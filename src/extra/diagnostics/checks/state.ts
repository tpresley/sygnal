/**
 * SYG201 — STATE reducer dropped keys that existed in the previous state (warn)
 * SYG202 — STATE reducer returned undefined (warn)
 * SYG221 — set() called with a string (error, G-143): the string is spread
 *          into the state as keys '0', '1', ... (one per character)
 * SYG238 — G-393: a root with a model but no initialState (and no state from renderComponent's
 *          `initialState` or an HMR swap): its state is undefined, so it renders nothing until an
 *          action sets one (the 5.x / PLAN-4 behaviour; a root without a model renders from
 *          `initialState || true`, G-172). onModel, at construction, once per component name.
 * SYG222 — STATE reducer returned the object it got after mutating it in place (warn, dev;
 *          PLAN-4 GS-4): since 6.0 the same object back means "no change", so the mutation
 *          is ignored. Mechanism: onIntent (called before the model is read) wraps the
 *          instance's STATE reducers; the wrapper takes a shallow snapshot (keys and top-level
 *          values) before the reducer runs and compares it when the reducer returns the same
 *          reference; a behavior slice (state[key] of a `uses` entry) is snapshotted the same
 *          way (keys reported as 'key.field', G-214). Nested mutations (state.list.push) are
 *          below the snapshot. Zero bytes
 *          in the core: the wrapping only happens with the dev entry and diagnostics on.
 *
 * Mechanism: onReducer(component, action, prevState, nextState). Reported once
 * per action per component name. Not reported for:
 *   - synthetic actions (`__*`) and INITIALIZE (whole-state replacement; HYDRATE is an
 *     ordinary action since 6.0, D66)
 *   - SYG202: a Collection item (`() => undefined` is its documented self-removal, G-357)
 *   - keys that are calculated fields (they are re-derived after the reducer)
 *   - keys whose previous value was undefined
 * The set()/toggle() helpers always spread the previous state, so they can't
 * drop keys and never trigger SYG201.
 */
import type {DiagnosticCheck} from '../index'
import {report, devReport, once, nameOf, isPlainObject} from './shared'
import {ORIGINAL} from '../../../shared'

const SKIP = new Set(['INITIALIZE'])

// SYG222: the instance's STATE reducers, wrapped (see the header)
const WRAPPED = Symbol('SYG222')

export function watchMutation(component: any, action: string, fn: any): any {
  if (typeof fn !== 'function' || fn[WRAPPED]) return fn
  const wrapped: any = (state: any, ...rest: any[]) => {
    if (!isPlainObject(state)) return fn(state, ...rest)
    // the state's top level, and (G-214) each behavior slice's: a behavior reducer that mutates
    // its slice gets the host state back unchanged (behaviors.ts), so state[key] looks the same
    const snaps = [[state, ''], ...(component._uses || []).map(([k]: any) => [state[k], k + '.'])]
      .filter(([o]) => isPlainObject(o)).map(([o, p]) => [o, p, Object.keys(o), Object.values(o)])
    const out = fn(state, ...rest)
    if (out === state) {
      const changed = snaps.flatMap(([o, p, keys, values]: any) => keys.filter((k: string, i: number) => !(k in o) || o[k] !== values[i])
        .concat(Object.keys(o).filter(k => !keys.includes(k))).map((k: string) => p + k))
      const name = nameOf(component)
      if (changed.length && once(`SYG222:${name}:${action}`)) {
        const list = changed.map(k => `'${k}'`).join(', ')
        devReport('SYG222', {
          component,
          message: `The STATE reducer for '${action}' changed ${list} in place and returned the same object. Returning the object a reducer got means "no change" (as ABORT), so the change is ignored and nothing re-renders`,
          fix: `Return a new object: ${changed[0].includes('.') ? `(slice, data) => ({ ...slice, ${changed[0].split('.')[1]}: … })` : `(state, data) => ({ ...state, ${changed[0]}: … })`}. To write updates as mutations, wrap the reducer in immer's produce()`,
          data: {action, keys: changed},
        })
      }
    }
    return out
  }
  wrapped[WRAPPED] = true
  // checks that read reducer source (reply actions) see the original; so do the action log
  // and t.explain() (ORIGINAL)
  wrapped.toString = () => fn.toString()
  wrapped[ORIGINAL] = fn
  return wrapped
}

