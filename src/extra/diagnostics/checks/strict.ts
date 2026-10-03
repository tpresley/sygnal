/**
 * Strict mode: canonical-form checks (PLAN-1 workstream 2A,
 * dev-plans/PLAN-1-canonical-forms.md). Runtime half; sygnal-check --strict
 * implements every rule statically.
 *
 * Off by default. Turn it on with any of:
 *   - configureStrict(true)                    (this entry)
 *   - renderComponent(C, { strict: true })     (tests)
 *   - globalThis.__SYGNAL_STRICT__ = true      (e.g. injected by a dev tool)
 * and diagnostics must be on (strict reports go through the same core).
 * The flag lives on the core bridge object, so it is shared by every copy of
 * this entry and by renderComponent.
 *
 * | Code   | Rule (canonical form)                    | Runtime mechanism                       |
 * |--------|------------------------------------------|-----------------------------------------|
 * | SYG501 | C1 destructure the view's first argument | onModel: component.view.length > 1      |
 * | SYG502 | C3 return ABORT for "no change"          | onReducer: returned the previous state  |
 * |        |                                          | object (undefined stays SYG202)         |
 * | SYG504 | C5 object form, no 'ACTION | SINK' keys  | onModel: raw model keys containing '|'  |
 * | SYG508 | reply actions, not select()/errors()     | replies.ts: a request with a category   |
 * |        | round trip (PLAN-3 §1.1)                 | the same instance select()ed on a       |
 * |        |                                          | reply-capable source                    |
 * | SYG503, SYG505, SYG506, SYG507: static only (sygnal-check --strict); the
 *   runtime can't tell emit() from { EVENTS }, a side effect from a pure
 *   reducer, or see CHILD.select() arguments without a core hook.
 *
 * Every finding is reported once per component name (+ action / key).
 * The SYG5xx severities are registered here (registerCodes) and passed
 * explicitly, so the main bundle doesn't carry them (D29).
 */
import type {DiagnosticCheck} from '../index'
import {CODE_TITLES, STRICT_CODE_SEVERITY, registerCodes} from '../codes'
import type {DiagnosticSeverity} from '../codes'
import {bridge, report, once, nameOf, isInternalAction} from './shared'

registerCodes(Object.keys(STRICT_CODE_SEVERITY).map(code =>
  [code, STRICT_CODE_SEVERITY[code], CODE_TITLES[code]] as [string, DiagnosticSeverity, string]))

/**
 * Turn runtime strict checks on (true), off (false), or back to the default
 * (undefined → globalThis.__SYGNAL_STRICT__ === true).
 */
export function configureStrict(on?: boolean): void {
  const core = bridge()
  if (core) core.strict = on
}

/** Whether runtime strict checks are on. */
export function isStrictEnabled(): boolean {
  const flag = bridge()?.strict
  return flag === undefined ? (globalThis as any).__SYGNAL_STRICT__ === true : flag === true
}

const strictReport = (code: string, details: Parameters<typeof report>[1]) =>
  report(code, {severity: STRICT_CODE_SEVERITY[code], ...details})

export const strictCheck: DiagnosticCheck = {
  id: 'strict',

  onModel(component) {
    if (!isStrictEnabled() || !component) return
    const name = nameOf(component)

    // SYG501 — view(props, state, context, peers): positional use of the 2nd+ args.
    // (A default value or a rest parameter stops Function.length, so this can
    // miss `(props, state = {})`, but it never flags a single-argument view.)
    const view = component.view
    if (typeof view === 'function' && view.length > 1 && !view.__sygnalLazy && once(`SYG501:${name}`)) {
      const extra = ['state', 'context', 'peers'].slice(0, view.length - 1)
      strictReport('SYG501', {
        component,
        message: `The view takes ${view.length} positional arguments (props, ${extra.join(', ')})`,
        fix: `Destructure the first argument instead: function ${name}({ ${extra.join(', ')}, ...props })`,
        data: {arity: view.length},
      })
    }

    // SYG504 — 'ACTION | SINK' shorthand keys
    const model = component.model
    if (!model || typeof model !== 'object') return
    for (const key of Object.keys(model)) {
      if (!key.includes('|')) continue
      const [action, sink] = key.split('|').map(s => s.trim())
      if (!action || !sink || !once(`SYG504:${name}:${key}`)) continue
      const rewrite = sink === 'EVENTS'
        ? `${action}: { EVENTS: event('TYPE', (state, data) => payload) }`
        : `${action}: { ${sink}: (state, data, next) => ... }`
      strictReport('SYG504', {
        component,
        message: `Model key '${key}' uses the 'ACTION | SINK' shorthand`,
        fix: `Use the object form: ${rewrite} (merge it into an existing '${action}' entry if there is one)`,
        data: {key, action, sink},
      })
    }
  },

  onReducer(component, action, prevState, nextState) {
    if (!isStrictEnabled() || isInternalAction(action)) return  // incl. INITIALIZE/DISPOSE
    // undefined is SYG202 (state check, every mode); only the identical object here.
    if (!prevState || typeof prevState !== 'object' || nextState === undefined) return
    let same = nextState === prevState
    if (!same && typeof component?.addCalculated === 'function') {
      // with calculated fields the reducer saw addCalculated(prev) (memoized: same object)
      try { same = component.addCalculated(prevState) === nextState } catch (_) {}
    }
    const name = nameOf(component)
    if (!same || !once(`SYG502:${name}:${action}`)) return
    strictReport('SYG502', {
      component,
      message: `The STATE reducer for '${action}' returned the unchanged state object`,
      fix: `Return ABORT for "no change": ${action}: (state, data) => cond ? { ...state, ... } : ABORT`,
      data: {action},
    })
  },
}
