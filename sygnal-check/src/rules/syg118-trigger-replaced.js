/**
 * SYG118 (warn, ui-sweep R1): a host intent action named like a behavior action (`'tabs.SELECT'`)
 * replaces the trigger the behavior builds for it. Reported when the `uses` entry passes the
 * option that trigger is built from (the behavior's `listens`: FIRST_PARTY, or what the intent of
 * a defineBehavior() call it can follow listens to through an option), so the elements the option
 * names stop dispatching it. The dev entry reports the same (checks/behaviors.ts onIntent).
 */
import { stringValue } from '../ast.js'

export default {
  id: 'trigger-replaced',
  codes: ['SYG118'],
  description: 'Host intent replaces a behavior trigger',
  run(project, report) {
    for (const comp of project.components) {
      const intent = comp.intent
      if (!intent?.actions?.length) continue
      const byName = new Map(intent.actions.map(a => [a.name, a]))
      for (const e of comp.uses?.entries || []) {
        if (e.status !== 'resolved' || !e.def) continue
        const seen = new Set()
        for (const l of e.def.listens || []) {
          if (!l.action || !e.options?.has(l.option)) continue
          const name = `${e.key}.${l.action}`, a = byName.get(name)
          if (!a || seen.has(name)) continue
          seen.add(name)
          const v = stringValue(e.options.get(l.option).node)
          report({
            code: 'SYG118',
            component: comp.name,
            file: intent.file,
            node: a.node,
            related: [{ file: e.options.get(l.option).file, node: e.options.get(l.option).keyNode, message: `the '${l.option}' option this trigger is built from` }],
            message: `intent action '${name}' replaces the trigger behavior '${e.def.name}' builds from its '${l.option}' option, so the elements '${l.option}' names no longer dispatch '${name}'`,
            fix: `list every element in the option instead (${l.option}: '${v ?? '<its selector>'}, .other'), dispatch it from another action with next('${name}'), or leave the '${l.option}' option out to replace the trigger on purpose`,
            data: { key: e.key, action: l.action, option: l.option },
          })
        }
      }
    }
  },
}
