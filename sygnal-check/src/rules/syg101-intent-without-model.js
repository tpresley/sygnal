/**
 * SYG101: an intent action with no model entry never does anything.
 * Model keys are expanded first ('ACTION | SINK' → ACTION).
 */
export default {
  id: 'intent-without-model',
  codes: ['SYG101'],
  description: 'Intent action has no model entry',
  run(project, report) {
    for (const comp of project.components) {
      const intent = comp.intent
      if (!intent || intent.actions.length === 0) continue
      if (comp.model && !comp.model.known) continue // spreads / unresolvable model
      if (!comp.model && comp.staticProps.model) continue
      const modelActions = new Set((comp.model?.entries || []).map(e => e.action))
      for (const a of intent.actions) {
        if (modelActions.has(a.name)) continue
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
    }
  },
}
