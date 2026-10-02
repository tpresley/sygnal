/**
 * SYG201 — STATE reducer dropped keys that existed in the previous state (warn)
 * SYG202 — STATE reducer returned undefined (warn)
 * SYG221 — set() called with a string (error, G-143): the string is spread
 *          into the state as keys '0', '1', ... (one per character)
 *
 * Mechanism: onReducer(component, action, prevState, nextState). Reported once
 * per action per component name. Not reported for:
 *   - synthetic actions (`__*`) and INITIALIZE/HYDRATE (whole-state replacement)
 *   - keys that are calculated fields (they are re-derived after the reducer)
 *   - keys whose previous value was undefined
 * The set()/toggle() helpers always spread the previous state, so they can't
 * drop keys and never trigger SYG201.
 */
import type {DiagnosticCheck} from '../index'
import {report, devReport, once, nameOf, isPlainObject} from './shared'

const SKIP = new Set(['INITIALIZE', 'HYDRATE'])

export const stateCheck: DiagnosticCheck = {
  id: 'state',

  onReducer(component, action, prevState, nextState) {
    if (typeof action !== 'string' || action.startsWith('__') || SKIP.has(action)) return
    const name = nameOf(component)

    if (nextState === undefined) {
      if (!once(`SYG202:${name}:${action}`)) return
      // Returning undefined from a Collection item's reducer is the documented way to remove
      // the item, so only the root (where it wipes the whole app state) is a warning.
      const sub = !!component?.isSubComponent
      report('SYG202', {
        component,
        severity: sub ? 'info' : 'warn',
        message: `The STATE reducer for '${action}' returned undefined` +
          (sub ? ' (this removes the item if the component is a Collection item)' : ''),
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
