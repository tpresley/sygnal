/**
 * Sygnal diagnostics core.
 *
 * ===========================================================================
 * FROZEN INTERFACE (PLAN-1 workstream 0B). Changes after the 0B merge go
 * through the coordinator. Later workstreams add checks (registerCheck) and
 * codes (./codes.ts, inside their reserved range) — they do not change these
 * signatures.
 * ===========================================================================
 *
 * --- Reporting ------------------------------------------------------------
 *
 *   report(code: string, details: {
 *     component?: string | { name?: string }   // component name or instance
 *     message: string                          // what is wrong
 *     fix?: string                             // how to fix it
 *     data?: any                               // structured payload
 *     severity?: 'error' | 'warn' | 'info'     // override the code's default
 *   }): Diagnostic | undefined
 *
 *     - mode 'off'     → no-op, returns undefined (nothing collected/printed)
 *     - code in ignore list → no-op, returns undefined
 *     - mode 'collect' → collected, no console output
 *     - mode 'warn'    → collected; 'warn' → console.warn, 'error' → console.error,
 *                        'info' → collected only
 *     - mode 'error'   → collected; 'warn'/'error' severities throw a
 *                        DiagnosticError (err.diagnostic holds the Diagnostic);
 *                        'info' collected only. Called directly this throws
 *                        synchronously; raised during a hook (i.e. from a
 *                        check) it is rethrown asynchronously — see Hooks.
 *
 *     `diagnostic.text` is formatted lazily (getter) on first read.
 *
 *   formatDiagnostic(code, details): string
 *     → `[Sygnal SYG123] <Component>: <message>. <fix> <docsUrl>`
 *       (works in every mode; for call sites that must keep printing in 'off')
 *
 *   getDiagnostics(): Diagnostic[]          // copy of the collected list
 *   clearDiagnostics(): void
 *   onDiagnostic(cb: (d: Diagnostic) => void): () => void   // returns unsubscribe
 *
 * --- Configuration --------------------------------------------------------
 *
 *   configureDiagnostics({ mode?: DiagnosticsMode | undefined, ignore?: string[] }): void
 *   getDiagnosticsMode(): 'off' | 'collect' | 'warn' | 'error'
 *   isDiagnosticsEnabled(): boolean
 *
 *   Mode resolution — first defined wins:
 *     1. explicit mode: run(App, drivers, { diagnostics }) or configureDiagnostics({ mode })
 *     2. globalThis.__SYGNAL_DEV__ (=== true → 'warn'; injected by the Vite plugin in serve)
 *     3. 'off'
 *   The mode is resolved at module load, on every run() call and on every
 *   configureDiagnostics() call. `configureDiagnostics({ mode: undefined })`
 *   clears the explicit mode and falls back to steps 2-3.
 *   Every run() call is authoritative: it sets both the explicit mode and the
 *   ignore list from its `diagnostics` option, and run() WITHOUT the option
 *   resets them to the defaults (no explicit mode, empty ignore list), so a
 *   setting from an earlier run()/configureDiagnostics() does not leak in.
 *
 * --- Checks ---------------------------------------------------------------
 *
 *   registerCheck(check: DiagnosticCheck): () => void      // returns unregister
 *
 *   interface DiagnosticCheck {
 *     id: string
 *     onIntent?(component, actionNames: string[], selectorsUsed: string[] | undefined): void
 *     onModel?(component, modelMap: Record<string, string[]>): void
 *     onRender?(component, rootVnode: any): void
 *     onReducer?(component, action: string, prevState: any, nextState: any, sinkName: string): void
 *     onDispose?(component): void
 *   }
 *
 *   A check that throws (other than a DiagnosticError from 'error' mode) is
 *   isolated: the exception is reported as SYG900 and other checks still run.
 *
 * --- Hooks (called from src/component.ts, marked `// [diagnostics hook]`) ----
 *
 *   onIntent(component, actionNames, selectorsUsed?)
 *     after intent is built. actionNames = keys of the intent object ([] for a
 *     single-stream intent). selectorsUsed is currently always undefined —
 *     TODO(1A): collect via MainDOMSource.select instrumentation in src/cycle/dom.
 *   onModel(component, modelMap)
 *     after the model is normalized; modelMap = action → sink names, shorthand
 *     ('A | SINK') expanded, plain functions mapped to the state sink,
 *     includes built-ins such as INITIALIZE.
 *   onRender(component, rootVnode)
 *     after each render of the component (fully injected vnode, before the DOM
 *     driver patches it; `rootVnode.elm` is populated after the patch, so DOM
 *     checks should defer, e.g. with a microtask/timeout).
 *   onReducer(component, action, prevState, nextState, sinkName)
 *     after each STATE reducer returns (not for ABORT, not when the reducer
 *     throws). nextState is the raw reducer return value (before calculated
 *     field cleanup). Currently only fired for the state sink; sinkName is the
 *     component's state source name.
 *   onDispose(component)
 *     at the start of component disposal.
 *
 *   onIntent and onModel are each called exactly once per component instance,
 *   in that order, during construction (also when the component has no
 *   intent → actionNames [], or no model → modelMap {}).
 *
 *   `component` is the internal Component instance (stable identity per
 *   instance; `.name` is the component name).
 *
 *   Every hook starts with a single boolean check and returns immediately
 *   when the mode is 'off'.
 *
 *   Hooks NEVER throw synchronously into Sygnal's stream pipeline (a throw
 *   there would kill the state/view stream for good). Every exception from a
 *   check is caught. In 'error' mode a DiagnosticError raised during a hook —
 *   by a check's report() call, or by the SYG900 report for a check that
 *   threw a plain Error — is rethrown ASYNCHRONOUSLY (queueMicrotask, falling
 *   back to setTimeout), so test runners still see an uncaught error while
 *   the app's streams keep running. The remaining checks still run.
 *   `_setAsyncThrow(fn?)` replaces the async rethrow (test seam; no argument
 *   restores the default; `_resetDiagnostics()` also restores it).
 *
 * (This comment is attached to the type-only import below so the TypeScript
 * emit drops it — keeps it out of the published bundle and the size gate.)
 */
