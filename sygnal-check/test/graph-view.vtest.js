// PLAN-10 T-1: the graph page's pure modules (src/graphView/: model, layout, Mermaid), the HTML
// inlining, the page's colour contrast, and the CLI's --graph=html|mermaid flags.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { buildModel, healthList, searchText, lineOf, ancestors } from '../src/graphView/model.js'
import * as modelExports from '../src/graphView/model.js'
import * as layoutExports from '../src/graphView/layout.js'
import * as mermaidExports from '../src/graphView/mermaid.js'
import { layoutGraph, edgePaths, bbox, NODE_W, NODE_H } from '../src/graphView/layout.js'
import { toMermaid, mermaidLabel } from '../src/graphView/mermaid.js'
import { graphHtml, inlineJson, inlineModule } from '../src/graphView/html.js'
import { main, projectName, fileSafe } from '../src/cli.js'
import { graph } from '../src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const srcDir = path.join(pkgRoot, 'src/graphView')

/** A component as the graph has it, with every list empty unless given. */
function comp(name, file, line, extra = {}) {
  return {
    name, id: `${file}:${line}`, parentId: null, file, kind: 'child', actions: [], stateKeys: [], calculated: [],
    contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [],
    diagnostics: [], ...extra,
  }
}
const G = (components, events = {}, diagnostics = []) => ({ version: 1, source: 'static', components, events, diagnostics })

/** The shop app of the graph-viz spike, as the graph describes it (independent of graph.js changes). */
function shop() {
  return G([
    comp('App', 'src/App.jsx', 7, {
      kind: 'root', stateKeys: ['page', 'cart'], contextProvides: ['currency', 'cartCount'], eventsSelected: ['NAVIGATE', 'ADD_TO_CART'],
      actions: [{ name: 'GO', trigger: 'intent', sinks: ['STATE'] }, { name: 'SAVE', trigger: 'unknown', sinks: ['EFFECT'] }],
      children: [{ name: 'Header', via: 'tag' }, { name: 'Shop', via: 'switchable' }, { name: 'Cart', via: 'switchable' }],
    }),
    comp('Header', 'src/Header.jsx', 2, { contextConsumes: ['cartCount'], eventsEmitted: ['NAVIGATE', 'SEARCH'] }),
    comp('Cart', 'src/Cart.jsx', 3, { kind: 'switchable', eventsEmitted: ['NAVIGATE'], children: [{ name: 'CartLine', via: 'collection', from: 'cart' }] }),
    comp('CartLine', 'src/CartLine.jsx', 2, { kind: 'collection-item', contextConsumes: ['currency', 'locale'] }),
    comp('ProductCard', 'src/ProductCard.jsx', 2, { kind: 'root', eventsEmitted: ['ADD_TO_CART'] }),
  ], {
    NAVIGATE: { emitters: ['Cart', 'Header'], selectors: ['App'] },
    ADD_TO_CART: { emitters: ['ProductCard'], selectors: ['App'] },
    SEARCH: { emitters: ['Header'], selectors: [] },
  })
}

