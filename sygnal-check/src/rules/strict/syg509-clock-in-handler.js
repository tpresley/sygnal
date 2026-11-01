/**
 * SYG509 (strict, warn): a model handler (a STATE reducer, an EFFECT handler or another sink's
 * handler, including event()'s payload function) reads the clock or randomness from a global:
 * `Date.now()`, `new Date()` with no arguments, `Math.random()`, `crypto.randomUUID()` (also
 * through `globalThis.` / `window.` / `self.`). The canonical form takes them from the handler's
 * 4th argument (props), which record/replay and renderComponent can supply:
 *
 *   SAVE: { EFFECT: (state, data, next, { now }) => { localStorage.setItem('savedAt', String(now())) } }
 *
 * Reads in nested functions, views and intents are not reported. Under --strict this rule
 * replaces the default-mode SYG258 (STATE reducers only; rules/syg258-clock-in-reducer.js).
 * `--fix` rewrites the reads and the parameter list when it is safe (model/clockReads.js).
 */
import { modelHandlers, clockReads, clockRewrite, clockReport } from '../../model/clockReads.js'

export default {
  id: 'strict-clock-in-handler',
  codes: ['SYG509'],
  description: 'Clock or randomness read from a global in a handler',
  perFile: true,
  strict: true,
  run(project, report) {
    for (const comp of project.components) {
      for (const h of modelHandlers(project, comp)) {
        const { file, node: fn } = h.fn
        const reads = clockReads(file, fn)
        if (!reads.length) continue
        const rewrite = clockRewrite(file, fn, reads)
        for (const r of reads) report({ ...clockReport(file, h, r, rewrite, 'SYG509'), component: comp.name })
      }
    }
  },
}
