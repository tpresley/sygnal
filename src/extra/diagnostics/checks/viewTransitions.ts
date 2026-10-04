/**
 * View Transitions (PLAN-4 GS-12, D129). Dev-entry-only code (DEV_CODE_SEVERITY):
 *
 * SYG645 — a component declares `viewTransitions`, but its app's DOM driver can't run them (run()'s
 *          default makeDOMDriver, not makeViewTransitionDOMDriver()), so its actions patch at once
 *          and nothing else says so. The helper marks its IsolateModule (`vtDriver`). Not reported
 *          for renderComponent's mock DOM (no IsolateModule) or its `dom: 'real'` container
 *          (`.sygnal-test`): tests don't animate.
 */
import type {DiagnosticCheck} from '../index'
import {devReport, once, nameOf} from './shared'

export const viewTransitionsCheck: DiagnosticCheck = {
  id: 'viewTransitions',

  onModel(component) {
    const list = component?.view?.viewTransitions
    if (!list?.length) return
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
