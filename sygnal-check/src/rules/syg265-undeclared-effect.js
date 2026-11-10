/**
 * SYG265 (error) and SYG266 (warn): a side effect outside a declared output. A view, a STATE
 * reducer, another sink's handler (it returns the output, it doesn't perform it), a calculated
 * field, a context entry, a declaration static, an intent, a component file's top-level code, or
 * a helper one of these reaches, calls a browser API that changes something outside the app's
 * state: SYG265 for the network, SYG266 for storage, navigation, timers, messages, DOM writes
 * and listeners, device APIs and dynamic code. Every effect then goes through a model output,
 * so an inventory of a change's effects can be computed from the code. EFFECT handlers are the
 * declared escape hatch (rules/strict/syg511-network-in-effect.js for the one thing not allowed
 * there). Analysis and words: model/effects.js. Research: dev-plans/research/undeclared-effects.
 */
import { effectRoots, runRoots, moduleRoot, effectFindings, effectReport } from '../model/effects.js'

export default {
  id: 'undeclared-effect',
  codes: ['SYG265', 'SYG266'],
  description: 'Side effect outside a declared output',
  perFile: true, // run.js createRuleMemo: one file at a time, from the file and its imports
  run(project, report) {
    const emit = (root) => {
      for (const f of effectFindings(project, root)) if (f.code === 'SYG265' || f.code === 'SYG266') report(effectReport(project, root, f))
    }
    for (const comp of project.components) for (const root of effectRoots(project, comp)) emit(root)
    for (const root of runRoots(project)) emit(root)
    for (const p of project.scanned) {
      const file = project.files.get(p)
      const root = file && moduleRoot(project, file)
      if (root) emit(root)
    }
  },
}
