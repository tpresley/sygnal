// @vitest-environment jsdom
// PLAN-5 3-M: review fixes for the hydrating first patch (3-J, D217): fragments (G-481), data-*
// attrs (G-482), server-only style declarations (G-483), textarea text (G-484), elements with
// create/init/insert hooks (G-485), selector class/id (G-486), `open` (G-487); and the plain
// <slot> element (G-480). Each test fails on the 3-J code.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, renderToString, Portal, createRef, Suspense } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { Fragment } from '../src/cycle/dom/fragment.ts'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let apps = [], errors
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1))
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''; vi.unstubAllGlobals()
  const logged = errors.mock.calls
  vi.restoreAllMocks()
  expect(logged).toEqual([])
})

/** HTML with each element's attributes in name order (an adopted element keeps the server's order) */
function norm(html) {
  const t = document.createElement('template')
  t.innerHTML = html
  for (const el of t.content.querySelectorAll('*')) {
    const list = [...el.attributes].map(a => [a.name, a.value]).sort((a, b) => a[0] < b[0] ? -1 : 1)
    for (const [n] of list) el.removeAttribute(n)
    for (const [n, v] of list) el.setAttribute(n, v)
  }
  return t.innerHTML
}
const attrs = (el) => el ? [...el.attributes].map(a => a.name + '=' + a.value).sort().join(' ') : 'GONE'

/** the container's HTML after a client-only render of App (state: App.initialState) */
async function fresh(App) {
  document.body.innerHTML = '<div id="root"></div>'
  const a = run(App, {}, { mountPoint: '#root' })
  await sleep(40)
  const out = norm(document.getElementById('root').innerHTML)
  a.dispose()
  await sleep(5)
  return out
}

/**
 * The server's HTML (renderToString, or `server`) in #root, `prep` run on it (typing, focus),
 * then run(). Returns the elements before (by data-t, and all of them), the app and the HTML.
 */
async function hydrate(App, { server, wrap, prep } = {}) {
  const html = server ?? renderToString(App, { state: App.initialState })
  document.body.innerHTML = wrap ? wrap(html) : `<div id="root">${html}</div>`
  const all = [...document.querySelectorAll('#root *')]
  const byT = Object.fromEntries([...document.querySelectorAll('[data-t]')].map(e => [e.dataset.t, e]))
  const texts = new Map(all.map(e => [e, e.firstChild?.nodeType == 3 ? e.firstChild : null]))
  prep?.(byT)
  const app = run(App, {}, { mountPoint: '#root' })
  apps.push(app)
  await sleep(40)
  const now = (t) => document.querySelector(`[data-t="${t}"]`)
  return {
    all, byT, now, app,
    kept: all.filter(e => e.isConnected),
    keptT: (t) => now(t) === byT[t],
    textKept: (t) => now(t)?.firstChild === texts.get(byT[t]),
    html: () => norm(document.getElementById('root').innerHTML),
  }
}

/** One view inside a `main`, with the given initial state */
const app = (view, initialState = {}) => {
  function App({ state }) { return h('main', null, view(state)) }
  App.initialState = initialState
  return App
}


