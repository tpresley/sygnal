/**
 * Wizard spike (dev-plans/research/wizard): an <Outlet from="key"> checked against the component's
 * `uses`.
 * - SYG455: `from` names no uses key, or a key whose behavior isn't `wizard()` (the dev runtime
 *   reports the first at run time too).
 * - SYG456: a step of the wizard's `steps` with no component in `of` (nothing renders when the flow
 *   reaches it; the runtime reports it when it happens).
 * - SYG457: an `of` key that is no step (a typo, or a step that was removed).
 * Only for a known `uses` object, a string `from`, and `of` / `steps` object literals of named keys.
 */
import { closestName } from '../names.js'
import { renameFix, keyEdit, stringEdit } from '../edits.js'

export default {
  id: 'outlet',
  codes: ['SYG455', 'SYG456', 'SYG457'],
  description: 'Outlet from and of checked against the wizard',
  run(project, report) {
    const seen = new Set()
    for (const comp of project.components) {
      if (!comp.view) continue
      const sink = project.viewOf({ file: comp.file, node: comp.view })
      for (const u of sink?.collections || []) {
        const o = u.outlet
        if (!o || o.from == null || seen.has(u.node)) continue
        seen.add(u.node)
        const uses = comp.uses
        if (!uses?.known) continue
        const file = u.file || comp.file
        const e = uses.entries.find(x => x.key === o.from)
        if (!e) {
          const keys = uses.entries.map(x => x.key), near = closestName(o.from, new Set(keys))
          report({
            code: 'SYG455',
            component: comp.name,
            file,
            node: o.fromNode,
            message: `<Outlet from="${o.from}"> names no key of ${comp.name}.uses` + (keys.length ? ` (${keys.join(', ')})` : '') + (near ? `; did you mean '${near}'?` : ''),
            fix: near ? `from="${near}"` : `declare it: ${comp.name}.uses = { ${o.from}: wizard({ steps }) }`,
            data: { from: o.from, keys, ...(near ? { suggestion: near } : {}) },
            fixes: near && o.fromNode?.value && renameFix(`Change '${o.from}' to '${near}'`, stringEdit(file, o.fromNode.value, near)),
          })
          continue
        }
        if (e.status !== 'resolved') continue
        if (e.def?.name !== 'wizard') {
          report({
            code: 'SYG455',
            component: comp.name,
            file,
            node: o.fromNode,
            message: `<Outlet from="${o.from}"> names ${comp.name}.uses.${o.from}, which is not a wizard() behavior`,
            fix: `name the key of a wizard() in from, or use the Outlet's route or current props`,
            data: { from: o.from, reason: 'not-wizard' },
          })
          continue
        }
        const st = e.options.get('steps'), steps = st && project.objectKeys(st.file, st.node)
        if (!steps || !o.of) continue
        const ofKeys = new Set(o.of.map(x => x.key)), names = new Set(steps.keys())
        for (const [name, s] of steps) {
          if (ofKeys.has(name)) continue
          report({
            code: 'SYG456',
            component: comp.name,
            file,
            node: o.ofNode,
            message: `step '${name}' of ${comp.name}.uses.${o.from} has no component in the Outlet's of; nothing renders when the flow reaches it`,
            fix: `add it: of={{ ${name}: Component, … }}`,
            data: { step: name, steps: [...names] },
          })
        }
        for (const { key, node } of o.of) {
          if (names.has(key)) continue
          const near = closestName(key, names)
          report({
            code: 'SYG457',
            component: comp.name,
            file,
            node,
            message: `the Outlet's of names '${key}', which is not a step of ${comp.name}.uses.${o.from} (${[...names].join(', ')}), so it never renders` + (near ? ` (did you mean '${near}'?)` : ''),
            fix: near ? `rename the key to the step: ${near}: …` : `use one of the step names as the key, or remove the entry`,
            data: { key, steps: [...names], ...(near ? { suggestion: near } : {}) },
            fixes: near && renameFix(`Change '${key}' to '${near}'`, keyEdit(file, node, near)),
          })
        }
      }
    }
  },
}
