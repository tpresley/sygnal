// PLAN-10 V-4 (D536): the page on large apps. Size tiers, directory groups, folding with bundled
// edges, EVENTS bus nodes, focus mode, filters, the grouped layout, the search results / outline /
// EVENTS table data, the canvas hit test, and the page follow-ups (state trace from A-7, the
// context health item as SYG170 sees it, Vike routes from A-9).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { buildModel, healthList, stateTrace, routeLabel, searchText } from '../src/graphView/model.js'
import { tierFor, groupKeys, treeInfo, reachableFromEntries, focusSet, projectView, filterCount, FILTERS, CANVAS_NODES } from '../src/graphView/groups.js'
import * as groupsExports from '../src/graphView/groups.js'
import { layoutView } from '../src/graphView/groupLayout.js'
import * as groupLayoutExports from '../src/graphView/groupLayout.js'
import { searchResults, dirTree, eventsTable, where } from '../src/graphView/views.js'
import * as viewsExports from '../src/graphView/views.js'
import { hitNode } from '../src/graphView/canvas.js'
import * as canvasExports from '../src/graphView/canvas.js'
import { layoutGraph, edgePaths } from '../src/graphView/layout.js'
import { graphHtml, inlineModule } from '../src/graphView/html.js'
import { synthGraph } from './fixtures/graph-synth.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(here, '../src/graphView')

function comp(name, file, line, extra = {}) {
  return {
    name, id: `${file}:${line}`, parentId: null, file, kind: 'child', actions: [], stateKeys: [], calculated: [],
    contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [],
    diagnostics: [], ...extra,
  }
}
const G = (components, events = {}, diagnostics = []) => ({ version: 1, source: 'static', components, events, diagnostics })
const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5

describe('V-4 tiers and groups', () => {
  it('tierFor: ≤ 60 small (nothing new), ≤ 150 medium (open groups, focus, buses, minimap), else large (folded, wrapped)', () => {
    expect(tierFor(60)).toMatchObject({ name: 'small', grouped: false, focus: false, minimap: false })
    expect(tierFor(61)).toMatchObject({ name: 'medium', grouped: true, folded: false, focus: true, buses: true, minimap: true, wrap: false })
    expect(tierFor(150).name).toBe('medium')
    expect(tierFor(151)).toMatchObject({ name: 'large', grouped: true, folded: true, focus: true, wrap: true })
  })

  it('groupKeys: two segments below the common directory; a ghost goes with what renders it; runtime graphs by app', () => {
    const m = buildModel(G([
      comp('App', 'src/App.jsx', 1, { children: [{ name: 'Shop', via: 'tag' }, { name: 'Missing', via: 'tag' }] }),
      comp('Shop', 'src/features/shop/Shop.jsx', 1, { children: [{ name: 'Line', via: 'tag' }] }),
      comp('Line', 'src/features/shop/components/deep/Line.jsx', 1),
      comp('Nav', 'src/layout/Nav.jsx', 1),
    ]))
    const g = groupKeys(m)
    expect(g.get('src/App.jsx:1')).toBe('src')
    expect(g.get('src/features/shop/Shop.jsx:1')).toBe('src/features/shop')
    expect(g.get('src/features/shop/components/deep/Line.jsx:1')).toBe('src/features/shop')
    expect(g.get('src/layout/Nav.jsx:1')).toBe('src/layout')
    expect(g.get(m.ghosts[0].id)).toBe('src')
    const rt = { runtime: true, comps: [{ id: 'a', dir: 'app 1 · App' }], parentsOf: new Map() }
    expect(groupKeys(rt).get('a')).toBe('app 1 · App')
  })

  it('treeInfo: first parents from the entries first, render cycles get a root; reachableFromEntries', () => {
    const m = buildModel(G([
      comp('Lib', 'a/Lib.jsx', 1, { children: [{ name: 'Shared', via: 'tag' }] }),
      comp('App', 'a/App.jsx', 1, { entry: true, children: [{ name: 'Shared', via: 'tag' }] }),
      comp('Shared', 'a/Shared.jsx', 1),
      comp('X', 'b/X.jsx', 1, { children: [{ name: 'Y', via: 'tag' }] }),
      comp('Y', 'b/Y.jsx', 1, { children: [{ name: 'X', via: 'tag' }] }),
    ]))
    const t = treeInfo(m)
    expect(t.firstParent.get('a/Shared.jsx:1')).toBe('a/App.jsx:1')
    expect(t.depth.get('b/X.jsx:1') + t.depth.get('b/Y.jsx:1')).toBe(1)
    expect([...reachableFromEntries(m)].sort()).toEqual(['a/App.jsx:1', 'a/Shared.jsx:1'])
    expect(reachableFromEntries(buildModel(G([comp('A', 'a.jsx', 1)])))).toBeNull()
  })
})

