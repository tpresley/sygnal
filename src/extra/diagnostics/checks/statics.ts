/**
 * PLAN-4.5 D152: shared statics are frozen in dev (dev entry only; the core never freezes).
 *
 * Since P45-B a component's `initialState`, `model`, `context` and `calculated` statics are
 * shared by all its instances (no per-instance deep copy). Mutating one in place (a reducer's
 * `state.items.push(x)` on the initial state, a view that writes into state) would change every
 * instance, and every later one. With diagnostics on, `initialState` is deep-frozen (its plain
 * objects and arrays; class instances such as Map or Date are left as they are) and the other
 * statics are frozen at the top level, so such a mutation throws a TypeError where it happens
 * (in a reducer: reported as SYG216 with the error attached; in a view: SYG406).
 *
 * Both the instance's values (after behaviors or persist() merged theirs) and the component
 * function's own statics are frozen. Mechanism: onIntent, which runs during construction,
 * before the model is wired.
 */
import type {DiagnosticCheck} from '../index'

const plain = (v: any): boolean => {
  if (!v || typeof v != 'object') return false
  const p = Object.getPrototypeOf(v)
  return Array.isArray(v) || p === Object.prototype || p === null
}

const deepFreeze = (v: any): void => {
  if (!plain(v) || Object.isFrozen(v)) return
  Object.freeze(v)
  for (const k of Object.keys(v)) deepFreeze(v[k])
}

const freeze = (o: any): void => {
  if (!o || (typeof o != 'object' && typeof o != 'function')) return
  deepFreeze(o.initialState)
  for (const k of ['model', 'context', 'calculated']) if (plain(o[k])) Object.freeze(o[k])
}

export const staticsCheck: DiagnosticCheck = {
  id: 'statics',

  onIntent(component) {
    freeze(component)
    if (typeof component?.view == 'function') freeze(component.view)
  },
}
