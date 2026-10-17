/**
 * The layout of a grouped projection (PLAN-10 V-4, D536, D537: no layout library): each open
 * directory group laid out on its own (layered, islands packed) inside a box, the folded group
 * cards laid out together over their bundled render edges, EVENTS bus nodes in a lane to the right.
 * Ported from S-1's prototype (research/graph-viz/large/model.mjs `layout`, `layered`, `shelf`).
 *
 *   layoutView(P, opts?) → { pos: Map id → { x, y, w, h }, clusters: [{ key, x, y, w, h, open: true }] }
 *     P      groups.js projectView() (not identity / flat: those go through layoutGraph())
 *     opts   { wrap?: n }: a layer wider than n cards continues on the next row (P.tier.wrap: the
 *            default ⌈1.2·√nodes⌉, at least 6)
 *   Same shapes as layoutGraph(), so edgePaths() and the page take either. Deterministic. Editing
 *   one group moves only that group and the boxes packed after it (S-1 §2: 1.4–7.6 % of nodes at
 *   500–2,000; folded groups 0 %).
 *
 * Pure: no DOM, no imports (html.js inlines it; see model.js).
 */

const LX = 36, LY = 86, BOXPAD = 28, BOXHEAD = 18, CARD_H = 74

/** Layered layout of `ids` (longest path without the cycle-closing edges, barycenter sweeps). */
function layered(ids, parentsOf, childrenOf, sizeOf, wrap) {
  const set = new Set(ids)
  const kids = (id) => childrenOf.get(id).filter(c => set.has(c) && c !== id)
  const roots = ids.filter(id => !parentsOf.get(id).some(p => p !== id && set.has(p)))
  const order = new Map(), back = new Set(), onStack = new Set()
  const visit = (root) => {
    // iterative depth-first walk: preorder and the back edges (deep trees don't hit the stack limit)
    const stack = [[root, 0]]
    order.set(root, order.size); onStack.add(root)
    while (stack.length) {
      const top = stack[stack.length - 1]
      const ks = kids(top[0])
      if (top[1] >= ks.length) { onStack.delete(top[0]); stack.pop(); continue }
      const c = ks[top[1]++]
      if (onStack.has(c)) back.add(top[0] + '\u0000' + c)
      else if (!order.has(c)) { order.set(c, order.size); onStack.add(c); stack.push([c, 0]) }
    }
  }
  for (const r of roots) if (!order.has(r)) visit(r)
  for (const id of ids) if (!order.has(id)) visit(id)
  const dagKids = (id) => kids(id).filter(c => !back.has(id + '\u0000' + c))
  const dagParents = (id) => parentsOf.get(id).filter(p => p !== id && set.has(p) && !back.has(p + '\u0000' + id))
  const indeg = new Map(ids.map(id => [id, dagParents(id).length]))
  const layer = new Map()
  const ready = ids.filter(id => indeg.get(id) === 0).sort((a, b) => order.get(a) - order.get(b))
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]
    layer.set(id, Math.max(0, ...dagParents(id).map(p => layer.get(p) + 1)))
    for (const c of dagKids(id)) { indeg.set(c, indeg.get(c) - 1); if (indeg.get(c) === 0) ready.push(c) }
  }
  const layers = []
  for (const id of ids) { const l = layer.get(id) ?? 0; layer.set(id, l); (layers[l] = layers[l] || []).push(id) }
  for (let l = 0; l < layers.length; l++) layers[l] = layers[l] || []
  for (const L of layers) L.sort((a, b) => order.get(a) - order.get(b))
  const index = () => { const m = new Map(); layers.forEach(L => L.forEach((id, i) => m.set(id, i))); return m }
  const sortBy = (L, f) => { const k = new Map(L.map(id => [id, f(id)])); L.sort((a, b) => k.get(a) - k.get(b) || order.get(a) - order.get(b)) }
  for (let pass = 0; pass < 4; pass++) {
    let m = index()
    for (let l = 1; l < layers.length; l++) {
      sortBy(layers[l], (id) => { const ps = parentsOf.get(id).filter(p => set.has(p) && layer.get(p) === l - 1); return ps.length ? ps.reduce((s, p) => s + m.get(p), 0) / ps.length : m.get(id) })
      m = index()
    }
    for (let l = layers.length - 2; l >= 0; l--) {
      sortBy(layers[l], (id) => { const cs = kids(id).filter(c => layer.get(c) === l + 1); return cs.length ? cs.reduce((s, c) => s + m.get(c), 0) / cs.length : m.get(id) })
      m = index()
    }
  }
  const W = (id) => sizeOf(id).w, H = (id) => sizeOf(id).h
  const out = new Map()
  if (wrap && layers.some(L => L.length > wrap)) {
    // wrapped rows: a layer wider than `wrap` cards continues on the next row (ordered, centred)
    const rows = []
    for (const L of layers) for (let i = 0; i < L.length; i += wrap) rows.push({ ids: L.slice(i, i + wrap), gap: i + wrap >= L.length ? LY : LY / 3 })
    const rw = rows.map(r => r.ids.reduce((s, id) => s + W(id) + LX, -LX))
    const maxW = Math.max(...rw)
    let y = 0
    rows.forEach((r, i) => {
      let x = (maxW - rw[i]) / 2
      for (const id of r.ids) { out.set(id, { x, y }); x += W(id) + LX }
      y += Math.max(CARD_H, ...r.ids.map(H)) + r.gap
    })
    return { pos: out, w: maxW, h: y - rows[rows.length - 1].gap }
  }
  const local = new Map()
  const wide = layers.reduce((w, L, i) => L.length > layers[w].length ? i : w, 0)
  let x0 = 0
  for (const id of layers[wide]) { local.set(id, x0); x0 += W(id) + LX }
  const place = (l, up) => {
    const want = layers[l].map(id => {
      const rs = (up ? parentsOf.get(id) : kids(id)).filter(r => set.has(r) && local.has(r) && layer.get(r) === (up ? l - 1 : l + 1))
      return [id, rs.length ? rs.reduce((s, r) => s + local.get(r) + W(r) / 2, 0) / rs.length - W(id) / 2 : null]
    })
    const known = want.filter(w => w[1] != null).map(w => w[1])
    let base = known.length ? Math.min(...known) : 0, lastR = -Infinity
    for (const [id, x] of want) { const v = Math.max(x ?? base, lastR + LX); local.set(id, v); lastR = v + W(id); base = lastR + LX }
  }
  for (let l = wide + 1; l < layers.length; l++) place(l, true)
  for (let l = wide - 1; l >= 0; l--) place(l, false)
  const minX = Math.min(...local.values())
  const rowH = layers.map(L => Math.max(CARD_H, ...L.map(H)))
  const rowY = []
  let y = 0
  for (let l = 0; l < layers.length; l++) { rowY[l] = y; y += rowH[l] + LY }
  let w = 0
  for (const id of ids) { const x = local.get(id) - minX; out.set(id, { x, y: rowY[layer.get(id)] }); w = Math.max(w, x + W(id)) }
  return { pos: out, w, h: Math.max(0, y - LY) }
}

