// @vitest-environment jsdom
// A view that returns null, false or undefined renders nothing, as in React (it rendered an
// empty <div>). An empty comment holds its place, so the view patches to and from an element in
// position: as a child, at the app root, as a Collection item, a Switchable page, under
// Transition / Portal / Suspense, on the server (renderToString: `<!---->`), at hydration (the
// server's comment is adopted), and on sygnal/host, sygnal/terminal and sygnal/worker. JSX
// children false / null / undefined render nothing at all (no comment), in the pragma and in
// renderToString.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, renderToString, renderComponent, createElement as h, Collection, Switchable, Transition, Portal, Suspense } from 'sygnal'
import { HostDocument, makeHostDriver } from 'sygnal/host'
import { createTerminal } from 'sygnal/terminal'
import { createWorkerTarget } from 'sygnal/worker'
import { startBridge } from 'sygnal/worker/page'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 10 })
let cleanup = [], errors
beforeEach(() => { errors = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => {
  cleanup.splice(0).forEach((f) => f())
  document.body.innerHTML = ''
  const logged = errors.mock.calls
  vi.restoreAllMocks()
  expect(logged).toEqual([])
})
const NOTHING = [['null', null], ['false', false], ['undefined', undefined]]

// a child that renders nothing unless `show`; its own click counts while it is shown
function Maybe({ state }) { return state.show ? h('button', { className: 'mb' }, 'm' + state.n) : state.empty }
Maybe.intent = ({ DOM }) => ({ INC: DOM.click('.mb') })
Maybe.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
function Parent() { return h('div', { className: 'wrap' }, h('i', null, 'a'), h(Maybe, { state: 'm' }), h('b', null, 'z')) }
Parent.model = { TOGGLE: (s) => ({ ...s, m: { ...s.m, show: !s.m.show } }) }
const parentWith = (empty, show = false) => Object.assign((p) => Parent(p), Parent, { initialState: { m: { show, n: 0, empty } } })

/** the wrapper's nodes: tag names, '#comment' or '#text' */
const nodesOf = (el) => [...el.childNodes].map((n) => n.nodeType == 1 ? n.localName : n.nodeName)

describe('a view that returns nothing', () => {
  for (const [name, empty] of NOTHING) {
    it(`${name}: a child renders nothing in its place (mock DOM)`, async () => {
      const t = renderComponent(parentWith(empty))
      cleanup.push(() => t.dispose())
      await t.ready()
      expect(t.html()).toBe('<div class="wrap"><i>a</i><!----><b>z</b></div>')
      expect(t.queryAll('div')).toHaveLength(1)
      await t.simulateAction('TOGGLE')
      expect(t.html()).toBe('<div class="wrap"><i>a</i><button class="mb">m0</button><b>z</b></div>')
    })

    it(`${name}: a child patches to and from an element in position (real DOM), its events still work`, async () => {
      const t = renderComponent(parentWith(empty), { dom: 'real' })
      cleanup.push(() => t.dispose())
      await t.ready()
      const wrap = t.query('.wrap')
      expect(nodesOf(wrap)).toEqual(['i', '#comment', 'b'])
      expect(t.container.querySelectorAll('div')).toHaveLength(1)
      const i = wrap.firstChild, b = wrap.lastChild
      for (let round = 0; round < 3; round++) {
        await t.simulateAction('TOGGLE')
        expect(nodesOf(wrap)).toEqual(['i', 'button', 'b'])
        t.query('.mb').click()
        await t.settle()
        expect(t.query('.mb').textContent).toBe('m' + (round + 1))
        await t.simulateAction('TOGGLE')
        expect(nodesOf(wrap)).toEqual(['i', '#comment', 'b'])
      }
      // the siblings are the same elements throughout
      expect(wrap.firstChild).toBe(i)
      expect(wrap.lastChild).toBe(b)
    })
  }

  it('at the app root: the mount point holds only a comment, then the element, then a comment again', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    function Root({ state }) { return state.on ? h('p', { className: 'on' }, 'on') : null }
    Root.initialState = { on: false }
    Root.intent = ({ DOM }) => ({ OFF: DOM.click('.on') })
    Root.model = { OFF: (s) => ({ ...s, on: false }), ON: (s) => ({ ...s, on: true }) }
    const app = run(Root, {}, { mountPoint: '#root' })
    cleanup.push(() => app.dispose())
    await tick(10)
    const root = document.getElementById('root')
    expect(nodesOf(root)).toEqual(['#comment'])
    app.__runtime.dispatch('root', 'ON')
    await tick(10)
    expect(root.innerHTML).toBe('<p class="on">on</p>')
    root.querySelector('.on').click()
    await tick(10)
    expect(nodesOf(root)).toEqual(['#comment'])
  })

  it('Collection items that render nothing keep their place among the others', async () => {
    function Item({ state }) { return state.hidden ? null : h('li', null, state.label) }
    function List({ state }) { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 1, label: 'a' }, { id: 2, label: 'b', hidden: true }, { id: 3, label: 'c' }] }
    List.model = {
      SHOW: (s) => ({ ...s, items: s.items.map((x) => ({ ...x, hidden: false })) }),
      HIDE_A: (s) => ({ ...s, items: s.items.map((x) => (x.id == 1 ? { ...x, hidden: true } : x)) }),
    }
    const t = renderComponent(List, { dom: 'real' })
    cleanup.push(() => t.dispose())
    await t.ready()
    const ul = t.query('ul')
    expect(nodesOf(ul)).toEqual(['li', '#comment', 'li'])
    const [a, , c] = ul.childNodes
    await t.simulateAction('SHOW')
    expect([...ul.children].map((li) => li.textContent)).toEqual(['a', 'b', 'c'])
    expect(ul.children[0]).toBe(a)
    expect(ul.children[2]).toBe(c)
    await t.simulateAction('HIDE_A')
    expect(nodesOf(ul)).toEqual(['#comment', 'li', 'li'])
    expect(ul.lastChild).toBe(c)
  })

  it('a Switchable page that renders nothing', async () => {
    function A() { return h('p', { className: 'pa' }, 'A') }
    function B() { return null }
    function App({ state }) { return h('main', null, h(Switchable, { of: { a: A, b: B }, current: state.page })) }
    App.initialState = { page: 'a' }
    App.model = { GO: (s, page) => ({ ...s, page }) }
    const t = renderComponent(App, { dom: 'real' })
    cleanup.push(() => t.dispose())
    await t.ready()
    expect(t.query('main').innerHTML).toBe('<p class="pa">A</p>')
    await t.simulateAction('GO', 'b')
    expect(nodesOf(t.query('main'))).toEqual(['#comment'])
    await t.simulateAction('GO', 'a')
    expect(t.query('main').innerHTML).toBe('<p class="pa">A</p>')
  })

  // (a Portal's children are elements: a component inside one isn't instantiated, so its
  // conditional content here is a JSX child, `show && <span>`)
  it('under Transition, Portal and Suspense', async () => {
    vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1))
    cleanup.push(() => vi.unstubAllGlobals())
    document.body.innerHTML = '<div id="root"></div><div id="modal"></div>'
    function Kid({ state }) { return state.show ? h('span', { className: 'kid' }, 'k') : null }
    function App({ state }) {
      return h('main', null,
        h(Transition, { name: 'fade', duration: 5 }, h(Kid)),
        h(Portal, { target: '#modal' }, state.show && h('span', { className: 'kid' }, 'k')),
        h(Suspense, { fallback: h('em', null, '…') }, h(Kid)))
    }
    App.initialState = { show: false }
    App.model = { TOGGLE: (s) => ({ ...s, show: !s.show }) }
    const app = run(App, {}, { mountPoint: '#root' })
    cleanup.push(() => app.dispose())
    await tick(20)
    const main = document.querySelector('main'), modal = document.getElementById('modal')
    expect(main.querySelectorAll('.kid')).toHaveLength(0)
    expect(modal.querySelectorAll('.kid')).toHaveLength(0)
    // (the portal's placeholder between them; Suspense with one ready child unwraps it)
    expect(nodesOf(main)).toEqual(['#comment', 'div', '#comment'])
    app.__runtime.dispatch('root', 'TOGGLE')
    await tick(20)
    expect(main.querySelectorAll('.kid')).toHaveLength(2)
    expect(modal.querySelectorAll('.kid')).toHaveLength(1)
    app.__runtime.dispatch('root', 'TOGGLE')
    await tick(40)
    expect(document.querySelectorAll('.kid')).toHaveLength(0)
  })
})

