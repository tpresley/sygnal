/**
 * Types for the 'sygnal/diagnostics' entry (runtime consistency checks).
 *
 *   import 'sygnal/diagnostics'   // registers all checks (side effect)
 *
 * Checks only run while diagnostics are on: run(App, drivers, { diagnostics: 'warn' }),
 * or globalThis.__SYGNAL_DEV__ (set by the Vite plugin in dev).
 */

export type DiagnosticSeverity = 'error' | 'warn' | 'info'

export interface DiagnosticCodeInfo {
  code: string
  severity: DiagnosticSeverity
  title: string
  /** anchor on https://sygnal.js.org/reference/errors, e.g. 'syg101' */
  docsSlug: string
}

/** A runtime check, as registered with the diagnostics core. */
export interface DiagnosticCheck {
  id: string
  onIntent?: (component: any, actionNames: string[], selectorsUsed: string[] | undefined) => void
  onModel?: (component: any, modelMap: Record<string, string[]>) => void
  onRender?: (component: any, rootVnode: any) => void
  onReducer?: (component: any, action: string, prevState: any, nextState: any, sinkName: string) => void
  onDispose?: (component: any) => void
  onSelector?: (domSource: any, selector: string) => void
  onBusEmit?: (type: string, emitterName?: string) => void
  onBusSelect?: (type: string | string[] | undefined) => void
}

/**
 * Strict mode (canonical forms, SYG5xx): turn the runtime strict checks on
 * (true), off (false), or back to the default (undefined → on only when
 * globalThis.__SYGNAL_STRICT__ === true). Off by default. Diagnostics must
 * also be on. Runtime rules: SYG501 (positional view args), SYG504 ('ACTION | SINK'
 * keys); `sygnal-check --strict` checks SYG501-508 statically (SYG502 is retired in 6.0).
 * In tests: renderComponent(C, { strict: true }).
 */
export function configureStrict(on?: boolean): void

/** Whether the runtime strict checks are on. */
export function isStrictEnabled(): boolean

/** Every runtime check in this entry. */
export const checks: DiagnosticCheck[]

/** Re-register all checks and the RxJS hints (done automatically on import). Returns an uninstall function. */
export function installChecks(): () => void

export interface ChecksOptions {
  /** delay after a render before the DOM checks (SYG103/104) run; default 50 ms */
  settleMs?: number
  /** render-idle time before SYG103 escalates to warn; default 2000 ms */
  idleMs?: number
  /** renders required before SYG103 escalates to warn; default 3 */
  minRenders?: number
}

/** Tune the timing of the DOM checks (mostly for tests). */
export function configureChecks(options?: ChecksOptions): void

/** Forget what the checks have seen and reported (dedupe state, registries). For tests. */
export function resetChecks(): void

export interface EventBusSummary {
  selected: string[]
  emitted: string[]
  selectedNeverEmitted: string[]
  emittedNeverSelected: string[]
}

/**
 * Report SYG105 (info) for every EVENTS type selected but never emitted so far,
 * and return the EVENTS bus registry.
 */
export function checkEventBus(): EventBusSummary

/** RxJS operator name -> xstream equivalent (used by SYG301). */
export const RXJS_HINTS: Record<string, string>

/** Metadata for every registered diagnostic code. */
export function listCodes(): DiagnosticCodeInfo[]

/** Metadata for one diagnostic code, or undefined if unknown. */
export function getCodeInfo(code: string): DiagnosticCodeInfo | undefined

// ---------------------------------------------------------------------------
// inspect (PLAN-1 workstream 2B): a machine-readable app graph. The same shape
// is produced at runtime (inspect(), getDevTools().inspect(), renderComponent's
// t.inspect()) and statically (`sygnal-check --graph --json`); JSON Schema:
// sygnal-check/schema/inspect.schema.json. Fields one side cannot know are
// null (or omitted).
// ---------------------------------------------------------------------------

/** How an action is dispatched. */
/** 'agent' (static, PLAN-6 K-1): only the component's `agent` declaration dispatches it */
/**
 * 'behavior' (static, PLAN-10 A-8): a `uses` entry's action nothing else triggers that the behavior
 * may dispatch itself where the checker can't list it (a package behavior, an open model, ...)
 */
export type InspectActionTrigger = 'intent' | 'next' | 'reply' | 'builtin' | 'agent' | 'behavior' | 'unknown'

/**
 * PLAN-10 A-4 (static only): a source position, 1-based. `file` (relative to the working
 * directory) only when it isn't the component's file.
 */
