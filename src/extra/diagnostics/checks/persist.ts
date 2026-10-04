/**
 * PLAN-4 GS-5: persist() checks (dev entry only; sygnal-check reports both statically).
 *
 * SYG224 (error) — a `persist` static on a component that isn't the root: the core only sets it
 *          up on the root (the one run() or renderComponent() is given), so nothing is saved
 *          or restored.
 * SYG223 (warn)  — a `pick` / `omit` key of persist() that isn't a key of the component's
 *          `initialState` static (a typo: that key is never saved, or never left out).
 * Once per component name. Mechanism: onModel reads the static `view.persist` (the persist()
 * value carries its options) and `view.initialState`.
 */
import type {DiagnosticCheck} from '../index'
import {devReport, nameOf, once, didYouMean} from './shared'

export const persistCheck: DiagnosticCheck = {
  id: 'persist',

  onModel(component) {
    const view = component?.view, p = view?.persist
    if (!p) return
    const name = nameOf(component)
    if (component.isSubComponent) {
      if (once('SYG224:' + name)) devReport('SYG224', {
        component,
        message: `${name}.persist is set, but ${name} is not the root component, so its state is never saved or restored (persist() works on the root only)`,
        fix: `Move persist to the root component (the one passed to run()) and pick the keys it holds: persist({ key, pick: ['${name.toLowerCase()}'] })`,
        data: {key: p.options?.key},
      })
      return
    }
    const o = p.options, init = view.initialState
    if (!o || !init || typeof init != 'object') return
    const keys = Object.keys(init)
    for (const opt of ['pick', 'omit']) {
      for (const k of Array.isArray(o[opt]) ? o[opt] : []) {
        if (keys.includes(k) || !once(`SYG223:${name}:${opt}:${k}`)) continue
        devReport('SYG223', {
          component,
          message: `persist ${opt} names '${k}', which is not a key of ${name}.initialState, so it is ${opt == 'pick' ? 'never saved' : 'never left out'}${didYouMean(k, keys)}`,
          fix: `Use top-level keys of initialState in ${opt} (${keys.join(', ')}), or add '${k}' to initialState`,
          data: {option: opt, key: k, stateKeys: keys},
        })
      }
    }
  },
}