describe('on the server and at hydration', () => {
  it('renderToString: a root, a child or a Collection item that returns nothing is an empty comment', () => {
    function Nothing() { return null }
    expect(renderToString(Nothing)).toBe('<!---->')
    expect(renderToString(parentWith(false))).toBe('<div class="wrap" data-sygnal-ssr=""><i>a</i><!----><b>z</b></div>')
    function Item({ state }) { return state.hidden ? undefined : h('li', null, state.label) }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ label: 'a' }, { label: 'b', hidden: true }] }
    expect(renderToString(List)).toBe('<ul data-sygnal-ssr=""><li>a</li><!----></ul>')
  })

  it('JSX children false / null / undefined render nothing (no comment) in the pragma and renderToString', async () => {
    function C({ state }) { return h('p', null, 'x', false, null, undefined, state.on && h('b', null, 'on'), 'y') }
    C.initialState = { on: false }
    expect(renderToString(C)).toBe('<p data-sygnal-ssr="">xy</p>')
    const t = renderComponent(C, { dom: 'real' })
    cleanup.push(() => t.dispose())
    await t.ready()
    expect(t.query('p').innerHTML).toBe('xy')
  })

  it('hydration adopts the server comment, and the view patches from it', async () => {
    const App = parentWith(null)
    document.body.innerHTML = `<div id="root">${renderToString(App)}</div>`
    const comment = document.querySelector('.wrap').childNodes[1]
    expect(comment.nodeType).toBe(8)
    const app = run(App, {}, { mountPoint: '#root' })
    cleanup.push(() => app.dispose())
    await tick(10)
    const wrap = document.querySelector('.wrap')
    expect(wrap.childNodes[1]).toBe(comment)
    expect(nodesOf(wrap)).toEqual(['i', '#comment', 'b'])
    app.__runtime.dispatch('root', 'TOGGLE')
    await tick(10)
    expect(nodesOf(wrap)).toEqual(['i', 'button', 'b'])
  })
})

