/**
 * SYG170 (PLAN-10 X-1, D512): a context field read with no provider. A component reads
 * `context.x` (in its view, or a reducer's `props.context`), and neither it nor any component
 * above it declares `x` in its `.context`, so the value is `undefined`.
 *
 * Reported (warn) only when the checker sees the whole chain: every way up from the reader ends at
 * a component that run() or defineElement() starts, and no entry call in the scanned files has a
 * component it can't resolve. Silent otherwise, because the provider may be outside the scanned
 * files or picked at run time:
 *   - a component nothing scanned renders and no entry starts (a library part, a page some
 *     router or test renders, a docs fragment), or a plain capitalized function that renders a
 *     component on the chain without being rendered itself;
 *   - a Vike `+Page` / `+Layout` root (the framework wraps it in layouts it may not scan);
 *   - JSX passed into another component (children / slots: at run time the component that
 *     places it is the parent);
 *   - a component on the chain whose `.context` isn't a literal the checker can read.
 * One finding per component and field, at the first read.
 */
import { renderGraph } from '../model/renderGraph.js'
import { contextReads } from '../model/context.js'
import { closestName } from '../names.js'

/** true / false, or null when the unit's `.context` can't be read */
function provides(u, field) {
  if (u.viewOnly) return false
  if (u.staticProps.context && !u.contextEntries) return null
  return u.contextKeys.has(field)
}

export default {
  id: 'context-provider',
  codes: ['SYG170'],
  description: 'Context field read with no provider',
  run(project, report) {
    const g = renderGraph(project)
    if (g.entries.unknown) return
    const closing = new Set(g.entries.refs.filter(r => r.via !== 'vike').map(g.unitOf).filter(Boolean))
    if (!closing.size) return
    for (const u of [...g.units]) {
      const reads = []
      for (const r of (u.viewOnly ? contextReads(u.view) : u.contextConsumed) || []) reads.push({ ...r, file: u.file })
      for (const r of u.contextReadsModel || []) reads.push(r)
      if (!reads.length) continue

      // everything above u; open when a way up leaves what the checker sees
      const up = new Map([[u, null]]) // unit → the unit below it (for the path)
      const stack = [u]
      let open = false
      while (stack.length && !open) {
        const x = stack.pop()
        const parents = g.parentsOf.get(x) || []
        if (g.hiddenParents(x).length) { open = true; break }
        if (!parents.length) { if (!closing.has(x)) open = true; continue }
        for (const p of parents) {
          if (p.via === 'slot') { open = true; break }
          if (!up.has(p.unit)) { up.set(p.unit, x); stack.push(p.unit) }
        }
      }
      if (open) continue
      const chain = [...up.keys()]
      const root = chain.find(x => closing.has(x) && !(g.parentsOf.get(x) || []).length)
      const path = []
      for (let x = root; x; x = up.get(x)) path.push(x.name)

      const done = new Set()
      for (const r of reads) {
        if (done.has(r.name)) continue
        done.add(r.name)
        const p = chain.map(x => provides(x, r.name))
        if (p.some(v => v !== false)) continue
        const offered = new Set(chain.flatMap(x => x.viewOnly ? [] : [...x.contextKeys]))
        const near = closestName(r.name, offered)
        report({
          code: 'SYG170',
          component: u.name,
          file: r.file,
          node: r.node,
          message: `context.${r.name} is undefined: neither ${u.name} nor a component above it (${path.join(' > ')}) has '${r.name}' in its .context` +
            (near ? ` (did you mean '${near}'?)` : ''),
          fix: near ? `read context.${near}, or add '${r.name}' to an ancestor's .context`
            : `add it to the .context of ${u.name} or a component above it: ${path[0]}.context = { ${r.name}: (state) => … }`,
          data: { field: r.name, path },
        })
      }
    }
  },
}