export interface InspectLocation {
  line: number
  column: number
  file?: string
}

export interface InspectAction extends Partial<InspectLocation> {
  name: string
  /**
   * 'intent': returned by the component's intent. 'builtin': BOOTSTRAP,
   * INITIALIZE, DISPOSE or READY. 'reply': named as a reply action by a request
   * (`ok: 'NAME'` / `error: 'NAME'`) or a `connections` entry (statically: a
   * string literal; at runtime: a request the instance was seen sending).
   * 'next': dispatched with next() (statically: a next('NAME') literal; at
   * runtime: a model-only action whose STATE reducer was seen running).
   * 'unknown': none of these is known.
   */
  trigger: InspectActionTrigger
  /** sinks of the model entry (STATE, EVENTS, EFFECT, PARENT, custom drivers); [] without a model entry */
  sinks: string[]
  /** the `uses` key of the behavior that owns it ('pager' for 'pager.NEXT') */
  behavior?: string
  /** static, PLAN-10 A-4: the model entry (line/column on the action: the intent property, else this) */
  modelAt?: InspectLocation
}

export interface InspectChild extends Partial<InspectLocation> {
  name: string
  via: 'tag' | 'collection' | 'switchable' | 'slot'
  /** Collection: the `from` state field, when known */
  from?: string | null
  /** runtime: number of live instances behind this entry (e.g. Collection items) */
  count?: number
  /** runtime, PLAN-10 D522: the ids of those instances */
  ids?: string[]
  /**
   * static, PLAN-10 A-3: the id of the component it renders (resolved through the import); null when
   * it isn't in the graph (a package, a widget, a file not scanned, a dynamic value)
   */
  id?: string | null
  /** static, PLAN-10 A-1: a literal `state` lens (`<Greeting state="host" />`) */
  state?: string
  /** static, PLAN-10 A-2: the package the tag is imported from ('sygnal/ui') */
  external?: string
  /** static, PLAN-10 A-2: a widget tag (defineWidget, fromZag, fromReact, the sygnal/ui Zag parts) */
  widget?: true
}

/** PLAN-10 A-5 (static): a CHILD.select(Child) call in an intent */
export interface InspectChildSelect extends InspectLocation {
  /** the selected component's name as written */
  child: string | null
  /** its id; null when it isn't in the graph */
  id: string | null
  /** the intent actions whose stream contains the call (the receivers of the child's PARENT sink) */
  actions: string[]
}

export interface InspectSelector extends Partial<InspectLocation> {
  /** CSS selector passed to DOM.select() (chained selects joined with a space) */
  selector: string
  /** event types listened to; null when unknown (runtime, real DOM) */
  events: string[] | null
  /**
   * whether it matches an element the component itself renders; null when unknown.
   * static: the class/id is in the view source. renderComponent: an element of the latest
   * render matches (a conditionally rendered element that is hidden right now gives false).
   * real DOM: true once a DOM check saw it match, false after SYG103/SYG104, else null.
   */
  matched: boolean | null
  /** the child component whose (isolated) elements it matches instead, if any */
  isolationHit: string | null
  /** PLAN-4 CT-1: the control this selector is (its key), when it is `[data-control="<Key>"]` */
  control?: string
  /** the `uses` key of the behavior that listens to it */
  behavior?: string
}

/** PLAN-4 CT-1: a control (controls()) a component renders */
export interface InspectControl extends Partial<InspectLocation> {
  /** the control's key (rendered as data-control="<name>") */
  name: string
  /** the intrinsic tag of a tag spec; null for a spec object */
  element: string | null
  /** a spec object's kind (e.g. 'widget') */
  kind?: string
  /** whether the component's intent listens to it; null when unknown */
  listened: boolean | null
}

export interface InspectDiagnostic {
  code: string
  severity: DiagnosticSeverity
  component?: string
  /** static, PLAN-10 A-3: the id of the component it is attached to */
  componentId?: string
  message: string
  fix?: string
  docsUrl?: string
  data?: any
  /** runtime only: when it was reported (ms since the epoch; each is reported once per process) */
  timestamp?: number
  /** static only */
  file?: string
  line?: number
  column?: number
  /** static only: the range end (1-based; endColumn exclusive, UTF-16 units) */
  endLine?: number
  endColumn?: number
  /** static only: the other locations of a pair or cross-file finding */
  related?: InspectRelatedLocation[]
  /** static only: mechanical fixes as text edits (sygnal-check, PLAN-7 C-4) */
  fixes?: InspectFix[]
}

