// @vitest-environment jsdom
// PLAN-5 4-I: the review of 4-H (Collection without a wrapper div, D229). A Collection renders a
// keyed fragment now, so the places that looked for an element where the wrapper was must look
// through fragments: Suspense's not-ready probe (G-556), READY: false on a component whose root
// is a Collection (G-557), the mock DOM's scoping of a fragment root (G-558), and Transition around
// a Collection (G-559: applied to each item; no false SYG612). The reviewer's probes (r4h new.probe
// P1b, new4.probe P9, new5.probe P10, new3.probe P8) are the cases below.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, Collection, Suspense, Transition, lazy } from '../src/index.js'
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
