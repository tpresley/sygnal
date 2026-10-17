/**
 * The app graph as a Mermaid flowchart (PLAN-10 C-2, D504): `sygnal-check --graph=mermaid` and the
 * page's "Copy as Mermaid" both call this.
 *
 *   toMermaid(model, { events = true, classOf?, edgeClassOf?, classDefs?, linkStyles? }) → string
 *     flowchart TD; one node per component (ghosts dashed); render edges (Collection labelled
 *     with its `[from]` field, Switchable with 'switch', slots with 'slot'); EVENTS as dotted edges
 *     labelled with the type (left out with events: false). Node ids are n0, n1, … in model order.
 *     The diff (PLAN-10 C-3, diff.js): classOf(comp) → a class name (in classDefs: name → style)
 *     instead of ghost; edgeClassOf(edge) → a name in linkStyles (name → style), a linkStyle line
 *     per class with the indexes of its edges.
 *
 * Pure: no DOM, no imports (html.js inlines it; see model.js).
 */

/** A quoted Mermaid label: entity codes for the characters Mermaid would read as syntax or HTML. */
export function mermaidLabel(s) {
  return '"' + String(s).replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;') + '"'
}

export function toMermaid(model, { events = true, classOf, edgeClassOf, classDefs = {}, linkStyles = {} } = {}) {
  const ids = new Map(model.comps.map((c, i) => [c.id, 'n' + i]))
  const lines = ['flowchart TD']
  const cls = (c) => (classOf && classOf(c)) || (c.ghost ? 'ghost' : null)
  const used = new Set()
  for (const c of model.comps) { const k = cls(c); if (k) used.add(k); lines.push(`  ${ids.get(c.id)}[${mermaidLabel(c.name)}]${k ? ':::' + k : ''}`) }
  const seen = new Set()
  const links = new Map()
  let n = 0
  const push = (line, e) => {
    if (seen.has(line)) return
    seen.add(line); lines.push(line)
    const k = edgeClassOf && edgeClassOf(e)
    if (k && linkStyles[k]) { if (!links.has(k)) links.set(k, []); links.get(k).push(n) }
    n++
  }
  for (const e of model.renderEdges) push(`  ${ids.get(e.from)} ${e.label ? `-->|${mermaidLabel(e.label)}|` : '-->'} ${ids.get(e.to)}`, e)
  if (events) for (const e of model.eventEdges) push(`  ${ids.get(e.from)} -.->|${mermaidLabel(e.type)}| ${ids.get(e.to)}`, e)
  if (used.has('ghost')) lines.push('  classDef ghost stroke-dasharray: 5 5')
  for (const k of Object.keys(classDefs)) if (used.has(k)) lines.push(`  classDef ${k} ${classDefs[k]}`)
  for (const [k, list] of links) lines.push(`  linkStyle ${list.join(',')} ${linkStyles[k]}`)
  return lines.join('\n') + '\n'
}
