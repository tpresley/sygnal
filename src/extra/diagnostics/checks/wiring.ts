/**
 * SYG101 — intent action has no model entry (warn)
 * SYG102 — model entry has no intent trigger (info; it may still be reached
 *          with next(), which is only known at call time)
 *
 * Mechanism: onIntent records the intent's action names per component;
 * onModel (always called right after, once per instance) compares them with
 * the normalized model map (shorthand already expanded by the core).
 * Synthetic actions (`__*`, e.g. renderComponent's `__TEST_ACTION__`) and the
 * built-ins BOOTSTRAP/INITIALIZE/HYDRATE/DISPOSE/READY are never reported.
 */
import type {DiagnosticCheck} from '../index'
import {report, once, isInternalAction, nameOf, didYouMean} from './shared'

const intentActions = new WeakMap<object, string[]>()

export const wiringCheck: DiagnosticCheck = {
  id: 'wiring',

  onIntent(component, actionNames) {
    intentActions.set(component, actionNames || [])
  },

  onModel(component, modelMap) {
    const name = nameOf(component)
    const actions = intentActions.get(component) || []
    intentActions.delete(component)
    const modelActions = Object.keys(modelMap || {})

    for (const action of actions) {
      if (isInternalAction(action) || modelActions.includes(action)) continue
      if (!once(`SYG101:${name}:${action}`)) continue
      report('SYG101', {
        component,
        message: `Intent action '${action}' has no model entry, so it never does anything${didYouMean(action, modelActions)}`,
        fix: `Add '${action}' to ${name}.model, or remove it from ${name}.intent`,
        data: {action, modelActions},
      })
    }

    // A single-stream intent (intent returns one action$ stream) has no
    // action names to compare against.
    const intent$ = component && component.intent$
    if (intent$ && typeof intent$.addListener === 'function') return

    const hmr = ([] as string[]).concat(component?.hmrActions || [])
    for (const action of modelActions) {
      if (isInternalAction(action) || actions.includes(action) || hmr.includes(action)) continue
      if (!once(`SYG102:${name}:${action}`)) continue
      report('SYG102', {
        component,
        message: `Model entry '${action}' has no intent action with that name${didYouMean(action, actions)}`,
        fix: `Add '${action}' to ${name}.intent, or remove the model entry. If it is only dispatched with next('${action}'), ignore this`,
        data: {action, intentActions: actions},
      })
    }
  },
}
