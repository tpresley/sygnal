// @vitest-environment jsdom
// A view that returns a string or a number renders it as text, as in React: a text node in the
// view's place. The view patches between text, an element and nothing (null) in position, and its
// events work again whenever it renders an element: as a child, at the app root, as a Collection
// item, a Switchable page, under Transition / Suspense, on the server (renderToString, escaped),
// at hydration (the server's text adopted, also next to a text sibling), and on sygnal/host,
// sygnal/terminal and sygnal/worker.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, renderToString, renderComponent, createElement as h, Collection, Switchable, Transition, Suspense } from 'sygnal'
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
const TEXTS = [['a string', 'hi'], ['a number', 7], ['zero', 0], ['an empty string', '']]

// a child that renders `text` unless `show`; its own click counts while it is shown
function Maybe({ state }) { return state.show ? h('button', { className: 'mb' }, 'm' + state.n) : state.text }
Maybe.intent = ({ DOM }) => ({ INC: DOM.click('.mb') })
Maybe.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
function Parent() { return h('div', { className: 'wrap' }, h('i', null, 'a'), h(Maybe, { state: 'm' }), h('b', null, 'z')) }
Parent.model = {
  TOGGLE: (s) => ({ ...s, m: { ...s.m, show: !s.m.show } }),
  TEXT: (s, text) => ({ ...s, m: { ...s.m, text } }),
}
const parentWith = (text, show = false) => Object.assign((p) => Parent(p), Parent, { initialState: { m: { show, n: 0, text } } })

/** the wrapper's nodes: tag names, '#comment' or '#text' */
const nodesOf = (el) => [...el.childNodes].map((n) => n.nodeType == 1 ? n.localName : n.nodeName)

