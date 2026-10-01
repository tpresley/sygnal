// G-084: components passed as children (vnodes) through a wrapper component. Counts live
// instances with inspect() and counts view calls, to see whether a child is instantiated
// once per ancestor that sees its vnode.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupChecks } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null; vi.restoreAllMocks() })

const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))
const count = (g, name) => g.components.filter(c => c.name === name).length
const parentsOf = (g, name) => g.components.filter(c => c.name === name).map(c => g.components.find(p => p.id === c.parentId)?.name)

describe('G-084: a child passed as children through a wrapper', () => {
  it('is instantiated once (Wrapper > Layout > Page, like the Vike shell)', async () => {
    let pageViews = 0
    function Page({ state }) { pageViews++; return h('p', { className: 'page' }, String(state.n)) }
    Page.isolatedState = true
    Page.initialState = { n: 1 }
    function Layout({ children }) { return h('main', { className: 'layout' }, ...children) }
    function Wrapper({ children }) { return h('section', { className: 'wrapper' }, ...children) }
    function App() { return h('div', null, h(Wrapper, null, h(Layout, null, h(Page)))) }
    App.initialState = { x: 0 }

    t = renderComponent(App)
    await t.ready()
    await settle()
    expect(t.html()).toContain('<p class="page">1</p>')
    const g = t.inspect()
    expect(parentsOf(g, 'Layout')).toEqual(['Wrapper'])
    expect(parentsOf(g, 'Page')).toEqual(['Layout'])
    expect(count(g, 'Wrapper')).toBe(1)
  })

  it('runs a nested child once: one BOOTSTRAP, one EVENTS emit', async () => {
    let boots = 0
    function Child() { return h('i', null, 'c') }
    Child.intent = () => ({})
    Child.model = { BOOTSTRAP: { EVENTS: () => { boots++; return { type: 'CHILD_UP', data: 1 } } } }
    function Card({ children }) { return h('div', { className: 'card' }, ...children) }
    function App() { return h('div', null, h(Card, null, h(Card, null, h(Child)))) }
    App.initialState = {}
    t = renderComponent(App)
    await t.ready()
    await settle()
    expect(boots).toBe(1)
    expect(t.emitted.filter(e => e.type === 'CHILD_UP')).toHaveLength(1)
    expect(count(t.inspect(), 'Child')).toBe(1)
  })

  it('swapping the child passed through a wrapper keeps one live instance (no stale ones)', async () => {
    function A({ state }) { return h('p', { className: 'a' }, 'A' + state.v) }
    A.isolatedState = true
    A.initialState = { v: 1 }
    function B({ state }) { return h('p', { className: 'b' }, 'B' + state.v) }
    B.isolatedState = true
    B.initialState = { v: 2 }
    function Layout({ children }) { return h('main', null, ...children) }
    function App({ state }) {
      return h('div', null, h('button', { className: 'go' }, 'go'), h(Layout, null, state.page === 'a' ? h(A) : h(B)))
    }
    App.initialState = { page: 'a' }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: s => ({ ...s, page: s.page === 'a' ? 'b' : 'a' }) }
    t = renderComponent(App)
    await t.ready()
    await settle()
    expect(t.html()).toContain('<p class="a">A1</p>')
    t.simulateEvent('.go', 'click')
    await settle(60)
    expect(t.html()).toContain('<p class="b">B2</p>')
    const g = t.inspect()
    expect(count(g, 'A') + count(g, 'B')).toBe(1)
    expect(parentsOf(g, 'B')).toEqual(['Layout'])
  })
})
