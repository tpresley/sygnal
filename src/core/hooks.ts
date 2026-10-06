/**
 * PLAN-4.6 R0: the extension contract of the component core (types only: 0 bytes in any bundle).
 * R1-R4 implemented it; R5 deleted the old core's instance patching it replaces. The prose
 * contract, with the consumers mapped to these hooks, is
 * dev-plans/research/core-rewrite/04-hooks-contract.md.
 *
 * Three layers:
 * 1. Registries (module level, filled on import): what a feature module adds to the core without
 *    the core naming it: hosts, markers (pre/post processors), view resolvers, definition hooks,
 *    statics. An app that never imports the module pays nothing (D157).
 * 2. Hooks (per app, from run() / renderComponent / the dev entries): observation and wrapping
 *    points for diagnostics, devtools, testing and the dev action log. Every hook is optional and
 *    the core calls it as `hooks.x?.(...)`.
 * 3. The runtime API handed to hooks: inspection views and `setState`, so no consumer needs a raw
 *    instance or a stream internal (`shamefullySendNext`, `_v`, `_n`).
 *
 * Invariants the hooks must not break (the flush contract, PLAN-4.6 §2 change 4):
 * - Actions drain run-to-completion, FIFO: an action dispatched while another is processed (a
 *   driver emitting synchronously during sink delivery, an EFFECT, a PARENT, a hook) is appended
 *   to the queue, never run nested.
 * - A STATE reducer is applied when its action is processed. Every other sink of that action gets
 *   the state from before it.
 * - A flush (one microtask after the first commit of a batch) repeats { render top-down, recompute
 *   statics, drain the queue } until nothing changed, then emits ONE root vnode (one patch), then
 *   runs ELEMENT commands and dispatches BOOTSTRAP for the instances created in it.
 * - Loop guard: at most 100 passes per flush and 100 flushes per macrotask; past that the next
 *   flush waits for a MessageChannel message. No timer anywhere in startup, flush or teardown.
 * - Hooks run synchronously inside these steps. A hook may dispatch (it is queued), but must not
 *   render, patch or dispose.
 */

// ---------------------------------------------------------------------------------- shared types

/** A component function with its statics (view + `.intent`, `.model`, `.initialState`, ...) */
export type ComponentFn = ((input: any) => any) & Record<string, any>

/** One normalized model entry: the sink and its handler (a function, or a constant value) */
export type Handler = [sink: string, fn: any]

/**
 * What a definition hook may read and edit: the component's statics, before normalization.
 * Behaviors' existing `merge(component, key)` runs on a shim with these fields (spike finding 5),
 * so `uses`, `undo`, `selection`, `pager` and `persist` work unchanged, once per component
 * function instead of once per instance.
 */
export interface DefSource {
  model: Record<string, any> | undefined
  intent: ((sources: any) => Record<string, any>) | undefined
  initialState: any
  /** defaults of missing state keys (a behavior's slice or a resource's `{status: 'idle'}` on a sub-component) */
  idle: Record<string, any> | null
  calculated: Record<string, any> | undefined
  context: Record<string, (state: any) => any> | undefined
  /** action -> behavior key, for action logs (`pager.NEXT` comes from `pager`) */
  behaviorActions: Record<string, string>
}

/** The normalized definition: computed once per component function (WeakMap) */
export interface Def {
  readonly name: string
  readonly view: ComponentFn
  readonly intent?: (sources: any) => Record<string, any>
  /** action -> handlers in model order; a function entry is STATE */
  readonly handlers: ReadonlyMap<string, readonly Handler[]>
  readonly sinks: ReadonlySet<string>
  readonly initialState: any
  readonly idle: Record<string, any> | null
  readonly isolated: boolean
  /** calculated fields in topological order (SYG206 / SYG209 thrown at definition) */
  readonly calculated: ReadonlyArray<[field: string, fn: (s: any) => any, deps: string[] | null]> | null
  readonly context: ReadonlyArray<[key: string, fn: (s: any) => any]> | null
  /** the statics this definition declares that some driver takes (`__sygnalStatic`) */
  readonly statics: ReadonlyArray<string>
  readonly behaviorActions: Readonly<Record<string, string>>
  readonly onError?: (error: any, info: {componentName: string}) => any
  /**
   * R4 (renderComponent's root only): the model actions the test may dispatch with
   * simulateAction that the intent doesn't name (wiring's SYG101/SYG102, inspect(); today's
   * `__sygnalTestActions` on the intent object)
   */
  readonly testActions?: readonly string[]
}

