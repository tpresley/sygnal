/**
 * SYG117 (PLAN-13 N-1): a literal `next('X')` in a component's model where the component has no
 * model entry X. next() dispatches to its own component only, so the action does nothing; an
 * ancestor's entry of that name never runs (a child's `next('ENTER')` for an action its parent
 * handles: the Temper "Loading your Task Card…" hang).
 *
 *   Card.model = { CLICK: { EFFECT: (s, d, next) => next('ENTER') } }   // ENTER: only App has it
 *
 * Sources: model.nextTargets (literal names inside the model object and the module-level
 * reducers it references). Not reported for a model with spreads, a component whose behaviors
 * can't all be followed, or a behavior's own (namespaced) actions. When a scanned component that
 * renders this one (or one above it) has the entry, the message names it and the fix is PARENT /
 * EVENTS; otherwise a did-you-mean against the component's own entries.
 */
import { closestName } from '../names.js'
import { renameFix, stringEdit } from '../edits.js'
import { behaviorActions, openPrefixes } from '../model/behaviors.js'
import { renderGraph } from '../model/renderGraph.js'

/** the nearest scanned ancestor (by render edges) with a model entry `action` */
function handlerAbove(graph, comp, action) {
  const seen = new Set([comp])
  let level = [comp]
  while (level.length) {
    const up = []
    for (const u of level) for (const p of graph.parentsOf.get(u) || []) {
      if (seen.has(p.unit)) continue
      seen.add(p.unit)
      if ((p.unit.model?.entries || []).some(e => e.action === action)) return p.unit
      up.push(p.unit)
    }
    level = up
  }
  return null
}

export default {
  id: 'next-without-entry',
  codes: ['SYG117'],
  description: 'next() names an action with no model entry',
  run(project, report) {
    let graph
    for (const comp of project.components) {
      const model = comp.model
      if (!model || !model.known || !model.nextTargets.length) continue
      const uses = comp.uses
      if (uses && (!uses.known || uses.entries.some(e => e.status === 'opaque'))) continue
      const keys = new Set(model.entries.map(e => e.action))
      const owned = behaviorActions(uses)
      const open = openPrefixes(uses)
      for (const t of model.nextTargets) {
        if (keys.has(t.name) || owned.has(t.name) || open.some(p => t.name.startsWith(p))) continue
        graph ||= renderGraph(project)
        const up = handlerAbove(graph, comp, t.name)
        const near = up ? undefined : closestName(t.name, keys)
        report({
          code: 'SYG117',
          component: comp.name,
          file: t.file,
          node: t.node,
          message: `${comp.name} calls next('${t.name}'), but ${comp.name} has no model entry '${t.name}', so the action does nothing` +
            (up ? `: next() never reaches ${up.name}, which handles '${t.name}'` : near ? ` (did you mean '${near}'?)` : ''),
          fix: up
            ? `next() stays in its own component. Send it up instead: give the entry that calls it a PARENT sink (PARENT: (state) => ({ … })) and add ${t.name}: CHILD.select(${comp.name}) to ${up.name}.intent, or emit EVENTS: event('${t.name}', …) and select it there`
            : near
            ? `rename it to the existing entry: next('${near}')`
            : `add the entry to ${comp.name}.model (${t.name}: (state, data) => …), or fix the name to match an existing one`,
          data: { action: t.name, ...(up ? { handledBy: up.name } : {}), ...(near ? { suggestion: near } : {}) },
          fixes: near && renameFix(`Change '${t.name}' to '${near}'`, stringEdit(t.file, t.node, near)),
        })
      }
    }
  },
}
