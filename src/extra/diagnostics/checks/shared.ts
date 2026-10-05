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

/**
 * Built-in actions Sygnal dispatches itself; never "missing" or "unreachable".
 * (HYDRATE is not one since 6.0, D66: nothing dispatches it, so it is an ordinary action.)
 */
export const BUILTIN_ACTIONS = new Set(['BOOTSTRAP', 'INITIALIZE', 'DISPOSE', 'READY', 'RESOURCE'])

/** Sinks the core handles itself: their values never go to a reply-action driver. */
// (PLAN-4 GS-2: ELEMENT too; `{ scrollIntoView: Row, block: 'center' }` names no action)
const NON_REPLY_SINK = /^(STATE|EFFECT|EVENTS|PARENT|READY|DOM|CHILD|ELEMENT|PERSIST)$/

// `ok: 'X'` / `"error": "X"` in function source (minified code keeps string literals and keys)
const keyedNames = (keys: string) => new RegExp(`(?:^|[{,\\s])["']?(?:${keys})["']?\\s*:\\s*(["'\`])([\\w$.:/-]+)\\1`, 'g')
// (PLAN-3 5-4b: and a router `{ block: 'ACTION' }`)
const REPLY_IN_SOURCE = keyedNames('ok|error|block')
const CONNECTION_IN_SOURCE = keyedNames('message|open|close|error')
// G-224: a `timers` static's `action: 'TICK'` / `frame: 'FRAME'`
const TIMER_IN_SOURCE = keyedNames('action|frame')
// PLAN-5 B-3: a `browser` static's `action: 'SEEN'` / `error: 'GEO_FAILED'`
const BROWSER_IN_SOURCE = keyedNames('action|error')

const namesIn = (fn: any, re: RegExp, out: Set<string>) => {
  if (typeof fn !== 'function') return
  let src = ''
  try { src = Function.prototype.toString.call(fn) } catch (_) { return }
  re.lastIndex = 0
  for (let m = re.exec(src); m; m = re.exec(src)) out.add(m[2])
}

/**
 * Reply actions a component's requests and `connections` static can name, read from the
 * source of its non-STATE sink functions (`HTTP: (s) => ({ url, ok: 'LOADED', error: 'FAILED' })`)
 * and of `connections` (message/open/close/error). A heuristic for SYG102 (PLAN-3): a name
 * built at run time is missed (SYG102 stays info, so that only costs a false hint).
 */
export function replyNamesOf(component: any): Set<string> {
  const out = new Set<string>()
  const model = component && component.model
  if (model && typeof model === 'object') {
    for (const key of Object.keys(model)) {
      const value = model[key]
      const bar = key.indexOf('|')
      if (bar >= 0) {
        if (!NON_REPLY_SINK.test(key.slice(bar + 1).trim())) namesIn(value, REPLY_IN_SOURCE, out)
      } else if (value && typeof value === 'object') {
        for (const sink of Object.keys(value)) {
          if (!NON_REPLY_SINK.test(sink)) namesIn(value[sink], REPLY_IN_SOURCE, out)
        }
      }
    }
  }
  namesIn(component?.view?.connections, CONNECTION_IN_SOURCE, out)
  // G-224: makeTimerDriver() replies the actions the `timers` static names (a function of the
  // state, or an object of them)
  const timers = component?.view?.timers
  if (timers && typeof timers === 'object') for (const k in timers) namesIn(timers[k], TIMER_IN_SOURCE, out)
  else namesIn(timers, TIMER_IN_SOURCE, out)
  // PLAN-5 B-3: the browser driver replies the actions the `browser` static names
  const browser = component?.view?.browser
  if (browser && typeof browser === 'object') for (const k in browser) namesIn(browser[k], BROWSER_IN_SOURCE, out)
  else namesIn(browser, BROWSER_IN_SOURCE, out)
  // PLAN-3 5-4b: the router replies the action a `route` static names
  const route = component?.view?.route
  if (typeof route === 'string') out.add(route)
  // PLAN-4 GS-5: persist() adds RESTORE (sent after hydration and by sync)
  if (component?.view?.persist) out.add('RESTORE')
  return out
}

/** Reply actions a component instance's requests were seen naming (replies.ts → inspect). */
export const replySeen = new WeakMap<object, Set<string>>()

/** Synthetic/internal actions (`__TEST_ACTION__`, `__NOOP_ACTION__`, ...) and built-ins. */
export const isInternalAction = (action: string): boolean =>
  typeof action !== 'string' || action.startsWith('__') || BUILTIN_ACTIONS.has(action)

let seen = new Set<string>()

/** true the first time `key` is seen (dedupes reports, e.g. per component name). */
export const once = (key: string): boolean => (seen.has(key) ? false : (seen.add(key), true))
/** undo once(key): the report it guarded wasn't made (G-470: diagnostics off) */
export const unsee = (key: string): void => void seen.delete(key)
/** whether once(`key`) has reported already (a check can skip its work: SYG435) */
export const onced = (key: string): boolean => seen.has(key)

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