describe('G-481: fragments', () => {
  it("the review's probe: fields after a component returning a fragment keep typed text and focus", async () => {
    function F() { return h(Fragment, null, h('label', null, 'Name'), h('span', null, '*')) }
    function M() { return h('form', null, h(F), h('span', { 'data-t': 'hint' }, 'hint'), h('input', { 'data-t': 'in', className: 'name' })) }
    M.initialState = {}
    const want = await fresh(M)
    const r = await hydrate(M, { prep: (t) => { t.in.value = 'typed'; t.in.focus() } })
    expect(r.kept.length, 'every element adopted').toBe(r.all.length)
    expect(r.keptT('in')).toBe(true)
    expect(r.now('in').value).toBe('typed')
    expect(document.activeElement).toBe(r.now('in'))
    expect(r.html()).toBe(want)
  })

  const cases = {
    middle: () => h('div', null, h('b', null, 'pre'), h(Fragment, null, h('span', null, 'f1'), h('span', null, 'f2')), h('i', { 'data-t': 'post' }, 'post')),
    nested: () => h('div', null, h(Fragment, null, h('em', null, 'a'), h(Fragment, null, h('span', null, 'b'), h('span', null, 'c')), h('em', null, 'd')), h('p', { 'data-t': 'post' }, 'z')),
    empty: () => h('div', null, h('b', null, 'pre'), h(Fragment, null), h('p', { 'data-t': 'post' }, 'z')),
    emptyFirst: () => h('div', null, h(Fragment, null), h('p', { 'data-t': 'post' }, 'z')),
    text: () => h('div', null, h(Fragment, null, 'just text'), h('p', { 'data-t': 'post' }, 'z')),
    textAndElements: () => h('div', null, h(Fragment, null, h('b', null, 'b'), ' and text'), h('p', { 'data-t': 'post' }, 'z')),
    rootFragment: () => h(Fragment, null, h('header', null, 'h'), h('p', { 'data-t': 'post' }, 'z')),
  }
  for (const [name, view] of Object.entries(cases)) {
    it(name, async () => {
      function App() { return name == 'rootFragment' ? view() : h('main', null, view()) }
      App.initialState = {}
      const want = await fresh(App)
      const r = await hydrate(App)
      expect(r.kept.length, 'every element adopted').toBe(r.all.length)
      expect(r.keptT('post')).toBe(true)
      expect(r.html()).toBe(want)
    })
  }

  it('a later patch inside and around an adopted fragment', async () => {
    function F({ n }) { return h(Fragment, null, h('span', { 'data-t': 'a' }, 'a' + n), h('span', { className: n % 2 ? 'odd' : 'even' }, 'b'), h('span', { 'data-t': 'c' }, 'c')) }
    function App({ state }) { return h('main', null, h('button', { className: 'inc' }, '+'), h(F, { n: state.n }), h('input', { 'data-t': 'in' })) }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
    App.model = { INC: (s) => ({ n: s.n + 1 }) }
    const r = await hydrate(App)
    expect(r.kept.length).toBe(r.all.length)
    document.querySelector('.inc').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await sleep(20)
    expect(r.html()).toBe('<main><button class="inc">+</button><span data-t="a">a1</span><span class="odd">b</span><span data-t="c">c</span><input data-t="in"></main>')
    expect(r.keptT('in') && r.keptT('a') && r.keptT('c')).toBe(true)
    document.querySelector('.inc').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await sleep(20)
    expect(r.html()).toBe('<main><button class="inc">+</button><span data-t="a">a2</span><span class="even">b</span><span data-t="c">c</span><input data-t="in"></main>')
  })

  it('a false / null child (`{cond && <X/>}`) takes no node: the siblings after it are adopted', async () => {
    const App = app(() => h('div', null, false, h('p', { 'data-t': 'p' }, 'p'), null, h('input', { 'data-t': 'in' }), undefined, h(Fragment, null, null, h('b', { 'data-t': 'b' }, 'b'))))
    const want = await fresh(App)
    const r = await hydrate(App, { prep: (t) => { t.in.value = 'typed' } })
    expect(r.kept.length).toBe(r.all.length)
    expect(r.now('in').value).toBe('typed')
    expect(r.html()).toBe(want)
  })
})

describe('G-482: data-* attributes the client sets as attributes', () => {
  it('attrs data-* stays (the dataset copy no longer removes it)', async () => {
    const App = app(() => h('p', { attrs: { 'data-x': '1' }, 'data-t': 'p' }, 'p'))
    const want = await fresh(App)
    const r = await hydrate(App)
    expect(r.keptT('p')).toBe(true)
    expect(r.now('p').getAttribute('data-x')).toBe('1')
    expect(r.html()).toBe(want)
  })

  it('a resolved Suspense boundary keeps data-sygnal-suspense; an old server data-* goes', async () => {
    const App = app(() => h(Suspense, { fallback: 'wait' }, h('p', { 'data-t': 'p' }, 'content'), h('p', null, 'more')))
    const r = await hydrate(App, { server: '<main><div data-sygnal-suspense="resolved" data-old="1"><p data-t="p">content</p><p>more</p></div></main>' })
    const box = document.querySelector('main > div')
    expect(r.all.includes(box)).toBe(true)
    expect(box.getAttribute('data-sygnal-suspense')).toBe('resolved')
    expect(box.hasAttribute('data-old')).toBe(false)
    expect(r.kept.length).toBe(r.all.length)
  })
})

describe('G-483: style declarations only the server wrote', () => {
  it('a non-SSR mount over a spinner ends equal to a fresh render', async () => {
    function App() { return h('div', { style: { color: 'red' } }, 'Hi') }
    App.initialState = {}
    const want = await fresh(App)
    const r = await hydrate(App, { server: '<div class="spinner" style="position: fixed; inset: 0px; color: blue" aria-busy="true">Loading…</div>' })
    expect(r.html()).toBe(want)
  })

  it('a client style keeps the declarations both set, drops the rest (incl. custom properties)', async () => {
    const App = app(() => h('div', { style: { marginTop: '2px', '--k': '1' }, 'data-t': 'd' }, 'x'))
    const r = await hydrate(App, { server: '<main><div data-t="d" style="margin-top: 2px; --k: 1; --gone: 2; padding: 3px">x</div></main>' })
    expect(r.keptT('d')).toBe(true)
    const st = r.now('d').style
    expect([st.marginTop, st.getPropertyValue('--k'), st.getPropertyValue('--gone'), st.padding]).toEqual(['2px', '1', '', ''])
  })
})
