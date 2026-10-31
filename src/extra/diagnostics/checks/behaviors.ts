/**
 * PLAN-4 GS-1, runtime behavior checks (dev entry only; the static `uses` resolution is 3-D's).
 *
 * SYG127 (error), once per component name (not per Collection item; again in each renderComponent):
 *   - a `uses` key that the host's own `initialState` static already has (the behavior's slice
 *     replaces it);
 *   - a `uses` value that isn't a defineBehavior() result (no `merge`): the core skips it, so
 *     state[key] and its actions never exist.
 *   A host intent or model entry named like a behavior action ('pager.NEXT') is an override,
 *   not a collision.
 * Mechanism: onModel (every instance gets one, with or without a model) reads the static
 * `view.uses` and `view.initialState`.
 * SYG118 (warn, ui-sweep R1), once per component name: a host intent action that replaces a
 * behavior trigger built from an option the host passed (onIntent, below).
 */
import type {DiagnosticCheck} from '../index'
import {devReport, nameOf, once} from './shared'

const what = (v: any): string =>
  v === null || v === undefined ? String(v)
  : typeof v == 'function' ? 'a function (a defineBehavior factory not called?)'
  : typeof v == 'object' ? 'a plain object'
  : `a ${typeof v}`

export const behaviorsCheck: DiagnosticCheck = {
  id: 'behaviors',

  // SYG118 (ui-sweep R1): a host intent action named like a behavior action replaces the trigger
  // the behavior built from an option the host passed (`triggers: { ACTION: 'option' }` on the
  // definition). The intent combine (extra/behaviors.ts) removes a host-replaced action from
  // `_behaviorActions`, so after the intent ran that map tells which ones the host took
  onIntent(component, names) {
    const view = component?.view, uses = view?.uses
    if (!uses || typeof uses != 'object' || !once('SYG118:' + nameOf(component))) return
    const owned = component._behaviorActions || {}
    for (const key of Object.keys(uses)) {
      const b = uses[key], tr = b?.triggers
      for (const a in tr) {
        const opt = tr[a], name = key + '.' + a
        if (b.options?.[opt] == null || !names.includes(name) || name in owned) continue
        devReport('SYG118', {
          component,
          message: `${nameOf(component)}'s intent action '${name}' replaces the trigger the behavior builds from its '${opt}' option, so the elements '${opt}' names no longer dispatch '${name}'`,
          fix: `List every element in the option instead (${opt}: '${String(b.options[opt])}, .other'), dispatch it from another action with next('${name}'), or leave the '${opt}' option out to replace the trigger on purpose`,
          data: {key, action: a, option: opt},
        })
      }
    }
  },

  onModel(component) {
    const view = component?.view, uses = view?.uses
    if (!uses || typeof uses != 'object' || !once('SYG127:' + nameOf(component))) return
    const init = view.initialState
    for (const key of Object.keys(uses)) {
      const b = uses[key]
      if (typeof b?.merge != 'function') {
        devReport('SYG127', {
          component,
          message: `uses entry '${key}' is ${what(b)}, not a defineBehavior() result; it was skipped, so state.${key} and its '${key}.*' actions don't exist`,
          fix: `Use a defineBehavior() factory's result: uses = { ${key}: behavior(options) }`,
          data: {key, reason: 'unresolvable'},
        })
      } else if (init && typeof init == 'object' && key in init) {
        devReport('SYG127', {
          component,
          message: `uses key '${key}' is also a key of ${nameOf(component)}'s initialState; the behavior's slice replaces that value`,
          fix: `Remove '${key}' from initialState (pass its values as the behavior's options), or rename the uses key`,
          data: {key, reason: 'initialState'},
        })
      }
    }
  },
}