describe('other renderers', () => {
  it('sygnal/host: nothing in the host tree but an empty text node', async () => {
    const doc = new HostDocument()
    const app = run(parentWith(null), { DOM: makeHostDriver(doc) })
    cleanup.push(() => app.dispose())
    await tick()
    const wrap = doc.body.querySelector('.wrap')
    expect(wrap.children.map((e) => e.localName)).toEqual(['i', 'b'])
    expect(wrap.textContent).toBe('az')
    app.__runtime.dispatch('root', 'TOGGLE')
    await tick()
    expect(wrap.children.map((e) => e.localName)).toEqual(['i', 'button', 'b'])
    app.__runtime.dispatch('root', 'TOGGLE')
    await tick()
    expect(wrap.children.map((e) => e.localName)).toEqual(['i', 'b'])
  })

  it('sygnal/terminal: nothing is painted', async () => {
    const term = createTerminal({ width: 20, height: 3 })
    function App() { return h('div', null, h('p', null, 'top'), h(Maybe, { state: 'm' }), h('p', null, 'end')) }
    App.initialState = { m: { show: false, n: 0, empty: null } }
    App.model = Parent.model
    const app = run(App, { DOM: term.driver })
    cleanup.push(() => app.dispose())
    await term.settle()
    expect(term.frame().split('\n').map((l) => l.trimEnd()).filter(Boolean)).toEqual(['top', 'end'])
    app.__runtime.dispatch('root', 'TOGGLE')
    await term.settle()
    expect(term.frame()).toContain('m0')
    app.__runtime.dispatch('root', 'TOGGLE')
    await term.settle()
    expect(term.frame()).not.toContain('m0')
  })

  it('sygnal/worker: the page mirrors nothing, then the element, then nothing', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const mount = document.getElementById('root')
    const ch = new MessageChannel()
    const bridge = startBridge(ch.port2, mount)
    const target = createWorkerTarget(ch.port1)
    const app = run(parentWith(undefined), { DOM: target.driver })
    cleanup.push(() => { app.dispose(); bridge.stop(); ch.port1.close(); ch.port2.close() })
    await bridge.ready
    await until(() => expect(mount.querySelector('.wrap')?.textContent).toBe('az'))
    expect(mount.querySelectorAll('.wrap > *')).toHaveLength(2)
    app.__runtime.dispatch('root', 'TOGGLE')
    await until(() => expect(mount.querySelector('.mb')?.textContent).toBe('m0'))
    app.__runtime.dispatch('root', 'TOGGLE')
    await until(() => expect(mount.querySelector('.mb')).toBe(null))
    expect(mount.querySelector('.wrap').textContent).toBe('az')
  })
})
