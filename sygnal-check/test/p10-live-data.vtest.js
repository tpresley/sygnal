// PLAN-10 W-2 / P-2 (D543, D544): what sygnal/vite's graph route takes from sygnal-check: the live
// build's diagnostics and component stamps (live.js, graph.js componentStamps), the page's "Live
// data" overlay (graphView/liveData.js overlayRuntime) and graphHtml's `appData`.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLiveProject } from '../src/live.js'
import { check, componentStamps, buildProject, buildGraph, graphHtml as graphHtmlFromIndex } from '../src/index.js'
import { overlayRuntime } from '../src/graphView/liveData.js'
import { graphHtml } from '../src/graphView/html.js'
import { rtDetailHtml } from '../src/graphView/runtime.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHOP = path.join(HERE, 'fixtures', 'graph-shop')
const KANBAN = path.resolve(HERE, '..', '..', 'examples', 'kanban')

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })
function project(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-live-data-')))
  dirs.push(root)
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"app","type":"module"}')
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), text)
  }
  return root
}

/** binding → key per file name, from a live build with stamps */
function stampsOf(root) {
  const b = createLiveProject({ root }).build({ settings: { paths: ['src'] }, stamps: true })
  const out = {}
  for (const [file, list] of b.stamps) out[path.relative(root, file)] = list
  return { build: b, stamps: out }
}

describe('live build: diagnostics and stamps (W-2, P-2)', () => {
  it("gives check()'s diagnostics for the same files, so the overlay and the page come from one build", () => {
    const root = project({
      'src/App.jsx': `function App() { return <button className="x">hi</button> }
App.intent = ({ DOM }) => ({ ORPHAN: DOM.click('.x') })
App.model = {}
export default App
`,
    })
    const b = createLiveProject({ root }).build({ settings: { paths: ['src'], defaults: { ignore: [] } } })
    const plain = check(['src'], { cwd: root })
    expect(b.diagnostics.map(d => `${d.file}:${d.line} ${d.code}`)).toEqual(plain.map(d => `${d.file}:${d.line} ${d.code}`))
    expect(b.diagnostics.map(d => d.code)).toContain('SYG101')
    expect(b.stamps).toBeNull()
    // defaults sit below explicit settings and the config file, as check()'s
    const quiet = createLiveProject({ root }).build({ settings: { paths: ['src'], defaults: { ignore: ['SYG101'] } } })
    expect(quiet.diagnostics.map(d => d.code)).not.toContain('SYG101')
  })

  it("stamps every top-level component of the graph-shop fixture with the graph's own key", () => {
    const { build, stamps } = stampsOf(SHOP)
    const keys = build.graph.components.map(c => c.key).sort()
    const stamped = Object.values(stamps).flat().map(s => s.key).sort()
    expect(stamped).toEqual(keys)
    expect(stamps[path.join('src', 'App.jsx')]).toEqual([
      { binding: 'App', key: 'src/App.jsx#App' },
      { binding: 'Greeting', key: 'src/App.jsx#Greeting' },
      { binding: 'Shop', key: 'src/App.jsx#Shop' },
    ])
    // two Summary components in two directories: one key each
    expect(stamps[path.join('src', 'cart', 'Summary.jsx')]).toEqual([{ binding: 'Summary', key: 'src/cart/Summary.jsx#Summary' }])
    expect(stamps[path.join('src', 'checkout', 'Summary.jsx')]).toEqual([{ binding: 'Summary', key: 'src/checkout/Summary.jsx#Summary' }])
  })

  it('stamps kanban the same way', () => {
    const { build, stamps } = stampsOf(KANBAN)
    expect(Object.values(stamps).flat().map(s => s.key).sort()).toEqual(build.graph.components.map(c => c.key).sort())
    expect(Object.values(stamps).flat().map(s => s.binding).sort()).toEqual(['LaneComponent', 'RootComponent', 'TaskCard'])
  })

  it("D521's '#2' rule: the top-level binding gets its own key, a nested component of the same name none", () => {
    const root = project({
      'src/Item.jsx': `export function makeItem() {
  function Item() { return <i>nested</i> }
  Item.initialState = { a: 1 }
  return Item
}
export const Item = () => <b>top</b>
Item.initialState = { b: 1 }
export default function Page() { return <Item /> }
Page.initialState = {}
`,
    })
    const { build, stamps } = stampsOf(root)
    const keys = build.graph.components.map(c => c.key)
    expect(keys).toEqual(expect.arrayContaining(['src/Item.jsx#Item', 'src/Item.jsx#Item#2', 'src/Item.jsx#Page']))
    // the nested Item comes first in the source: it keeps 'file#name', the top-level one is '#2'
    expect(stamps['src/Item.jsx']).toEqual([
      { binding: 'Item', key: 'src/Item.jsx#Item#2' },
      { binding: 'Page', key: 'src/Item.jsx#Page' },
    ])
  })

  it('leaves out an anonymous default export (the page joins it by name)', () => {
    const root = project({
      'src/main.js': "import { run } from 'sygnal'\nimport App from './App.jsx'\nrun(App)\n",
      'src/App.jsx': 'export default function () { return <div /> }\n',
    })
    const project_ = buildProject([path.join(root, 'src', 'App.jsx'), path.join(root, 'src', 'main.js')], { cwd: root })
    const graph = buildGraph(project_)
    expect(graph.components.map(c => c.key)).toEqual(['src/App.jsx#App'])
    expect([...componentStamps(project_).values()].flat()).toEqual([])
  })

  it('the package exports graphHtml and componentStamps', () => {
    expect(graphHtmlFromIndex).toBe(graphHtml)
    expect(typeof componentStamps).toBe('function')
  })
})