describe('a view that returns text', () => {
  for (const [name, text] of TEXTS) {
    it(`${name}: a child renders it in its place (mock DOM)`, async () => {
      const t = renderComponent(parentWith(text))
      cleanup.push(() => t.dispose())
      await t.ready()
      expect(t.html()).toBe(`<div class="wrap"><i>a</i>${text}<b>z</b></div>`)
      await t.simulateAction('TOGGLE')
      expect(t.html()).toBe('<div class="wrap"><i>a</i><button class="mb">m0</button><b>z</b></div>')
    })

    it(`${name}: a child patches to and from an element in position (real DOM), its events still work`, async () => {
      const t = renderComponent(parentWith(text), { dom: 'real' })
      cleanup.push(() => t.dispose())
      await t.ready()
      const wrap = t.query('.wrap')
      expect(nodesOf(wrap)).toEqual(['i', '#text', 'b'])
      expect(wrap.childNodes[1].data).toBe(String(text))
      const i = wrap.firstChild, b = wrap.lastChild
      for (let round = 0; round < 3; round++) {
        await t.simulateAction('TOGGLE')
        expect(nodesOf(wrap)).toEqual(['i', 'button', 'b'])
        t.query('.mb').click()
        await t.settle()
        expect(t.query('.mb').textContent).toBe('m' + (round + 1))
        await t.simulateAction('TOGGLE')
        expect(nodesOf(wrap)).toEqual(['i', '#text', 'b'])
        expect(wrap.childNodes[1].data).toBe(String(text))
      }
      expect(wrap.firstChild).toBe(i)
      expect(wrap.lastChild).toBe(b)
    })
  }

  it('the text changes in place; to null and back', async () => {
    const t = renderComponent(parentWith('one'), { dom: 'real' })
    cleanup.push(() => t.dispose())
    await t.ready()
    const wrap = t.query('.wrap'), node = wrap.childNodes[1]
    await t.simulateAction('TEXT', 'two')
    expect(wrap.childNodes[1]).toBe(node)
    expect(node.data).toBe('two')
    await t.simulateAction('TEXT', 3)
    expect(wrap.textContent).toBe('a3z')
    await t.simulateAction('TEXT', null)
    expect(nodesOf(wrap)).toEqual(['i', '#comment', 'b'])
    await t.simulateAction('TEXT', 'back')
    expect(nodesOf(wrap)).toEqual(['i', '#text', 'b'])
    expect(wrap.textContent).toBe('abackz')
  })

  it('at the app root: the mount point holds the text, then the element, then the text again', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    function Root({ state }) { return state.on ? h('p', { className: 'on' }, 'on') : 'off ' + state.n }
    Root.initialState = { on: false, n: 0 }
    Root.intent = ({ DOM }) => ({ OFF: DOM.click('.on') })
    Root.model = { OFF: (s) => ({ ...s, on: false, n: s.n + 1 }), ON: (s) => ({ ...s, on: true }) }
    const app = run(Root, {}, { mountPoint: '#root' })
    cleanup.push(() => app.dispose())
    await tick(10)
    const root = document.getElementById('root')
    expect(root.innerHTML).toBe('off 0')
    app.__runtime.dispatch('root', 'ON')
    await tick(10)
    expect(root.innerHTML).toBe('<p class="on">on</p>')
    root.querySelector('.on').click()
    await tick(10)
    expect(root.innerHTML).toBe('off 1')
  })

  it('Collection items that render text keep their place among the others, their events working', async () => {
    function Item({ state }) { return state.text ? state.label : h('li', { className: 'it' }, state.label + state.n) }
    Item.intent = ({ DOM }) => ({ INC: DOM.click('.it') })
    Item.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 1, label: 'a', n: 0 }, { id: 2, label: 'b', n: 0, text: true }, { id: 3, label: 'c', n: 0 }] }
    List.model = { FLIP: (s) => ({ ...s, items: s.items.map((x) => ({ ...x, text: !x.text })) }) }
    const t = renderComponent(List, { dom: 'real' })
    cleanup.push(() => t.dispose())
    await t.ready()
    const ul = t.query('ul')
    expect(nodesOf(ul)).toEqual(['li', '#text', 'li'])
    const [a, , c] = ul.childNodes
    c.click()
    await t.settle()
    expect(ul.textContent).toBe('a0bc1')
    expect(ul.lastChild).toBe(c)
    await t.simulateAction('FLIP')
    expect(nodesOf(ul)).toEqual(['#text', 'li', '#text'])
    expect(ul.textContent).toBe('ab0c')
    ul.children[0].click()
    await t.settle()
    expect(ul.textContent).toBe('ab1c')
    await t.simulateAction('FLIP')
    expect(ul.textContent).toBe('a0bc1')
    expect(ul.firstChild).not.toBe(a)
  })

  it('a Switchable page that renders text', async () => {
    function A() { return h('p', { className: 'pa' }, 'A') }
    function B() { return 'page b' }
    function App({ state }) { return h('main', null, h(Switchable, { of: { a: A, b: B }, current: state.page })) }
    App.initialState = { page: 'a' }
    App.model = { GO: (s, page) => ({ ...s, page }) }
    const t = renderComponent(App, { dom: 'real' })
    cleanup.push(() => t.dispose())
    await t.ready()
    expect(t.query('main').innerHTML).toBe('<p class="pa">A</p>')
    await t.simulateAction('GO', 'b')
    expect(t.query('main').innerHTML).toBe('page b')
    await t.simulateAction('GO', 'a')
    expect(t.query('main').innerHTML).toBe('<p class="pa">A</p>')
  })

  it('under Transition and Suspense', async () => {
    vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1))
    cleanup.push(() => vi.unstubAllGlobals())
    document.body.innerHTML = '<div id="root"></div>'
    function Kid({ state }) { return state.show ? h('span', { className: 'kid' }, 'k') : 'none' }
    function App() {
      return h('main', null,
        h(Transition, { name: 'fade', duration: 5 }, h(Kid)),
        h(Suspense, { fallback: h('em', null, '…') }, h(Kid)))
    }
    App.initialState = { show: false }
    App.model = { TOGGLE: (s) => ({ ...s, show: !s.show }) }
    const app = run(App, {}, { mountPoint: '#root' })
    cleanup.push(() => app.dispose())
    await tick(20)
    const main = document.querySelector('main')
    expect(main.textContent).toBe('nonenone')
    app.__runtime.dispatch('root', 'TOGGLE')
    await tick(20)
    expect(main.querySelectorAll('.kid')).toHaveLength(2)
    app.__runtime.dispatch('root', 'TOGGLE')
    await tick(40)
    expect(main.querySelectorAll('.kid')).toHaveLength(0)
    expect(main.textContent).toBe('nonenone')
  })
})

