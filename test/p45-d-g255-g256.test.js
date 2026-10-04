// @vitest-environment jsdom
// PLAN-4.5 P45-D (D151): two pre-existing view-walk gaps.
// - G-255: a view that returns the same root vnode object again lost its child components on
//   that render (the root's `componentsProcessed` flag skipped collecting them, so they were
//   disposed and their placeholders rendered as bare tags).
// - G-256: special markers (Transition, Portal, ClientOnly, Lazy) inside a fragment were never
//   processed: they reached the DOM as <transition>, <portal>... elements.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Fragment } from '../src/cycle/dom/snabbdom.js'
import { Transition } from '../src/transition.js'
import { Portal } from '../src/portal.js'
import { ClientOnly } from '../src/vike/ClientOnly.js'
import { lazy } from '../src/lazy.js'

let t
afterEach(() => { if (t) t.dispose(); t = null; document.body.innerHTML = '' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

describe('G-255: a view returning the same root vnode again keeps its child components', () => {
  it('the child stays mounted and keeps rendering', async () => {
    let disposed = 0
    function Child({ state }) { return h('span', { className: 'child' }, String(state.n)) }
    Child.model = { DISPOSE: { EFFECT: () => { disposed++ } } }
    let root
    function App() { return (root ||= h('div', { className: 'app' }, h('b', { className: 'inc' }, '+'), h(Child, {}))) }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
    App.model = { INC: s => ({ ...s, n: s.n + 1 }) }
    t = renderComponent(App, { dom: 'real' })
    await t.ready()
    expect(t.query('.child').textContent).toBe('0')
    await t.simulateEvent('.inc', 'click')
    await t.waitForState(s => s.n === 1)
    await t.settle()
    expect(t.query('.child')?.textContent).toBe('1')
    await t.simulateEvent('.inc', 'click')
    await t.waitForState(s => s.n === 2)
    await t.settle()
    expect(t.query('.child')?.textContent).toBe('2')
    expect(disposed).toBe(0)
  })
})

describe('G-256: markers inside a fragment are processed', () => {
  it('Transition in a fragment: its child is rendered with the enter classes, no <transition> element', async () => {
    function App({ state }) {
      return h('div', { className: 'app' }, h(Fragment, null, h('i', null, 'x'), state.on ? h(Transition, { name: 'fade', duration: 10 }, h('p', { className: 'tp' }, 'hi')) : null))
    }
    App.initialState = { on: false }
    App.intent = ({ DOM }) => ({ ON: DOM.click('i') })
    App.model = { ON: s => ({ ...s, on: true }) }
    t = renderComponent(App, { dom: 'real' })
    await t.ready()
    await t.simulateEvent('i', 'click')
    await t.waitForState(s => s.on)
    await t.settle()
    expect(t.container.querySelector('transition')).toBe(null)
    const p = t.query('.tp')
    expect(p).not.toBe(null)
    expect(p.classList.contains('fade-enter-active')).toBe(true)
  })

  it('Portal in a fragment: the content goes to the target', async () => {
    const target = document.createElement('div')
    target.id = 'p45d-target'
    document.body.appendChild(target)
    function App() { return h('div', { className: 'app' }, h(Fragment, null, h(Portal, { target: '#p45d-target' }, h('p', { className: 'ported' }, 'there')))) }
    t = renderComponent(App, { dom: 'real' })
    await t.ready()
    await t.settle()
    expect(t.container.querySelector('portal')).toBe(null)
    expect(target.querySelector('.ported')?.textContent).toBe('there')
  })

  it('ClientOnly in a fragment is unwrapped on the client', async () => {
    function App() { return h('div', { className: 'app' }, h(Fragment, null, h(ClientOnly, null, h('p', { className: 'co' }, 'client')))) }
    t = renderComponent(App, { dom: 'real' })
    await t.ready()
    expect(t.container.querySelector('clientonly')).toBe(null)
    expect(t.query('.co')?.textContent).toBe('client')
  })

  it('a Lazy component in a fragment renders once loaded', async () => {
    function Loaded() { return h('p', { className: 'lz' }, 'loaded') }
    const Lazy = lazy(() => Promise.resolve({ default: Loaded }))
    function App({ state }) { return h('div', { className: 'app' }, h(Fragment, null, h(Lazy, {}), h('i', null, String(state.n)))) }
    App.initialState = { n: 0 }
    t = renderComponent(App, { dom: 'real' })
    await t.ready()
    await sleep(30)
    await t.settle()
    expect(t.query('.lz')?.textContent).toBe('loaded')
  })

  it('a sub-component and a Transition in a nested fragment', async () => {
    function Child() { return h('span', { className: 'kid' }, 'kid') }
    function App() { return h('div', { className: 'app' }, h(Fragment, null, h(Fragment, null, h(Child, {}), h(Transition, { name: 'v', duration: 10 }, h('p', { className: 'tp2' }, 't'))))) }
    t = renderComponent(App, { dom: 'real' })
    await t.ready()
    await t.settle()
    expect(t.query('.kid')?.textContent).toBe('kid')
    expect(t.container.querySelector('transition')).toBe(null)
    expect(t.query('.tp2')).not.toBe(null)
  })
})
