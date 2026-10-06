// @vitest-environment jsdom
// PLAN-5 4-I: the review of 4-H (Collection without a wrapper div, D229). A Collection renders a
// keyed fragment now, so the places that looked for an element where the wrapper was must look
// through fragments: Suspense's not-ready probe (G-556), READY: false on a component whose root
// is a Collection (G-557), the mock DOM's scoping of a fragment root (G-558), and Transition around
// a Collection (G-559: applied to each item; no false SYG612). The reviewer's probes (r4h new.probe
// P1b, new4.probe P9, new5.probe P10, new3.probe P8) are the cases below.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, renderToString, Collection, Suspense, Transition, lazy } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Fragment } from '../src/cycle/dom/fragment.ts'
import { useFreshDiagnostics } from './review-2e2/helpers.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let apps = []
beforeEach(() => { vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1)) })
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''; vi.unstubAllGlobals() })
function mount(App) {
  document.body.innerHTML = '<div id="root"></div>'
  const app = run(App, {}, { mountPoint: '#root' }); apps.push(app)
  return { app, el: document.getElementById('root') }
}

describe('G-556: Suspense looks through fragments for a not-ready child', () => {
  it('<Suspense><Collection of={lazy(...)} /></Suspense> shows the fallback while the item loads', async () => {
    let res; const p = new Promise(r => { res = r })
    function Item({ state }) { return h('li', { className: 'it' }, state.t) }
    const LI = lazy(() => p.then(() => ({ default: Item })))
    function App() { return h('ul', null, h(Suspense, { fallback: h('li', { className: 'fb' }, 'loading') }, h(Collection, { of: LI, from: 'rows' }))) }
    App.initialState = { rows: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] }
    const { el } = mount(App); await sleep(30)
    expect(el.querySelector('.fb')).not.toBe(null)
    expect(el.querySelector('.it')).toBe(null)
    res(); await sleep(30)
    expect(el.querySelector('.fb')).toBe(null)
    expect([...el.querySelectorAll('ul > li.it')].map(e => e.textContent)).toEqual(['a', 'b'])
  })

  it('a fragment child (<>…</>) whose element is not ready keeps the fallback', async () => {
    function Kid() { return h('li', { className: 'kid' }, 'k') }
    Kid.model = { BOOTSTRAP: { READY: () => false } }
    function App() { return h('ul', null, h(Suspense, { fallback: h('li', { className: 'fb' }, '…') }, [h('li', null, 'x'), h(Kid)])) }
    App.initialState = {}
    const { el } = mount(App); await sleep(30)
    expect(el.querySelector('.fb')).not.toBe(null)
  })
})

describe('G-557: READY: false on a component whose root is a fragment', () => {
  it('a child whose root is a Collection suspends (r4h P9)', async () => {
    function Item({ state }) { return h('li', { className: 'it' }, state.t) }
    function List() { return h(Collection, { of: Item, from: 'rows' }) }
    List.intent = ({ DOM }) => ({ GO: DOM.select('document').events('p4i-ready') })
    List.model = { BOOTSTRAP: { READY: () => false }, GO: { READY: () => true } }
    function App() { return h('ul', null, h(Suspense, { fallback: h('li', { className: 'fb' }, 'loading') }, h(List, { state: 'l' }))) }
    App.initialState = { l: { rows: [{ id: 1, t: 'a' }] } }
    const { el } = mount(App); await sleep(40)
    expect(el.querySelector('.fb')).not.toBe(null)
    expect(el.querySelector('.it')).toBe(null)
    document.dispatchEvent(new Event('p4i-ready')); await sleep(30)
    expect(el.querySelector('.fb')).toBe(null)
    expect(el.querySelector('ul > li.it').textContent).toBe('a')
  })

  it('a child whose root is <>…</> marks each top-level element', async () => {
    // the view's root is a fragment of two elements
    function Two() { return h(Fragment, null, h('p', { className: 'a' }, 'a'), 'text', h('p', { className: 'b' }, 'b')) }
    Two.model = { BOOTSTRAP: { READY: () => false } }
    function App() { return h('div', null, h(Suspense, { fallback: h('i', { className: 'fb' }, '…') }, h(Two))) }
    App.initialState = {}
    const { el } = mount(App); await sleep(30)
    expect(el.querySelector('.fb')).not.toBe(null)
    expect(el.querySelector('.a')).toBe(null)
  })
})