describe('V-4 projection', () => {
  const big = buildModel(synthGraph(500, 3))
  const medium = buildModel(synthGraph(120, 4))

  it('the small tier with no filter is the model itself (the V-1 page unchanged)', () => {
    const m = buildModel(synthGraph(40, 1))
    const P = projectView(m)
    expect(P.identity).toBe(true)
    expect(P.renderEdges).toBe(m.renderEdges)
    expect(P.nodes.map(n => n.id)).toEqual(m.comps.map(c => c.id))
    expect(JSON.stringify([...layoutGraph(m).pos])).toBe(JSON.stringify([...layoutGraph(P).pos]))
  })

  it('large: every group folded into one card with counts and the worst severity; edges bundled ×N; no group self-loops', () => {
    const P = projectView(big)
    expect(P.tier.name).toBe('large')
    const groups = P.nodes.filter(n => n.type === 'group')
    expect(groups.length).toBeGreaterThan(5)
    expect(P.nodes.length).toBeLessThan(60)
    const real = big.comps.filter(c => !c.ghost)
    const drawnComps = P.nodes.filter(n => n.type === 'comp' && !n.comp.ghost).length
    expect(groups.reduce((s, g) => s + g.count, 0) + drawnComps).toBe(real.length)
    for (const g of groups) {
      const members = g.members.map(id => big.byId.get(id)).filter(c => !c.ghost)
      expect(g.err).toBe(members.filter(c => c.diagnostics.some(d => d.severity === 'error')).length)
      for (const id of g.members) expect(P.rep.get(id)).toBe(g.id)
    }
    for (const e of [...P.renderEdges, ...P.eventEdges, ...P.contextEdges]) {
      expect(P.byNode.has(e.from) && P.byNode.has(e.to)).toBe(true)
      expect(e.from === e.to && e.from.startsWith('grp:')).toBe(false)
    }
    const bundled = P.renderEdges.filter(e => e.count > 1 && (e.from.startsWith('grp:') || e.to.startsWith('grp:')))
    expect(bundled.length).toBeGreaterThan(0)
    for (const e of bundled) expect(e.label).toBe(`×${e.count}`)
    expect(P.renderEdges.reduce((s, e) => s + e.count, 0)).toBeLessThanOrEqual(big.renderEdges.length)
  })

  it('open / closed sets: opening a group draws its components; a one-component group never folds; medium starts open', () => {
    const k = 'src/features/shop'
    const P = projectView(big, { open: new Set([k]) })
    const shop = big.comps.filter(c => groupKeys(big).get(c.id) === k)
    for (const c of shop) expect(P.rep.get(c.id)).toBe(c.id)
    expect(P.groups.find(g => g.key === k).folded).toBe(false)
    const M1 = projectView(medium)
    expect(M1.nodes.some(n => n.type === 'group')).toBe(false)
    const M2 = projectView(medium, { closed: new Set(['src/features/shop']) })
    expect(M2.nodes.filter(n => n.type === 'group').map(n => n.key)).toEqual(['src/features/shop'])
    const g = groupKeys(big)
    const ones = [...new Set(g.values())].filter(key => big.comps.filter(c => !c.ghost && g.get(c.id) === key).length === 1)
    for (const key of ones) expect(P.groups.find(x => x.key === key)?.folded ?? false).toBe(false)
  })

  it('EVENTS bus nodes only where they cut edges (emitters × selectors > emitters + selectors)', () => {
    const P = projectView(medium)
    const buses = P.nodes.filter(n => n.type === 'bus')
    for (const b of buses) {
      expect(b.emitters * b.selectors).toBeGreaterThan(b.emitters + b.selectors)
      expect(P.eventEdges.filter(e => e.to === b.id).length).toBe(b.emitters)
      expect(P.eventEdges.filter(e => e.from === b.id).length).toBe(b.selectors)
    }
    const nav = buses.find(b => b.event === 'NAVIGATE')
    expect(nav).toBeTruthy()
    expect(projectView(buildModel(synthGraph(40, 1))).nodes.some(n => n.type === 'bus')).toBe(false)
  })

  it('focus: ancestors to the entry, children to depth 2, EVENTS / context / PARENT peers; flat, nothing folded, breadcrumbs', () => {
    const checkout = big.comps.find(c => c.name === 'Checkout')
    const F = focusSet(big, checkout.id)
    const P = projectView(big, { focus: checkout.id })
    expect(P.flat).toBe(true)
    expect(P.focus).toBe(checkout.id)
    expect(P.nodes.every(n => n.type === 'comp')).toBe(true)
    expect(new Set(P.nodes.map(n => n.id))).toEqual(F)
    expect(P.nodes.length).toBeLessThan(40)
    expect(P.crumbs.map(id => big.byId.get(id).name)).toEqual(['App', 'Shell', 'Router', 'StoreShell', 'Checkout'])
    const storeShell = big.comps.find(c => c.name === 'StoreShell')
    expect(F.has(storeShell.id)).toBe(true) // its context provider (currency)
    for (const e of [...P.eventEdges, ...P.contextEdges]) expect(e.from === checkout.id || e.to === checkout.id).toBe(true)
    // the small tier ignores a focus
    const small = buildModel(synthGraph(40, 1))
    expect(projectView(small, { focus: small.comps[3].id }).identity).toBe(true)
  })

  it('filters: problems / kind / AI keep the ancestors (dimmed); hide view-only leaves; unreachable from any entry', () => {
    const problems = projectView(big, { filter: { problems: true }, open: new Set(groupKeys(big).values()) })
    const shown = problems.nodes.filter(n => n.type === 'comp')
    expect(shown.some(n => n.dim)).toBe(true)
    for (const n of shown) if (!n.dim) expect(n.comp.diagnostics.some(d => d.severity !== 'info') || (n.comp.ghost && !n.comp.external) || big.orphanReads.some(o => o.id === n.id)).toBe(true)
    const noLeaves = projectView(big, { filter: { hideViewOnly: true }, open: new Set(groupKeys(big).values()) })
    for (const n of noLeaves.nodes) if (n.comp?.viewOnly) expect(big.childrenOf.get(n.id).length).toBeGreaterThan(0)
    const ai = projectView(big, { filter: { ai: true }, open: new Set(groupKeys(big).values()) })
    expect(ai.nodes.filter(n => !n.dim && n.comp).every(n => n.comp.agent || n.comp.actions.some(a => a.sinks.includes('LLM')))).toBe(true)
    const m = buildModel(G([
      comp('App', 'a/App.jsx', 1, { kind: 'root', entry: true, children: [{ name: 'Used', via: 'tag' }] }),
      comp('Used', 'a/Used.jsx', 1), comp('Orphan', 'a/Orphan.jsx', 1, { kind: 'root', children: [{ name: 'Leaf', via: 'tag' }] }), comp('Leaf', 'a/Leaf.jsx', 1),
    ]))
    expect(projectView(m, { filter: { unreachable: true } }).nodes.map(n => n.comp.name).sort()).toEqual(['Leaf', 'Orphan'])
    expect(projectView(m, { filter: { kind: 'root' } }).nodes.map(n => n.comp.name).sort()).toEqual(['App', 'Orphan'])
    expect(projectView(m, { filter: { hideBehavior: true } }).identity).toBe(true) // changes no node
    expect(filterCount({ kind: 'root', problems: true, ai: false })).toBe(2)
    expect(FILTERS.map(f => f[0])).toEqual(['problems', 'hideViewOnly', 'hideBehavior', 'ai', 'unreachable'])
  })
})

