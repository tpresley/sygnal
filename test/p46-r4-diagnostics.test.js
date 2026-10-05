// @vitest-environment jsdom
// PLAN-4.6 R4: the next core's own dev diagnostics in 'sygnal/diagnostics' (checks/next.ts):
// SYG423 (D168 context-tracking safety net), SYG424 (D169/D177 duplicate ids: parity/collection),
// SYG425 (D174 kept slice without initialState's keys), SYG612 (D173 removed forms). Next core
// only: the current core has none of these situations (it re-renders on every context change,
// overwrites the slice, and still runs the removed forms).
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import '../src/extra/diagnostics/checks/index.js'
import { run, createElement as h, Collection, xs, component } from '../src/index.js'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.js'
import { resetChecks } from '../src/extra/diagnostics/checks/index.js'

const NEXT = process.env.SYGNAL_CORE == 'next'
const d = NEXT ? describe : describe.skip
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let apps = []
beforeEach(() => { clearDiagnostics(); resetChecks() })
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = ''; configureDiagnostics({ mode: undefined }) })
const start = (App) => {
  document.body.innerHTML = '<div id="root"></div>'
  const a = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
  apps.push(a)
  return a
}
const codes = (c) => getDiagnostics().filter((x) => x.code === c)
const click = (sel) => document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true }))

d('SYG423: a view context tracking skipped would render differently (D168)', () => {
  function make(read) {
    // (its own state: only the context changes for it)
    function Child({ context }) { return h('i', { className: 'c' }, String(read(context))) }
    Child.isolatedState = true
    Child.initialState = { mine: 1 }
    function App({ state }) { return h('div', null, h('button', null, 'x'), h(Child)) }
    App.initialState = { theme: 'light', other: 0 }
    App.context = { theme: (s) => s.theme, other: (s) => s.other }
    App.intent = ({ DOM }) => ({ T: DOM.click('button') })
    App.model = { T: (s) => ({ ...s, theme: 'dark' }) }
    return App
  }
  it('an untracked read (reflection) is reported, naming the changed key', async () => {
    start(make((c) => Object.getOwnPropertyDescriptor(c, 'theme')?.value))
    await sleep(20)
    click('button'); await sleep(30)
    const [x] = codes('SYG423')
    expect(x?.severity).toBe('warn')
    expect(x.message).toContain("'theme'")
  })
  it('a tracked read re-renders and is not reported', async () => {
    start(make((c) => c.theme))
    await sleep(20)
    click('button'); await sleep(30)
    expect(document.querySelector('.c').textContent).toBe('dark')
    expect(codes('SYG423')).toEqual([])
  })
})

d('SYG425: an isolatedState child keeps a slice that lacks its initialState keys (D174)', () => {
  it('names the missing keys and suggests resetState', async () => {
    function Panel({ state }) { return h('p', null, JSON.stringify(state)) }
    Panel.isolatedState = true
    Panel.initialState = { open: false, size: 1 }
    function App() { return h('div', null, h(Panel, { state: 'panel' })) }
    App.initialState = { panel: { open: true } }
    start(App)
    await sleep(20)
    const [x] = codes('SYG425')
    expect(x?.severity).toBe('warn')
    expect(x.message).toContain("'size'")
    expect(x.fix).toContain('resetState')
    expect(x.data.missing).toEqual(['size'])
  })
  it('nothing when the slice has every key, or with resetState', async () => {
    function Panel({ state }) { return h('p', null, JSON.stringify(state)) }
    Panel.isolatedState = true
    Panel.initialState = { open: false }
    function App() { return h('div', null, h(Panel, { state: 'a' }), h(Panel, { state: 'b', resetState: true })) }
    App.initialState = { a: { open: true }, b: { x: 1 } }
    start(App)
    await sleep(20)
    expect(codes('SYG425')).toEqual([])
  })
})

d('SYG612: a form 6.0 removed, met at runtime (D173), once each, with the migration guide anchor', () => {
  const forms = () => codes('SYG612').map((x) => x.data.form).sort()
  it('statics, positional views and pipe keys', async () => {
    function Badge() { return h('b', null, 'ok') }
    function Old(props, state) { return h('div', null, 'x', h('Badge')) }
    Old.components = { Badge }
    Old.peers = { Side: Badge }
    Old.hmrActions = ['X']
    Old.storeCalculatedInState = false
    Old.DOMSourceName = 'DOM2'
    Old.initialState = {}
    Old.model = { 'GO | EFFECT': () => {} }
    start(Old)
    await sleep(20)
    expect(forms()).toEqual(['components', 'hmractions', 'peers', 'pipe-keys', 'positional-views', 'source-names', 'storecalculatedinstate', 'string-tags'])
    const [x] = codes('SYG612')
    expect(x.severity).toBe('error')
    expect(x.fix).toMatch(/https:\/\/sygnal\.js\.org\/guide\/migrating-to-6#/)
  })
  it("CHILD.select('Name') and <Collection of=\"Name\">", async () => {
    function Item() { return h('li', null, 'i') }
    function App() { return h('div', null, h(Collection, { of: 'Item', from: 'rows' })) }
    App.initialState = { rows: [{ id: 1 }] }
    App.intent = ({ CHILD }) => ({ GOT: CHILD.select('Item') })
    App.model = { GOT: (s) => s }
    start(App)
    await sleep(20)
    expect(forms()).toEqual(['child-select-name', 'collection-of-name'])
  })
  it('the component() factory as the root', async () => {
    const App = component({ name: 'Fac', view: () => h('div', null, 'f'), initialState: {} })
    start(App)
    await sleep(20)
    expect(forms()).toContain('component-factory')
  })
})
