/**
 * PLAN-4 GS-5: persist() checks (dev entry only; sygnal-check reports both statically).
 *
 * SYG224 (error) — a `persist` static on a component that isn't the root: the core only sets it
 *          up on the root (the one run() or renderComponent() is given), so nothing is saved
 *          or restored. Under Vike's Layout/Wrapper shell (the `__vike` source) the message says
 *          persist isn't supported on Vike pages, layouts or wrappers yet.
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
      // 3-B2: under Vike's Layout/Wrapper shell (onRenderClient's `__vike` source) the Page,
      // Layouts and Wrappers are all sub-components of the shell root
      const vike = component.sources?.__vike
      if (once('SYG224:' + name)) devReport('SYG224', {
        component,
        message: vike
          ? `${name}.persist is set, but ${name} renders in Vike's Layout/Wrapper shell (the shell is the app's root), so its state is never saved or restored: persist() isn't supported on Vike pages, layouts or wrappers yet`
          : `${name}.persist is set, but ${name} is not the root component, so its state is never saved or restored (persist() works on the root only)`,
        fix: vike
          ? `Remove persist from ${name}. Save the state yourself (STATE.watch writing to localStorage, read back in BOOTSTRAP), or use persist() on a component you run() yourself, or on a Vike page with no Layout or Wrapper (it is its own root)`
          : `Move persist to the root component (the one passed to run()) and pick the keys it holds: persist({ key, pick: ['${name.toLowerCase()}'] })`,
        data: {key: p.options?.key, ...(vike && {vike: true})},
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