describe('V-4 grouped layout', () => {
  const big = buildModel(synthGraph(500, 3))
  const all = new Set(groupKeys(big).values())

  it('no two nodes overlap; open groups are boxes around their components; deterministic', () => {
    for (const P of [projectView(big), projectView(big, { open: all }), projectView(buildModel(synthGraph(120, 4)))]) {
      const L = layoutView(P)
      const list = [...L.pos.values()]
      expect(L.pos.size).toBe(P.nodes.length)
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlap(list[i], list[j])).toBe(false)
      for (const b of L.clusters) {
        for (const n of P.nodes) {
          if (n.type !== 'comp' || P.groupOf.get(n.id) !== b.key) continue
          const p = L.pos.get(n.id)
          expect(p.x >= b.x && p.y >= b.y && p.x + p.w <= b.x + b.w && p.y + p.h <= b.y + b.h).toBe(true)
        }
      }
      expect(JSON.stringify([...layoutView(P).pos])).toBe(JSON.stringify([...L.pos]))
    }
  })

  it('wrapped rows: the folded overview is far narrower than one row of cards; buses sit right of the drawing', () => {
    const P = projectView(big)
    const wide = layoutView(P, { wrap: 0 }), wrapped = layoutView(P)
    const width = (L) => Math.max(...[...L.pos.values()].filter((_, i) => P.nodes[i].type !== 'bus').map(p => p.x + p.w))
    expect(width(wrapped)).toBeLessThan(width(wide))
    const M2 = buildModel(synthGraph(120, 4))
    const P2 = projectView(M2), L2 = layoutView(P2)
    const xs = P2.nodes.filter(n => n.type !== 'bus').map(n => L2.pos.get(n.id).x + n.w)
    for (const b of P2.nodes.filter(n => n.type === 'bus')) expect(L2.pos.get(b.id).x).toBeGreaterThan(Math.max(...xs))
  })

  it('an edit moves only its group (live mode stability)', () => {
    const g = synthGraph(500, 3)
    const g2 = structuredClone(g)
    const parent = g2.components.find(c => c.name === 'Cart')
    g2.components.push(comp('AddedPanel', 'src/features/shop/AddedPanel.jsx', 7))
    parent.children.push({ name: 'AddedPanel', via: 'tag', id: 'src/features/shop/AddedPanel.jsx:7' })
    const a = layoutView(projectView(buildModel(g))), b = layoutView(projectView(buildModel(g2)))
    let moved = 0, common = 0
    for (const [id, p] of a.pos) { const q = b.pos.get(id); if (!q) continue; common++; if (Math.hypot(p.x - q.x, p.y - q.y) > 20) moved++ }
    expect(moved / common).toBeLessThan(0.1) // folded: the shop card's count changes, nothing moves
  })

  it('edgePaths on a projection: one route per drawn edge, carrying the bundled edge (count, types)', () => {
    const P = projectView(big), L = layoutView(P)
    const routes = edgePaths(P, L)
    expect(routes.length).toBe(P.renderEdges.length + P.eventEdges.length + P.contextEdges.length + P.parentEdges.length)
    expect(routes.find(r => r.edge.count > 1).label).toMatch(/^×\d+$/)
    for (const r of routes) expect(r.d).not.toMatch(/NaN/)
  })

  it('the canvas hit test finds the node under a point (view transform applied)', () => {
    const P = projectView(big), L = layoutView(P)
    const n = P.nodes[3], p = L.pos.get(n.id), view = { x: 40, y: -10, k: 0.5 }
    expect(hitNode({ P, L }, view, view.x + (p.x + 5) * view.k, view.y + (p.y + 5) * view.k).id).toBe(n.id)
    expect(hitNode({ P, L }, view, -9999, -9999)).toBeNull()
    expect(CANVAS_NODES).toBe(400)
  })
})

