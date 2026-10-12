// Baseline for edits: json-render's sequential flow (experimental-compose.ts), adapted to the flat
// layout + params: one `next` choice per call over every operation (add:<part>, remove:<key>,
// move:<key>, replace:<key>, set:<key>:<param>:<value>, finish); move and replace take a second
// call for the destination / the replacement. Repeats until finish (max 8 calls).
import { describeNode, leaves, partById } from '../params-edits.mjs'

export async function baselineEdit(decide, catalog, layout, prompt, { maxSteps = 8 } = {}) {
  let order = leaves(layout).map((l) => ({ key: l.key, node: { ...l.node } })) // rows flattened: baseline has no rows
  let next = Math.max(...Object.keys(layout.nodes).map((k) => Number(k.slice(1)))) + 1
  const done = []
  let pending = null
  let calls = 0
  for (let step = 0; step < maxSteps; step++) {
    const desc = (e) => `${e.key} (${describeNode(catalog, e.node)})`
    const criteria = {}
    if (!pending) {
      const present = new Set(order.map((e) => e.node.part))
      for (const p of catalog.parts) if (!present.has(p.id)) criteria[`add:${p.id}`] = `Add at the end: ${p.description}`
      for (const e of order) {
        criteria[`remove:${e.key}`] = `Remove ${desc(e)}`
        criteria[`move:${e.key}`] = `Move or reorder ${desc(e)}: choose its new position next`
        criteria[`replace:${e.key}`] = `Change ${desc(e)}: choose a replacement element next, in the same position`
        const part = partById(catalog, e.node.part)
        for (const [name, p] of Object.entries(part.params || {})) for (const [v, vd] of Object.entries(p.options)) {
          if (String(e.node.params?.[name] ?? p.default) !== v) criteria[`set:${e.key}:${name}:${v}`] = `Set the ${p.label} of ${desc(e)} to ${vd}`
        }
      }
      criteria.finish = 'The page fulfills the request; no more changes are needed.'
    } else if (pending.type === 'move') {
      const others = order.filter((e) => e.key !== pending.key)
      others.forEach((e, i) => { criteria[`pos:${i}`] = `Move ${pending.key} before ${desc(e)}` })
      criteria[`pos:${others.length}`] = `Move ${pending.key} to the end, at the bottom`
    } else {
      const present = new Set(order.map((e) => e.node.part))
      for (const p of catalog.parts) if (!present.has(p.id)) criteria[`with:${p.id}`] = `Replace with: ${p.description}`
    }
    const r = await decide({
      user_request: prompt,
      already_built: order.map((e) => ({ id: e.key, content: describeNode(catalog, e.node) })),
      changes_made: done,
    }, {
      next: {
        type: 'choice',
        instructions: [
          'Choose the next operation needed by user_request. Use only offered choices.',
          pending ? `Now ${pending.type} ${pending.key}. Choose only the destination or replacement that fulfills the requested edit.`
            : 'This is a follow-up edit to the existing UI. Preserve everything the user did not ask to change. Use add for new elements, replace to change an element, remove to delete one, move to reorder, set to change a setting. Finish when the requested changes are done.',
        ].join(' '),
        criteria,
      },
    })
    calls++
    const c = r.answers.next.choice
    done.push(criteria[c])
    if (c === 'finish') break
    const [op, a, b, v] = c.split(':')
    if (pending?.type === 'move') {
      const e = order.find((x) => x.key === pending.key)
      const others = order.filter((x) => x !== e)
      others.splice(Number(a), 0, e); order = others; pending = null
    } else if (pending?.type === 'replace') {
      const i = order.findIndex((x) => x.key === pending.key)
      order[i] = { key: `n${next++}`, node: { part: a } }; pending = null
    } else if (op === 'add') order.push({ key: `n${next++}`, node: { part: a } })
    else if (op === 'remove') order = order.filter((x) => x.key !== a)
    else if (op === 'move' || op === 'replace') pending = { type: op, key: a }
    else if (op === 'set') {
      const e = order.find((x) => x.key === a)
      const p = partById(catalog, e.node.part).params[b]
      const params = { ...(e.node.params || {}) }
      if (v === String(p.default)) delete params[b]; else params[b] = v
      e.node = { ...e.node, params }
      if (!Object.keys(params).length) delete e.node.params
    }
  }
  const out = { root: layout.root, nodes: { [layout.root]: { part: 'page', slots: { default: order.map((e) => e.key) } } } }
  for (const e of order) out.nodes[e.key] = e.node
  return { layout: out, calls }
}
