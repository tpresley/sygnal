/**
 * Large apps on the page (PLAN-10 V-4, D536): size tiers, directory groups, filters, focus mode and
 * the projection of the model onto what is drawn (folded groups with bundled edges, EVENTS bus
 * nodes). Ported from S-1's prototype (research/graph-viz/large/model.mjs `project`).
 *
 *   tierFor(n) → { name: 'small' | 'medium' | 'large', n, grouped, folded, focus, buses, minimap, wrap }
 *     n = scanned components (ghosts left out). small ≤ 60: the V-1 layout, nothing folded;
 *     medium ≤ 150: open directory groups each laid out on its own, focus mode on select, bus
 *     nodes where they cut edges, a minimap; large: the groups start folded, wrapped rows
 *   groupKeys(model) → Map compId → group key
 *     static graphs: the directory below the components' common directory, two segments deep
 *     ('src/features/shop' when everything is under src/); a ghost goes with the component that
 *     renders it; runtime graphs: the card's app (`dir`)
 *   treeInfo(model) → { roots, depth: Map, firstParent: Map } (BFS from the roots, entries first;
 *     cached on the model): the spanning tree the filters and the breadcrumbs use
 *   reachableFromEntries(model) → Set of ids reachable from an `entry: true` component, or null
 *     when the graph marks none (the "unreachable from any entry" filter is then unavailable; SYG172
 *     is page-only, D534)
 *   FILTERS, filterCount(filter)
 *     filter = { kind?: '' | kind, problems?, hideViewOnly?, hideBehavior?, ai?, unreachable?, changes? }
 *     changes: only components with a `diff` (added, removed or changed: `--base`, diff.js); the
 *     page offers it only when it draws a diff
 *     hideBehavior changes no node (the page leaves behavior actions out of cards and details)
 *   focusSet(model, id, depth = 2) → Set: the component, its ancestors (to the entries), its
 *     children to `depth`, and its EVENTS, context and PARENT peers
 *   projectView(model, opts) → P, what the page draws
 *     opts = { tier, groupOf?, filter?, open?: Set<key>, closed?: Set<key>, focus?: id, focusDepth? }
 *       a group is folded when the tier folds (large) and it isn't in `open`, or it is in `closed`;
 *       a group with one visible component never folds; nothing folds in focus mode
 *     P = { identity, flat, tier, nodes, byNode, rep, groupOf, focus, focusSet, crumbs, dimmed,
 *           comps, byId, parentsOf, childrenOf, renderEdges, eventEdges, contextEdges, parentEdges,
 *           shown, total, groups }
 *       nodes   [{ id, type: 'comp' | 'group' | 'bus', w, h, comp?, key?, members, count?, err?,
 *                 warn?, ai?, entry?, event?, emitters?, selectors?, dim? }]
 *       rep     Map compId → the drawn node that shows it (absent: filtered out or outside the focus)
 *       edges   the model's edge shapes between drawn node ids, with `count` (bundled: `label`
 *               '×N', `types` / `fields` / `actions` the union). identity: the model's own arrays
 *       comps, byId, parentsOf, childrenOf   a model-shaped view of the drawn nodes (layout input)
 *       groups  [{ key, count, folded }] every group with a visible component
 *     identity: small tier, no filter → the model as it is (the V-1 page, unchanged)
 *     flat:     no directory boxes and no bus nodes (small tier, or focus mode): layoutGraph() lays it out
 *
 * Pure: no DOM, no imports (html.js inlines it; see model.js).
 */

export const TIER_SMALL = 60
export const TIER_MEDIUM = 150
/** Above this many drawn nodes the page paints a canvas instead of SVG (S-1 §3). */
export const CANVAS_NODES = 400
export const GROUP_W = 248
export const GROUP_H = 96
export const BUS_W = 168
export const BUS_H = 28

export function tierFor(n) {
  if (n <= TIER_SMALL) return { name: 'small', n, grouped: false, folded: false, focus: false, buses: false, minimap: false, wrap: false }
  if (n <= TIER_MEDIUM) return { name: 'medium', n, grouped: true, folded: false, focus: true, buses: true, minimap: true, wrap: false }
  return { name: 'large', n, grouped: true, folded: true, focus: true, buses: true, minimap: true, wrap: true }
}

const segs = (d) => !d || d === '.' ? [] : d.split('/')

