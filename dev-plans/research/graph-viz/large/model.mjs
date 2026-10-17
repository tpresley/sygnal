/**
 * S-1 (PLAN-10): the large-app model, pure (no DOM), shared by explore.html (inlined by render.mjs)
 * and the Node measurements (measure-node.mjs).
 *
 *   buildModel(G)                    → M: components (+ ghosts), render / EVENTS / context edges, depths
 *   groupOf(M, mode)                 → Map id → group key   (none | dir | entry | community)
 *   project(M, opts)                 → V: the visible graph after filters, focus, subtree folds,
 *                                       group folds and the EVENTS mode (pairs | bus | off)
 *   layout(V, engine, libs, opts)    → Promise<L>: positions (layered | tidy | dagre | elk)
 *   metrics(V, L)                    → crossings, drawing area, zoom needed to fit 1440×900
 *   displacement(L1, L2)             → how far the common nodes moved (stability)
 *
 * Libraries are passed in (`libs.d3`, `libs.dagre`, `libs.ELK`), so the page can inline only the
 * ones it is measuring and Node can import them from node_modules.
 */

export const NW = 216, NH = 74, GX = 36, GY = 86, PAD = 28
export const GW = 248, GH = 96 // a folded group card
export const BW = 168, BH = 28 // an EVENTS bus node

const dirOf = (f) => f && f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.'

// ───────────────────────── model ─────────────────────────
export function buildModel(G) {
  const comps = G.components.map(c => ({ ...c, ghost: false }))
  const byId = new Map(comps.map(c => [c.id, c]))
  const byName = new Map()
  for (const c of comps) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c) }
  /** A name used from `from`: same file, then same directory, then the longest common path (the spike's rule). */
  const resolve = (name, from) => {
    const list = byName.get(name)
    if (!list || !list.length) return null
    if (list.length === 1 || !from) return list[0]
    const same = list.find(c => c.file === from.file); if (same) return same
    const dir = dirOf(from.file)
    const sameDir = list.find(c => dirOf(c.file) === dir); if (sameDir) return sameDir
    const common = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i }
    return list.slice().sort((a, b) => common(b.file, from.file) - common(a.file, from.file))[0]
  }
  const renderEdges = [], ghosts = new Map()
  for (const c of comps) {
    for (const ch of c.children) {
      let t = (ch.id && byId.get(ch.id)) || resolve(ch.name, c)
      if (!t) {
        const gid = `ghost:${dirOf(c.file)}:${ch.name}`
        if (!ghosts.has(gid)) ghosts.set(gid, { id: gid, name: ch.name, ghost: true, kind: 'ghost', file: dirOf(c.file) + '/?', actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [] })
        t = ghosts.get(gid)
      }
      renderEdges.push({ from: c.id, to: t.id, via: ch.via, label: ch.via === 'collection' ? `[${ch.from ?? ''}]` : ch.via === 'switchable' ? 'switch' : ch.via === 'slot' ? 'slot' : '' })
    }
  }
  for (const g of ghosts.values()) { comps.push(g); byId.set(g.id, g) }
  const parentsOf = new Map(comps.map(c => [c.id, []])), childrenOf = new Map(comps.map(c => [c.id, []]))
  for (const e of renderEdges) { if (!parentsOf.get(e.to).includes(e.from)) parentsOf.get(e.to).push(e.from); if (!childrenOf.get(e.from).includes(e.to)) childrenOf.get(e.from).push(e.to) }
  const roots = comps.filter(c => !parentsOf.get(c.id).length).map(c => c.id)
  // depth + first parent (BFS from the roots, entries first): the spanning tree for tidy / icicle / outline
  const depth = new Map(), firstParent = new Map()
  const order = [...roots].sort((a, b) => (byId.get(b).entry ? 1 : 0) - (byId.get(a).entry ? 1 : 0))
  const q = order.map(id => [id, 0]); for (const id of order) depth.set(id, 0)
  for (let i = 0; i < q.length; i++) { const [id, d] = q[i]; for (const ch of childrenOf.get(id)) if (!depth.has(ch)) { depth.set(ch, d + 1); firstParent.set(ch, id); q.push([ch, d + 1]) } }
  for (const c of comps) if (!depth.has(c.id)) { depth.set(c.id, 0); roots.push(c.id) } // render cycles with no root
  const treeKids = new Map(comps.map(c => [c.id, []]))
  for (const [ch, p] of firstParent) treeKids.get(p).push(ch)

  // EVENTS: one record per type, ends as ids (emitterIds / selectorIds when present, else by name)
  const events = []
  for (const [type, e] of Object.entries(G.events || {})) {
    const ids = (names, ids) => ids?.length ? ids.filter(id => byId.has(id)) : names.flatMap(n => byName.get(n)?.map(c => c.id) ?? [])
    events.push({ type, emitters: [...new Set(ids(e.emitters, e.emitterIds))], selectors: [...new Set(ids(e.selectors, e.selectorIds))] })
  }
  const eventPairs = []
  for (const e of events) for (const a of e.emitters) for (const b of e.selectors) eventPairs.push({ from: a, to: b, type: e.type })

  // context: a read is served by the nearest ancestor that provides the field
  const contextEdges = [], orphanReads = []
  for (const c of comps) for (const field of c.contextConsumes || []) {
    let provider = null; const seen = new Set(); let frontier = [...parentsOf.get(c.id)]
    while (frontier.length && !provider) { const next = []; for (const p of frontier) { if (seen.has(p)) continue; seen.add(p); const pc = byId.get(p); if (pc.contextProvides.includes(field)) { provider = pc; break } next.push(...parentsOf.get(p)) } frontier = next }
    if (provider) contextEdges.push({ from: provider.id, to: c.id, field }); else orphanReads.push({ id: c.id, field })
  }
  const worst = (c) => c.diagnostics.some(d => d.severity === 'error') ? 'error' : c.diagnostics.some(d => d.severity === 'warn') ? 'warn' : null
  const problem = (c) => !!worst(c) || c.ghost || orphanReads.some(o => o.id === c.id)
  return { G, comps, byId, byName, resolve, renderEdges, parentsOf, childrenOf, roots, depth, firstParent, treeKids, events, eventPairs, contextEdges, orphanReads, worst, problem, dirOf }
}

