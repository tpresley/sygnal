/**
 * SYG401 — <Collection from=...> field is missing or not an array (warn).
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
  if (from === undefined) {
    if (!Array.isArray(state) && !(state && Array.isArray(state.value))) {
      problem = `has no 'from' prop, so it uses ${name}'s whole state, which is ${describe(state)}, not an array`
    }
  } else if (typeof from === 'string') {
    if (!isPlainObject(state) || !(from in state)) {
      const arrays = isPlainObject(state) ? Object.keys(state).filter(k => Array.isArray(state[k])) : []
      problem = `uses from="${from}", but ${name}'s state has no '${from}' field` +
        (arrays.length ? ` (array fields: ${arrays.map(k => `'${k}'`).join(', ')})` : '')
    } else if (!Array.isArray(state[from])) {
      problem = `uses from="${from}", but state.${from} is ${describe(state[from])}, not an array`
      fix = `Make '${from}' an array (initialize it to [] instead of ${describe(state[from])})`
    }
  } else if (from && typeof from === 'object' && !Array.isArray(from)) {
    if (typeof from.get !== 'function') {
      problem = `has a 'from' object without a get() function`
      fix = `Pass a state field name, or a lens object { get: state => array, set: (state, items) => newState }`
    } else {
      let value: any
      try { value = from.get(state) } catch (_) { return }
      if (!Array.isArray(value)) {
        problem = `has a 'from' lens whose get() returned ${describe(value)}, not an array`
        fix = `Make the lens get() return an array`
      }
    }
  } else if (!Array.isArray(from)) {
    problem = `has an invalid 'from' prop (${describe(from)})`
  }

  if (!problem || !once(`SYG401:${name}:${typeof from === 'string' ? from : typeof from}`)) return
  reportSafely('SYG401', {
    component,
    message: `<Collection of={${ofName}}> ${problem}, so it renders no items`,
    fix,
    data: {from: typeof from === 'string' ? from : typeof from, of: ofName},
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
