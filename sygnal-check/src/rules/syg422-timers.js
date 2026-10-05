/**
 * Timers and declaration statics (PLAN-4 GS-7), statically. The dev entry reports both codes at
 * run time (src/extra/diagnostics/checks/timers.ts); these catch them before the app runs.
 *
 *   SYG422 (error)  a literal timer spec makeTimerDriver() can't run (model/timers.js specProblem:
 *                   non-positive / NaN `every`, negative `after`, both, no or an empty action, a
 *                   `frame` that isn't an action name, a truthy non-object). Only literal values are
 *                   judged: `{ every: state.ms, action: 'TICK' }` is left to the runtime.
 *   SYG643 (warn)   a component declares `timers` (or `connections`, `resources`), is rendered by an
 *                   app whose run() call registers no driver that takes that static
 *                   (makeTimerDriver(), makeSocketDriver(), makeFetchDriver(), makeBrowserDriver()). Only when the run()
 *                   call is in the scanned files, its drivers are an object literal the checker can
 *                   list (model/apps.js), and the component is one the root renders: otherwise
 *                   nothing, so no false positives (renderComponent provides fakes; tests don't count).
 */
import { findApps, STATIC_DRIVERS } from '../model/apps.js'

const DRIVER_OF = Object.fromEntries(Object.entries(STATIC_DRIVERS).map(([f, s]) => [s, `${f}()`]))
const KEY = { timers: 'TIMER', connections: 'WS', resources: 'HTTP', browser: 'BROWSER' }
const EFFECT = { timers: 'its timers never run', connections: 'its connections never open', resources: 'its resources are never fetched', browser: 'its browser sources never start' }

function reportSpecs(project, report) {
  for (const comp of project.components) {
    for (const s of comp.timers?.specs || []) {
      if (!s.problem) continue
      report({
        code: 'SYG422',
        component: comp.name,
        file: s.file,
        node: s.node,
        message: `Timer '${s.name}' ${s.problem}; it is not started`,
        fix: `declare ${s.name}: { every: 100, action: 'TICK' }, { after: 5000, action: 'EXPIRE' } or { frame: 'FRAME' } (falsy to stop it)`,
        data: { name: s.name },
      })
    }
  }
}

function reportMissingDrivers(project, report) {
  const declared = project.components.filter(c => Object.keys(DRIVER_OF).some(k => c.staticProps[k]))
  if (!declared.length) return
  const apps = findApps(project)
  for (const comp of declared) {
    for (const k of Object.keys(DRIVER_OF)) {
      if (!comp.staticProps[k]) continue
      const lacking = apps.find(a => a.statics && a.components.has(comp) && !a.statics.has(k))
      // another app (or one we can't read) that renders it with the driver: say nothing
      if (!lacking || apps.some(a => a.components.has(comp) && (!a.statics || a.statics.has(k)))) continue
      const at = `${project.relPath(lacking.file.path)}:${lacking.call.loc.start.line}`
      report({
        code: 'SYG643',
        component: comp.name,
        file: comp.file,
        node: comp.staticPropNodes[k] || comp.staticProps[k],
        message: `${comp.name} declares ${comp.name}.${k}, but the run() call that renders it (${at}) registers no ${DRIVER_OF[k]} driver, so ${EFFECT[k]}`,
        fix: `register the driver: run(App, { ${KEY[k]}: ${DRIVER_OF[k]}, ... }) (any key; the core finds it by the static it takes)`,
        data: { static: k, driver: DRIVER_OF[k] },
      })
    }
  }
}

export default {
  id: 'timers',
  codes: ['SYG422', 'SYG643'],
  description: 'Invalid timer spec; a declaration static with no driver to take it',
  run(project, report) {
    reportSpecs(project, report)
    reportMissingDrivers(project, report)
  },
}