// ───────────────────────── grouping ─────────────────────────
/** Directory key: the file's directory cut to `dirDepth` segments (3: src/features/shop, examples/kanban/src). */
export function groupOf(M, mode = 'dir', { dirDepth = 3, seed = 1 } = {}) {
  const g = new Map()
  if (mode === 'none') { for (const c of M.comps) g.set(c.id, null); return g }
  if (mode === 'dir') { for (const c of M.comps) g.set(c.id, (c.file ?? '?').split('/').slice(0, -1).slice(0, dirDepth).join('/') || '.'); return g }
  if (mode === 'entry') {
    // each run() root's tree; reached from more than one root → 'shared'
    const reach = new Map()
    for (const r of M.roots) { const st = [r], seen = new Set(); while (st.length) { const id = st.pop(); if (seen.has(id)) continue; seen.add(id); if (!reach.has(id)) reach.set(id, new Set()); reach.get(id).add(r); st.push(...M.childrenOf.get(id)) } }
    for (const c of M.comps) { const rs = [...(reach.get(c.id) ?? [])]; g.set(c.id, rs.length === 1 ? `${M.byId.get(rs[0]).name} (${M.byId.get(rs[0]).file})` : 'shared') }
    return g
  }
  if (mode === 'community') {
    const comm = louvain(M.comps.map(c => c.id), [...M.renderEdges.map(e => [e.from, e.to, 1]), ...M.eventPairs.map(e => [e.from, e.to, 0.5]), ...M.contextEdges.map(e => [e.from, e.to, 0.3])], seed)
    // name a community after its shallowest member
    const best = new Map()
    for (const c of M.comps) { const k = comm.get(c.id); const b = best.get(k); if (!b || M.depth.get(c.id) < M.depth.get(b.id) || (M.depth.get(c.id) === M.depth.get(b.id) && (M.childrenOf.get(c.id).length > M.childrenOf.get(b.id).length))) best.set(k, c) }
    for (const c of M.comps) { const b = best.get(comm.get(c.id)); g.set(c.id, `≈ ${b.name} (${M.dirOf(b.file)})`) }
    return g
  }
  throw new Error('unknown grouping ' + mode)
}

/** Louvain modularity (local moving + aggregation), deterministic order. Returns Map id → community. */
export function louvain(ids, wedges, seed = 1, maxLevels = 4) {
  let nodes = ids.map((_, i) => i)
  const idx = new Map(ids.map((id, i) => [id, i]))
  let edges = []
  for (const [a, b, w] of wedges) { const i = idx.get(a), j = idx.get(b); if (i != null && j != null && i !== j) edges.push([i, j, w]) }
  let member = ids.map((_, i) => i) // original node → current community
  let rnd = seed >>> 0; const rand = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296 }
  for (let level = 0; level < maxLevels; level++) {
    const n = nodes.length
    const adj = Array.from({ length: n }, () => new Map())
    let m2 = 0
    for (const [a, b, w] of edges) { if (a === b) { adj[a].set(a, (adj[a].get(a) ?? 0) + 2 * w) } else { adj[a].set(b, (adj[a].get(b) ?? 0) + w); adj[b].set(a, (adj[b].get(a) ?? 0) + w) } m2 += 2 * w }
    if (!m2) break
    const k = adj.map(m => [...m.values()].reduce((s, w) => s + w, 0))
    const com = nodes.map((_, i) => i), tot = k.slice()
    let moved = true, rounds = 0, any = false
    const order = nodes.map((_, i) => i).sort(() => rand() - 0.5)
    while (moved && rounds++ < 20) {
      moved = false
      for (const i of order) {
        const ci = com[i]; tot[ci] -= k[i]
        const wTo = new Map(); for (const [j, w] of adj[i]) if (j !== i) wTo.set(com[j], (wTo.get(com[j]) ?? 0) + w)
        let best = ci, gain = (wTo.get(ci) ?? 0) - tot[ci] * k[i] / m2
        for (const [c, w] of wTo) { const g = w - tot[c] * k[i] / m2; if (g > gain + 1e-12) { gain = g; best = c } }
        tot[best] += k[i]; if (best !== ci) { com[i] = best; moved = true; any = true }
      }
    }
    if (!any) break
    const remap = new Map(); for (const c of com) if (!remap.has(c)) remap.set(c, remap.size)
    member = member.map(c => remap.get(com[c]))
    const agg = new Map()
    // internal weight stays as a self-loop, or the next level merges everything
    for (const [a, b, w] of edges) { const x = remap.get(com[a]), y = remap.get(com[b]); const key = x < y ? x + ',' + y : y + ',' + x; agg.set(key, (agg.get(key) ?? 0) + w) }
    edges = [...agg].map(([key, w]) => { const [x, y] = key.split(','); return [+x, +y, w] })
    nodes = [...remap.values()]
  }
  return new Map(ids.map((id, i) => [id, member[i]]))
}