/** A seeded pseudo-random graph: trees, shared children, cycles, self-renders, several directories. */
function synthetic(n, seed = 7) {
  let s = seed
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const comps = []
  for (let i = 0; i < n; i++) comps.push(comp(`C${i}`, `src/${['a', 'b', 'c', 'd/e'][i % 4]}/C${i}.jsx`, i + 1))
  for (let i = 1; i < n; i++) {
    if (rnd() < 0.85) comps[Math.floor(rnd() * i)].children.push({ name: `C${i}`, via: rnd() < 0.2 ? 'collection' : 'tag' })
    if (rnd() < 0.1) comps[Math.floor(rnd() * i)].children.push({ name: `C${i}`, via: 'switchable' })
  }
  comps[5].children.push({ name: 'C0', via: 'tag' }) // a cycle back to a root
  comps[9].children.push({ name: 'C9', via: 'tag' }) // renders itself
  comps[3].children.push({ name: 'Missing', via: 'tag' })
  return G(comps, { PING: { emitters: ['C4', 'C8'], selectors: ['C1', 'C12'] } })
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('graphView model', () => {
  it('resolves names like an import: same file, then same directory, then the longest common path', () => {
    const m = buildModel(G([
      comp('Page', 'src/a/Page.jsx', 1, { children: [{ name: 'Chat', via: 'tag' }] }),
      comp('Chat', 'src/b/Chat.jsx', 1),
      comp('Chat', 'src/a/Chat.jsx', 1),
      comp('Other', 'src/b/x/Other.jsx', 1, { children: [{ name: 'Chat', via: 'tag' }] }),
      comp('Self', 'src/c/Self.jsx', 1, { children: [{ name: 'Inner', via: 'tag' }] }),
      comp('Inner', 'src/c/Self.jsx', 9),
      comp('Inner', 'src/c/Inner.jsx', 1),
    ]))
    const to = (from) => m.renderEdges.filter(e => e.from === from).map(e => e.to)
    expect(to('src/a/Page.jsx:1')).toEqual(['src/a/Chat.jsx:1'])
    expect(to('src/b/x/Other.jsx:1')).toEqual(['src/b/Chat.jsx:1'])
    expect(to('src/c/Self.jsx:1')).toEqual(['src/c/Self.jsx:9'])
    expect(m.resolve('Nope')).toBe(null)
  })

  it('prefers ids when the graph has them: children[].id, emitterIds / selectorIds, { name, id } entries, componentId', () => {
    const m = buildModel(G([
      comp('Page', 'src/a/Page.jsx', 1, { children: [{ name: 'Chat', via: 'tag', id: 'src/z/Chat.jsx:1' }] }),
      comp('Chat', 'src/a/Chat.jsx', 1),
      comp('Chat', 'src/z/Chat.jsx', 1),
    ], {
      A: { emitters: ['Chat'], emitterIds: ['src/z/Chat.jsx:1'], selectors: ['Page'], selectorIds: ['src/a/Page.jsx:1'] },
      B: { emitters: [{ name: 'Chat', id: 'src/a/Chat.jsx:1' }], selectors: [{ name: 'Chat', id: 'src/z/Chat.jsx:1' }] },
    }, [{ code: 'SYG105', severity: 'warn', message: 'm', component: 'Chat', componentId: 'src/z/Chat.jsx:1' }]))
    expect(m.renderEdges.map(e => e.to)).toEqual(['src/z/Chat.jsx:1'])
    expect(m.eventEdges).toEqual([
      { from: 'src/z/Chat.jsx:1', to: 'src/a/Page.jsx:1', type: 'A' },
      { from: 'src/a/Chat.jsx:1', to: 'src/z/Chat.jsx:1', type: 'B' },
    ])
    expect(m.diagnostics[0].compId).toBe('src/z/Chat.jsx:1')
    // id: null and external never resolve by name; one ghost per (package, name)
    const x = buildModel(G([
      comp('P', 'src/a/P.jsx', 1, { children: [{ name: 'Toaster', via: 'tag', id: null, external: 'sygnal/ui' }, { name: 'Chat', via: 'tag', id: null }] }),
      comp('R', 'src/b/R.jsx', 1, { children: [{ name: 'Toaster', via: 'tag', id: null, external: 'sygnal/ui' }] }),
      comp('Toaster', 'src/a/Toaster.jsx', 1),
      comp('Chat', 'src/a/Chat.jsx', 1),
    ]))
    expect(x.ghosts.map(g => [g.id, g.external])).toEqual([['external:sygnal/ui:Toaster', 'sygnal/ui'], ['ghost:src/a:Chat', undefined]])
    expect(x.renderEdges.map(e => e.to)).toEqual(['external:sygnal/ui:Toaster', 'ghost:src/a:Chat', 'external:sygnal/ui:Toaster'])
    // an id that isn't in the graph falls back to the name
    const f = buildModel(G([comp('P', 'src/P.jsx', 1, { children: [{ name: 'Q', via: 'tag', id: 'gone:1' }] }), comp('Q', 'src/Q.jsx', 1)]))
    expect(f.renderEdges[0].to).toBe('src/Q.jsx:1')
  })

  it('ghost nodes: one per directory for a rendered name nothing defines; labels on Collection and Switchable edges', () => {
    const m = buildModel(shop())
    expect(m.ghosts.map(g => [g.id, g.name, g.kind])).toEqual([['ghost:src:Shop', 'Shop', 'ghost']])
    expect(m.comps.at(-1).ghost).toBe(true)
    expect(m.renderEdges.map(e => [e.from.split('/').pop(), e.to.split('/').pop(), e.via, e.label])).toEqual([
      ['App.jsx:7', 'Header.jsx:2', 'tag', ''],
      ['App.jsx:7', 'ghost:src:Shop', 'switchable', 'switch'],
      ['App.jsx:7', 'Cart.jsx:3', 'switchable', 'switch'],
      ['Cart.jsx:3', 'CartLine.jsx:2', 'collection', '[cart]'],
    ])
    expect(m.parentsOf.get('src/CartLine.jsx:2')).toEqual(['src/Cart.jsx:3'])
    expect([...ancestors(m, 'src/CartLine.jsx:2')].sort()).toEqual(['src/App.jsx:7', 'src/Cart.jsx:3'])
  })

  it('EVENTS edges: every emitter to every selector, deduped; context served by the nearest providing ancestor', () => {
    const m = buildModel(shop())
    expect(m.eventEdges.map(e => `${e.from.split('/').pop()}→${e.to.split('/').pop()} ${e.type}`)).toEqual([
      'Cart.jsx:3→App.jsx:7 NAVIGATE', 'Header.jsx:2→App.jsx:7 NAVIGATE', 'ProductCard.jsx:2→App.jsx:7 ADD_TO_CART',
    ])
    expect(m.contextEdges).toEqual([
      { from: 'src/App.jsx:7', to: 'src/Header.jsx:2', fields: ['cartCount'] },
      { from: 'src/App.jsx:7', to: 'src/CartLine.jsx:2', fields: ['currency'] },
    ])
    expect(m.orphanReads).toEqual([{ id: 'src/CartLine.jsx:2', field: 'locale' }])
  })

  it('health: diagnostics by code (errors first, titles from the codes), derived checks only where no code covers them', () => {
    // `trigger: 'unknown'` alone is not "nothing triggers it" (a helper-named reply, an intent spread in
    // from another file): only SYG102's findings are, info ones included
    const plain = healthList(buildModel(shop()))
    expect(plain.map(h => [h.group, h.tone, h.items.map(i => i.title)])).toEqual([
      ['Events nobody selects', 'warn', ['SEARCH']],
      ['Context read with no provider', 'warn', ['context.locale']],
      ['Rendered but not scanned', 'muted', ['Shop']],
    ])
    expect(plain[0].items[0]).toMatchObject({ event: 'SEARCH', id: 'src/Header.jsx:2' })
    const info = shop()
    info.components[0].diagnostics.push({ code: 'SYG102', severity: 'info', message: "model entry 'SAVE' is never triggered" })
    expect(healthList(buildModel(info))[0]).toMatchObject({ group: 'Actions nothing triggers', tone: 'warn', code: 'SYG102', items: [{ title: info.components[0].name, sub: "model entry 'SAVE' is never triggered" }] })
    const g = shop()
    g.components[0].diagnostics.push({ code: 'SYG102', severity: 'warn', message: "model entry 'SAVE' is never triggered" })
    g.components[1].diagnostics.push({ code: 'SYG105', severity: 'warn', message: 'SEARCH nobody selects' })
    g.diagnostics.push({ code: 'SYG240', severity: 'error', message: 'schema', component: 'Header' }, { code: 'SYG301', severity: 'info', message: 'hint' })
    const deduped = healthList(buildModel(g), { SYG102: 'Model entry is unreachable' })
    expect(deduped.map(h => h.group)).toEqual(['SYG240', 'SYG102 Model entry is unreachable', 'SYG105', 'Context read with no provider', 'Rendered but not scanned'])
    expect(deduped[0]).toMatchObject({ tone: 'err', code: 'SYG240', items: [{ id: 'src/Header.jsx:2', title: 'Header', sub: 'schema' }] })
  })

  it('the AI agent surface and controls nothing listens to', () => {
    const g = G([comp('Todos', 'src/T.jsx', 1, {
      agent: { tools: 'todos', read: true, actions: [{ name: 'ADD', consequential: false }, { name: 'CLEAR', consequential: true }] },
      controls: [{ name: 'Add', element: 'button', listened: false }],
    })])
    expect(healthList(buildModel(g)).map(h => [h.group, h.items[0].title, h.items[0].sub])).toEqual([
      ['Controls nothing listens to', 'Add', 'Todos · <button>'],
      ['AI agent surface', 'todos (read)', 'Todos · 2 actions, CLEAR ask first'],
    ])
  })

  it('D528: emitterIds / selectorIds are full lists, not parallel to the names (one name, two emitter ids)', () => {
    const m = buildModel(G([
      comp('Page', 'src/Page.jsx', 1),
      comp('Summary', 'src/cart/Summary.jsx', 3),
      comp('Summary', 'src/checkout/Summary.jsx', 3),
      comp('Other', 'src/Other.jsx', 1),
    ], {
      NAVIGATE: { emitters: ['Summary'], selectors: ['Page'], emitterIds: ['src/cart/Summary.jsx:3', 'src/checkout/Summary.jsx:3'], selectorIds: ['src/Page.jsx:1'] },
      // an id list wins over the names; a missing list falls back to them
      ONLY_IDS: { emitters: ['Other'], selectors: ['Page'], emitterIds: ['src/Page.jsx:1'], selectorIds: ['src/Other.jsx:1'] },
      NAMES: { emitters: ['Other'], selectors: ['Page'] },
      MIXED: { emitters: ['Summary'], selectors: ['Page'], emitterIds: ['src/checkout/Summary.jsx:3'] },
    }))
    expect(m.eventEdges.map(e => `${e.type}: ${e.from} → ${e.to}`)).toEqual([
      'NAVIGATE: src/cart/Summary.jsx:3 → src/Page.jsx:1',
      'NAVIGATE: src/checkout/Summary.jsx:3 → src/Page.jsx:1',
      'ONLY_IDS: src/Page.jsx:1 → src/Other.jsx:1',
      'NAMES: src/Other.jsx:1 → src/Page.jsx:1',
      'MIXED: src/checkout/Summary.jsx:3 → src/Page.jsx:1',
    ])
  })

  it('PARENT edges from childSelects; package and widget ghosts stay out of "not scanned"', () => {
    const m = buildModel(G([
      comp('List', 'src/List.jsx', 1, {
        children: [{ name: 'Row', via: 'collection', id: 'src/Row.jsx:1' }, { name: 'Menu', via: 'tag', id: null, external: 'sygnal/ui/menu', widget: true }, { name: 'Stars', via: 'tag', id: null, widget: true }, { name: 'Lost', via: 'tag' }],
        childSelects: [{ child: 'Row', id: 'src/Row.jsx:1', actions: ['ROW_DELETE'], line: 9 }, { child: 'Lost', id: null, actions: ['X'] }],
      }),
      comp('Row', 'src/Row.jsx', 1, { actions: [{ name: 'DELETE', trigger: 'intent', sinks: ['PARENT'] }] }),
    ]))
    expect(m.parentEdges).toEqual([{ from: 'src/Row.jsx:1', to: 'src/List.jsx:1', actions: ['ROW_DELETE'], line: 9 }])
    expect(healthList(m).find(h => h.group === 'Rendered but not scanned').items.map(i => i.title)).toEqual(['Lost'])
    const l = layoutGraph(m)
    expect(edgePaths(m, l).filter(e => e.cls === 'parent')).toMatchObject([{ from: 'src/Row.jsx:1', to: 'src/List.jsx:1', label: 'ROW_DELETE', marker: 'ah-parent' }])
  })

  it('stable keys: the graph key, else file#name; ghosts by package or directory; byKey', () => {
    const m = buildModel(G([
      comp('P', 'src/a/P.jsx', 1, { children: [{ name: 'Toaster', via: 'tag', id: null, external: 'sygnal/ui' }, { name: 'Nope', via: 'tag' }] }),
      comp('Q', 'src/a/Q.jsx', 4, { key: 'custom-key' }),
    ]))
    expect(m.comps.map(c => c.key)).toEqual(['src/a/P.jsx#P', 'custom-key', 'ghost:sygnal/ui#Toaster', 'ghost:src/a#Nope'])
    expect(m.byKey.get('src/a/P.jsx#P')).toBe('src/a/P.jsx:1')
    // the same component after lines were added above it: a new id, the same key
    const shifted = shop()
    for (const c of shifted.components) c.id = c.id.replace(/:(\d+)$/, (_, n) => ':' + (Number(n) + 5))
    const before = buildModel(shop()), after = buildModel(shifted)
    expect(after.comps.map(c => c.key)).toEqual(before.comps.map(c => c.key))
    expect(after.comps.map(c => c.id)).not.toEqual(before.comps.map(c => c.id))
  })

  it('lineOf, searchText and missing lists', () => {
    expect(lineOf({ id: 'src/A.jsx:12' })).toBe(12)
    expect(lineOf({ id: 'src/A.jsx:12', line: 3 })).toBe(3)
    expect(lineOf({ id: 'runtime-7' })).toBe(null)
    const m = buildModel({ components: [{ name: 'Bare', id: 'x:1', file: 'x' }] })
    expect(m.comps[0].actions).toEqual([])
    expect(searchText(m.comps[0])).toBe('bare\nx')
    expect(buildModel({}).comps).toEqual([])
  })
})

describe('graphView layout', () => {
  const graphs = { shop: shop(), synthetic: synthetic(140), small: synthetic(12, 3) }
  for (const [name, g] of Object.entries(graphs)) {
    it(`${name}: every component placed, no two cards overlap, clusters don't overlap`, () => {
      const m = buildModel(g)
      const { pos, clusters } = layoutGraph(m)
      expect(pos.size).toBe(m.comps.length)
      const ps = m.comps.map(c => pos.get(c.id))
      for (const p of ps) { expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true); expect([p.w, p.h]).toEqual([NODE_W, NODE_H]) }
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(overlap(ps[i], ps[j]), `${m.comps[i].id} / ${m.comps[j].id}`).toBe(false)
      for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) expect(overlap(clusters[i], clusters[j])).toBe(false)
      // every card inside its cluster's box
      for (const c of m.comps) {
        const box = clusters.find(b => overlap(b, pos.get(c.id)))
        if (clusters.length) expect(box && pos.get(c.id).x >= box.x && pos.get(c.id).x + NODE_W <= box.x + box.w && pos.get(c.id).y + NODE_H <= box.y + box.h).toBeTruthy()
      }
    })
  }

  it('is deterministic: the same graph lays out the same, edges included', () => {
    const run = () => { const m = buildModel(synthetic(140)); const l = layoutGraph(m); return JSON.stringify([[...l.pos], l.clusters, edgePaths(m, l)]) }
    expect(run()).toBe(run())
  })

  it('a child sits below its parent (cycles and self-renders left out of the layering)', () => {
    const m = buildModel(synthetic(140))
    const { pos } = layoutGraph(m)
    const back = new Set(['src/b/C5.jsx:6>src/a/C0.jsx:1', 'src/b/C9.jsx:10>src/b/C9.jsx:10'])
    let below = 0, total = 0
    for (const e of m.renderEdges) {
      if (back.has(`${e.from}>${e.to}`)) continue
      total++
      if (pos.get(e.to).y > pos.get(e.from).y) below++
    }
    expect(below).toBe(total)
  })

  it('islands, clusters by directory, an island with an entry first', () => {
    const m = buildModel(shop())
    const l = layoutGraph(m)
    expect(l.islands.map(ids => ids.map(id => id.split('/').pop()))).toEqual([['App.jsx:7', 'Header.jsx:2', 'Cart.jsx:3', 'CartLine.jsx:2', 'ghost:src:Shop'], ['ProductCard.jsx:2']])
    expect(l.clusters).toEqual([]) // one directory: no boxes
    const g = shop()
    g.components[4].entry = true
    const l2 = layoutGraph(buildModel(g))
    expect(l2.pos.get('src/ProductCard.jsx:2').x).toBe(0)
    // one box per directory, the bigger ones first
    const m3 = buildModel(synthetic(40))
    const l3 = layoutGraph(m3)
    expect(l3.clusters.map(c => c.key).sort()).toEqual(['src/a', 'src/b', 'src/c', 'src/d/e'])
    const inBox = (b) => m3.comps.filter(c => overlap(b, l3.pos.get(c.id))).length
    const sizes = l3.clusters.map(inBox)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(m3.comps.length)
    expect(sizes).toEqual(sizes.slice().sort((a, b) => b - a))
  })

  it('edge routes: one per render / EVENTS / context edge, with markers and labels', () => {
    const m = buildModel(shop())
    const edges = edgePaths(m, layoutGraph(m))
    const count = (cls) => edges.filter(e => e.cls === cls).length
    expect([count('render'), count('switchable'), count('collection'), count('event'), count('context')]).toEqual([1, 2, 1, 3, 2])
    for (const e of edges) expect(e.d).toMatch(/^M-?[\d.]+,-?[\d.]+ C/)
    expect(edges.find(e => e.cls === 'collection')).toMatchObject({ label: '[cart]', marker: 'ah-coll' })
    expect(edges.find(e => e.cls === 'context' && e.to === 'src/CartLine.jsx:2')).toMatchObject({ fields: ['currency'], marker: 'ah-ctx' })
    expect(bbox(new Map(), [])).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 })
  })
})

