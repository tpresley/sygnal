/**
 * SYG101: an intent action with no model entry never does anything.
 * Model keys are expanded first ('ACTION | SINK' → ACTION).
 *
 * Behaviors (PLAN-4 GS-1): a behavior's model entries count as the host's,
 * namespaced ('pager.NEXT', D109), so a host intent action 'pager.NEXT' is
 * handled. Actions under an opaque behavior's key are not checked. A
 * behavior intent action (a defineBehavior definition) with no entry in the
 * behavior's model, nor a host 'key.ACTION' entry, is reported at the
 * component's `uses` entry.
 */
import { behaviorActions, openPrefixes } from '../model/behaviors.js'

export default {
  id: 'intent-without-model',
  codes: ['SYG101'],
  description: 'Intent action has no model entry',
  run(project, report) {
    for (const comp of project.components) {
      if (comp.model && !comp.model.known) continue // spreads / unresolvable model
      if (!comp.model && comp.staticProps.model) continue
      const modelActions = new Set((comp.model?.entries || []).map(e => e.action))
      const owned = behaviorActions(comp.uses)
      const open = openPrefixes(comp.uses)
      const intent = comp.intent
      for (const a of intent?.actions || []) {
        if (modelActions.has(a.name) || owned.get(a.name)?.sinks.length || open.some(p => a.name.startsWith(p))) continue
        report({
          code: 'SYG101',
          component: comp.name,
          file: intent.file,
          node: a.node,
          message: `intent action '${a.name}' has no model entry, so it does nothing`,
          fix: `add '${a.name}' to ${comp.name}.model, or fix the spelling to match an existing model key`,
          data: { action: a.name },
        })
      }
      for (const [name, b] of owned) {
        if (!b.intent || b.sinks.length || modelActions.has(name) || open.some(p => name.startsWith(p))) continue
        const e = b.entry
        report({
          code: 'SYG101',
          component: comp.name,
          file: e.file,
          node: e.keyNode,
          message: `behavior '${e.def.name}' (uses key '${e.key}') has intent action '${b.action}' with no model entry, in the behavior or as '${name}' in ${comp.name}.model, so it does nothing`,
          fix: `add '${b.action}' to the behavior's model, or handle '${name}' in ${comp.name}.model`,
          data: { action: name, behavior: e.key },
        })
      }
    }
  },
}