/** Shelf-packs boxes ({ w, h }) into rows no wider than maxW; sets b.x, b.y. */
function shelf(boxes, maxW, gap) {
  let x = 0, y = 0, rowH = 0, w = 0
  for (const b of boxes) {
    if (x > 0 && x + b.w > maxW) { x = 0; y += rowH + gap; rowH = 0 }
    b.x = x; b.y = y
    x += b.w + gap
    rowH = Math.max(rowH, b.h)
    w = Math.max(w, b.x + b.w)
  }
  return { w, h: y + rowH }
}

export function layoutView(P, opts = {}) {
  const pos = new Map(), clusters = []
  const nodes = P.nodes.filter(n => n.type !== 'bus')
  const sizeOf = (id) => P.byNode.get(id)
  const { parentsOf, childrenOf } = P
  const wrap = opts.wrap ?? (P.tier?.wrap ? Math.max(6, Math.ceil(Math.sqrt(nodes.length) * 1.2)) : 0)
  const maxW = Math.max(1600, Math.sqrt(nodes.length) * (216 + LX) * 1.6)
  const islands = (ids) => {
    const set = new Set(ids), seen = new Set(), out = []
    for (const id of ids) {
      if (seen.has(id)) continue
      const isl = [], st = [id]
      while (st.length) { const x = st.pop(); if (seen.has(x) || !set.has(x)) continue; seen.add(x); isl.push(x); st.push(...parentsOf.get(x), ...childrenOf.get(x)) }
      out.push(isl)
    }
    const entry = (isl) => isl.some(id => sizeOf(id).comp?.entry === true || sizeOf(id).entry)
    return out.sort((a, b) => Number(entry(b)) - Number(entry(a)) || b.length - a.length)
  }
  const pack = (ids, innerMax) => {
    const isl = islands(ids).map(ix => ({ ids: ix, ...layered(ix, parentsOf, childrenOf, sizeOf, wrap) }))
    const sh = shelf(isl, Math.max(innerMax, ...isl.map(i => i.w)), LX * 2)
    const p = new Map()
    for (const i of isl) for (const [id, q] of i.pos) p.set(id, { x: i.x + q.x, y: i.y + q.y })
    return { pos: p, w: sh.w, h: sh.h }
  }
  // the open groups each on their own, the folded cards together (no box around them)
  const byGroup = new Map()
  // a group that shows one component (it never folds) sits with the folded cards when there are any
  const drawnIn = new Map()
  for (const n of nodes) if (n.type === 'comp') { const k = P.groupOf.get(n.id); drawnIn.set(k, (drawnIn.get(k) ?? 0) + 1) }
  const anyFolded = nodes.some(n => n.type === 'group')
  for (const n of nodes) {
    const g = n.type === 'comp' ? P.groupOf.get(n.id) ?? null : null
    const k = n.type === 'group' || P.flat || (anyFolded && drawnIn.get(g) === 1) ? null : g
    if (!byGroup.has(k)) byGroup.set(k, [])
    byGroup.get(k).push(n.id)
  }
  const boxed = (k) => k != null && byGroup.size > 1
  const gs = [...byGroup].map(([key, ids]) => ({ key, ids, ...pack(ids, maxW / 2) }))
  const hasEntry = (g) => g.ids.some(id => sizeOf(id).comp?.entry === true || sizeOf(id).entry)
  gs.sort((a, b) => Number(hasEntry(b)) - Number(hasEntry(a)) || b.ids.length - a.ids.length || (String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : 0))
  for (const g of gs) if (boxed(g.key)) { g.w += BOXPAD * 2; g.h += BOXPAD * 2 + BOXHEAD }
  shelf(gs, maxW, 40)
  for (const g of gs) {
    const ox = g.x + (boxed(g.key) ? BOXPAD : 0), oy = g.y + (boxed(g.key) ? BOXPAD + BOXHEAD : 0)
    for (const [id, q] of g.pos) { const s = sizeOf(id); pos.set(id, { x: ox + q.x, y: oy + q.y, w: s.w, h: s.h }) }
    if (boxed(g.key)) clusters.push({ key: g.key, x: g.x, y: g.y, w: g.w, h: g.h, open: true })
  }
  // bus nodes: a lane right of the drawing, ordered by the mean height of their ends
  const buses = P.nodes.filter(n => n.type === 'bus')
  if (buses.length) {
    let x1 = 0
    for (const p of pos.values()) x1 = Math.max(x1, p.x + p.w)
    const ends = new Map(buses.map(b => [b.id, []]))
    for (const e of P.eventEdges) {
      if (ends.has(e.to) && pos.has(e.from)) ends.get(e.to).push(pos.get(e.from))
      if (ends.has(e.from) && pos.has(e.to)) ends.get(e.from).push(pos.get(e.to))
    }
    const want = buses.map(b => { const ps = ends.get(b.id); return [b, ps.length ? ps.reduce((s, p) => s + p.y + p.h / 2, 0) / ps.length : 0] })
      .sort((a, b) => a[1] - b[1] || (a[0].id < b[0].id ? -1 : 1))
    let last = -Infinity
    for (const [b, y0] of want) { const y = Math.max(y0 - b.h / 2, last + 8); pos.set(b.id, { x: x1 + 160, y, w: b.w, h: b.h }); last = y + b.h }
  }
  return { pos, clusters, islands: [] }
}