export const stateCheck: DiagnosticCheck = {
  id: 'state',

  // SYG222: checks/next.ts wraps the STATE reducers (watchMutation) through wrapHandler

  onModel(component) {
    // SYG238 (G-393): the initial state is set at construction (D165), before onModel
    const n = component?.__next
    if (!n?.isRoot || !n.def?.model || n.state !== undefined) return
    const name = nameOf(component)
    if (!once(`SYG238:${name}`)) return
    devReport('SYG238', {
      component,
      message: `${name} is a root with a model but no initialState: its state is undefined, so it renders nothing until an action sets one`,
      fix: `Add ${name}.initialState = { … } (the root's start state; a child gets its state from its parent instead)`,
      data: {},
    })
  },

  onReducer(component, action, prevState, nextState) {
    if (typeof action !== 'string' || action.startsWith('__') || SKIP.has(action)) return
    const name = nameOf(component)

    if (nextState === undefined) {
      // G-357: returning undefined from a Collection item's reducer is the documented way to
      // remove the item: not reported. In another sub-component it is info, in the root (where
      // it wipes the whole app state) a warning.
      if (component?.__next?.kind === 'item' || !once(`SYG202:${name}:${action}`)) return
      const sub = !!component?.isSubComponent
      report('SYG202', {
        component,
        severity: sub ? 'info' : 'warn',
        message: `The STATE reducer for '${action}' returned undefined` +
          (sub ? ' (only a Collection item removes itself this way)' : ''),
        fix: `Return the new state, e.g. (state, data) => ({ ...state, ... }), or return ABORT to leave the state unchanged`,
        data: {action},
      })
      return
    }

    if (!isPlainObject(prevState) || !isPlainObject(nextState)) return

    // SYG221 (G-143): set('city') spreads the string into the state: { ...state, 0: 'c', 1: 'i', ... }
    const chars: string[] = []
    while (typeof nextState[chars.length] === 'string' && nextState[chars.length].length === 1 && !(chars.length in prevState)) {
      chars.push(nextState[chars.length])
    }
    if (chars.length > 0 && !(chars.length in nextState)) {
      if (!once(`SYG221:${name}:${action}`)) return
      const field = chars.join('')
      const update = /^[A-Za-z_$][\w$]*$/.test(field)
        ? `set((state, ${field}) => ({ ${field} }))`
        : `set((state, value) => ({ ['${field}']: value }))`
      devReport('SYG221', {
        component,
        message: `The STATE reducer for '${action}' added the keys ${chars.map((_, i) => `'${i}'`).slice(0, 4).join(', ')}${chars.length > 4 ? ', …' : ''} ` +
          `(one per character of '${field}'): set() was called with a string, set('${field}'). set() takes an object or a function`,
        fix: `To store the action data in '${field}', pass a function: ${update}. For a fixed value pass an object: set({ ${field}: … })`,
        data: {action, field},
      })
      return
    }

    const calculated: Set<string> | null = component?._calculatedFieldNames || null
    const dropped = Object.keys(prevState).filter(key =>
      !(key in nextState) && prevState[key] !== undefined && !(calculated && calculated.has(key)))
    if (dropped.length === 0 || !once(`SYG201:${name}:${action}`)) return

    const list = dropped.map(k => `'${k}'`).join(', ')
    report('SYG201', {
      component,
      message: `The STATE reducer for '${action}' returned a state without ${list}, which ${dropped.length === 1 ? 'was' : 'were'} in the previous state (likely a missing ...state spread)`,
      fix: `Spread the previous state: (state, data) => ({ ...state, ... }). If removing ${dropped.length === 1 ? 'the key' : 'these keys'} is intended, ignore this`,
      data: {action, droppedKeys: dropped},
    })
  },
}