describe('graphView mermaid', () => {
  it('flowchart TD: render edges labelled, EVENTS dotted, ghosts dashed', () => {
    expect(toMermaid(buildModel(shop()))).toMatchSnapshot()
  })
  it('events: false leaves out the EVENTS edges; labels are escaped', () => {
    const out = toMermaid(buildModel(shop()), { events: false })
    expect(out).not.toContain('-.->')
    expect(out).toContain('-->|"[cart]"|')
    expect(mermaidLabel('a "b" <c> #d')).toBe('"a #quot;b#quot; #lt;c#gt; #35;d"')
    expect(toMermaid(buildModel(G([comp('A', 'a.jsx', 1)])))).toBe('flowchart TD\n  n0["A"]\n')
  })
})

describe('graphView html', () => {
  it('inlineJson escapes <, U+2028 and U+2029 and round-trips', () => {
    const v = { s: '</script><!-- \u2028 \u2029 & >' }
    const out = inlineJson(v)
    expect(out).not.toMatch(/<|\u2028|\u2029/)
    expect(JSON.parse(out)).toEqual(v)
    expect(vm.runInNewContext(`(${out})`)).toEqual(v) // valid JavaScript too
  })

  it('a hostile name or message cannot end the data <script> or the page; the title is escaped', () => {
    const g = shop()
    g.components[1].name = '</script><script>alert(1)</script>'
    g.components[1].diagnostics.push({ code: 'SYG110', severity: 'warn', message: '<!-- \u2028 </SCRIPT>' })
    const html = graphHtml(g, { title: '<b>"x"</b>' })
    expect(html).not.toContain('alert(1)</script>')
    expect(html).not.toContain('</SCRIPT>')
    expect(html.match(/<\/script>/g)).toHaveLength(3) // the two data elements and the code
    expect(html).toContain('<title>&lt;b&gt;&quot;x&quot;&lt;/b&gt; · Sygnal app graph</title>')
    const data = html.match(/<script type="application\/json" id="graph-data">([^]*?)<\/script>/)[1]
    expect(JSON.parse(data).components[1].name).toBe('</script><script>alert(1)</script>')
  })

  it('one file: CSS, code and data inline, a no-network CSP, nothing loaded from anywhere', () => {
    const html = graphHtml(shop(), { title: 'shop', root: 'C:\\proj', editor: 'cursor' })
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'`)
    expect(html).not.toMatch(/<(script|link|img|iframe)[^>]+(src|href)=/i)
    expect(html).not.toMatch(/https?:\/\/(?!sygnal\.js\.org|www\.w3\.org)/) // only the SVG namespace and docs links
    const meta = JSON.parse(html.match(/id="graph-meta">([^]*?)<\/script>/)[1])
    expect(meta).toMatchObject({ title: 'shop', root: 'C:/proj', editor: 'cursor', codes: {} })
    const code = html.match(/<script>\n([^]*?)<\/script>/)[1]
    expect(() => new vm.Script(code)).not.toThrow()
  })

  it('code titles: only the codes in the graph, from explanations.json', () => {
    const g = shop()
    g.components[0].diagnostics.push({ code: 'SYG102', severity: 'warn', message: 'x' })
    g.diagnostics.push({ code: 'SYG105', severity: 'warn', message: 'y' })
    const meta = JSON.parse(graphHtml(g).match(/id="graph-meta">([^]*?)<\/script>/)[1])
    const titles = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(pkgRoot, 'explanations.json'), 'utf8')).map(e => [e.code, e.title]))
    expect(meta.codes).toEqual({ SYG102: titles.SYG102, SYG105: titles.SYG105 })
  })

  it('inlined modules export exactly what the ES modules export, and work the same', () => {
    const V = {}
    for (const f of ['model.js', 'layout.js', 'mermaid.js']) vm.runInNewContext(inlineModule(fs.readFileSync(path.join(srcDir, f), 'utf8'), f), { V })
    expect(Object.keys(V).sort()).toEqual([...Object.keys(modelExports), ...Object.keys(layoutExports), ...Object.keys(mermaidExports)].sort())
    const m = V.buildModel(shop())
    expect(V.toMermaid(m)).toBe(toMermaid(buildModel(shop())))
    expect(JSON.stringify([...V.layoutGraph(m).pos])).toBe(JSON.stringify([...layoutGraph(buildModel(shop())).pos]))
  })

  it('inlineModule refuses what would not survive inlining', () => {
    expect(() => inlineModule("import x from 'y'\nexport const a = 1")).toThrow(/can't import/)
    expect(() => inlineModule('export default 1')).toThrow(/declarations/)
    expect(() => inlineModule('const a = 1\nexport { a }')).toThrow(/declarations/)
    expect(() => inlineModule("export const a = '</script>'")).toThrow(/<\/script/)
    expect(() => inlineModule("export const a = '<!--'")).toThrow(/<!--/)
    expect(() => vm.runInNewContext(inlineModule('export const a = 1', 'x') + inlineModule('export const a = 2', 'y'), { V: {} })).toThrow(/exported twice/)
  })
})