/** Where an action came from (testing's t.actions `cause`, devtools, the action log) */
export type ActionCause = 'intent' | 'next' | 'reply' | 'built-in' | 'simulateAction' | 'behavior' | 'parent' | 'setState'

/**
 * A read-only view of a live instance: everything devtools, diagnostics and testing read today
 * from raw instance fields (`_componentNumber`, `name`, `currentState`, `currentProps`,
 * `currentContext`, `isSubComponent`, `sources.__parentComponentNumber`, `_disposed`, ...).
 * Getters are live; the object is stable for the instance's life.
 */
export interface InstanceView {
  /** stable id (inspect()'s component id; today `_componentNumber`) */
  readonly id: number
  readonly parentId: number | undefined
  readonly name: string
  readonly def: Def
  /** the state the view gets (calculated fields included; `currentState` + `addCalculated`) */
  readonly state: any
  readonly props: Record<string, any>
  readonly context: Record<string, any>
  readonly isRoot: boolean
  /** 'item' (Collection), 'page' (Switchable), 'child' (tag), 'root' */
  readonly kind: 'root' | 'child' | 'item' | 'page'
  /** Switchable page: shown now (hidden pages skip render, keep actions and background statics) */
  readonly shown: boolean
  readonly disposed: boolean
  /** the uid() root of this instance (`__uid`) */
  readonly uid: string
  /** its children, in render order */
  children(): InstanceView[]
  /** the sources its intent got (after wrapSources), e.g. to compare with run()'s sources */
  readonly sources: Readonly<Record<string, any>>
}

/** An action as the queue holds it */
export interface ActionRecord {
  readonly type: string
  readonly data: any
  readonly cause: ActionCause
  /** the instance that runs it */
  readonly target: InstanceView
  /** a reply: the source (driver name) that delivered it (R4: devtools' replySink) */
  readonly source?: string
}

// ---------------------------------------------------------------------------------- 2. hooks

export interface Hooks {
  // ------------------------------------------------------------------ definition time
  /**
   * Called once per component function, before normalization, with the definition's statics.
   * Return a new (or the same, edited) DefSource. Runs for every app on the page (definitions are
   * shared), so it must depend only on `view`. Behaviors, undo, selection, pager, persist's model
   * rewrite and resources' RESOURCE entry use the module registry (`defHooks`) instead; this hook
   * is for a per-app consumer that needs the same point (diagnostics' SYG222 reducer wrapping,
   * strict checks of the model's shape).
   */
  transformDef?(src: DefSource, view: ComponentFn): DefSource | void

  // ------------------------------------------------------------------ instance lifetime
  /** after the instance's state cell and INITIALIZE, before its intent subscribes */
  onCreate?(inst: InstanceView): void
  /** at the start of dispose (DISPOSE has been queued; its streams are not stopped yet) */
  onDispose?(inst: InstanceView): void
  /** after the instance's view ran and its children were injected (only when it re-rendered) */
  onRender?(inst: InstanceView, vnode: any): void
  /** after the root vnode was patched (one per flush that changed the vnode) */
  onPatch?(vnode: any): void

  // ------------------------------------------------------------------ sources
  /**
   * The sources an instance's intent gets. Return a wrapper (a Proxy that records selectors, a
   * fake for a driverless sink, a checking DOM source). Called once per instance, before the
   * intent; `fake(name)` style sources added here take part in replies/statics detection, which
   * happens after this hook (today testing mutates `sources`/`sourceNames` from onIntent).
   */
  wrapSources?(inst: InstanceView, sources: Record<string, any>): Record<string, any>
  /** the intent's action names (the wiring checks, inspect()) */
  onIntent?(inst: InstanceView, actionNames: string[]): void