describe('G-558: the mock DOM scopes a fragment root', () => {
  function Item({ state }) { return h('li', null, h('button', { className: 'b' }, state.t)) }
  Item.intent = ({ DOM }) => ({ HIT: DOM.select('.b').events('click') })
  Item.model = { HIT: (s) => ({ ...s, t: s.t + '!' }) }
  function List() { return h(Collection, { of: Item, from: 'rows' }) }

  it("t.html() of a list component returning a Collection prints the items directly (r4h P10)", async () => {
    function App() { return h('ul', null, h(List, { state: 'l' })) }
    App.initialState = { l: { rows: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] } }
    const t = renderComponent(App); await t.ready()
    expect(t.html()).toBe('<ul><li><button class="b">a</button></li><li><button class="b">b</button></li></ul>')
    t.simulateEvent('.b', 'click'); await t.settle()
    expect(t.state.l.rows.map(r => r.t)).toEqual(['a!', 'b'])
    expect(t.html()).not.toContain('undefined')
    t.dispose()
  })

  it('renderComponent of the list component itself', async () => {
    List.initialState = { rows: [{ id: 1, t: 'a' }] }
    try {
      const t = renderComponent(List); await t.ready()
      expect(t.html()).toBe('<li><button class="b">a</button></li>')
      t.dispose()
    } finally { delete List.initialState }
  })

  it('a <>…</> root with text in a child component', async () => {
    function Frag() { return h(Fragment, null, h('b', null, 'x'), 'y') }
    function App() { return h('div', null, h(Frag)) }
    App.initialState = {}
    const t = renderComponent(App); await t.ready()
    expect(t.html()).toBe('<div><b>x</b>y</div>')
    t.dispose()
  })
})

describe('G-559: Transition around a Collection', () => {
  useFreshDiagnostics()
  it('applies to each item (enter and leave), with no SYG612 (r4h P8)', async () => {
    function Row({ state }) { return h('li', { className: 'r' }, state.t) }
    function App() { return h('ul', null, h(Transition, { name: 'fade', duration: 30 }, h(Collection, { of: Row, from: 'items' }))) }
    App.intent = ({ DOM }) => ({ OP: DOM.select('document').events('p4i-op').map(e => e.detail) })
    App.model = { OP: (s, f) => f(s) }
    App.initialState = { items: [{ id: 1, t: 'a' }] }
    const t = renderComponent(App, { dom: 'real' }); await t.ready(); await sleep(5)
    const ul = t.container.querySelector('ul')
    expect(ul.querySelector('li.r').className).toContain('fade-enter')
    await sleep(60)
    expect(ul.querySelector('li.r').className).toBe('r')
    document.dispatchEvent(new CustomEvent('p4i-op', { detail: (s) => ({ items: [...s.items, { id: 2, t: 'b' }] }) }))
    await sleep(5)
    const lis = ul.querySelectorAll('li.r')
    expect(lis.length).toBe(2)
    expect(lis[0].className).toBe('r')
    expect(lis[1].className).toContain('fade-enter')
    await sleep(60)
    document.dispatchEvent(new CustomEvent('p4i-op', { detail: (s) => ({ items: s.items.slice(1) }) }))
    await sleep(5)
    expect(ul.querySelectorAll('li.r').length).toBe(2)
    expect(ul.querySelector('li.r').className).toContain('fade-leave')
    await sleep(80)
    expect([...ul.querySelectorAll('li.r')].map(e => e.textContent)).toEqual(['b'])
    expect(t.diagnostics.map(d => d.code)).toEqual([])
    t.dispose()
  })

  it('renderToString renders the items in place', () => {
    function Row({ state }) { return h('li', null, state.t) }
    function App() { return h('ul', null, h(Transition, { name: 'fade' }, h(Collection, { of: Row, from: 'items' }))) }
    App.initialState = { items: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] }
    expect(renderToString(App, { state: App.initialState }).replace(/ data-sygnal-ssr=""/, '')).toBe('<ul><li>a</li><li>b</li></ul>')
  })

  it("an unchanged item keeps its vnode across the owner's renders (no re-patch)", async () => {
    let up = 0
    function Row({ state }) { return h('li', { hook: { update: () => up++ } }, state.t) }
    function App({ state }) { return h('div', null, h('i', null, String(state.n)), h('ul', null, h(Transition, { name: 'f', duration: 1 }, h(Collection, { of: Row, from: 'items' })))) }
    App.intent = ({ DOM }) => ({ OP: DOM.select('document').events('p4i-n') })
    App.model = { OP: (s) => ({ ...s, n: s.n + 1 }) }
    App.initialState = { n: 0, items: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] }
    const { el } = mount(App); await sleep(30)
    up = 0
    document.dispatchEvent(new Event('p4i-n')); await sleep(10)
    document.dispatchEvent(new Event('p4i-n')); await sleep(10)
    expect(el.querySelector('i').textContent).toBe('2')
    expect(up).toBe(0)
  })
})
