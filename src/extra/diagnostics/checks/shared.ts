/**
 * Shared plumbing for the runtime checks (PLAN-1 workstream 1A).
 *
 * The checks are bundled separately from the main 'sygnal' entry
 * ('sygnal/diagnostics'). They must talk to the SAME diagnostics core
 * instance the components use, so they never import the core's functions
 * directly: `import '../index'` only makes sure the core is loaded (in the
 * dist build that import is rewritten to the external 'sygnal' package, see
 * rollup.config.mjs), and the functions are read from the bridge object the
 * core publishes on globalThis.__SYGNAL_DIAGNOSTICS__.
 */
import '../index'
import type {DiagnosticCheck, DiagnosticDetails, Diagnostic} from '../index'
import {CODE_TITLES, DEV_CODE_SEVERITY, registerCodes} from '../codes'
import type {DiagnosticSeverity} from '../codes'

interface CoreBridge {
  registerCheck(check: DiagnosticCheck): () => void
  report(code: string, details: DiagnosticDetails): Diagnostic | undefined
  [key: string]: any
}

export const bridge = (): CoreBridge => (globalThis as any).__SYGNAL_DIAGNOSTICS__

export const report = (code: string, details: DiagnosticDetails): Diagnostic | undefined =>
  bridge().report(code, details)

/**
 * report() for code that is NOT running inside a core hook (timers, wrapped
 * methods): never throws synchronously; an 'error'-mode DiagnosticError is
 * rethrown asynchronously, like the core does for hooks.
 */
export const reportSafely = (code: string, details: DiagnosticDetails): Diagnostic | undefined => {
  try {
    return report(code, details)
  } catch (err) {
    const raise = () => { throw err }
    typeof queueMicrotask === 'function' ? queueMicrotask(raise) : setTimeout(raise)
    return undefined
  }
}

registerCodes(Object.keys(DEV_CODE_SEVERITY).map(code =>
  [code, DEV_CODE_SEVERITY[code], CODE_TITLES[code]] as [string, DiagnosticSeverity, string]))

/**
 * reportSafely() for the dev-entry-only codes (DEV_CODE_SEVERITY, G-143): the main bundle's
 * core doesn't know their severity, so it is passed explicitly.
 */
export const devReport = (code: string, details: DiagnosticDetails): Diagnostic | undefined =>
  reportSafely(code, {severity: DEV_CODE_SEVERITY[code], ...details})

/** Tunables (test seam: configureChecks()). */
export const timing = {
  /** delay after a render before DOM checks run (lets nested renders patch) */
  settleMs: 50,
  /** SYG103 escalates to warn after this much render-idle time ... */
  idleMs: 2000,
  /** ... and only once the component has rendered at least this often */
  minRenders: 3,
}

/** Built-in actions Sygnal dispatches itself; never "missing" or "unreachable". */
export const BUILTIN_ACTIONS = new Set(['BOOTSTRAP', 'INITIALIZE', 'HYDRATE', 'DISPOSE', 'READY'])

/** Synthetic/internal actions (`__TEST_ACTION__`, `__NOOP_ACTION__`, ...) and built-ins. */
export const isInternalAction = (action: string): boolean =>
  typeof action !== 'string' || action.startsWith('__') || BUILTIN_ACTIONS.has(action)

let seen = new Set<string>()

/** true the first time `key` is seen (dedupes reports, e.g. per component name). */
export const once = (key: string): boolean => (seen.has(key) ? false : (seen.add(key), true))

/**
 * Forget only the once() dedupe set (G-051: renderComponent calls it through the core bridge
 * when an outermost instance starts, so findings are reported again in every test). Unlike
 * resetCheckState() it keeps the checks' registries, e.g. inspect()'s live records.
 */
export const resetOnce = (): void => { seen = new Set() }
{
  const core = bridge()
  if (core) core.resetOnce = resetOnce
}

const resetters: Array<() => void> = []
export const onReset = (fn: () => void): void => { resetters.push(fn) }

/** Clear every check's dedupe/registry state (tests). */
export function resetCheckState(): void {
  seen = new Set()
  resetters.forEach(fn => fn())
}

export const nameOf = (component: any): string => (component && component.name) || 'component'

export const isPlainObject = (value: any): boolean =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

/** Levenshtein distance (small strings only). */
function distance(a: string, b: string): number {
  const row = Array.from({length: b.length + 1}, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

/** Closest candidate to `name` (case-insensitive match or edit distance <= 2), if any. */
export function suggest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestScore = Infinity
  for (const c of candidates) {
    if (c === name) continue
    const score = c.toLowerCase() === name.toLowerCase() ? 0 : distance(c, name)
    if (score < bestScore) { best = c; bestScore = score }
  }
  return bestScore <= Math.min(2, Math.floor(name.length / 3)) ? best : undefined
}

export const didYouMean = (name: string, candidates: Iterable<string>): string => {
  const s = suggest(name, candidates)
  return s ? ` (did you mean '${s}'?)` : ''
}