/** A fix for a static diagnostic: apply all of its edits together. */
export interface InspectFix {
  title: string
  kind: 'quickfix' | 'refactor'
  /** the one obvious fix (LSP `isPreferred`) */
  preferred?: boolean
  /** a mechanical rewrite `sygnal-check --fix` applies */
  fixAll?: boolean
  edits: InspectTextEdit[]
}

/**
 * Replace `start`..`end` of `file` with `text`. Offsets count UTF-16 units; `line`/`column` ..
 * `endLine`/`endColumn` are the same range, 1-based, `endColumn` exclusive. `file` may differ
 * from the diagnostic's.
 */
export interface InspectTextEdit {
  file: string
  start: number
  end: number
  line: number
  column: number
  endLine: number
  endColumn: number
  text: string
}

/** A diagnostic's other location (static only; same units as InspectDiagnostic's range). */
export interface InspectRelatedLocation {
  file: string
  line: number
  column: number
  endLine: number
  endColumn: number
  message: string
}

export interface InspectComponent {
  name: string
  /** runtime: instance number (as a string); static: 'file:line' of the definition */
  id: string
  /**
   * static, PLAN-10 D521: 'file#name', stable when lines move (hosts key selection and positions by it);
   * a second component of the same name in one file gets 'file#name#2', and so on. Not at runtime
   */
  key?: string
  /** runtime: the parent instance's id; static: null (see the parents' `children`) */
  parentId: string | null
  /** static only: source file, relative to the working directory */
  file?: string
  /**
   * runtime: how the instance was created; static: 'root' when no scanned
   * component renders it, else how it is first rendered
   */
  kind: 'root' | 'child' | 'collection-item' | 'switchable'
  /** PLAN-10 A-1 / D522: rendered as a component (or started as an entry) but has no statics */
  viewOnly?: true
  /**
   * static, PLAN-10 A-6: started by run(), defineElement() or a Vike +Page / +Layout; 'unknown' on the
   * other roots when an entry call's component can't be resolved (picked at run time).
   * runtime (D522): true on an app's root instance
   */
  entry?: true | 'unknown'
  /** runtime, PLAN-10 D522: the app (run()) it belongs to: its root's index among the live roots, oldest first */
  app?: number
  /** runtime, PLAN-10 D522: false on a hidden Switchable page and below it; omitted when shown */
  shown?: false
  actions: InspectAction[]
  /** state keys (runtime: current state; static: initialState) */
  stateKeys: string[]
  /** calculated field names */
  calculated: string[]
  /** context fields this component provides (Component.context) */
  contextProvides: string[]
  /** context fields its view reads (static: the view source; runtime, D530: what its latest render read) */
  contextConsumes?: string[] | null
  /** EVENTS types this component emits */
  eventsEmitted: string[]
  /** EVENTS types this component selects ('*' = EVENTS.select() without a type) */
  eventsSelected: string[]
  children: InspectChild[]
  selectors: InspectSelector[]
  /** static, PLAN-10 A-4: where the `context` static's entries are */
  contextEntries?: Array<InspectLocation & { name: string }>
  /** static, PLAN-10 A-4: the EVENTS emit and select sites of its intent and model */
  eventSites?: Array<InspectLocation & { type: string; role: 'emit' | 'select' }>
  /** static, PLAN-10 A-5: CHILD.select(Child) in its intent */
  childSelects?: InspectChildSelect[]
  /** PLAN-4 CT-1: the controls it renders (runtime: seen in its renders); omitted when none */
  controls?: InspectControl[]
  /** static only, PLAN-4 GS-2 (G-224): the element commands (ELEMENT sink) its model sends; omitted when none */
  commands?: InspectCommand[]
  /** static only, PLAN-4 GS-7 (G-224): the literal timer specs of its `timers` static; omitted when none */
  timers?: InspectTimer[]
  /** static only, PLAN-6 K-1: the component's `agent` declaration (sygnal/ai); omitted when none */
  agent?: InspectAgent
  diagnostics: InspectDiagnostic[]
  /** runtime, PLAN-3 5-3: the instance's `resources` and their state */
  resources?: InspectResource[]
}