import type { DiagnosticSeverity } from './codes'
import { CODE_SEVERITY, docsUrlFor } from './codes'


export type DiagnosticsMode = 'off' | 'collect' | 'warn' | 'error'

export interface DiagnosticDetails {
  component?: string | { name?: string }
  message: string
  fix?: string
  data?: any
  severity?: DiagnosticSeverity
}

export interface Diagnostic {
  code: string
  severity: DiagnosticSeverity
  component?: string
  message: string
  fix?: string
  data?: any
  docsUrl: string
  text: string
  timestamp: number
}

export interface DiagnosticsOptions {
  mode?: DiagnosticsMode
  ignore?: string[]
}

export interface DiagnosticCheck {
  id: string
  onIntent?: (component: any, actionNames: string[], selectorsUsed: string[] | undefined) => void
  onModel?: (component: any, modelMap: Record<string, string[]>) => void
  onRender?: (component: any, rootVnode: any) => void
  onReducer?: (component: any, action: string, prevState: any, nextState: any, sinkName: string) => void
  onDispose?: (component: any) => void
}

export class DiagnosticError extends Error {
  diagnostic: Diagnostic
  constructor(diagnostic: Diagnostic) {
    super(diagnostic.text)
    this.diagnostic = diagnostic
  }
}

let explicitMode: DiagnosticsMode | undefined
let mode: DiagnosticsMode = 'off'
let enabled = false
let ignored = new Set<string>()
let collected: Diagnostic[] = []
let listeners: Array<(d: Diagnostic) => void> = []
let checks: DiagnosticCheck[] = []

export function resolveDiagnosticsMode(): DiagnosticsMode {
  mode = explicitMode || ((globalThis as any).__SYGNAL_DEV__ === true ? 'warn' : 'off')
  enabled = mode !== 'off'
  return mode
}

