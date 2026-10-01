/**
 * SYG401 — <Collection> has no `from` and the whole state is not an array (warn).
 * A defined `from` is checked by the core (D22).
 *
 * Reported through diagnostics in addition to the existing console output.
 *
 * Mechanism: the core has no hook at Collection instantiation, and the
 * Collection marker vnode is gone by the time onRender sees the tree. So, at
 * onModel (construction time, before the first render), this check wraps the
 * component INSTANCE's instantiateCollection method (an own property that
 * shadows the prototype method; Component calls `this.instantiateCollection`
 * for every new Collection). The wrapper inspects the marker's props and the
 * component's current state, then always calls the original. This only
 * happens when the dev-only 'sygnal/diagnostics' entry is loaded and
 * diagnostics are on. Reported once per component name and `from` value.
 */
import type {DiagnosticCheck} from '../index'
import {reportSafely, once, nameOf, isPlainObject} from './shared'

const describe = (v: any): string =>
  v === null ? 'null' : v === undefined ? 'undefined' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? 'an object' : `a ${typeof v}`

function checkCollection(component: any, el: any): void {
  const props = (el && el.data && el.data.props) || {}
  const from = props.from
  const of = props.of
  const ofName = typeof of === 'function' ? (of.componentName || of.label || of.name || 'component') : String(of)
  const name = nameOf(component)

  let state = component.currentState
  try { if (typeof component.addCalculated === 'function') state = component.addCalculated(state) } catch (_) {}

  let problem: string | undefined
  let fix = `Pass the name of an array field in ${name}'s state, e.g. <Collection of={${ofName}} from="items" />, and initialize that field to [] in initialState`
  // Every defined `from` (string field, lens object, or an invalid value) is reported by
  // the core itself (SYG401/SYG412, retrofitted in 1E) in every diagnostics mode (D22), so
  // this check only covers a missing `from`.
  if (from !== undefined) return
  if (!Array.isArray(state) && !(state && Array.isArray(state.value))) {
    problem = `has no 'from' prop, so it uses ${name}'s whole state, which is ${describe(state)}, not an array`
  }

  if (!problem || !once(`SYG401:${name}:undefined`)) return
  reportSafely('SYG401', {
    component,
    message: `<Collection of={${ofName}}> ${problem}, so it renders no items`,
    fix,
    data: {from: 'undefined', of: ofName},
  })
}

const WRAPPED = '__sygnalDiagWrapped'

export const collectionsCheck: DiagnosticCheck = {
  id: 'collections',

  onModel(component) {
    const original = component && component.instantiateCollection
    if (typeof original !== 'function' || original[WRAPPED]) return
    const wrapped = function (this: any, el: any, ...rest: any[]) {
      try { checkCollection(this, el) } catch (_) {}
      return original.call(this, el, ...rest)
    }
    ;(wrapped as any)[WRAPPED] = true
    component.instantiateCollection = wrapped
  },
}