export function groupKeys(model) {
  const out = new Map()
  if (model.runtime) { for (const c of model.comps) out.set(c.id, c.dir ?? '.'); return out }
  const real = model.comps.filter(c => !c.ghost)
  let prefix = null
  for (const c of real) {
    const s = segs(c.dir)
    if (prefix == null) { prefix = s; continue }
    let i = 0
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++
    prefix = prefix.slice(0, i)
  }
  prefix = prefix ?? []
  const keyOf = (dir) => { const s = segs(dir); return s.slice(0, Math.min(s.length, prefix.length + 2)).join('/') || '.' }
  for (const c of real) out.set(c.id, keyOf(c.dir))
  for (const c of model.comps) {
    if (!c.ghost) continue
    const p = (model.parentsOf.get(c.id) || []).find(x => out.has(x))
    out.set(c.id, p != null ? out.get(p) : keyOf(c.dir))
  }
  return out
}

export function treeInfo(model) {
  if (model._tree) return model._tree
  const { comps, byId, parentsOf, childrenOf } = model
  const roots = comps.filter(c => !parentsOf.get(c.id).some(p => p !== c.id)).map(c => c.id)
    .sort((a, b) => Number(byId.get(b).entry === true) - Number(byId.get(a).entry === true))
  const depth = new Map(), firstParent = new Map()
  const queue = []
  for (const r of roots) { depth.set(r, 0); queue.push(r) }
  const walk = () => {
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]
      for (const ch of childrenOf.get(id)) if (!depth.has(ch)) { depth.set(ch, depth.get(id) + 1); firstParent.set(ch, id); queue.push(ch) }
    }
  }
  walk()
  // render cycles with no root: their first member in graph order starts a tree
  for (const c of comps) if (!depth.has(c.id)) { roots.push(c.id); depth.set(c.id, 0); queue.push(c.id); walk() }
  model._tree = { roots, depth, firstParent }
  return model._tree
}

export function reachableFromEntries(model) {
  const entries = model.comps.filter(c => c.entry === true).map(c => c.id)
  if (!entries.length) return null
  const seen = new Set()
  const stack = [...entries]
  while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); stack.push(...model.childrenOf.get(id)) }
  return seen
}

/** The filter menu's switches, in order: [key, label]. */
export const FILTERS = [
  ['problems', 'Only problems'],
  ['hideViewOnly', 'Hide view-only leaves'],
  ['hideBehavior', 'Hide behavior actions'],
  ['ai', 'AI surface only'],
  ['unreachable', 'Unreachable from any entry'],
  ['changes', 'Changes only'],
]

export function filterCount(f = {}) {
  return (f.kind ? 1 : 0) + FILTERS.filter(([k]) => f[k]).length
}

const severity = (c) => c.diagnostics.some(d => d.severity === 'error') ? 'error' : c.diagnostics.some(d => d.severity === 'warn') ? 'warn' : null

/** Filters that remove nodes (hideBehavior only changes what a card lists). */
const nodeFilters = (f) => !!(f.kind || f.problems || f.hideViewOnly || f.ai || f.unreachable || f.changes)

export function focusSet(model, id, depth = 2) {
  const F = new Set([id])
  if (!model.byId.has(id)) return F
  const stack = [id]
  while (stack.length) { const x = stack.pop(); for (const p of model.parentsOf.get(x)) if (!F.has(p)) { F.add(p); stack.push(p) } }
  let front = [id]
  for (let d = 0; d < depth; d++) {
    const next = []
    for (const x of front) for (const ch of model.childrenOf.get(x)) if (!F.has(ch)) { F.add(ch); next.push(ch) }
    front = next
  }
  for (const e of model.eventEdges) { if (e.from === id) F.add(e.to); if (e.to === id) F.add(e.from) }
  for (const e of model.contextEdges) { if (e.from === id) F.add(e.to); if (e.to === id) F.add(e.from) }
  for (const e of model.parentEdges || []) { if (e.from === id) F.add(e.to); if (e.to === id) F.add(e.from) }
  return F
}

const NODE_W = 216, NODE_H = 74

