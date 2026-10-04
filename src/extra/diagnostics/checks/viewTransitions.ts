/**
 * View Transitions (PLAN-4 GS-12, D129). Dev-entry-only code (DEV_CODE_SEVERITY):
 *
 * SYG645 — a component declares `viewTransitions`, but its app's DOM driver can't run them (run()'s
 *          default makeDOMDriver, not makeViewTransitionDOMDriver()), so its actions patch at once
 *          and nothing else says so. The helper marks its IsolateModule (`vtDriver`). Not reported
 *          for renderComponent's mock DOM (no IsolateModule) or its `dom: 'real'` container
 *          (`.sygnal-test`): tests don't animate.
 *          Also (G-228): the static is not an array (`true`, `'MOVE'`): no action is listed (the core
 *          reads it with `includes?.()`, so a string matches substrings; anything else matches none).
 */
import type {DiagnosticCheck} from '../index'
import {devReport, once, nameOf} from './shared'

export const viewTransitionsCheck: DiagnosticCheck = {
  id: 'viewTransitions',

  onModel(component) {
    const list = component?.view?.viewTransitions
    if (list == null) return
    if (!Array.isArray(list)) {
      const name = nameOf(component)
      if (!once(`SYG645:${name}`)) return
      const actions = Object.keys(component.model || {}).filter(a => !a.includes('|'))
      devReport('SYG645', {
        component,
        message: `${name}.viewTransitions is not an array (it is ${typeof list == 'string' ? `'${list}'` : typeof list}), so no action is listed for a View Transition`,
        fix: `List the action names in an array: ${name}.viewTransitions = [${(typeof list == 'string' ? [list] : actions.slice(0, 2)).map(a => `'${a}'`).join(', ') || "'ACTION'"}] (an array of action names)`,
        data: {value: list},
      })
      return
    }
    if (!list.length) return
    const im = component.sources?.[component.DOMSourceName || 'DOM']?._isolateModule
    // the core's DOM source proxy answers any unknown key with an event shorthand (a function)
    if (typeof im != 'object' || !im || im.vtDriver) return
    if (typeof document != 'undefined' && document.querySelector?.('.sygnal-test')) return
    const name = nameOf(component)
    if (!once(`SYG645:${name}`)) return
    devReport('SYG645', {
      component,
      message: `${name} declares ${name}.viewTransitions (${list.map((a: any) => `'${a}'`).join(', ')}), but the app's DOM driver can't run View Transitions, so those actions patch without one`,
      fix: `Give run() the View Transition DOM driver: run(App, { DOM: makeViewTransitionDOMDriver('#root') })`,
      data: {actions: list},
    })
  },
}