// ───────────────────────── projection ─────────────────────────
/**
 * opts: {
 *   grouping: 'none'|'dir'|'entry'|'community', groups?: Map (precomputed groupOf),
 *   foldedGroups: Set<key> | 'all',  expandedGroups: Set<key> (with 'all': these stay open),
 *   foldedSubtrees: Set<id>, autoFoldDepth: number|null, unfolded: Set<id> (auto-fold exceptions),
 *   events: 'pairs'|'bus'|'off', context: boolean,
 *   focus: id|null, focusDepth: 1|2,
 *   filter: { dirs?: string[] (prefixes), kinds?: string[], problemsOnly, hideViewOnly, hideBehavior, aiOnly }
 * }
 * V: { nodes: [{ id, type: comp|fold|group|bus, w, h, comp?, count?, key?, type? }], edges: [{ from, to, cls, count, labels }],
 *      rep: Map compId → visible node id, hiddenUnder: Map foldId → n, crumbs: [ids], focusSet? }
 */
export function project(M, opts = {}) {
  const o = { grouping: 'dir', events: 'pairs', context: true, focusDepth: 2, filter: {}, ...opts }
  const groups = o.groups ?? groupOf(M, o.grouping)
  let keep = new Set(M.comps.map(c => c.id))
  const f = o.filter || {}
  // filters: matching components + their ancestors (dimmed) so the tree stays connected
  const dimmed = new Set()
  const pred = (c) => {
    if (f.dirs?.length && !f.dirs.some(d => (c.file ?? '').startsWith(d))) return false
    if (f.kinds?.length && !f.kinds.includes(c.kind)) return false
    if (f.hideViewOnly && c.viewOnly && !M.childrenOf.get(c.id).length) return false
    if (f.problemsOnly && !M.problem(c)) return false
    if (f.aiOnly && !c.agent && !c.actions.some(a => a.sinks.includes('LLM'))) return false
    return true
  }
  if (f.dirs?.length || f.kinds?.length || f.hideViewOnly || f.problemsOnly || f.aiOnly) {
    const hit = M.comps.filter(pred).map(c => c.id)
    keep = new Set(hit)
    if (f.problemsOnly || f.aiOnly || f.dirs?.length || f.kinds?.length) for (const id of hit) { let p = M.firstParent.get(id); while (p != null && !keep.has(p)) { keep.add(p); dimmed.add(p); p = M.firstParent.get(p) } }
  }
  // focus: ancestors to the entry, children to focusDepth, EVENTS / context / PARENT peers
  let crumbs = [], focusSet = null
  if (o.focus && M.byId.has(o.focus)) {
    const F = new Set([o.focus])
    const st = [o.focus]; while (st.length) { const id = st.pop(); for (const p of M.parentsOf.get(id)) if (!F.has(p)) { F.add(p); st.push(p) } }
    let fr = [o.focus]; for (let d = 0; d < o.focusDepth; d++) { const nx = []; for (const id of fr) for (const ch of M.childrenOf.get(id)) if (!F.has(ch)) { F.add(ch); nx.push(ch) } fr = nx }
    const c = M.byId.get(o.focus)
    for (const e of M.events) if (c.eventsEmitted.includes(e.type) || c.eventsSelected.includes(e.type)) { if (e.emitters.includes(o.focus)) e.selectors.forEach(x => F.add(x)); if (e.selectors.includes(o.focus)) e.emitters.forEach(x => F.add(x)) }
    for (const e of M.contextEdges) { if (e.to === o.focus) F.add(e.from); if (e.from === o.focus) F.add(e.to) }
    focusSet = F
    keep = new Set([...keep].filter(id => F.has(id)))
    let p = o.focus; crumbs = [p]; while (M.firstParent.has(p)) { p = M.firstParent.get(p); crumbs.unshift(p) }
  }
  // subtree folds: hide what is reachable only through a folded node
  const folded = new Set(o.foldedSubtrees ?? [])
  if (o.autoFoldDepth != null && !o.focus) for (const c of M.comps) if (M.depth.get(c.id) === o.autoFoldDepth && M.childrenOf.get(c.id).length && !(o.unfolded?.has(c.id))) folded.add(c.id)
  const rep = new Map(), hiddenUnder = new Map()
  if (folded.size) {
    const vis = new Set(), st = M.roots.filter(r => keep.has(r))
    while (st.length) { const id = st.pop(); if (vis.has(id) || !keep.has(id)) continue; vis.add(id); if (!folded.has(id)) st.push(...M.childrenOf.get(id)) }
    for (const id of keep) {
      if (vis.has(id)) { rep.set(id, id); continue }
      // nearest folded ancestor along first parents
      let p = M.firstParent.get(id); while (p != null && !(folded.has(p) && vis.has(p))) p = M.firstParent.get(p)
      if (p != null) { rep.set(id, 'fold:' + p); hiddenUnder.set(p, (hiddenUnder.get(p) ?? 0) + 1) } else rep.set(id, id)
    }
    for (const [p] of hiddenUnder) rep.set(p, 'fold:' + p)
  } else for (const id of keep) rep.set(id, id)
  // group folds
  // focus mode already cuts the graph down: no group folds inside it
  const allFold = o.foldedGroups === 'all' && !focusSet
  const isFolded = (k) => k != null && !focusSet && (allFold ? !(o.expandedGroups?.has(k)) : o.foldedGroups?.has?.(k))
  const groupCount = new Map()
  for (const id of keep) { const k = groups.get(id); if (isFolded(k)) { rep.set(id, 'grp:' + k); groupCount.set(k, (groupCount.get(k) ?? 0) + 1) } }
  // the focused node is never hidden in a fold
  if (o.focus && keep.has(o.focus)) rep.set(o.focus, rep.get(o.focus)?.startsWith('fold:') ? rep.get(o.focus) : rep.get(o.focus))

  const nodes = new Map()
  for (const id of keep) {
    const r = rep.get(id)
    if (nodes.has(r)) { const n = nodes.get(r); n.members.push(id); continue }
    if (r.startsWith('grp:')) nodes.set(r, { id: r, type: 'group', key: r.slice(4), w: GW, h: GH, members: [id] })
    else if (r.startsWith('fold:')) { const cid = r.slice(5); nodes.set(r, { id: r, type: 'fold', comp: M.byId.get(cid), cid, w: NW, h: NH, members: [id], hidden: hiddenUnder.get(cid) ?? 0 }) }
    else nodes.set(r, { id: r, type: 'comp', comp: M.byId.get(id), cid: id, w: NW, h: NH, members: [id], dim: dimmed.has(id) })
  }
  for (const n of nodes.values()) if (n.type === 'group') n.count = n.members.length
  const edgeMap = new Map()
  const addE = (from, to, cls, label, via) => {
    if (!from || !to || from === to) return
    const k = cls + '|' + from + '|' + to
    let e = edgeMap.get(k)
    if (!e) edgeMap.set(k, e = { from, to, cls, count: 0, labels: new Set(), via })
    e.count++; if (label) e.labels.add(label)
  }
  for (const e of M.renderEdges) addE(rep.get(e.from), rep.get(e.to), 'render', e.label, e.via)
  const touches = (a, b) => !focusSet || a === o.focus || b === o.focus
  if (o.events === 'pairs') { for (const e of M.eventPairs) if (touches(e.from, e.to)) addE(rep.get(e.from), rep.get(e.to), 'event', e.type) } else if (o.events === 'bus' || o.events === 'bus-all') {
    for (const e of M.events) {
      if (focusSet && !e.emitters.includes(o.focus) && !e.selectors.includes(o.focus)) continue
      const ems = [...new Set(e.emitters.map(x => rep.get(x)).filter(Boolean))], sls = [...new Set(e.selectors.map(x => rep.get(x)).filter(Boolean))]
      if (!ems.length && !sls.length) continue
      // 'bus': a bus node only where it saves edges (emitters × selectors > emitters + selectors) and
      // an end is a visible component; otherwise the (bundled) pair edges. 'bus-all': one per type
      const visEnd = [...ems, ...sls].some(x => !x.startsWith('grp:'))
      if (o.events === 'bus' && !(visEnd && ems.length * sls.length > ems.length + sls.length)) { for (const a of ems) for (const b of sls) addE(a, b, 'event', e.type); continue }
      const bid = 'bus:' + e.type
      nodes.set(bid, { id: bid, type: 'bus', event: e.type, w: BW, h: BH, members: [], emitters: ems.length, selectors: sls.length })
      for (const a of ems) addE(a, bid, 'event', e.type)
      for (const b of sls) addE(bid, b, 'event', e.type)
    }
  }
  if (o.context) for (const e of M.contextEdges) if (touches(e.from, e.to)) addE(rep.get(e.from), rep.get(e.to), 'context', e.field)
  const edges = [...edgeMap.values()].map(e => ({ ...e, labels: [...e.labels] }))
  return { nodes: [...nodes.values()], edges, rep, hiddenUnder, crumbs, focusSet, groups, folded, opts: o }
}

