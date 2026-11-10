/**
 * SYG511 (strict, warn): an EFFECT handler, or a helper it reaches, makes a network request
 * directly (`fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, `WebSocket`, `EventSource`, an HTTP
 * client package). EFFECT is the declared escape hatch, so the effect is visible to tools; a
 * request there still bypasses the HTTP driver: no reply actions, no abort, no test fake, and no
 * URL in the inventory. SYG512 (strict, info): a pure place writes a module-level variable, a
 * hidden channel between components. Analysis: model/effects.js.
 */
import { effectRoots, effectFindings, effectReport } from '../../model/effects.js'

export default {
  id: 'strict-network-in-effect',
  codes: ['SYG511', 'SYG512'],
  description: 'Network request in an EFFECT handler; module-level variable written outside an output',
  perFile: true,
  strict: true,
  run(project, report) {
    for (const comp of project.components) {
      for (const root of effectRoots(project, comp)) {
        for (const f of effectFindings(project, root)) if (f.code === 'SYG511' || f.code === 'SYG512') report(effectReport(project, root, f))
      }
    }
  },
}
