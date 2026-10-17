/**
 * The page's layout (PLAN-10 V-1): a layered layout per island, islands packed into clusters by
 * directory, and the edge routes. Deterministic: the same model gives the same positions.
 *
 *   layoutGraph(model) → { pos: Map id → { x, y, w, h }, clusters: [{ key, x, y, w, h }], islands: id[][] }
 *     islands    sets of components connected by render edges (graph order)
 *     layers     longest path from the island's roots over the render edges, with the edges that
 *                close a cycle (a component that renders an ancestor, or itself) left out
 *     order      depth-first order from the roots, then barycenter sweeps
 *     x          the widest layer spaced evenly; every other layer pulled toward its neighbours'
 *                centres, never closer than one gap (so cards in a layer never overlap)
 *     clusters   islands grouped by the directory of their first root; islands holding an `entry`
 *                first, then the bigger ones; drawn as boxes only when there are several
 *   edgePaths(model, layout) → [{ cls, from, to, d, label, mid: [x, y], marker, type?, fields? }]
 *     cls: 'render' | 'collection' | 'switchable' | 'slot' | 'event' | 'context'
 *   bbox(pos, ids) → { x0, y0, x1, y1 } with the margin the page fits to
 *
 * Pure: no DOM, no imports (html.js inlines it; see model.js).
 */

export const NODE_W = 216
export const NODE_H = 74
const GX = 36, GY = 86, PAD = 28

function layoutIsland(ids, model) {
  const { parentsOf, childrenOf } = model
  const set = new Set(ids)
  const kids = (id) => childrenOf.get(id).filter(c => set.has(c))
  // roots: no parent inside the island (a self-render doesn't count)
  const roots = ids.filter(id => !parentsOf.get(id).some(p => p !== id && set.has(p)))
  // depth-first from the roots (then anything a cycle hid): preorder, and the back edges to drop
  const order = new Map()
  const back = new Set()
  const onStack = new Set()
  const visit = (id) => {
    order.set(id, order.size)
    onStack.add(id)
    for (const c of kids(id)) {
      if (onStack.has(c)) back.add(id + '\u0000' + c)
      else if (!order.has(c)) visit(c)
    }
    onStack.delete(id)
  }
  for (const r of roots) if (!order.has(r)) visit(r)
  for (const id of ids) if (!order.has(id)) visit(id)
  const dagKids = (id) => kids(id).filter(c => !back.has(id + '\u0000' + c))
  const dagParents = (id) => parentsOf.get(id).filter(p => set.has(p) && !back.has(p + '\u0000' + id))

  // longest path, in topological order (Kahn, ties in depth-first order)
  const indeg = new Map(ids.map(id => [id, dagParents(id).length]))
  const layer = new Map()
  const ready = ids.filter(id => indeg.get(id) === 0).sort((a, b) => order.get(a) - order.get(b))
  while (ready.length) {
    const id = ready.shift()
    const l = Math.max(0, ...dagParents(id).map(p => layer.get(p) + 1))
    layer.set(id, l)
    for (const c of dagKids(id)) {
      indeg.set(c, indeg.get(c) - 1)
      if (indeg.get(c) === 0) ready.push(c)
    }
  }
  const layers = []
  for (const id of ids) { const l = layer.get(id) ?? 0; layer.set(id, l); (layers[l] = layers[l] || []).push(id) }
  for (let l = 0; l < layers.length; l++) layers[l] = layers[l] || []
  for (const L of layers) L.sort((a, b) => order.get(a) - order.get(b))

  // barycenter sweeps (down, then up), four passes
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

  // x: the widest layer evenly, then each other layer toward its neighbours' centres
  const local = new Map()
  const wide = layers.reduce((w, L, i) => L.length > layers[w].length ? i : w, 0)
  layers[wide].forEach((id, i) => local.set(id, i * (NODE_W + GX)))
  const place = (l, up) => {
    const want = layers[l].map(id => {
      const rs = (up ? parentsOf.get(id) : kids(id)).filter(r => set.has(r) && local.has(r) && layer.get(r) === (up ? l - 1 : l + 1))
      return [id, rs.length ? rs.reduce((s, r) => s + local.get(r), 0) / rs.length : null]
    })
    const known = want.filter(w => w[1] != null).map(w => w[1])
    let base = known.length ? Math.min(...known) : 0
    let lastX = -Infinity
    for (const [id, x0] of want) {
      const x = Math.max(x0 ?? base, lastX + NODE_W + GX)
      local.set(id, x)
      lastX = x
      base = x + NODE_W + GX
    }
  }
  for (let l = wide + 1; l < layers.length; l++) place(l, true)
  for (let l = wide - 1; l >= 0; l--) place(l, false)
  const minX = Math.min(...local.values())
  let w = 0
  for (const [id, x] of local) { local.set(id, x - minX); w = Math.max(w, x - minX + NODE_W) }
  return { ids, w, h: layers.length * NODE_H + (layers.length - 1) * GY, local, layer }
}