// a static graph and a runtime inspect() as the dev server's app tab sends it
const STATIC = {
  version: 1, source: 'static',
  components: [
    { name: 'App', id: 'src/App.jsx:1', key: 'src/App.jsx#App', file: 'src/App.jsx', kind: 'root', actions: [{ name: 'ADD', trigger: 'intent', sinks: ['STATE'] }], stateKeys: ['items'], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [{ name: 'Item', via: 'collection', id: 'src/Item.jsx:1' }], selectors: [], diagnostics: [] },
    { name: 'Item', id: 'src/Item.jsx:1', key: 'src/Item.jsx#Item', file: 'src/Item.jsx', kind: 'collection-item', actions: [{ name: 'TOGGLE', trigger: 'intent', sinks: ['STATE'] }], stateKeys: ['done'], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [] },
    { name: 'Summary', id: 'src/a/Summary.jsx:1', key: 'src/a/Summary.jsx#Summary', file: 'src/a/Summary.jsx', kind: 'child', actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [] },
    { name: 'Summary', id: 'src/b/Summary.jsx:1', key: 'src/b/Summary.jsx#Summary', file: 'src/b/Summary.jsx', kind: 'child', actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [] },
    { name: 'Settings', id: 'src/Settings.jsx:1', key: 'src/Settings.jsx#Settings', file: 'src/Settings.jsx', kind: 'switchable', actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [] },
  ],
  events: {}, diagnostics: [],
}
const inst = (id, name, extra = {}) => ({ name, id: String(id), parentId: null, kind: 'child', actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [], ...extra })
const RUNTIME = {
  version: 1, source: 'runtime',
  components: [
    inst(1, 'App', { key: 'src/App.jsx#App', kind: 'root', entry: true, app: 0, stateKeys: ['items'] }),
    inst(2, 'Item', { key: 'src/Item.jsx#Item', parentId: '1', kind: 'collection-item', app: 0, stateKeys: ['done'] }),
    inst(3, 'Item', { key: 'src/Item.jsx#Item', parentId: '1', kind: 'collection-item', app: 0, shown: false }),
    inst(4, 'Summary', { key: 'src/b/Summary.jsx#Summary', parentId: '1', app: 0 }),
    inst(5, 'Summary', { parentId: '1', app: 0 }), // no stamp: two static Summaries, ambiguous
    inst(6, 'Settings', { parentId: '1', app: 0 }), // no stamp: one static Settings, joined by name
    inst(7, 'Toast', { key: 'node_modules/ui/Toast.jsx#Toast', parentId: '1', app: 0 }), // not scanned
  ],
  events: {}, diagnostics: [],
  recentActions: [
    { type: 'ADD', component: 'App', instance: '1', sinks: ['STATE'], cause: 'intent', at: 1 },
    { type: 'TOGGLE', component: 'Item', instance: '2', sinks: ['STATE'], cause: 'intent', at: 2 },
    { type: 'TOGGLE', component: 'Item', instance: '3', sinks: ['STATE'], cause: 'intent', at: 3 },
    { type: 'ADD', component: 'App', instance: '1', sinks: ['STATE'], cause: 'intent', at: 4 },
  ],
}