// ───────────────────────── layouts ─────────────────────────
/** Layered layout of a set of node ids (the spike's: longest path, barycenter sweeps, place by parents). */
function layered(ids, parentsOf, childrenOf, sizeOf, wrap = 0) {
  const set = new Set(ids)
  const roots = ids.filter(id => !parentsOf.get(id).some(p => set.has(p)))
  if (!roots.length) roots.push(ids[0])
  const layer = new Map(), cap = ids.length
  const queue = roots.map(r => [r, 0])
  for (let qi = 0; qi < queue.length; qi++) {
    const [id, d] = queue[qi]
    if ((layer.get(id) ?? -1) >= d || d > cap) continue
    layer.set(id, d)
    for (const ch of childrenOf.get(id)) if (set.has(ch)) queue.push([ch, d + 1])
  }
  const layers = []
  for (const id of ids) { const l = layer.get(id) ?? 0; (layers[l] = layers[l] || []).push(id) }
  for (let i = 0; i < layers.length; i++) layers[i] = layers[i] || []
  const order = new Map(); let k = 0
  const visit = (id) => { if (order.has(id)) return; order.set(id, k++); for (const ch of childrenOf.get(id)) if (set.has(ch)) visit(ch) }
  roots.forEach(visit); ids.forEach(visit)
  for (const L of layers) L.sort((a, b) => order.get(a) - order.get(b))
  const idx = () => { const m = new Map(); layers.forEach(L => L.forEach((id, i) => m.set(id, i))); return m }
  for (let pass = 0; pass < 4; pass++) {
    let m = idx()
    for (let l = 1; l < layers.length; l++) {
      const bc = (id) => { const ps = parentsOf.get(id).filter(p => layer.get(p) === l - 1 && set.has(p)); return ps.length ? ps.reduce((s, p) => s + m.get(p), 0) / ps.length : m.get(id) }
      const b = new Map(layers[l].map(id => [id, bc(id)])); layers[l].sort((x, y) => b.get(x) - b.get(y)); m = idx()
    }
    for (let l = layers.length - 2; l >= 0; l--) {
      const bc = (id) => { const cs = childrenOf.get(id).filter(c => layer.get(c) === l + 1 && set.has(c)); return cs.length ? cs.reduce((s, c) => s + m.get(c), 0) / cs.length : m.get(id) }
      const b = new Map(layers[l].map(id => [id, bc(id)])); layers[l].sort((x, y) => b.get(x) - b.get(y)); m = idx()
    }
  }
  const W = (id) => sizeOf(id).w
  if (wrap && layers.some(L => L.length > wrap)) {
    // layer wrapping: a layer wider than `wrap` cards continues on the next row (ordered, centred)
    const rows = []
    for (let l = 0; l < layers.length; l++) for (let i = 0; i < layers[l].length; i += wrap) rows.push({ ids: layers[l].slice(i, i + wrap), gap: i + wrap >= layers[l].length ? GY : GY / 3 })
    const rw = rows.map(r => r.ids.reduce((s, id) => s + W(id) + GX, -GX))
    const maxW = Math.max(...rw)
    const out = new Map(); let yy = 0
    rows.forEach((r, ri) => { let x = (maxW - rw[ri]) / 2; const h = Math.max(NH, ...r.ids.map(id => sizeOf(id).h)); for (const id of r.ids) { out.set(id, { x, y: yy }); x += W(id) + GX } yy += h + r.gap })
    return { pos: out, w: maxW, h: yy - rows[rows.length - 1].gap }
  }
  const local = new Map()
  const wide = layers.reduce((w, L, i) => L.length > layers[w].length ? i : w, 0)
  let xx = 0; for (const id of layers[wide]) { local.set(id, xx); xx += W(id) + GX }
  const place = (l, ref) => {
    const want = layers[l].map(id => {
      const rs = (ref === 'up' ? parentsOf : childrenOf).get(id).filter(r => local.has(r) && layer.get(r) === (ref === 'up' ? l - 1 : l + 1) && set.has(r))
      return [id, rs.length ? rs.reduce((s, r) => s + local.get(r) + W(r) / 2, 0) / rs.length - W(id) / 2 : null]
    })
    let lastR = -Infinity
    const fb = want.filter(w => w[1] != null).map(w => w[1]); let base = fb.length ? Math.min(...fb) : 0
    for (const [id, x0] of want) { let x = x0 ?? base; if (x < lastR + GX) x = lastR + GX; local.set(id, x); lastR = x + W(id); base = lastR + GX }
  }
  for (let l = wide + 1; l < layers.length; l++) place(l, 'up')
  for (let l = wide - 1; l >= 0; l--) place(l, 'down')
  let minX = Infinity; for (const x of local.values()) minX = Math.min(minX, x)
  const rowH = layers.map(L => Math.max(NH, ...L.map(id => sizeOf(id).h)))
  const rowY = []; let yy = 0; for (let l = 0; l < layers.length; l++) { rowY[l] = yy; yy += rowH[l] + GY }
  let w = 0
  const out = new Map()
  for (const id of ids) { const x = local.get(id) - minX; out.set(id, { x, y: rowY[layer.get(id) ?? 0] }); w = Math.max(w, x + W(id)) }
  return { pos: out, w, h: Math.max(0, yy - GY) }
}

