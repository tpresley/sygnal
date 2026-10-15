/**
 * SYG401 — a <Collection> / <VirtualCollection> whose items aren't an array (warn):
 *   - no `from`, and the whole state is not an array
 *   - `from` a key or a path ('board.cards') that isn't in state, or isn't an array there
 * A lens `from` (a getter that returns a non-array, SYG401) and an invalid `from` (SYG412) are
 * the core's. The string `from` checks moved here from the core in 6.5.0 (production apps don't
 * print them; dev and tests do: sygnal/vite and renderComponent load this entry).
 *
 * Called by the dev layer (next.ts onHostProps) with the owner's facade and the host's props.
 * Reported once per component name and `from` value.
 */
import type {DiagnosticCheck} from '../index'
import {reportSafely, once, nameOf, isPlainObject} from './shared'

const describe = (v: any): string =>
  v === null ? 'null' : v === undefined ? 'undefined' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? 'an object' : `a ${typeof v}`

export function checkCollection(component: any, el: any): void {
  const props = (el && el.data && el.data.props) || {}
  const from = props.from
  const of = props.of
  const ofName = typeof of === 'function' ? (of.componentName || of.label || of.name || 'component') : String(of)
  const name = nameOf(component)

  let state = component.currentState
  try { if (typeof component.addCalculated === 'function') state = component.addCalculated(state) } catch (_) {}

  if (typeof from === 'string') return checkFrom(component, name, from, ofName, state)
  // a lens or an invalid value: the core's (SYG401 / SYG412)
  if (from !== undefined) return
  if (Array.isArray(state) || (state && Array.isArray(state.value))) return
  if (!once(`SYG401:${name}:undefined`)) return
  reportSafely('SYG401', {
    component,
    message: `<Collection of={${ofName}}> has no 'from' prop, so it uses ${name}'s whole state, which is ${describe(state)}, not an array, so it renders no items`,
    fix: `Pass the name of an array field in ${name}'s state, e.g. <Collection of={${ofName}} from="items" />, and initialize that field to [] in initialState`,
    data: {from: 'undefined', of: ofName},
  })
}

/** `from` a key or a path ('board.cards', 'boards[0].cards'), as the core reads it (cell.ts pathOf) */
function checkFrom(component: any, name: string, from: string, ofName: string, state: any): void {
  const ks = from.replace(/\[(\d+)\]/g, '.$1').split('.')
  const calc = component._calculatedFieldNames
  if (calc?.has?.(ks[0])) return
  const at = ks.slice(0, -1).reduce((o: any, k: string) => (o == null ? o : o[k]), state), last = ks[ks.length - 1]
  if (!isPlainObject(at) && !Array.isArray(at)) return // a level still missing: renders once it appears (D178)
  let message: string
  if (!(last in at)) {
    const arrays = Object.keys(at).filter(k => Array.isArray(at[k]))
    message = `Collection from="${from}" is not in state${arrays.length ? ` (array fields: '${arrays.join("', '")}')` : ''}; it renders nothing until it exists`
  } else if (!Array.isArray(at[last])) message = `Collection 'from' field '${from}' is not an array; it renders nothing`
  else return
  if (!once(`SYG401:${name}:${from}`)) return
  reportSafely('SYG401', {component, message, fix: 'Set it to an array in initialState', data: {from, of: ofName}})
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