export function projectView(model, opts = {}) {
  const M = model
  const real = M.comps.filter(c => !c.ghost)
  const tier = opts.tier ?? tierFor(real.length)
  const f = opts.filter || {}
  const groupOf = opts.groupOf ?? groupKeys(M)
  const T = treeInfo(M)
  const focus = tier.focus && opts.focus != null && M.byId.has(opts.focus) ? opts.focus : null
  const base = { tier, groupOf, total: real.length, byNode: null }

  // filters: the matching components, plus their ancestors (dimmed) so the tree stays connected
  let keep = new Set(M.comps.map(c => c.id))
  const dimmed = new Set()
  if (nodeFilters(f)) {
    const reach = f.unreachable ? reachableFromEntries(M) : null
    const orphan = new Set((M.orphanReads || []).map(o => o.id))
    const pred = (c) => {
      if (f.kind && c.kind !== f.kind) return false
      if (f.hideViewOnly && c.viewOnly && !M.childrenOf.get(c.id).length) return false
      if (f.problems && !(severity(c) || (c.ghost && !c.external && !c.widget) || orphan.has(c.id))) return false
      if (f.ai && !c.agent && !c.actions.some(a => (a.sinks || []).includes('LLM'))) return false
      if (reach && reach.has(c.id)) return false
      if (f.changes && !c.diff) return false
      return true
    }
    keep = new Set(M.comps.filter(pred).map(c => c.id))
    if (f.kind || f.problems || f.ai || f.changes) {
      for (const id of [...keep]) {
        let p = T.firstParent.get(id)
        while (p != null && !keep.has(p)) { keep.add(p); dimmed.add(p); p = T.firstParent.get(p) }
      }
    }
  }

  let fset = null, crumbs = []
  if (focus) {
    fset = focusSet(M, focus, opts.focusDepth ?? 2)
    keep = new Set([...keep].filter(id => fset.has(id)))
    keep.add(focus)
    for (let p = focus; p != null; p = T.firstParent.get(p)) crumbs.unshift(p)
  }

  const comp = (c) => ({ id: c.id, type: 'comp', comp: c, w: NODE_W, h: NODE_H, members: [c.id], ...(dimmed.has(c.id) ? { dim: true } : {}) })
  if (!tier.grouped && !nodeFilters(f) && !focus) {
    const nodes = M.comps.map(comp)
    return {
      ...base, identity: true, flat: true, nodes, byNode: new Map(nodes.map(n => [n.id, n])), rep: new Map(M.comps.map(c => [c.id, c.id])),
      focus: null, focusSet: null, crumbs: [], dimmed,
      comps: M.comps, byId: M.byId, parentsOf: M.parentsOf, childrenOf: M.childrenOf,
      renderEdges: M.renderEdges, eventEdges: M.eventEdges, contextEdges: M.contextEdges, parentEdges: M.parentEdges || [],
      shown: real.length, groups: groupList(M, groupOf, keep, () => false),
    }
  }

  // group folds (never in focus mode; a group with one visible component stays open)
  const counts = new Map()
  for (const id of keep) { const k = groupOf.get(id); counts.set(k, (counts.get(k) ?? 0) + 1) }
  const isFolded = (k) => tier.grouped && !focus && k != null && (counts.get(k) ?? 0) > 1 &&
    (opts.closed?.has(k) || (tier.folded && !opts.open?.has(k)))
  const rep = new Map()
  for (const id of keep) { const k = groupOf.get(id); rep.set(id, isFolded(k) ? 'grp:' + k : id) }

  const nodes = new Map()
  for (const id of keep) {
    const r = rep.get(id), c = M.byId.get(id)
    if (r === id) { nodes.set(id, comp(c)); continue }
    let g = nodes.get(r)
    if (!g) nodes.set(r, g = { id: r, type: 'group', key: r.slice(4), w: GROUP_W, h: GROUP_H, members: [], count: 0, err: 0, warn: 0, ai: 0, entry: false })
    g.members.push(id)
    if (c.ghost || c.diff === 'removed') continue // V-6: a removed card is drawn, not counted
    g.count++
    const s = severity(c)
    if (s === 'error') g.err++; else if (s === 'warn') g.warn++
    if (c.agent) g.ai++
    if (c.entry === true) g.entry = true
  }

  // edges between drawn nodes, bundled (a count, the union of their labels)
  const maps = { render: new Map(), event: new Map(), context: new Map(), parent: new Map() }
  const bundle = (kind, from, to, e, extra) => {
    if (from == null || to == null || (from === to && from.startsWith('grp:'))) return null
    const k = from + '\u0000' + to + (kind === 'render' ? '\u0000' + e.via : '')
    let x = maps[kind].get(k)
    if (!x) maps[kind].set(k, x = { ...e, from, to, count: 0, ...extra() })
    x.count++
    return x
  }
  const grp = (id) => id.startsWith('grp:')
  for (const e of M.renderEdges) {
    const x = bundle('render', rep.get(e.from), rep.get(e.to), e, () => ({ labels: [] }))
    if (x && e.label && !x.labels.includes(e.label)) x.labels.push(e.label)
  }
  const touches = (a, b) => !focus || a === focus || b === focus
  // EVENTS: a bus node where it cuts edges (emitters × selectors > emitters + selectors) and an end is
  // a drawn component; otherwise the pairs, bundled between groups
  const events = M.events || {}
  const busNodes = []
  const busTypes = new Set()
  if (tier.buses && !focus) {
    const byType = new Map()
    for (const e of M.eventEdges) {
      if (!touches(e.from, e.to)) continue
      const a = rep.get(e.from), b = rep.get(e.to)
      if (a == null || b == null) continue
      let t = byType.get(e.type)
      if (!t) byType.set(e.type, t = { ems: new Set(), sls: new Set() })
      t.ems.add(a); t.sls.add(b)
    }
    for (const [type, t] of byType) {
      const ends = [...t.ems, ...t.sls]
      if (!(ends.some(x => !grp(x)) && t.ems.size * t.sls.size > t.ems.size + t.sls.size)) continue
      busTypes.add(type)
      const id = 'bus:' + type
      busNodes.push({ id, type: 'bus', event: type, w: BUS_W, h: BUS_H, members: [], emitters: t.ems.size, selectors: t.sls.size })
      for (const a of t.ems) bundle('event', a, id, { type }, () => ({ types: [type] }))
      for (const b of t.sls) bundle('event', id, b, { type }, () => ({ types: [type] }))
    }
  }
  for (const e of M.eventEdges) {
    if (busTypes.has(e.type) || !touches(e.from, e.to)) continue
    const x = bundle('event', rep.get(e.from), rep.get(e.to), e, () => ({ types: [] }))
    if (x && !x.types.includes(e.type)) x.types.push(e.type)
  }
  for (const e of M.contextEdges) {
    if (!touches(e.from, e.to)) continue
    const x = bundle('context', rep.get(e.from), rep.get(e.to), e, () => ({ fields: [] }))
    if (x) for (const fl of e.fields) if (!x.fields.includes(fl)) x.fields.push(fl)
  }
  for (const e of M.parentEdges || []) {
    if (!touches(e.from, e.to)) continue
    const x = bundle('parent', rep.get(e.from), rep.get(e.to), e, () => ({ actions: [] }))
    if (x) for (const a of e.actions) if (!x.actions.includes(a)) x.actions.push(a)
  }
  const many = (x) => x.count > 1 && (grp(x.from) || grp(x.to))
  const renderEdges = [...maps.render.values()].map(x => ({ ...x, label: many(x) ? `×${x.count}` : x.labels.join(', ') }))
  const eventEdges = [...maps.event.values()].map(x => ({ ...x, type: x.types[0] ?? x.type, label: many(x) ? `×${x.count}` : x.types.length > 2 ? `${x.types[0]} +${x.types.length - 1}` : x.types.join(', ') }))
  const contextEdges = [...maps.context.values()].map(x => ({ ...x, label: x.fields.join(', ') }))
  const parentEdges = [...maps.parent.values()].map(x => ({ ...x, label: x.actions.join(', ') }))

  const list = [...nodes.values(), ...busNodes]
  const byNode = new Map(list.map(n => [n.id, n]))
  const parentsOf = new Map(list.map(n => [n.id, []])), childrenOf = new Map(list.map(n => [n.id, []]))
  for (const e of renderEdges) {
    if (!parentsOf.get(e.to).includes(e.from)) parentsOf.get(e.to).push(e.from)
    if (!childrenOf.get(e.from).includes(e.to)) childrenOf.get(e.from).push(e.to)
  }
  // model-shaped stand-ins for the layout: comps (with `dir` = the group, so layoutGraph clusters by it)
  const comps = list.filter(n => n.type !== 'bus').map(n => n.type === 'comp' ? n.comp : { id: n.id, name: n.key, dir: '', kind: 'group', group: n })
  const byId = new Map(comps.map(c => [c.id, c]))
  return {
    ...base, identity: false, flat: !tier.grouped || !!focus, nodes: list, byNode, rep, focus, focusSet: fset, crumbs, dimmed,
    comps, byId, parentsOf, childrenOf, renderEdges, eventEdges, contextEdges, parentEdges,
    shown: [...keep].filter(id => !M.byId.get(id).ghost).length,
    groups: groupList(M, groupOf, keep, isFolded),
  }
}

function groupList(M, groupOf, keep, isFolded) {
  const out = new Map()
  for (const id of keep) {
    if (M.byId.get(id).ghost) continue
    const k = groupOf.get(id)
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  return [...out].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([key, count]) => ({ key, count, folded: isFolded(key) }))
}

/** The drawn node that shows `id` (itself, its folded group, …), or null when nothing does. */
export function repOf(P, id) {
  return P.rep.get(id) ?? null
}