/** PLAN-4 GS-2: an element command a model entry sends (static inspect, sygnal-check --graph) */
export interface InspectCommand extends Partial<InspectLocation> {
  /** the model entry that sends it */
  action: string
  /** the command's method (its first key) */
  method: string
  /** the control's key or the selector; null when not static */
  target: string | null
  /** the control it targets (its key) */
  control?: string
  /** intent actions listening on the target for a native event the command causes (close, toggle...) */
  triggers?: string[]
}

/** PLAN-6 K-1: a component's `agent` declaration (static inspect, sygnal-check --graph) */
export interface InspectAgent {
  /** the literal agent.name; null when absent or not a literal */
  name: string | null
  /** the tool-name prefix (agent.name, else the component name, snake_case); null when not static */
  tools: string | null
  description: string | null
  /** the declaration has a read projection */
  read: boolean
  actions: Array<{ name: string; consequential: boolean; input: boolean } & Partial<InspectLocation>>
  /** the read-only `agent.queries` tools; omitted when none */
  queries?: Array<{ name: string; input: boolean } & Partial<InspectLocation>>
  /** spreads: what is listed may be incomplete */
  partial?: true
}

/** PLAN-4 GS-7: a literal timer spec of a `timers` static (static inspect, sygnal-check --graph) */
export interface InspectTimer extends Partial<InspectLocation> {
  name: string
  every?: number | null
  after?: number | null
  /** the action a frame timer dispatches */
  frame?: string | null
  action?: string | null
  background?: true
}

/** PLAN-3 5-3: a resource of a component instance (runtime inspect()) */
export interface InspectResource {
  name: string
  status: 'idle' | 'loading' | 'success' | 'error'
  refreshing: boolean
  /** `data` is set (a success, or kept through a refetch) */
  hasData: boolean
  /** the error message while 'error' */
  error?: string
}

/** PLAN-3 5-3: a makeFetchDriver cache entry (runtime inspect(), t.cache) */
export interface InspectCacheEntry {
  key: string
  age?: number
  stale: boolean
  subscribers: number
  data: any
}

export interface InspectGraph {
  version: 1
  /** which implementation produced the graph */
  source?: 'runtime' | 'static'
  components: InspectComponent[]
  /**
   * EVENTS bus: type -> names of the components that emit / select it (each name once); emitterIds /
   * selectorIds (PLAN-10 A-3, D522, D528): the id of every such component (static) or instance
   * (runtime), not parallel to the names
   */
  events: Record<string, { emitters: string[]; selectors: string[]; emitterIds?: string[]; selectorIds?: string[] }>
  /** diagnostics not tied to a listed component */
  diagnostics: InspectDiagnostic[]
  /** runtime, PLAN-3 5-3: makeFetchDriver cache entries, by sink name (empty when no cache) */
  cache?: Record<string, InspectCacheEntry[]>
  /** runtime, PLAN-4 2-C (GS-10): with `inspect({ actions })`, the most recent actions, oldest first */
  recentActions?: InspectRecentAction[]
}

/** PLAN-4 2-C (GS-10): one recent action (inspect({ actions })) */
export interface InspectRecentAction {
  type: string
  /** the action's data, when it is JSON-safe and small (a DOM event is left out) */
  data?: any
  /** the component's name */
  component: string
  /** the instance's id (InspectComponent.id) */
  instance: string
  /** the sinks that produced a value for it (not ABORT) */
  sinks: string[]
  cause: 'intent' | 'next' | 'reply' | 'built-in' | 'simulateAction' | 'behavior' | 'agent'
  /** ms since the dev entry started recording (or the last resetChecks()) */
  at: number
}

export interface InspectOptions {
  /** only these component instances (ids as in InspectComponent.id) */
  ids?: Array<string | number>
  /** selector details by component id (renderComponent passes its mock-DOM view) */
  selectors?: Record<string, InspectSelector[]>
  /** diagnostics to attach (default: the devtools' collected diagnostics, when available) */
  diagnostics?: Array<{ code: string; severity: DiagnosticSeverity; component?: string; message: string; [key: string]: any }>
  /** PLAN-4 2-C: add `recentActions`: true for every kept one (the last 200), a number for the last n */
  actions?: boolean | number
}

/**
 * The app graph of the live component instances, built from what the
 * diagnostics hooks have seen (so diagnostics must be on while the app runs).
 * Disposed components are pruned. Also available as `getDevTools().inspect()`
 * / `window.__SYGNAL_DEVTOOLS__.inspect()` once the devtools bridge exists
 * (run() in a browser), and as renderComponent's `t.inspect()`.
 */
export function inspect(options?: InspectOptions): InspectGraph
