/**
 * SYG201 — STATE reducer dropped keys that existed in the previous state (warn)
 * SYG202 — STATE reducer returned undefined (warn)
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
import {report, once, nameOf, isPlainObject} from './shared'

const SKIP = new Set(['INITIALIZE', 'HYDRATE'])

export const stateCheck: DiagnosticCheck = {
  id: 'state',

  onReducer(component, action, prevState, nextState) {
    if (typeof action !== 'string' || action.startsWith('__') || SKIP.has(action)) return
    const name = nameOf(component)

    if (nextState === undefined) {
      if (!once(`SYG202:${name}:${action}`)) return
      report('SYG202', {
        component,
        message: `The STATE reducer for '${action}' returned undefined`,
        fix: `Return the new state, e.g. (state, data) => ({ ...state, ... }), or return ABORT to leave the state unchanged`,
        data: {action},
      })
      return
    }

    if (!isPlainObject(prevState) || !isPlainObject(nextState)) return
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