export function layoutGraph(model) {
  const { comps, parentsOf, childrenOf, byId } = model
  const islandOf = new Map()
  const islands = []
  const rank = new Map(comps.map((x, i) => [x.id, i]))
  for (const c of comps) {
    if (islandOf.has(c.id)) continue
    const ids = []
    const stack = [c.id]
    while (stack.length) {
      const id = stack.pop()
      if (islandOf.has(id)) continue
      islandOf.set(id, islands.length)
      ids.push(id)
      stack.push(...[...childrenOf.get(id)].reverse(), ...[...parentsOf.get(id)].reverse())
    }
    // graph order inside an island, whatever order the walk found them in
    ids.sort((a, b) => rank.get(a) - rank.get(b))
    islands.push(ids)
  }
  const hasEntry = (ids) => ids.some(id => byId.get(id).entry === true)
  const clusterMap = new Map()
  for (const ids of islands) {
    const root = ids.find(id => !parentsOf.get(id).length) ?? ids[0]
    const key = byId.get(root).dir ?? '.'
    if (!clusterMap.has(key)) clusterMap.set(key, [])
    clusterMap.get(key).push(ids)
  }
  const pos = new Map()
  const clusters = []
  const MAXW = Math.max(1400, Math.sqrt(comps.length) * (NODE_W + GX) * 1.6)
  const size = (key) => clusterMap.get(key).reduce((n, ids) => n + ids.length, 0)
  const keys = [...clusterMap.keys()].sort((a, b) =>
    Number(clusterMap.get(b).some(hasEntry)) - Number(clusterMap.get(a).some(hasEntry)) || size(b) - size(a) || (a < b ? -1 : a > b ? 1 : 0))
  const multi = keys.length > 1
  const boxes = keys.map(key => {
    const isl = clusterMap.get(key).slice()
      .sort((a, b) => Number(hasEntry(b)) - Number(hasEntry(a)) || b.length - a.length)
      .map(ids => layoutIsland(ids, model))
    const innerMax = Math.max(MAXW / 2, ...isl.map(i => i.w))
    let x = 0, y = 0, rowH = 0, w = 0
    for (const i of isl) {
      if (x > 0 && x + i.w > innerMax) { x = 0; y += rowH + GY; rowH = 0 }
      i.ox = x; i.oy = y
      x += i.w + GX * 2
      rowH = Math.max(rowH, i.h)
      w = Math.max(w, i.ox + i.w)
    }
    return multi ? { key, isl, w: w + PAD * 2, h: y + rowH + PAD * 2 + 18 } : { key, isl, w, h: y + rowH }
  })
  let x = 0, y = 0, rowH = 0
  for (const b of boxes) {
    if (x > 0 && x + b.w > MAXW) { x = 0; y += rowH + 40; rowH = 0 }
    b.x = x; b.y = y
    for (const i of b.isl) {
      const ox = b.x + (multi ? PAD : 0) + i.ox, oy = b.y + (multi ? PAD + 18 : 0) + i.oy
      for (const id of i.ids) pos.set(id, { x: ox + i.local.get(id), y: oy + i.layer.get(id) * (NODE_H + GY), w: NODE_W, h: NODE_H })
    }
    x += b.w + 40
    rowH = Math.max(rowH, b.h)
    if (multi) clusters.push({ key: b.key, x: b.x, y: b.y, w: b.w, h: b.h })
  }
  return { pos, clusters, islands }
}

const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3 }
const r1 = (n) => Math.round(n * 10) / 10