describe('graphView page.css contrast (WCAG AA, both themes)', () => {
  const css = fs.readFileSync(path.join(srcDir, 'page.css'), 'utf8')
  const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]))
  const light = tokens(css.match(/^:root \{([^}]*)\}/m)[1])
  const darkBlock = css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)[1]
  const dark = { ...light, ...tokens(darkBlock) }
  const media = tokens(css.match(/:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/)[1])
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  // [text, surfaces] pairs as the page uses them
  const text = [
    ['ink', ['bg', 'panel', 'card', 'chip']], ['muted', ['bg', 'panel', 'card', 'chip']], ['accent', ['panel', 'accent-soft']],
    ['ev', ['bg', 'panel', 'card']], ['ctx', ['bg', 'panel']], ['err', ['panel', 'err-soft']], ['warn', ['panel', 'bg', 'warn-soft']],
    ['ok', ['panel']], ['info', ['panel']], ['par', ['bg', 'panel']], ['ink', ['err-soft', 'warn-soft']],
  ]
  const onKind = ['k-root', 'k-child', 'k-coll', 'k-switch', 'k-ghost', 'err', 'warn']
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    it(`${name}: text tokens reach 4.5:1 on their surfaces`, () => {
      const bad = []
      for (const [fg, bgs] of text) for (const bg of bgs) if (ratio(t[fg], t[bg]) < 4.5) bad.push(`${fg} on ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`)
      for (const bg of onKind) if (ratio(t['on-kind'], t[bg]) < 4.5) bad.push(`on-kind on ${bg}: ${ratio(t['on-kind'], t[bg]).toFixed(2)}`)
      for (const s of ['STATE', 'EVENTS', 'EFFECT', 'PARENT', 'HTTP', 'ELEMENT', 'LLM', 'DOM', 'other']) if (ratio('#ffffff', t['s-' + s]) < 4.5) bad.push(`white on s-${s}`)
      expect(bad).toEqual([])
    })
  }
  it('the prefers-color-scheme block and [data-theme="dark"] define the same dark tokens', () => {
    expect(media).toEqual(tokens(darkBlock))
  })
  it('honours prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^]*transition: none !important/)
  })
})

