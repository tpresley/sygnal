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
 * also be on. Runtime rules: SYG501 (positional view args), SYG502 (reducer
 * returned the unchanged state instead of ABORT), SYG504 ('ACTION | SINK'
 * keys); `sygnal-check --strict` checks all of SYG501-507 statically.
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
export type InspectActionTrigger = 'intent' | 'next' | 'routed' | 'builtin' | 'unknown'

export interface InspectAction {
  name: string
  /**
   * 'intent': returned by the component's intent. 'builtin': BOOTSTRAP,
   * INITIALIZE, DISPOSE or READY. 'routed': named by a routed request
   * (`ok: 'NAME'` / `error: 'NAME'`) or a `connections` entry (statically: a
   * string literal; at runtime: a request the instance was seen sending).
   * 'next': dispatched with next() (statically: a next('NAME') literal; at
   * runtime: a model-only action whose STATE reducer was seen running).
   * 'unknown': none of these is known.
   */
  trigger: InspectActionTrigger
  /** sinks of the model entry (STATE, EVENTS, EFFECT, PARENT, custom drivers); [] without a model entry */
  sinks: string[]
}

export interface InspectChild {
  name: string
  via: 'tag' | 'collection' | 'switchable' | 'slot'
  /** Collection: the `from` state field, when known */
  from?: string | null
  /** runtime: number of live instances behind this entry (e.g. Collection items) */
  count?: number
}

export interface InspectSelector {
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
}

export interface InspectDiagnostic {
  code: string
  severity: DiagnosticSeverity
  component?: string
  message: string
  fix?: string
  docsUrl?: string
  data?: any
  /** static only */
  file?: string
  line?: number
  column?: number
}

export interface InspectComponent {
  name: string
  /** runtime: instance number (as a string); static: 'file:line' of the definition */
  id: string
  /** runtime: the parent instance's id; static: null (see the parents' `children`) */
  parentId: string | null
  /** static only: source file, relative to the working directory */
  file?: string
  /**
   * runtime: how the instance was created; static: 'root' when no scanned
   * component renders it, else how it is first rendered
   */
  kind: 'root' | 'child' | 'collection-item' | 'switchable'
  actions: InspectAction[]
  /** state keys (runtime: current state; static: initialState) */
  stateKeys: string[]
  /** calculated field names */
  calculated: string[]
  /** context fields this component provides (Component.context) */
  contextProvides: string[]
  /** context fields its view reads (static only; null at runtime) */
  contextConsumes?: string[] | null
  /** EVENTS types this component emits */
  eventsEmitted: string[]
  /** EVENTS types this component selects ('*' = EVENTS.select() without a type) */
  eventsSelected: string[]
  children: InspectChild[]
  selectors: InspectSelector[]
  diagnostics: InspectDiagnostic[]
}

export interface InspectGraph {
  version: 1
  /** which implementation produced the graph */
  source?: 'runtime' | 'static'
  components: InspectComponent[]
  /** EVENTS bus: type -> names of the components that emit / select it */
  events: Record<string, { emitters: string[]; selectors: string[] }>
  /** diagnostics not tied to a listed component */
  diagnostics: InspectDiagnostic[]
}

export interface InspectOptions {
  /** only these component instances (ids as in InspectComponent.id) */
  ids?: Array<string | number>
  /** selector details by component id (renderComponent passes its mock-DOM view) */
  selectors?: Record<string, InspectSelector[]>
  /** diagnostics to attach (default: the devtools' collected diagnostics, when available) */
  diagnostics?: Array<{ code: string; severity: DiagnosticSeverity; component?: string; message: string; [key: string]: any }>
}

/**
 * The app graph of the live component instances, built from what the
 * diagnostics hooks have seen (so diagnostics must be on while the app runs).
 * Disposed components are pruned. Also available as `getDevTools().inspect()`
 * / `window.__SYGNAL_DEVTOOLS__.inspect()` once the devtools bridge exists
 * (run() in a browser), and as renderComponent's `t.inspect()`.
 */
export function inspect(options?: InspectOptions): InspectGraph
