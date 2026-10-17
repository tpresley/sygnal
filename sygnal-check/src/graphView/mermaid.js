/**
 * The app graph as a Mermaid flowchart (PLAN-10 C-2, D504): `sygnal-check --graph=mermaid` and the
 * page's "Copy as Mermaid" both call this.
 *
 *   toMermaid(model, { events = true }) → string
 *     flowchart TD; one node per component (ghosts dashed); render edges (Collection labelled
 *     with its `[from]` field, Switchable with 'switch', slots with 'slot'); EVENTS as dotted edges
 *     labelled with the type (left out with events: false). Node ids are n0, n1, … in model order.
 *
 * Pure: no DOM, no imports (html.js inlines it; see model.js).
 */

/** A quoted Mermaid label: entity codes for the characters Mermaid would read as syntax or HTML. */
export function mermaidLabel(s) {
  return '"' + String(s).replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;') + '"'
}

export function toMermaid(model, { events = true } = {}) {
  const ids = new Map(model.comps.map((c, i) => [c.id, 'n' + i]))
  const lines = ['flowchart TD']
  for (const c of model.comps) lines.push(`  ${ids.get(c.id)}[${mermaidLabel(c.name)}]${c.ghost ? ':::ghost' : ''}`)
  const seen = new Set()
  const push = (line) => { if (!seen.has(line)) { seen.add(line); lines.push(line) } }
  for (const e of model.renderEdges) push(`  ${ids.get(e.from)} ${e.label ? `-->|${mermaidLabel(e.label)}|` : '-->'} ${ids.get(e.to)}`)
  if (events) for (const e of model.eventEdges) push(`  ${ids.get(e.from)} -.->|${mermaidLabel(e.type)}| ${ids.get(e.to)}`)
  if (model.comps.some(c => c.ghost)) lines.push('  classDef ghost stroke-dasharray: 5 5')
  return lines.join('\n') + '\n'
}