describe('on the server and at hydration', () => {
  it('renderToString: a root, a child or a Collection item that returns text; escaped', () => {
    function Text() { return 'a < b & "c"' }
    expect(renderToString(Text)).toBe('a &lt; b &amp; &quot;c&quot;')
    function Num() { return 42 }
    expect(renderToString(Num)).toBe('42')
    expect(renderToString(parentWith('<x>'))).toBe('<div class="wrap" data-sygnal-ssr=""><i>a</i>&lt;x&gt;<b>z</b></div>')
    function Item({ state }) { return state.text ? state.label : h('li', null, state.label) }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ label: 'a' }, { label: 'b', text: true }] }
    expect(renderToString(List)).toBe('<ul data-sygnal-ssr=""><li>a</li>b</ul>')
  })

  it('hydration adopts the server text, and the view patches from it', async () => {
    const App = parentWith('hello')
    document.body.innerHTML = `<div id="root">${renderToString(App)}</div>`
    const text = document.querySelector('.wrap').childNodes[1]
    expect(text.nodeType).toBe(3)
    const app = run(App, {}, { mountPoint: '#root' })
    cleanup.push(() => app.dispose())
    await tick(10)
    const wrap = document.querySelector('.wrap')
    expect(wrap.childNodes[1]).toBe(text)
    expect(nodesOf(wrap)).toEqual(['i', '#text', 'b'])
    app.__runtime.dispatch('root', 'TOGGLE')
    await tick(10)
    expect(nodesOf(wrap)).toEqual(['i', 'button', 'b'])
    expect(wrap.textContent).toBe('am0z')
  })

  it('hydration of a text view next to a text sibling (the server HTML merges them)', async () => {
    function Name({ state }) { return state.name }
    function App({ state }) { return h('p', { className: 'hi' }, 'Hello, ', h(Name, { state: 'user' }), '!', state.on ? h('b', null, 'on') : null) }
    App.initialState = { user: { name: 'Ada' }, on: false }
    App.model = { RENAME: (s, name) => ({ ...s, user: { name } }), ON: (s) => ({ ...s, on: true }) }
    document.body.innerHTML = `<div id="root">${renderToString(App)}</div>`
    const app = run(App, {}, { mountPoint: '#root' })
    cleanup.push(() => app.dispose())
    await tick(10)
    const p = document.querySelector('.hi')
    expect(p.textContent).toBe('Hello, Ada!')
    app.__runtime.dispatch('root', 'RENAME', 'Grace')
    await tick(10)
    expect(p.textContent).toBe('Hello, Grace!')
    app.__runtime.dispatch('root', 'ON')
    await tick(10)
    expect(p.textContent).toBe('Hello, Grace!on')
  })
})

describe('other renderers', () => {
  it('sygnal/host: a text node in the host tree', async () => {
    const doc = new HostDocument()
    const app = run(parentWith('hi'), { DOM: makeHostDriver(doc) })
    cleanup.push(() => app.dispose())
    await tick()
    const wrap = doc.body.querySelector('.wrap')
    expect(wrap.textContent).toBe('ahiz')
    app.__runtime.dispatch('root', 'TOGGLE')
    await tick()
    expect(wrap.children.map((e) => e.localName)).toEqual(['i', 'button', 'b'])
    app.__runtime.dispatch('root', 'TOGGLE')
    await tick()
    expect(wrap.children.map((e) => e.localName)).toEqual(['i', 'b'])
    expect(wrap.textContent).toBe('ahiz')
  })

  it('sygnal/terminal: the text is painted', async () => {
    const term = createTerminal({ width: 20, height: 3 })
    function App() { return h('div', null, h('p', null, 'top'), h(Maybe, { state: 'm' }), h('p', null, 'end')) }
    App.initialState = { m: { show: false, n: 0, text: 'middle' } }
    App.model = Parent.model
    const app = run(App, { DOM: term.driver })
    cleanup.push(() => app.dispose())
    await term.settle()
    expect(term.frame()).toContain('middle')
    app.__runtime.dispatch('root', 'TOGGLE')
    await term.settle()
    expect(term.frame()).toContain('m0')
    expect(term.frame()).not.toContain('middle')
    app.__runtime.dispatch('root', 'TOGGLE')
    await term.settle()
    expect(term.frame()).toContain('middle')
  })

  it('sygnal/worker: the page mirrors the text, then the element, then the text', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const mount = document.getElementById('root')
    const ch = new MessageChannel()
    const bridge = startBridge(ch.port2, mount)
    const target = createWorkerTarget(ch.port1)
    const app = run(parentWith('hi'), { DOM: target.driver })
    cleanup.push(() => { app.dispose(); bridge.stop(); ch.port1.close(); ch.port2.close() })
    await bridge.ready
    await until(() => expect(mount.querySelector('.wrap')?.textContent).toBe('ahiz'))
    app.__runtime.dispatch('root', 'TOGGLE')
    await until(() => expect(mount.querySelector('.mb')?.textContent).toBe('m0'))
    app.__runtime.dispatch('root', 'TOGGLE')
    await until(() => expect(mount.querySelector('.mb')).toBe(null))
    expect(mount.querySelector('.wrap').textContent).toBe('ahiz')
  })
})