describe('V-4 views: search results, outline, EVENTS table', () => {
  const m = buildModel(synthGraph(500, 3))

  it('searchResults: exact name first, then prefix, then substring, then other fields with why; event types', () => {
    const r = searchResults(m, 'cart')
    expect(r.comps[0].name).toBe('Cart')
    expect(r.events.map(e => e.type)).toContain('CART_CHANGED')
    expect(r.events[0].why).toMatch(/^EVENTS · \d+ → \d+$/)
    const scores = r.comps.map(c => c.score)
    expect(scores).toEqual([...scores].sort((a, b) => a - b))
    const byField = r.comps.find(c => c.score === 3)
    if (byField) expect(byField.why).not.toBe('')
    const nav = searchResults(m, 'navigate')
    expect(nav.comps.every(c => c.why.startsWith('emits') || c.why.startsWith('selects') || c.why.startsWith('action'))).toBe(true)
    expect(searchResults(m, '').count).toBe(0)
    expect(searchResults(m, 'a', { limit: 5 }).comps.length).toBe(5)
  })

  it('where: the directory that tells same-named components apart', () => {
    const lists = m.comps.filter(c => c.name === 'List')
    if (lists.length > 1) expect(new Set(lists.map(c => where(m, c))).size).toBe(lists.length)
    expect(where(m, m.comps.find(c => c.name === 'Checkout'))).toBe('')
  })

  it('dirTree: nested directories (single-child chains merged), entries first, groups marked, every component once', () => {
    const t = dirTree(m, groupKeys(m))
    const ids = []
    const walk = (n) => { ids.push(...n.comps); n.dirs.forEach(walk) }
    walk(t)
    expect(ids.sort()).toEqual(m.comps.map(c => c.id).sort())
    const find = (n, p) => n.path === p ? n : n.dirs.map(d => find(d, p)).find(Boolean)
    expect(find(t, 'src/features/shop').group).toBe('src/features/shop')
    expect(find(t, 'src').comps.map(id => m.byId.get(id).name)[0]).toBe('App') // the entry first
    const merged = dirTree(buildModel(G([comp('A', 'x/y/z/A.jsx', 1), comp('B', 'x/y/z/w/B.jsx', 1)])))
    expect(merged.dirs.map(d => d.name)).toEqual(['x/y/z'])
  })

  it('eventsTable: one row per type with emitter and selector ids; filter by type or name; sort by counts', () => {
    const rows = eventsTable(m)
    expect(rows.length).toBe(Object.keys(m.events).length)
    const nav = rows.find(r => r.type === 'NAVIGATE')
    expect(nav.selectors.map(id => m.byId.get(id).name).sort()).toEqual(['PageTracker', 'Router', 'Router'])
    expect(eventsTable(m, { sort: 'emitters' })[0].type).toBe('NAVIGATE')
    expect(eventsTable(m, { q: 'pagetracker' }).every(r => r.selectors.concat(r.emitters).some(id => m.byId.get(id).name === 'PageTracker'))).toBe(true)
  })
})