describe('cli --graph=html|mermaid', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-graph-test-'))
  function run(args, extra = {}) {
    let out = '', err = ''
    const opened = []
    const code = main(args, {
      cwd: pkgRoot, env: {}, isTTY: true, openFile: (f) => opened.push(f), tmpdir: extra.tmpdir ?? tmp(),
      stdout: { write: (s) => { out += s } }, stderr: { write: (s) => { err += s } }, ...extra,
    })
    return { code, out, err, opened }
  }
  const fixture = 'test/fixtures/good/todo-app.jsx'

  it('--graph=html writes <tmpdir>/sygnal-graph-<project>.html, prints the path and opens it', () => {
    const dir = tmp()
    const r = run([fixture, '--graph=html'], { tmpdir: dir })
    const file = path.join(dir, 'sygnal-graph-sygnal-check.html')
    expect(r.code).toBe(0)
    expect(r.out).toBe('')
    expect(r.err).toMatch(new RegExp(`^sygnal-check: wrote ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+ KB, \\d+ components?\\)\\n$`))
    expect(r.opened).toEqual([file])
    const html = fs.readFileSync(file, 'utf8')
    const meta = JSON.parse(html.match(/id="graph-meta">([^]*?)<\/script>/)[1])
    expect(meta).toMatchObject({ title: 'sygnal-check', root: pkgRoot.replace(/\\/g, '/') })
    expect(meta.editor).toBeUndefined()
    expect(JSON.parse(html.match(/id="graph-data">([^]*?)<\/script>/)[1]).components.map(c => c.name)).toContain('App')
  })

  it('never opens under CI, without a terminal, or with --no-open', () => {
    expect(run([fixture, '--graph=html'], { env: { CI: 'true' } }).opened).toEqual([])
    expect(run([fixture, '--graph=html'], { isTTY: false }).opened).toEqual([])
    expect(run([fixture, '--graph=html'], { isTTY: undefined, stdout: { write() {} } }).opened).toEqual([])
    expect(run([fixture, '--graph=html', '--no-open']).opened).toEqual([])
  })

  it('--out writes there and opens only with --open (and never under CI)', () => {
    const dir = tmp()
    const out = path.join(dir, 'g.html')
    const r = run([fixture, '--graph=html', '--out', out])
    expect(r.opened).toEqual([])
    expect(fs.readFileSync(out, 'utf8')).toMatch(/^<!doctype html>/)
    expect(run([fixture, '--graph=html', `--out=${out}`, '--open']).opened).toEqual([out])
    const ci = run([fixture, '--graph=html', '--out', out, '--open'], { env: { CI: '1' } })
    expect(ci.opened).toEqual([])
    expect(ci.err).toContain('not opening it: CI is set')
    expect(run([fixture, '--graph=html', '--out', path.join(dir, 'no/such/dir/g.html')]).code).toBe(2)
  })

  it('--editor sets the page default', () => {
    const dir = tmp()
    run([fixture, '--graph=html', '--editor', 'cursor', '--out', path.join(dir, 'e.html')])
    expect(fs.readFileSync(path.join(dir, 'e.html'), 'utf8')).toContain('"editor":"cursor"')
  })

  it('--graph=mermaid prints the same flowchart as the page; --events=false drops EVENTS; --out writes it', () => {
    const g = graph([fixture], { cwd: pkgRoot })
    const r = run([fixture, '--graph=mermaid'])
    expect(r.code).toBe(0)
    expect(r.out).toBe(toMermaid(buildModel(g)))
    expect(r.out).toMatch(/^flowchart TD\n/)
    expect(r.opened).toEqual([])
    expect(run([fixture, '--graph=mermaid', '--events=false']).out).toBe(toMermaid(buildModel(g), { events: false }))
    const dir = tmp()
    expect(run([fixture, '--graph=mermaid', '--out', path.join(dir, 'g.mmd')]).out).toBe('')
    expect(fs.readFileSync(path.join(dir, 'g.mmd'), 'utf8')).toBe(r.out)
  })

  it('bare --graph stays text, --graph --json and --graph=json print JSON, --graph=text the text', () => {
    const text = run([fixture, '--graph']).out
    expect(text).toMatch(/^App {2}test\/fixtures\/good\/todo-app\.jsx:49 {2}root$/m)
    expect(run([fixture, '--graph=text']).out).toBe(text)
    const json = run([fixture, '--graph', '--json']).out
    expect(JSON.parse(json).version).toBe(1)
    expect(run([fixture, '--graph=json']).out).toBe(json)
    expect(run([fixture, '--graph=json', '--json']).out).toBe(json)
  })

  it('rejects bad combinations', () => {
    for (const args of [
      ['--graph=svg'], ['--graph=html', '--json'], ['--graph=mermaid', '--json'], ['--open'], ['--no-open'], ['--graph=mermaid', '--open'],
      ['--out', 'x.html'], ['--graph=html', '--out'], ['--graph=html', '--editor', 'emacs'], ['--graph', '--editor', 'vscode'],
      ['--graph=html', '--events=false'], ['--graph=html', '--fix'],
    ]) {
      const r = run([fixture, ...args])
      expect(r.code, args.join(' ')).toBe(2)
      expect(r.opened).toEqual([])
    }
  })

  it('projectName (G-802): the nearest package.json from the scanned folder up to cwd, else the folder name; fileSafe', () => {
    expect(projectName(pkgRoot)).toBe('sygnal-check')
    // scanned below cwd: walks up to cwd's package.json
    expect(projectName(pkgRoot, ['test/fixtures/good'])).toBe('sygnal-check')
    expect(projectName(pkgRoot, ['test/fixtures/good/todo-app.jsx'])).toBe('sygnal-check')
    // never above cwd: a folder with no package.json is named after itself
    expect(projectName(path.join(pkgRoot, 'test/fixtures/good'))).toBe('good')
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'package.json'), '{}')
    expect(projectName(dir)).toBe(path.basename(dir))
    fs.mkdirSync(path.join(dir, 'apps/shop/src'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'apps/shop/package.json'), '{"name":"@acme/shop"}')
    expect(projectName(dir, ['apps/shop/src'])).toBe('@acme/shop')
    fs.mkdirSync(path.join(dir, 'apps/admin/src'), { recursive: true })
    expect(projectName(dir, ['apps/admin/src'])).toBe(path.basename(dir)) // up to cwd's (no name: its folder)
    expect(projectName(dir, ['apps/shop/src', 'apps/admin/src'])).toBe(path.basename(dir)) // their common folder: apps → cwd
    const outside = tmp()
    expect(projectName(dir, [outside])).toBe(path.basename(outside))
    expect(fileSafe('@scope/my app')).toBe('scope-my-app')
    expect(fileSafe('../..')).toBe('app')
  })
})