export function configureDiagnostics(options: DiagnosticsOptions = {}): void {
  if ('mode' in options) explicitMode = options.mode
  if (options.ignore) ignored = new Set(options.ignore)
  resolveDiagnosticsMode()
}

export function getDiagnosticsMode(): DiagnosticsMode {
  return mode
}

export function isDiagnosticsEnabled(): boolean {
  return enabled
}

const nameOf = (c: DiagnosticDetails['component']) => (c && typeof c === 'object' ? c.name : c) || undefined
const sentence = (s: string) => /[.!?]$/.test(s) ? s : s + '.'

export function formatDiagnostic(code: string, details: DiagnosticDetails): string {
  const name = nameOf(details.component)
  return `[Sygnal ${code}] ${name ? name + ': ' : ''}${sentence(details.message)}` +
    (details.fix ? ' ' + sentence(details.fix) : '') + ' ' + docsUrlFor(code)
}

export function report(code: string, details: DiagnosticDetails): Diagnostic | undefined {
  if (!enabled || ignored.has(code)) return
  const severity = details.severity || CODE_SEVERITY[code] || 'warn'
  const d: Diagnostic = {
    code,
    severity,
    component: nameOf(details.component),
    message: details.message,
    fix: details.fix,
    data: details.data,
    docsUrl: docsUrlFor(code),
    get text() { return formatDiagnostic(code, this) },
    timestamp: Date.now(),
  }
  if (collected.push(d) > 500) collected.shift()
  listeners.forEach(cb => { try { cb(d) } catch (_) {} })
  if (severity !== 'info') {
    if (mode === 'error') throw new DiagnosticError(d)
    if (mode === 'warn') console[severity](d.text)
  }
  return d
}

export function getDiagnostics(): Diagnostic[] {
  return collected.slice()
}

export function clearDiagnostics(): void {
  collected = []
}

export function onDiagnostic(cb: (d: Diagnostic) => void): () => void {
  listeners = [...listeners, cb]
  return () => { listeners = listeners.filter(l => l !== cb) }
}

export function registerCheck(check: DiagnosticCheck): () => void {
  checks = [...checks, check]
  return () => { checks = checks.filter(c => c !== check) }
}

type HookName = Exclude<keyof DiagnosticCheck, 'id'>

const defaultAsyncThrow = (err: any): void => {
  const raise = () => { throw err }
  typeof queueMicrotask === 'function' ? queueMicrotask(raise) : setTimeout(raise)
}
let asyncThrow = defaultAsyncThrow

/** Test seam: replace the async rethrow used for 'error'-mode diagnostics raised in hooks. */
export function _setAsyncThrow(fn?: (err: any) => void): void {
  asyncThrow = fn || defaultAsyncThrow
}

const hook = (name: HookName) => (component: any, ...args: any[]): void => {
  if (!enabled) return
  for (const check of checks) {
    try {
      (check[name] as any)?.(component, ...args)
    } catch (err: any) {
      // Never throw into the stream pipeline: 'error'-mode diagnostics (also a
      // SYG900 escalated by 'error' mode) are rethrown asynchronously.
      try {
        if (err instanceof DiagnosticError) throw err
        report('SYG900', {
          component,
          message: `Diagnostics check '${check.id}' threw in ${name}: ${err?.message}`,
          data: { check: check.id, hook: name, error: err },
        })
      } catch (e) {
        asyncThrow(e)
      }
    }
  }
}

export const onIntent: (component: any, actionNames: string[], selectorsUsed?: string[]) => void = hook('onIntent')
export const onModel: (component: any, modelMap: Record<string, string[]>) => void = hook('onModel')
export const onRender: (component: any, rootVnode: any) => void = hook('onRender')
export const onReducer: (component: any, action: string, prevState: any, nextState: any, sinkName: string) => void = hook('onReducer')
export const onDispose: (component: any) => void = hook('onDispose')

export function _resetDiagnostics(): void {
  explicitMode = undefined
  ignored = new Set()
  collected = []
  listeners = []
  checks = []
  asyncThrow = defaultAsyncThrow
  resolveDiagnosticsMode()
}

resolveDiagnosticsMode()
