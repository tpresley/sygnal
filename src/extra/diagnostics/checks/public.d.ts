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