/** Shelf-pack boxes ({ w, h }) into rows no wider than maxW; sets b.x, b.y. */
function shelf(boxes, maxW, gap = 40) {
  let x = 0, y = 0, rowH = 0, W = 0
  for (const b of boxes) { if (x > 0 && x + b.w > maxW) { x = 0; y += rowH + gap; rowH = 0 } b.x = x; b.y = y; x += b.w + gap; rowH = Math.max(rowH, b.h); W = Math.max(W, b.x + b.w) }
  return { w: W, h: y + rowH }
}

/** Adjacency of the render edges between visible nodes. */
function renderAdj(V) {
  const parentsOf = new Map(V.nodes.map(n => [n.id, []])), childrenOf = new Map(V.nodes.map(n => [n.id, []]))
  for (const e of V.edges) if (e.cls === 'render' && parentsOf.has(e.to) && childrenOf.has(e.from)) { parentsOf.get(e.to).push(e.from); childrenOf.get(e.from).push(e.to) }
  return { parentsOf, childrenOf }
}

/** EVENTS bus nodes: a lane right of the drawing, ordered by the mean y of their ends. */
function placeBuses(V, pos) {
  const buses = V.nodes.filter(n => n.type === 'bus')
  if (!buses.length) return
  let x1 = 0; for (const p of pos.values()) x1 = Math.max(x1, p.x + p.w)
  const want = buses.map(b => { const ys = V.edges.filter(e => e.from === b.id || e.to === b.id).map(e => pos.get(e.from === b.id ? e.to : e.from)).filter(Boolean).map(p => p.y + p.h / 2); return [b, ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length : 0] }).sort((a, b) => a[1] - b[1])
  let last = -Infinity
  for (const [b, y0] of want) { const y = Math.max(y0 - BH / 2, last + 8); pos.set(b.id, { x: x1 + 160, y, w: BW, h: BH }); last = y + BH }
}