describe('overlayRuntime (P-2): runtime data on the static cards', () => {
  const g = overlayRuntime(STATIC, RUNTIME)
  const card = (key) => g.components.find(c => c.key === key)

  it('joins instances by stamped key: ×N, the instances, the recent action counts', () => {
    expect(g.source).toBe('static')
    expect(card('src/App.jsx#App').rt).toMatchObject({ count: 1, recent: { ADD: 2 }, instances: [{ id: '1', stateKeys: ['items'], app: 0 }] })
    const item = card('src/Item.jsx#Item')
    expect(item.rt.count).toBe(2)
    expect(item.rt.recent).toEqual({ TOGGLE: 2 })
    expect(item.rt.instances.map(i => i.id)).toEqual(['2', '3'])
    expect(item.rt.raw.map(i => i.id)).toEqual(['2', '3'])
    // one shown instance: the card isn't hidden
    expect(item.shown).toBeUndefined()
    // the static fields stay: file, line-based id, actions
    expect(item).toMatchObject({ id: 'src/Item.jsx:1', file: 'src/Item.jsx', actions: [{ name: 'TOGGLE' }] })
  })

  it('a key tells two components of one name apart; without a key one name joins, two are ambiguous', () => {
    expect(card('src/b/Summary.jsx#Summary').rt.count).toBe(1)
    expect(card('src/a/Summary.jsx#Summary').mounted).toBe(false)
    expect(card('src/Settings.jsx#Settings').rt.instances.map(i => i.id)).toEqual(['6'])
    expect(g.liveData).toEqual({ instances: 7, matched: 5, unmatched: ['Toast'], ambiguous: ['Summary'] })
  })

  it('rtCardOf maps instances to static card ids (flashes, state)', () => {
    expect(g.rtCardOf).toEqual({ 1: 'src/App.jsx:1', 2: 'src/Item.jsx:1', 3: 'src/Item.jsx:1', 4: 'src/b/Summary.jsx:1', 6: 'src/Settings.jsx:1' })
  })

  it('no instance: mounted false; every instance hidden: shown false', () => {
    const hidden = overlayRuntime(STATIC, { ...RUNTIME, components: RUNTIME.components.filter(c => c.id !== '2') })
    expect(hidden.components.find(c => c.key === 'src/Item.jsx#Item').shown).toBe(false)
    const none = overlayRuntime(STATIC, { version: 1, source: 'runtime', components: [], events: {}, diagnostics: [] })
    expect(none.components.every(c => c.mounted === false && !c.rt)).toBe(true)
    // the input graphs are not changed
    expect(STATIC.components.some(c => 'rt' in c || 'mounted' in c)).toBe(false)
  })

  it("runtime.js's detail panel renders a joined card (instances, recent actions)", () => {
    const html = rtDetailHtml(card('src/Item.jsx#Item'), { esc: String, btnChip: (t) => `<b>${t}</b>`, states: { 2: { done: true } }, canFetch: true })
    expect(html).toContain('TOGGLE ×2')
    expect(html).toContain('"done": true')
    expect(html).toContain('data-inst="3"')
  })
})

describe('graphHtml appData (P-2)', () => {
  it('inlines liveData.js and mounts it only when meta.appData is set', () => {
    const plain = graphHtml(STATIC, { live: { events: '/__sygnal/graph/events', version: 1 } })
    expect(plain).not.toContain('// ── liveData.js ──')
    const html = graphHtml(STATIC, { live: { events: '/__sygnal/graph/events', version: 1 }, appData: { channel: 'sygnal:graph' } })
    expect(html).toContain('// ── liveData.js ──')
    expect(html).toContain("if (META.appData && V.mountLiveData) V.mountLiveData(V, api, read('graph-data'), META)")
    expect(html).toContain('"appData":{"channel":"sygnal:graph"}')
    // still one self-contained file: no external script or stylesheet
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet/)
  })
})
