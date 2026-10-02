/**
 * SYG102: a model entry nothing can trigger: no intent action of that name,
 * not a built-in action, no next('X') string literal targets it, no routed
 * request names it (`ok: 'X'` / `error: 'X'` in a value a non-STATE sink
 * returns), and no `connections` entry names it (message/open/close/error).
 */
import { BUILTIN_ACTIONS } from '../model/modelEntries.js'

export default {
  id: 'unreachable-model',
  codes: ['SYG102'],
  description: 'Model entry is unreachable',
  run(project, report) {
    for (const comp of project.components) {
      const model = comp.model
      if (!model || model.entries.length === 0) continue
      // An intent we can't see through (single stream, spreads, imported helper) may produce any action.
      if (comp.staticProps.intent && (!comp.intent || !comp.intent.known)) continue
      const triggers = new Set((comp.intent?.actions || []).map(a => a.name))
      const nextTargets = new Set(model.nextTargets.map(t => t.name))
      const routed = new Set([...model.routedTargets, ...(comp.connections?.targets || [])].map(t => t.name))
      const dynamicNext = model.dynamicNext.length > 0
      const dynamicRouted = model.routedDynamic.length > 0 || (comp.connections?.dynamic.length || 0) > 0
      const dynamic = dynamicNext || dynamicRouted
      const seen = new Set()
      for (const e of model.entries) {
        if (seen.has(e.action)) continue
        seen.add(e.action)
        if (BUILTIN_ACTIONS.has(e.action) || triggers.has(e.action) || nextTargets.has(e.action) || routed.has(e.action)) continue
        report({
          code: 'SYG102',
          severity: dynamic ? 'info' : undefined,
          component: comp.name,
          file: e.file,
          node: e.node,
          message: `model entry '${e.action}' is never triggered: no intent action, built-in action, routed request (ok/error) or next('${e.action}') call uses it` +
            (dynamicNext ? ' (a next() call with a non-literal name might)' : dynamicRouted ? ' (a request with a non-literal ok/error name might)' : ''),
          fix: comp.intent
            ? `add '${e.action}' to ${comp.name}.intent, name it in a request (ok: '${e.action}'), call next('${e.action}') from another entry, or remove it`
            : `add an intent that returns '${e.action}', name it in a request (ok: '${e.action}'), call next('${e.action}') from another entry, or remove it`,
          data: { action: e.action },
        })
      }
    }
  },
}