const sizeMap = (V) => { const m = new Map(V.nodes.map(n => [n.id, { w: n.w, h: n.h }])); return (id) => m.get(id) }

/**
 * engine: layered (the spike's, islands packed; with a grouping, each group laid out on its own and
 *         the group boxes packed: `packByGroup`) | tidy (d3.tree on the first-parent spanning tree) |
 *         dagre | elk (layered, groups as compound nodes)
 */
export async function layout(V, engine = 'layered', libs = {}, opts = {}) {
  const t0 = now()
  const pos = new Map(), boxes = []
  const nonBus = V.nodes.filter(n => n.type !== 'bus')
  const sizeOf = sizeMap(V)
  const { parentsOf, childrenOf } = renderAdj(V)
  // folded group cards are laid out together (no box around a single card)
  const groupKeyOf = (n) => n.type === 'group' ? null : V.groups.get(n.cid ?? n.members[0]) ?? null
  const maxW = opts.maxW ?? Math.max(1600, Math.sqrt(nonBus.length) * (NW + GX) * 1.6)
  // layered-wrap: the layered layout with wide layers wrapped onto more rows
  const wrap = engine === 'layered-wrap' ? (opts.wrap ?? Math.max(6, Math.ceil(Math.sqrt(nonBus.length) * 1.2))) : 0
  if (engine === 'layered' || engine === 'layered-wrap') {
    const islandsOf = (ids) => {
      const set = new Set(ids), seen = new Set(), out = []
      for (const id of ids) { if (seen.has(id)) continue; const isl = [], st = [id]; while (st.length) { const x = st.pop(); if (seen.has(x) || !set.has(x)) continue; seen.add(x); isl.push(x); st.push(...parentsOf.get(x), ...childrenOf.get(x)) } out.push(isl) }
      return out.sort((a, b) => b.length - a.length)
    }
    const packIslands = (ids, innerMax) => {
      const isl = islandsOf(ids).map(ix => ({ ids: ix, ...layered(ix, parentsOf, childrenOf, sizeOf, wrap) }))
      const sh = shelf(isl, Math.max(innerMax, ...isl.map(i => i.w)), GX * 2)
      const p = new Map(); for (const i of isl) for (const [id, q] of i.pos) p.set(id, { x: i.x + q.x, y: i.y + q.y })
      return { pos: p, w: sh.w, h: sh.h }
    }
    const byGroup = new Map()
    for (const n of nonBus) { const k = opts.packByGroup === false ? null : groupKeyOf(n); if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(n.id) }
    const multi = byGroup.size > 1
    // group order: by the shallowest member's depth, then size
    const gs = [...byGroup].map(([key, ids]) => ({ key, ids, ...packIslands(ids, maxW / 2) }))
    gs.sort((a, b) => b.ids.length - a.ids.length || String(a.key).localeCompare(String(b.key)))
    for (const g of gs) { g.w += multi ? PAD * 2 : 0; g.h += multi ? PAD * 2 + 18 : 0 }
    shelf(gs, maxW, 40)
    for (const g of gs) { for (const [id, q] of g.pos) { const s = sizeOf(id); pos.set(id, { x: g.x + (multi ? PAD : 0) + q.x, y: g.y + (multi ? PAD + 18 : 0) + q.y, w: s.w, h: s.h }) } if (multi && g.key != null) boxes.push({ key: g.key, x: g.x, y: g.y, w: g.w, h: g.h }) }
  } else if (engine === 'tidy') {
    const d3 = libs.d3
    // spanning tree among visible nodes: the first visible parent
    const vroot = { id: '__root', children: [] }
    const nodeOf = new Map(nonBus.map(n => [n.id, { id: n.id, children: [] }]))
    for (const n of nonBus) { const p = parentsOf.get(n.id)[0]; (p && nodeOf.has(p) && p !== n.id ? nodeOf.get(p) : vroot).children.push(nodeOf.get(n.id)) }
    // break cycles: anything not reached from vroot hangs off it
    const reached = new Set(); const st = [vroot]; while (st.length) { const x = st.pop(); if (reached.has(x)) continue; reached.add(x); st.push(...x.children) }
    for (const x of nodeOf.values()) if (!reached.has(x)) { for (const y of nodeOf.values()) y.children = y.children.filter(z => z !== x); vroot.children.push(x) }
    const h = d3.hierarchy(vroot)
    d3.tree().nodeSize([NW + GX, NH + GY]).separation((a, b) => a.parent === b.parent ? 1 : 1.15)(h)
    let minX = Infinity; h.each(d => { if (d.data.id !== '__root') minX = Math.min(minX, d.x) })
    h.each(d => { if (d.data.id === '__root') return; const s = sizeOf(d.data.id); pos.set(d.data.id, { x: d.x - minX, y: (d.depth - 1) * (NH + GY), w: s.w, h: s.h }) })
  } else if (engine === 'dagre') {
    const dagre = libs.dagre
    const g = new dagre.graphlib.Graph({ multigraph: false })
    g.setGraph({ rankdir: 'TB', nodesep: GX, ranksep: GY, marginx: 0, marginy: 0 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const n of nonBus) g.setNode(n.id, { width: n.w, height: n.h })
    for (const e of V.edges) if (e.cls === 'render' && g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to)
    dagre.layout(g)
    for (const n of nonBus) { const q = g.node(n.id); pos.set(n.id, { x: q.x - n.w / 2, y: q.y - n.h / 2, w: n.w, h: n.h }) }
  } else if (engine === 'elk') {
    const elk = new libs.ELK()
    const byGroup = new Map()
    for (const n of nonBus) { const k = groupKeyOf(n); if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(n) }
    const leaf = (n) => ({ id: n.id, width: n.w, height: n.h })
    const children = []
    for (const [k, list] of byGroup) {
      if (k == null || byGroup.size === 1 || opts.elkCompound === false) children.push(...list.map(leaf))
      else children.push({ id: 'box:' + k, layoutOptions: { 'elk.padding': `[top=${PAD + 18},left=${PAD},bottom=${PAD},right=${PAD}]` }, children: list.map(leaf) })
    }
    const ids = new Set(nonBus.map(n => n.id))
    const edges = V.edges.filter(e => e.cls === 'render' && ids.has(e.from) && ids.has(e.to)).map((e, i) => ({ id: 'e' + i, sources: [e.from], targets: [e.to] }))
    const res = await elk.layout({ id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.spacing.nodeNode': String(GX), 'elk.layered.spacing.nodeNodeBetweenLayers': String(GY), 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' }, children, edges })
    const walk = (node, ox, oy) => {
      for (const ch of node.children || []) {
        const x = ox + ch.x, y = oy + ch.y
        if (ch.id.startsWith('box:')) { boxes.push({ key: ch.id.slice(4), x, y, w: ch.width, h: ch.height }); walk(ch, x, y) } else pos.set(ch.id, { x, y, w: ch.width, h: ch.height })
      }
    }
    walk(res, 0, 0)
  } else throw new Error('unknown engine ' + engine)
  placeBuses(V, pos)
  if (!engine.startsWith('layered') && engine !== 'elk' && opts.groupBoxes !== false) {
    // bounding boxes of the groups (they may overlap: these engines don't know groups)
    const bb = new Map()
    for (const n of nonBus) { const k = groupKeyOf(n); if (k == null) continue; const p = pos.get(n.id); const b = bb.get(k) ?? { key: k, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x + p.w); b.y1 = Math.max(b.y1, p.y + p.h); bb.set(k, b) }
    if (bb.size > 1) for (const b of bb.values()) boxes.push({ key: b.key, x: b.x0 - 12, y: b.y0 - 30, w: b.x1 - b.x0 + 24, h: b.y1 - b.y0 + 42, loose: true })
  }
  return { pos, boxes, ms: now() - t0, engine }
}
const now = () => (globalThis.performance ?? Date).now()