  // ------------------------------------------------------------------ actions
  /** an action is about to be processed (dequeued); `cause` says where it came from */
  onAction?(inst: InstanceView, action: ActionRecord): void
  /**
   * Wrap one handler of an action. `fn` is the model entry (a function or a constant). Return a
   * replacement with the same contract; ABORT / the same state still mean "no change". Used by
   * the action log (which sinks produced a value), SYG222 checks, devtools.
   */
  wrapHandler?(inst: InstanceView, type: string, sink: string, fn: any): any
  /** the STATE reducer of an action ran (`next` is what was written; `prev === next`: no change) */
  onReducer?(inst: InstanceView, type: string, prev: any, next: any): void
  /**
   * a non-STATE sink produced a value (before it is stamped with `__emitterId`/`__emitterName`).
   * R4: a declaration static sent to a driver (`{ resources }`, `{ connections }`, `{ timers }`,
   * ...) comes here too, with `type` null
   */
  onSink?(inst: InstanceView, type: string | null, sink: string, value: any): void
  /**
   * R4 (04 §4 #3): a host's props when it is created and each time its owner re-renders it
   * (`sel`: the marker's, a Collection's or a VirtualCollection's), before it renders; the Collection checks (SYG401
   * for a missing `from`) read them here. `data`: the marker's vnode data (4-H: the buckets a
   * removed wrapper element would have had: style, class, attrs, ...)
   */
  onHostProps?(owner: InstanceView, sel: string, props: Record<string, any>, data?: Record<string, any>): void
  /** a model next(type, data, ms) was scheduled (replaces testing's NEXT_LOG debug-text parsing) */
  onNext?(inst: InstanceView, type: string, data: any, ms: number): void
  /**
   * an ELEMENT command (or an array of them) was sent; it runs after the next patch (testing
   * records, diagnostics checks). `false`: not run (renderComponent's mock DOM records only)
   */
  onElementCommand?(inst: InstanceView, command: any): void | false

  // ------------------------------------------------------------------ state, context, readiness
  /** an instance's (calculated) state changed in this flush (devtools onStateChanged) */
  onStateChanged?(inst: InstanceView, state: any): void
  /** an instance's props changed (devtools onPropsChanged, SYG props checks) */
  onPropsChanged?(inst: InstanceView, props: any): void
  /** an instance's context changed; `keys`: the keys that changed (D168) */
  onContextChanged?(inst: InstanceView, context: any, keys: string[]): void
  /**
   * D174: an `isolatedState` child bound to a slice that already exists (state="key" or a lens,
   * without `resetState`) keeps the parent's data instead of its initialState. R4's dev warning
   * reports the keys `initialState` defines that the slice lacks.
   */
  onStateSeed?(inst: InstanceView, slice: any, initialState: any): void
  /** D169: a Collection item key (id, or raw index) that appears more than once; only its first element renders. R4's dev warning */
  onDuplicateKey?(owner: InstanceView, key: any): void
  /** a child's READY flag changed (devtools, Suspense diagnostics) */
  onReady?(inst: InstanceView, child: InstanceView, ready: boolean): void
  /**
   * D168 safety net (dev only; R4): context tracking skipped this view's re-render (the context
   * changed, but no key the view read). `render(ctx)` calls the view again with the instance's
   * current inputs and that context (a fresh template, nothing injected or patched), so the
   * consumer can compare `render(prev)` with `render(next)` on a sample of skips and report a
   * difference (sygnal/diagnostics: SYG423). `keysRead`: the keys the last view call read.
   */
  onContextSkip?(inst: InstanceView, render: (context: any) => any, prev: any, next: any, keysRead: string[]): void

  // ------------------------------------------------------------------ errors
  /** the app-level error hook (run()'s `onError`, GS-11), with the phase the error came from */
  onError?(error: any, info: {componentName: string; phase: 'view' | 'model' | 'intent' | 'calculated' | 'context' | 'widget' | 'driver'; action?: string}): void
}

/**
 * What the runtime hands to hooks and tools (devtools, testing, sygnal/element, HMR, Vike). It
 * replaces every `sinks.STATE.shamefullySendNext(...)` and `STATE.stream._v` reach-in.
 */
