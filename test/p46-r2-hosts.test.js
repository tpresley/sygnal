// @vitest-environment jsdom
// PLAN-4.6 R2: the core's hosts and markers, through run() with the internal options (hooks,
// the runtime API); the public behaviour is in
// test/parity/ (collection, switchable, suspense-lazy, reset-state).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { run, createElement as h, xs, Collection, Switchable, Portal, Transition, Suspense, lazy } from '../src/index.js'
import { Fragment } from '../src/cycle/dom/snabbdom.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let apps = []
afterEach(() => { apps.forEach((a) => a.dispose()); apps = []; document.body.innerHTML = ''; vi.restoreAllMocks() })
function mount(App, drivers = {}, options = {}) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  const app = run(App, drivers, { mountPoint: '#root', ...options })
  apps.push(app)
  return { app, el, rt: app.__runtime, text: (s) => el.querySelector(s)?.textContent, $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)] }
}
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('PLAN-4.6 R2 next core: hosts', () => {
  it("the Collection's DOM is today's: one div with the marker's props as element properties", async () => {
    function Item({ state }) { return h('li', null, state.t) }
    function App() { return h('ul', null, h(Collection, { of: Item, from: 'rows', className: 'list', extra: 5 })) }
    App.initialState = { rows: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] }
    const m = mount(App)
    await m.rt.flushed()
    const d = m.$('ul > div.list')
    expect(d.children.length).toBe(2)
    expect(d.extra).toBe(5)
    expect(d.key).toBe('collection::r.0')
  })

  it('InstanceViews: items and pages are children of their owner (kind, shown, uid); byId finds them', async () => {
    function Item({ state }) { return h('li', null, state.t) }
    function A() { return h('p', null, 'a') }
    function B() { return h('p', null, 'b') }
    function App() { return h('div', null, h(Collection, { of: Item, from: 'rows' }), h(Switchable, { of: { a: A, b: B }, current: 'a' })) }
    App.initialState = { rows: [{ id: 'x', t: 'a' }, { t: 'b' }] }
    const m = mount(App)
    await m.rt.flushed()
    const kids = m.rt.root.children()
    expect(kids.map((k) => [k.name, k.kind, k.shown, k.uid])).toEqual([
      ['Item', 'item', true, 'u-0-x'], ['Item', 'item', true, 'u-0-_i1'], // G-322: an index key is _i<n>
      ['A', 'page', true, 'u-1-a'], ['B', 'page', false, 'u-1-b'],
    ])
    expect(m.rt.get(kids[3].id).name).toBe('B')
  })

  it('D169: a duplicate key renders its first element and calls onDuplicateKey (R4 warns from it)', async () => {
    const dups = []
    function Item({ state }) { return h('li', null, state.t) }
    function App() { return h('ul', null, h(Collection, { of: Item, from: 'rows' })) }
    App.initialState = { rows: [{ id: 7, t: 'a' }, { id: 7, t: 'b' }, { id: 8, t: 'c' }] }
    const m = mount(App, {}, { __hooks: { onDuplicateKey: (o, k) => dups.push([o.name, k]) } })
    await m.rt.flushed()
    expect(m.$$('li').map((e) => e.textContent)).toEqual(['a', 'c'])
    expect(dups).toEqual([['App', 7]])
  })

  it('D174: onStateSeed reports an isolated child bound to an existing slice (R4 warns from it)', async () => {
    const seen = []
    function Ed({ state }) { return h('p', null, state.title) }
    Ed.isolatedState = true
    Ed.initialState = { title: 'new', body: '' }
    Ed.model = { X: (s) => s }
    function App() { return h('div', null, h(Ed, { state: 'doc' }), h(Ed, { state: 'other' })) }
    App.initialState = { doc: { title: 'kept' } }
    const m = mount(App, {}, { __hooks: { onStateSeed: (i, slice, init) => seen.push([i.name, slice, init]) } })
    await m.rt.flushed()
    expect(seen).toEqual([['Ed', { title: 'kept' }, { title: 'new', body: '' }]])
    expect(m.rt.getState()).toEqual({ doc: { title: 'kept' }, other: { title: 'new', body: '' } })
  })

  it('a host whose props are invalid renders the owner error fallback (SYG411 / SYG415)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function App() { return h('div', null, h(Collection, { from: 'rows' }), h(Switchable, { of: 3, current: 'a' })) }
    App.initialState = { rows: [] }
    const m = mount(App)
    await m.rt.flushed()
    expect(m.$$('[data-sygnal-error]').length).toBe(2)
    expect(console.error.mock.calls.some((c) => String(c[0]).includes('SYG411'))).toBe(true)
    expect(console.error.mock.calls.some((c) => String(c[0]).includes('SYG415'))).toBe(true)
  })
})

describe('PLAN-4.6 R2 next core: markers', () => {
  it('lazy: the owner renders again when the import resolves, with no state write', async () => {
    let resolve
    const LazyKid = lazy(() => new Promise((r) => { resolve = r }))
    function Kid() { return h('b', { className: 'kid' }, 'loaded') }
    function App({ state }) { return h('div', null, h(LazyKid, {}), String(state.n)) }
    App.initialState = { n: 0 }
    const m = mount(App)
    const states = []
    m.app.sources.STATE.stream.addListener({ next: (s) => states.push(s) })
    await m.rt.flushed()
    expect(m.$('[data-sygnal-lazy="loading"]')).toBeTruthy()
    resolve({ default: Kid })
    await vi.waitFor(() => expect(m.text('.kid')).toBe('loaded'))
    expect(states).toEqual([{ n: 0 }])
  })

  it('markers inside fragments (G-256), Suspense in a fragment, a Transition with only text', async () => {
    const target = document.createElement('div')
    target.id = 'tgt'
    document.body.appendChild(target)
    function NR() { return h('i', { className: 'nr' }, 'x') }
    NR.isolatedState = true
    NR.initialState = {}
    NR.model = { BOOTSTRAP: { READY: () => false } }
    function App() {
      return h('div', null, h(Fragment, null,
        h(Portal, { target: '#tgt' }, h('p', { className: 'ported' }, 'p')),
        h(Transition, { name: 'f' }, 'just text'),
        h(Suspense, { fallback: 'wait' }, h(NR))))
    }
    App.initialState = {}
    const m = mount(App)
    await vi.waitFor(() => expect(target.querySelector('.ported')).toBeTruthy())
    await vi.waitFor(() => expect(m.$('[data-sygnal-suspense="pending"]')?.textContent).toBe('wait'))
    expect(m.el.querySelector('portal, transition, suspense')).toBe(null)
    expect(m.el.textContent).toContain('just text')
  })
})