// ───────────────────────── metrics ─────────────────────────
/** Straight-segment crossings of the edges of class `cls` (render edges: bottom centre → top centre). */
export function crossings(V, L, cls = 'render') {
  const segs = []
  for (const e of V.edges) {
    if (e.cls !== cls) continue
    const a = L.pos.get(e.from), b = L.pos.get(e.to); if (!a || !b) continue
    segs.push(cls === 'render' ? [a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y, e.from, e.to] : [a.x + a.w / 2, a.y + a.h / 2, b.x + b.w / 2, b.y + b.h / 2, e.from, e.to])
  }
  // sweep by x-extent: sort by min x, compare while overlapping
  const items = segs.map(s => ({ s, x0: Math.min(s[0], s[2]), x1: Math.max(s[0], s[2]), y0: Math.min(s[1], s[3]), y1: Math.max(s[1], s[3]) })).sort((a, b) => a.x0 - b.x0)
  let n = 0
  const orient = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
  for (let i = 0; i < items.length; i++) {
    const A = items[i]
    for (let j = i + 1; j < items.length && items[j].x0 <= A.x1; j++) {
      const B = items[j]
      if (B.y0 > A.y1 || B.y1 < A.y0) continue
      const a = A.s, b = B.s
      if (a[4] === b[4] || a[4] === b[5] || a[5] === b[4] || a[5] === b[5]) continue // shared endpoint
      const o1 = orient(a[0], a[1], a[2], a[3], b[0], b[1]), o2 = orient(a[0], a[1], a[2], a[3], b[2], b[3])
      const o3 = orient(b[0], b[1], b[2], b[3], a[0], a[1]), o4 = orient(b[0], b[1], b[2], b[3], a[2], a[3])
      if (o1 * o2 < 0 && o3 * o4 < 0) n++
    }
  }
  return n
}