export interface RuntimeAPI {
  /** the root instance (devtools tree, inspect()) */
  readonly root: InstanceView
  /** find an instance by id (devtools selection, time travel) */
  get(id: number): InstanceView | undefined
  /** the current root state, synchronously (today `STATE.stream._v`) */
  getState(): any
  /**
   * Replace the state of `target` (the root, or an instance's own cell: a Collection item, an
   * isolatedState component) as a 'setState' action: queued, applied run-to-completion, one patch.
   * A function gets the current state. Devtools time travel, element prop sync, HMR state
   * restore, Vike page swaps, persist RESTORE.
   */
  setState(target: 'root' | InstanceView | number, state: any | ((current: any) => any)): void
  /** dispatch an action to an instance, as if its intent emitted it (testing's simulateAction) */
  dispatch(target: 'root' | InstanceView | number, type: string, data?: any, cause?: ActionCause): void
  /** add / remove hooks on a live app (devtools connecting late; sygnal/diagnostics installed after run()) */
  addHooks(hooks: Hooks): () => void
  /** a resolved promise after the current flush (testing's settle without polling) */
  flushed(): Promise<void>
  /** R4: debug logging for one instance on / off (the DevTools toggle; core/debug.ts) */
  setDebug(target: 'root' | InstanceView | number, on: boolean): void
}

// ---------------------------------------------------------------------------------- 1. registries

/**
 * A child that renders in place of a marker vnode (Collection, Switchable). The registry entries
 * are core modules: they get the owner's raw instance (R2), unlike hooks.
 */
export interface Host {
  /** render with the latest props; return the vnode to inject (the cached one when nothing changed) */
  render(): any
  /** the latest props and children; `marker` / `id`: the marker vnode and its id in the owner */
  setProps(props: Record<string, any>, children: any[], marker?: any, id?: string): void
  dispose(): void
  /** READY of its instances (Suspense); Collection and Switchable stay ready, as today */
  readonly ready: boolean
  /** its instances (byId, InstanceView.children) */
  insts(): any[]
}

export interface Registry {
  /** marker sel -> host factory (Collection, Switchable) */
  hosts: Record<string, (owner: any, props: Record<string, any>, children: any[], id: string, marker: any) => Host>
  /**
   * marker sel -> template rewrite during the reconcile walk (Portal, Transition, ClientOnly,
   * Slot): replace the marker with a plain vnode and keep walking its children.
   */
  pres: Record<string, (vnode: any, owner: any) => any>
  /** marker sel -> post-processor of the injected vnode of an instance whose template had it (Suspense) */
  posts: Record<string, (vnode: any, owner: any) => any>
  /**
   * component function -> the function to instantiate (lazy: the loaded component once resolved;
   * `owner.refresh()` renders the owner again when it loads)
   */
  resolvers: Array<(view: ComponentFn, owner: any) => ComponentFn | undefined>
  /** definition time, every app: behaviors (`uses`), undo, selection, pager, persist, resources */
  defHooks: Array<(src: DefSource, view: ComponentFn) => DefSource | void>
}

/**
 * The statics contract (unchanged from today's generic path, `__sygnalStatic`): a driver source
 * that names a static (`__sygnalStatic: 'timers'`) gets each declaring instance's value of
 * `view[static](state)` on its sink, recomputed on commits that changed that instance's state,
 * dropped when deep-equal to the last (objIsEqual), filtered to `background: true` entries while
 * the instance is on a hidden Switchable page, stamped with `__emitterId` / `__emitterName`.
 * A source with `__sygnalReplies: true` and `replies(emitterId)` sends reply actions back to
 * exactly that instance. Optional `isolateValue(value, scope)` lets a driver scope a sink value
 * without a stream per instance (03 §5); without it the core falls back to `isolateSink`.
 */
export interface StaticsSource {
  __sygnalStatic?: string
  __sygnalReplies?: true
  replies?(emitterId: number): any
  isolateSource?(source: any, scope: string): any
  isolateSink?(sink$: any, scope: string): any
  isolateValue?(value: any, scope: string): any
}

/** Options of run() the core reads; `hooks` is internal (dev entries, testing), not documented */
export interface InternalRunOptions {
  /** hooks of this app (testing, devtools, diagnostics install theirs through these) */
  __hooks?: Hooks
}
