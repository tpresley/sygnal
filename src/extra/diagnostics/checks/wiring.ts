/**
 * SYG101 — intent action has no model entry (warn)
 * SYG102 — model entry has no intent trigger (info; it may still be reached
 *          with next(), which is only known at call time). An action a request
 *          names as a reply action, or `connections` names (`ok: 'LOADED'`, PLAN-3) counts as
 *          triggered: replyNamesOf() reads the names from the sink functions'
 *          source
 * SYG609 — a model sink or an intent source has no driver (warn; see below)
 *
 * Mechanism: onIntent records the intent's action names per component;
 * onModel (always called right after, once per instance) compares them with
 * the normalized model map (shorthand already expanded by the core).
 * Synthetic actions (`__*`, e.g. renderComponent's `__TEST_ACTION__`) and the
 * built-ins BOOTSTRAP/INITIALIZE/DISPOSE/READY are never reported (HYDRATE is an
 * ordinary action since 6.0).
 * Under renderComponent, intent streams injected for model actions (so that
 * simulateAction can dispatch them by their real names) are listed on the
 * intent object's non-enumerable `__sygnalTestActions` property. They are not
 * user intent actions (never reported as SYG101), and SYG102 is not reported
 * for those model actions (the test dispatches them with simulateAction).
 */
import type {DiagnosticCheck} from '../index'
import {report, once, isInternalAction, nameOf, didYouMean, replyNamesOf} from './shared'

const intentActions = new WeakMap<object, string[]>()

// SYG609 (G-110, PLAN-2 E2): sinks/sources that no driver provides. Sinks the core handles
// itself never need one. renderComponent (mock DOM source) records such sinks and fakes such
// sources (t.requests / t.respond), so its components are skipped.
// PLAN-4 GS-2: ELEMENT (element commands) is built in
const NO_DRIVER_NEEDED = /^(STATE|EFFECT|PARENT|READY|DOM|CHILD|ELEMENT)$/
const DRIVER_NAME = /^[A-Z][A-Z0-9_]*$/
// (`in`, not a read: the DOM source's shorthand Proxy returns a function for any property)
const underTest = (c: any) => {
  const dom = c?.sources?.[c.DOMSourceName || 'DOM']
  return !!dom && typeof dom == 'object' && '_hub' in dom
}
const driverFix = (sink: string) =>
  `Pass a driver named ${sink} to run(): run(App, { ${sink}: makeFetchDriver() }) for HTTP, or driverFromAsync(fn) / your own driver. ` +
  `Check the spelling against the drivers you pass`

export const wiringCheck: DiagnosticCheck = {
  id: 'wiring',

  onIntent(component, actionNames) {
    intentActions.set(component, actionNames || [])
  },

  // SYG609: an intent that reads a source no driver provides (`HTTP.select(...)` with no HTTP
  // driver) would crash with "Cannot read properties of undefined": say why first
  sources(component, sources) {
    if (underTest(component) || typeof Proxy != 'function') return
    const name = nameOf(component)
    return new Proxy(sources, {
      get(t: any, k: any) {
        if (typeof k == 'string' && !(k in t) && DRIVER_NAME.test(k) && once(`SYG609:${name}:source:${k}`)) {
          report('SYG609', {
            component,
            message: `${name}.intent reads the ${k} source, but no driver named ${k} was passed to run(), so it is undefined`,
            fix: driverFix(k),
            data: {name: k, kind: 'source', drivers: Object.keys(t).filter(n => DRIVER_NAME.test(n))},
          })
        }
        return t[k]
      },
    })
  },

  onModel(component, modelMap) {
    const name = nameOf(component)
    // SYG609: a sink no driver receives is dropped silently by run()
    if (!underTest(component)) {
      const own = new Set<string>(component?.sourceNames || [])
      for (const action of Object.keys(modelMap || {})) {
        for (const sink of modelMap[action] || []) {
          if (own.has(sink) || NO_DRIVER_NEEDED.test(sink) || sink === component?.stateSourceName) continue
          if (!once(`SYG609:${name}:sink:${sink}`)) continue
          report('SYG609', {
            component,
            message: `Model entry '${action}' sends to the ${sink} sink, but no driver named ${sink} was passed to run(), so every value sent there is dropped`,
            fix: driverFix(sink),
            data: {name: sink, kind: 'sink', action, drivers: [...own].filter(n => DRIVER_NAME.test(n))},
          })
        }
      }
    }
    const intent$ = component && component.intent$
    const injected = new Set<string>(
      (intent$ && typeof intent$ === 'object' && intent$.__sygnalTestActions) || [])
    const actions = (intentActions.get(component) || []).filter(a => !injected.has(a))
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
    if (intent$ && typeof intent$.addListener === 'function') return

    const hmr = ([] as string[]).concat(component?.hmrActions || [])
    const replies = replyNamesOf(component)
    for (const action of modelActions) {
      if (isInternalAction(action) || actions.includes(action) || hmr.includes(action) || injected.has(action) || replies.has(action)) continue
      if (!once(`SYG102:${name}:${action}`)) continue
      report('SYG102', {
        component,
        message: `Model entry '${action}' has no intent action with that name${didYouMean(action, actions)}`,
        fix: `Add '${action}' to ${name}.intent, name it in a request (ok: '${action}'), or remove the model entry. If it is only dispatched with next('${action}'), ignore this`,
        data: {action, intentActions: actions},
      })
    }
  },
}