export function bounds(L) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of L.pos.values()) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h) }
  for (const b of L.boxes || []) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h) }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 1, y1: 1, w: 1, h: 1 }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

/** crossings, drawing size, zoom that fits a 1440×900 canvas (card text is 14px × k: below ~0.6 it is unreadable). */
export function metrics(V, L, { canvasW = 1440 - 280, canvasH = 900 - 52 } = {}) {
  const b = bounds(L)
  return {
    nodes: V.nodes.length, renderEdges: V.edges.filter(e => e.cls === 'render').length, eventEdges: V.edges.filter(e => e.cls === 'event').length, contextEdges: V.edges.filter(e => e.cls === 'context').length,
    crossings: crossings(V, L, 'render'), eventCrossings: crossings(V, L, 'event'),
    w: Math.round(b.w), h: Math.round(b.h), areaMpx: +(b.w * b.h / 1e6).toFixed(2), fitK: +Math.min(canvasW / b.w, canvasH / b.h, 1.15).toFixed(3), layoutMs: +L.ms.toFixed(1),
  }
}

/** How far the common nodes moved between two layouts (after aligning the drawings' top-left corners). */
export function displacement(L1, L2) {
  const d = []
  for (const [id, p] of L1.pos) { const q = L2.pos.get(id); if (q) d.push(Math.hypot(q.x - p.x, q.y - p.y)) }
  d.sort((a, b) => a - b)
  const moved = d.filter(x => x > 20).length
  return { common: d.length, moved, movedPct: +(100 * moved / Math.max(1, d.length)).toFixed(1), median: Math.round(d[d.length >> 1] ?? 0), p90: Math.round(d[Math.floor(d.length * 0.9)] ?? 0), max: Math.round(d[d.length - 1] ?? 0) }
}

/** The defaults S-1 recommends, by graph size (filled in from the measurements; see large-apps.md). */
export function defaultsFor(n) {
  if (n <= 80) return { grouping: 'dir', foldedGroups: new Set(), events: 'pairs', autoFoldDepth: null, semantic: false, minimap: false }
  if (n <= 300) return { grouping: 'dir', foldedGroups: new Set(), events: 'bus', autoFoldDepth: null, semantic: true, minimap: true }
  return { grouping: 'dir', foldedGroups: 'all', events: 'bus', autoFoldDepth: null, semantic: true, minimap: true }
}