export function edgePaths(model, layout) {
  const { pos } = layout
  const out = []
  for (const e of model.renderEdges) {
    const a = pos.get(e.from), b = pos.get(e.to)
    const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y - 2
    const dy = Math.max(30, (y2 - y1) / 2)
    const cls = e.via === 'collection' ? 'collection' : e.via === 'switchable' ? 'switchable' : e.via === 'slot' ? 'slot' : 'render'
    out.push({
      cls, from: e.from, to: e.to, label: e.label, mid: [x2, y2 - 14],
      d: `M${r1(x1)},${r1(y1)} C${r1(x1)},${r1(y1 + dy)} ${r1(x2)},${r1(y2 - dy)} ${r1(x2)},${r1(y2)}`,
      marker: cls === 'collection' ? 'ah-coll' : cls === 'switchable' ? 'ah-switch' : 'ah',
    })
  }
  // EVENTS and context: spread the edges meeting at one card so they don't stack
  const sideCount = new Map()
  const bump = (id) => { const n = sideCount.get(id) ?? 0; sideCount.set(id, n + 1); return n }
  for (const e of model.eventEdges) {
    const a = pos.get(e.from), b = pos.get(e.to)
    const n = Math.max(bump('e' + e.from), bump('e' + e.to))
    let x1, y1, x2, y2, c1, c2
    const dy = (b.y + b.h / 2) - (a.y + a.h / 2)
    if (Math.abs(dy) > NODE_H) {
      // vertical: up into the selector's bottom, or down into its top
      const up = dy < 0
      x1 = a.x + a.w * 0.78; y1 = up ? a.y : a.y + a.h
      x2 = b.x + b.w * (0.62 + Math.min(n, 4) * 0.07); y2 = up ? b.y + b.h + 3 : b.y - 3
      const k = Math.max(40, Math.abs(y2 - y1) * 0.45) * (up ? -1 : 1)
      c1 = [x1, y1 + k]; c2 = [x2, y2 - k]
    } else if (e.from !== e.to) {
      const right = b.x > a.x
      x1 = right ? a.x + a.w : a.x; y1 = a.y + a.h * 0.7; x2 = right ? b.x - 3 : b.x + b.w + 3; y2 = b.y + b.h * 0.7
      const k = Math.max(30, Math.abs(x2 - x1) * 0.4) * (right ? 1 : -1)
      c1 = [x1 + k, y1 + 30 + n * 8]; c2 = [x2 - k, y2 + 30 + n * 8]
    } else {
      x1 = a.x + a.w; y1 = a.y + a.h * 0.3; x2 = a.x + a.w + 3; y2 = a.y + a.h * 0.7
      c1 = [x1 + 50, y1 - 10]; c2 = [x2 + 50, y2 + 10]
    }
    out.push({
      cls: 'event', from: e.from, to: e.to, type: e.type, label: e.type, marker: 'ah-ev',
      d: `M${r1(x1)},${r1(y1)} C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(x2)},${r1(y2)}`,
      mid: [r1(bez(x1, c1[0], c2[0], x2, 0.5)), r1(bez(y1, c1[1], c2[1], y2, 0.5))],
    })
  }
  for (const e of model.contextEdges) {
    const a = pos.get(e.from), b = pos.get(e.to)
    const n = Math.max(bump('c' + e.from), bump('c' + e.to))
    const x1 = a.x, y1 = a.y + a.h / 2, x2 = b.x - 3, y2 = b.y + b.h / 2
    const off = 40 + n * 14 + Math.min(100, Math.abs(y2 - y1) * 0.1)
    const c1 = [x1 - off, y1], c2 = [x2 - off, y2]
    out.push({
      cls: 'context', from: e.from, to: e.to, fields: e.fields, label: e.fields.join(', '), marker: 'ah-ctx',
      d: `M${r1(x1)},${r1(y1)} C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(x2)},${r1(y2)}`,
      mid: [r1(bez(x1, c1[0], c2[0], x2, 0.5) - 4), r1(bez(y1, c1[1], c2[1], y2, 0.5))],
    })
  }
  return out
}

export function bbox(pos, ids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const id of ids) {
    const p = pos.get(id)
    if (!p) continue
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h)
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 1, y1: 1 }
  return { x0: x0 - 90, y0: y0 - 50, x1: x1 + 130, y1: y1 + 50 }
}
