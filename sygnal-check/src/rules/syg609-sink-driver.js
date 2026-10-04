/**
 * SYG609, statically (PLAN-4 4-G2; REPORT-v4: Haiku 13-t2 kept `run(App)` with no
 * makeFetchDriver(), and its own tests passed on renderComponent's fake HTTP sink): a model entry
 * sends to a sink (HTTP, WS, any name that isn't built in) that no driver of the app's run() call
 * takes, so run() drops every value sent there. The dev entry reports the same code at run time
 * (src/extra/diagnostics/checks/wiring.ts).
 *
 * Only when every fact is static, like SYG643: the run() call is in the scanned files, its drivers
 * are an object literal the checker can list (or there is no drivers argument), the component is
 * one its root renders, and no other run() call that renders it registers the name (or has drivers
 * the checker can't list). Sinks the core handles itself never need a driver: STATE, EFFECT,
 * EVENTS, PARENT, READY, DOM, CHILD, ELEMENT, PERSIST, and LOG (a default driver of run()).
 * Reported once per component and sink, at the first entry that sends to it.
 */
import { findApps } from '../model/apps.js'

// src/extra/diagnostics/checks/wiring.ts NO_DRIVER_NEEDED, plus run()'s default drivers
const NO_DRIVER_NEEDED = new Set(['STATE', 'EFFECT', 'EVENTS', 'PARENT', 'READY', 'DOM', 'CHILD', 'ELEMENT', 'PERSIST', 'LOG'])
const DRIVER_NAME = /^[A-Z][A-Z0-9_]*$/
const EXAMPLE = { HTTP: 'makeFetchDriver()', WS: 'makeSocketDriver(url)' }

export default {
  id: 'sink-driver',
  codes: ['SYG609'],
  description: 'Sink has no driver',
  run(project, report) {
    let apps = null
    for (const comp of project.components) {
      const values = comp.model?.sinkValues || []
      const seen = new Set()
      for (const v of values) {
        const sink = v.sink
        if (seen.has(sink) || NO_DRIVER_NEEDED.has(sink) || !DRIVER_NAME.test(sink)) continue
        seen.add(sink)
        apps = apps || findApps(project)
        const rendering = apps.filter(a => a.components.has(comp))
        const lacking = rendering.find(a => a.drivers && !a.drivers.has(sink))
        if (!lacking || rendering.some(a => !a.drivers || a.drivers.has(sink))) continue
        const at = `${project.relPath(lacking.file.path)}:${lacking.call.loc.start.line}`
        const root = lacking.root?.name || 'App'
        const example = EXAMPLE[sink] ? `run(${root}, { ${sink}: ${EXAMPLE[sink]} })` : `run(${root}, { ${sink}: myDriver })`
        report({
          code: 'SYG609',
          component: comp.name,
          file: v.file,
          node: v.node,
          message: `Model entry '${v.action}' sends to the ${sink} sink, but the run() call that renders ${comp.name} (${at}) ` +
            `registers no driver named ${sink}, so every value sent there is dropped`,
          fix: `Pass a driver named ${sink} to run(): ${example}` +
            (EXAMPLE[sink] ? '' : ', e.g. driverFromAsync(fn) or your own driver') +
            `. Check the spelling against the drivers you pass. Tests don't need it: renderComponent fakes the sink`,
          data: { name: sink, kind: 'sink', action: v.action, drivers: [...lacking.drivers] },
        })
      }
    }
  },
}
