/**
 * PLAN-4.6 R0: the extension contract of the next component core (types only; nothing imports
 * this file yet, so it adds 0 bytes to any bundle). R1-R4 implement it; R5 deletes the instance
 * patching it replaces. The prose contract, with the current consumers mapped to these hooks, is
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
  /** the intent's action names (SYG605 wiring checks, inspect()) */
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
  /** a non-STATE sink produced a value (stamped with `__emitterId`/`__emitterName`) */
  onSink?(inst: InstanceView, type: string, sink: string, value: any): void
  /** a model next(type, data, ms) was scheduled (replaces testing's NEXT_LOG debug-text parsing) */
  onNext?(inst: InstanceView, type: string, data: any, ms: number): void
  /** an ELEMENT command is about to run after the patch (testing records, diagnostics checks) */
  onElementCommand?(inst: InstanceView, command: any): void

  // ------------------------------------------------------------------ state, context, readiness
  /** an instance's (calculated) state changed in this flush (devtools onStateChanged) */
  onStateChanged?(inst: InstanceView, state: any): void
  /** an instance's props changed (devtools onPropsChanged, SYG props checks) */
  onPropsChanged?(inst: InstanceView, props: any): void
  /** an instance's context changed; `keys`: the keys that changed (D168) */
  onContextChanged?(inst: InstanceView, context: any, keys: string[]): void
  /** a child's READY flag changed (devtools, Suspense diagnostics) */
  onReady?(inst: InstanceView, child: InstanceView, ready: boolean): void
  /**
   * D168 safety net (dev only): a view the tracker skipped was re-run and gave a different vnode.
   * The core reports it with the R4 SYG code; the hook lets tests and devtools see it.
   */
  onContextMiss?(inst: InstanceView, keysRead: string[], changed: string[]): void

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
}

// ---------------------------------------------------------------------------------- 1. registries

/** A child that renders in place of a marker vnode (Collection, Switchable) */
export interface Host {
  /** render with the latest props; return the vnode to inject (the cached one when nothing changed) */
  render(): any
  setProps(props: Record<string, any>, children: any[]): void
  dispose(): void
  /** READY of its instances (Suspense) */
  readonly ready: boolean
}

export interface Registry {
  /** marker sel -> host factory (Collection, Switchable) */
  hosts: Record<string, (owner: InstanceView, props: Record<string, any>, children: any[]) => Host>
  /**
   * marker sel -> template rewrite during the reconcile walk (Portal, Transition, ClientOnly,
   * Slot): replace the marker with a plain vnode and keep walking its children.
   */
  pres: Record<string, (vnode: any, owner: InstanceView) => any>
  /** marker sel -> post-processor of the injected vnode of an instance whose template had it (Suspense) */
  posts: Record<string, (vnode: any, owner: InstanceView) => any>
  /** component function -> the function to instantiate (lazy: the loaded component once resolved) */
  resolvers: Array<(view: ComponentFn, owner: InstanceView) => ComponentFn | undefined>
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

/** Options of run() the next core reads; `hooks` is internal (dev entries, testing), not documented */
export interface InternalRunOptions {
  /** PLAN-4.6 R1-R4 only: which core (deleted in R5) */
  __core?: 'current' | 'next'
  /** hooks of this app (testing, devtools, diagnostics install theirs through these) */
  __hooks?: Hooks
}