describe('V-4 page follow-ups', () => {
  it('state trace (A-7): owners, writers by action, readers, and the reducers it could not read', () => {
    const m = buildModel(G([
      comp('App', 'a/App.jsx', 1, { stateKeys: ['cart', 'page'], stateReads: ['page'], actions: [{ name: 'ADD', trigger: 'intent', sinks: ['STATE'], writes: ['cart'] }, { name: 'ODD', trigger: 'intent', sinks: ['STATE'], writes: null }] }),
      comp('Cart', 'a/Cart.jsx', 1, { stateReads: ['cart'], actions: [{ name: 'CLEAR', trigger: 'intent', sinks: ['STATE'], writes: ['cart'] }] }),
      comp('Other', 'a/Other.jsx', 1, { stateReads: ['page'] }),
    ]))
    const t = stateTrace(m, 'cart')
    expect(t.owners).toEqual(['a/App.jsx:1'])
    expect(t.writers).toEqual([{ id: 'a/App.jsx:1', action: 'ADD' }, { id: 'a/Cart.jsx:1', action: 'CLEAR' }])
    expect(t.readers).toEqual(['a/Cart.jsx:1'])
    expect(t.unknown).toEqual([{ id: 'a/App.jsx:1', action: 'ODD' }])
  })

  it('context health item: own .context and Vike page fields count as provided; reads SYG170 reports are not listed twice', () => {
    const m = buildModel(G([
      comp('App', 'a/App.jsx', 1, { contextProvides: ['theme'], contextConsumes: ['theme', 'lang'], children: [{ name: 'Kid', via: 'tag' }] }),
      comp('Kid', 'a/Kid.jsx', 1, { contextConsumes: ['theme', 'user'], diagnostics: [{ code: 'SYG170', severity: 'warn', message: "context.user is undefined: neither Kid nor a component above it (App > Kid) has 'user' in its .context" }] }),
      comp('Page', 'pages/orders/+Page.jsx', 1, { entry: true, route: '/orders', contextConsumes: ['routeParams', 'pageData', 'missing'] }),
      comp('Inner', 'components/Inner.jsx', 1, { entry: true, route: '/x', contextConsumes: ['urlPathname'] }),
    ]))
    expect(m.ownReads).toEqual([{ id: 'a/App.jsx:1', field: 'theme' }])
    expect(m.orphanReads.map(o => `${o.id} ${o.field}`).sort()).toEqual(['a/App.jsx:1 lang', 'a/Kid.jsx:1 user', 'pages/orders/+Page.jsx:1 missing'])
    const item = healthList(m).find(h => h.group === 'Context read with no provider')
    expect(item.items.map(i => i.title).sort()).toEqual(['context.lang', 'context.missing'])
    expect(item.items[0].sub).toMatch(/may be provided outside the scanned files/)
  })

  it('Vike routes (A-9): labels, search text, layout edges', () => {
    expect(routeLabel({ route: '/orders/@id', file: 'pages/orders/@id/+Page.jsx' })).toBe('/orders/@id')
    expect(routeLabel({ route: null, routeDynamic: true, file: 'pages/s/+Page.jsx' })).toBe('dynamic route')
    expect(routeLabel({ route: '/a', routes: ['/a', '/b', '/c'], file: 'c/X.jsx' })).toBe('/a +2')
    expect(routeLabel({ route: null, file: 'pages/_error/+Page.jsx' })).toBe('error page')
    expect(routeLabel({ file: 'src/App.jsx' })).toBeNull()
    expect(searchText({ ...buildModel(G([comp('P', 'pages/x/+Page.jsx', 1, { route: '/shop/@id' })])).comps[0] })).toContain('/shop/@id')
    const m = buildModel(G([comp('L', 'pages/+Layout.jsx', 1, { route: '/', children: [{ name: 'P', via: 'layout' }] }), comp('P', 'pages/x/+Page.jsx', 1, { route: '/x' })]))
    const routes = edgePaths(m, layoutGraph(m))
    expect(routes.filter(r => r.cls === 'layout').length).toBe(1)
  })
})

describe('V-4 page assembly', () => {
  it('the new modules inline (exports match) and are in the page', () => {
    const V = {}
    for (const f of ['groups.js', 'groupLayout.js', 'views.js', 'canvas.js']) vm.runInNewContext(inlineModule(fs.readFileSync(path.join(srcDir, f), 'utf8'), f), { V, Path2D: class {} })
    expect(Object.keys(V).sort()).toEqual([...Object.keys(groupsExports), ...Object.keys(groupLayoutExports), ...Object.keys(viewsExports), ...Object.keys(canvasExports)].sort())
    const html = graphHtml(synthGraph(200, 2), { title: 't' })
    for (const id of ['results', 'filters', 'crumbs', 'minimap', 'events-view', 'cv', 'v-events']) expect(html).toContain(`id="${id}"`)
    expect(html).toContain('// ── groups.js ──')
  })
})
