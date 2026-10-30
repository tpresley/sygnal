/**
 * SYG258 (warn): a STATE reducer reads the clock or randomness from a global (`Date.now()`,
 * `new Date()`, `Math.random()`, `crypto.randomUUID()`), so replaying its actions (record/replay,
 * renderComponent) can give a different state. The canonical form takes `now()`, `random()` and
 * `uuid()` from the reducer's 4th argument (props):
 *
 *   ADD: (state, title, next, { now, uuid }) => ({ ...state, tasks: [...state.tasks, { id: uuid(), title, created: now() }] })
 *
 * Only STATE reducers, and only reads directly in the reducer's body (model/clockReads.js).
 * Under --strict this rule is replaced by SYG509 (rules/strict/syg509-clock-in-handler.js),
 * which also covers EFFECT and other sink handlers: `notStrict` makes selectRules() leave it out,
 * so one read is never reported under both codes.
 */
import { modelHandlers, clockReads, clockRewrite, clockReport } from '../model/clockReads.js'

export default {
  id: 'clock-in-reducer',
  codes: ['SYG258'],
  description: 'Clock or randomness read from a global in a STATE reducer',
  perFile: true,
  notStrict: true, // SYG509 reports these under --strict
  run(project, report) {
    for (const comp of project.components) {
      for (const h of modelHandlers(project, comp)) {
        if (h.sink !== 'STATE') continue
        const { file, node: fn } = h.fn
        const reads = clockReads(file, fn)
        if (!reads.length) continue
        const rewrite = clockRewrite(file, fn, reads)
        for (const r of reads) report({ ...clockReport(file, h, r, rewrite, 'SYG258'), component: comp.name })
      }
    }
  },
}
