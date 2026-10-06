// @vitest-environment jsdom
// PLAN-5 3-Q: fragments. snabbdom's fragment vnodes (a DocumentFragment with firstChildNode /
// lastChildNode bounds set once) broke: stale bounds after hydration or after the fragment's
// first child changed made a later insert throw NotFoundError inside the DOM driver, and the app
// stopped updating (G-518); keyed fragments (a Collection item returning <>…</>) never moved
// (G-522); a child added at a fragment's end landed at the parent's end (G-517). The DOM driver
// now splices fragments into their parent before each patch (cycle/dom/utils.ts flat). Each case
// runs on a fresh client render and on a hydrated one (renderToString's markup first).
// The review's probes (3-M review, rv3m p1…p7) are the cases below.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, renderToString, Collection, Portal, Transition, Suspense, lazy } from '../src/index.js'
import { ClientOnly } from '../src/vike/ClientOnly.ts'
import { createElement as h } from '../src/pragma/index.js'
import { Fragment } from '../src/cycle/dom/fragment.ts'
import { flat } from '../src/cycle/dom/utils.ts'
import { thunk } from '../src/cycle/dom/thunk.ts'

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

/** mount App over `server` markup (hydrated) or an empty #root (fresh) */
async function mount(App, mode, server) {
  const html = mode == 'fresh' ? '' : server ?? renderToString(App, { state: App.initialState })
  document.body.innerHTML = `<div id="root">${html}</div>`
  const before = [...document.querySelectorAll('#root *')]
  const app = run(App, {}, { mountPoint: '#root' })
  apps.push(app)
  await sleep(40)
  return { before, app, out: () => document.getElementById('root').innerHTML }
}
const click = async (sel) => { document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(30) }
/** an App with a `.b` button whose click adds 1 to state.n */
const counter = (view, initialState = { n: 0 }) => {
  function App({ state }) { return h('main', null, h('button', { className: 'b' }, '+'), view(state)) }
  App.initialState = initialState
  App.intent = ({ DOM }) => ({ T: DOM.select('.b').events('click') })
  App.model = { T: (s) => ({ ...s, n: s.n + 1 }) }
  return App
}

describe('flat()', () => {
  it('keeps a tree without fragments by identity', () => {
    const v = h('div', null, h('p', null, 'a'), h('span', { className: 'x' }, h('b', null, 'c')))
    expect(flat(v)).toBe(v)
  })

  it('splices nested fragments; a keyed one keys its children (own key, else tag and count)', () => {
    const v = h('ul', null, h(Fragment, { key: 'k' }, h('li', null, 'a'), h('li', { key: 'own' }, 'b'), h(Fragment, null, h('li', null, 'c'), 'text')), h('p', null, 'z'))
    const f = flat(v)
    expect(f.children.map(c => c.key)).toEqual(['k/li#1', 'k/own', 'k/li#2', 'k/undefined#1', undefined])
    expect(f.children.map(c => c.text ?? c.children?.[0]?.text ?? c.text)).toEqual(['a', 'b', 'c', 'text', 'z'])
  })

  it('the same input vnode gives the same output (cached subtrees stay identical for snabbdom)', () => {
    const inner = h('div', null, h(Fragment, null, h('i', null, 'a')), h('b', null, 'b'))
    const v = h('section', null, h(Fragment, { key: 'k' }, h('i', null, 'a')), inner)
    const a = flat(v)
    expect(flat(v)).toBe(a)
    expect(flat(h('main', null, inner)).children[0]).toBe(a.children[1])
  })

  it("a copy writes its element to the app's vnode and keeps its own", () => {
    const i = h('i', null, 'a'), v = h('div', null, h(Fragment, { key: 'k' }, i))
    const c = flat(v).children[0], c2 = flat(h('p', null, h(Fragment, { key: 'j' }, i))).children[0]
    expect([c.key, c2.key, c.sel, c.data]).toEqual(['k/i#1', 'j/i#1', 'i', i.data])
    c.elm = 'one'; c2.elm = 'two'
    expect([c.elm, c2.elm, i.elm]).toEqual(['one', 'two', 'two'])
  })
})

for (const mode of ['fresh', 'hydrated']) describe(`fragments (${mode})`, () => {
  it('G-518: a recreated first child (hyperscript class selector), then an insert before the fragment', async () => {
    function F() { return h(Fragment, null, h('p.card', null, 'x'), h('span', null, 'y')) }
    const App = counter((s) => h('div', null, s.n ? h('b', null, 'new') : null, h(F), h('i', null, 'z')))
    const r = await mount(App, mode)
    await click('.b')
    expect(r.out()).toBe('<main><button class="b">+</button><div><b>new</b><p class="card">x</p><span>y</span><i>z</i></div></main>')
    await click('.b')
    expect(document.querySelector('main > div').innerHTML).toBe('<b>new</b><p class="card">x</p><span>y</span><i>z</i>')
  })

  it('G-518: a Transition as the first child; the app keeps updating after many patches', async () => {
    function F() { return h(Fragment, null, h(Transition, { name: 'f' }, h('p', null, 'x')), h('span', null, 'y')) }
    const App = counter((s) => h('div', null, h('output', null, String(s.n)), h('section', null, s.n % 2 ? h('i', null, 'n') : null, h(F))))
    await mount(App, mode)
    for (let i = 0; i < 3; i++) await click('.b')
    expect(document.querySelector('output').textContent).toBe('3')
    expect(document.querySelector('section').innerHTML.replace(/ class="[^"]*"/, '')).toBe('<i>n</i><p>x</p><span>y</span>')
  })

  it('G-518: <><Portal/>…</> then an insert before it (server placeholder markup)', async () => {
    const App = counter((s) => h('div', null, h('div', { id: 't' }), h('section', null, s.n ? h('i', null, 'n') : null, h(Fragment, null, h(Portal, { target: '#t' }, h('b', null, 'p')), h('span', null, 'y')))))
    const server = '<main><button class="b">+</button><div><div id="t"></div><section><div class="sygnal-portal" style="display: none" data-sygnal-portal="#t"></div><span>y</span></section></div></main>'
    await mount(App, mode, server)
    await click('.b')
    await click('.b')
    expect(document.querySelector('section').innerHTML).toBe('<i>n</i><div class="sygnal-portal" style="display: none;" data-sygnal-portal="#t"></div><span>y</span>')
    expect(document.querySelector('#t').textContent).toBe('p')
  })

  it("G-518: the fragment's first child changes tag, then an insert before the fragment (the generic case)", async () => {
    function F({ n }) { return h(Fragment, null, n >= 1 ? h('b', null, 'x') : h('p', null, 'x'), h('span', null, 'y')) }
    const App = counter((s) => h('div', null, s.n >= 2 ? h('i', null, 'n') : null, h(F, { n: s.n })))
    await mount(App, mode)
    await click('.b'); await click('.b')
    expect(document.querySelector('main > div').innerHTML).toBe('<i>n</i><b>x</b><span>y</span>')
  })

  it('G-518: lazy() + Suspense and ClientOnly as first children', async () => {
    const L = lazy(() => Promise.resolve({ default: function Lz() { return h('p', null, 'lazy') } }))
    const App = counter((s) => h('div', null, s.n ? h('i', null, 'n') : null,
      h(Fragment, null, h(Suspense, { fallback: h('em', null, 'wait') }, h(L)), h('input', { className: 'in' })),
      h(Fragment, null, h(ClientOnly, { fallback: h('em', null, 'srv') }, h('u', null, 'client')), h('s', null, 's'))))
    await mount(App, mode)
    await sleep(20)
    await click('.b')
    const html = document.querySelector('main > div').innerHTML
    expect(html.startsWith('<i>n</i>')).toBe(true)
    expect(html).toContain('<p>lazy</p>')
    expect(html.endsWith('<s>s</s>')).toBe(true)
  })

  it('G-517: a child added inside a fragment lands in its place (middle and end)', async () => {
    function F({ n }) { return h(Fragment, null, h('a', null, 'a'), n % 2 ? h('b', null, 'b') : null, h('c-x', null, 'c'), n % 2 ? h('d', null, 'd') : null) }
    const App = counter((s) => h('div', null, h(F, { n: s.n }), h('z', null, 'z')))
    await mount(App, mode)
    await click('.b')
    expect(document.querySelector('main > div').innerHTML).toBe('<a>a</a><b>b</b><c-x>c</c-x><d>d</d><z>z</z>')
    await click('.b')
    expect(document.querySelector('main > div').innerHTML).toBe('<a>a</a><c-x>c</c-x><z>z</z>')
  })

  it('G-517: inline (unkeyed) fragments with a conditional child keep the elements after them', async () => {
    const App = counter((s) => h('div', null, h(Fragment, null, h('a', null, 'a'), s.n ? h('b', null, 'b') : null), h('input', { className: 'in' })))
    await mount(App, mode)
    const input = document.querySelector('.in')
    input.value = 'typed'
    await click('.b')
    expect(document.querySelector('main > div').innerHTML).toBe('<a>a</a><b>b</b><input class="in">')
    expect(document.querySelector('.in')).toBe(input)
  })

  it('G-522: Collection items returning fragments reverse, insert and remove', async () => {
    function Item({ state }) { return h(Fragment, null, h('dt', null, state.k), h('dd', null, 'v' + state.k)) }
    function App({ state }) { return h('main', null, h('button', { className: 'rev' }, 'r'), h('button', { className: 'add' }, 'a'), h('button', { className: 'rm' }, 'x'), h('dl', null, h(Collection, { of: Item, from: 'items' }))) }
    App.initialState = { items: [{ id: 1, k: 'a' }, { id: 2, k: 'b' }, { id: 3, k: 'c' }] }
    App.intent = ({ DOM }) => ({ REV: DOM.select('.rev').events('click'), ADD: DOM.select('.add').events('click'), RM: DOM.select('.rm').events('click') })
    App.model = { REV: (s) => ({ items: [...s.items].reverse() }), ADD: (s) => ({ items: [s.items[0], { id: 9, k: 'z' }, ...s.items.slice(1)] }), RM: (s) => ({ items: s.items.slice(1) }) }
    await mount(App, mode)
    const list = () => document.querySelector('dl > div').innerHTML
    const dtA = [...document.querySelectorAll('dt')].find(e => e.textContent == 'a')
    await click('.rev')
    expect(list()).toBe('<dt>c</dt><dd>vc</dd><dt>b</dt><dd>vb</dd><dt>a</dt><dd>va</dd>')
    expect([...document.querySelectorAll('dt')].find(e => e.textContent == 'a')).toBe(dtA)
    await click('.add')
    expect(list()).toBe('<dt>c</dt><dd>vc</dd><dt>z</dt><dd>vz</dd><dt>b</dt><dd>vb</dd><dt>a</dt><dd>va</dd>')
    await click('.rm')
    expect(list()).toBe('<dt>z</dt><dd>vz</dd><dt>b</dt><dd>vb</dd><dt>a</dt><dd>va</dd>')
    await click('.rev')
    expect(list()).toBe('<dt>a</dt><dd>va</dd><dt>b</dt><dd>vb</dd><dt>z</dt><dd>vz</dd>')
  })

  it('keyed fragments in a view (`<Fragment key>`) move as a unit', async () => {
    const App = counter((s) => h('div', null, ...(s.n % 2 ? ['b', 'a'] : ['a', 'b']).map(k => h(Fragment, { key: k }, h('span', null, k), h('p', null, k + '!')))))
    await mount(App, mode)
    const spanA = document.querySelector('span')
    await click('.b')
    expect(document.querySelector('main > div').innerHTML).toBe('<span>b</span><p>b!</p><span>a</span><p>a!</p>')
    expect(document.querySelectorAll('span')[1]).toBe(spanA)
  })

  it('text-led fragment after parent text; then a sibling inserted after it', async () => {
    function F() { return h(Fragment, null, 'world', h('b', null, '!')) }
    const App = counter((s) => h('p', null, 'hello ', h(F), s.n ? h('i', null, 'n') : null, h('input', { className: 'in' })))
    await mount(App, mode)
    await click('.b')
    expect(document.querySelector('p').innerHTML).toBe('hello world<b>!</b><i>n</i><input class="in">')
  })

  it('a fragment inside SVG keeps the SVG namespace', async () => {
    function F() { return h(Fragment, null, h('circle', { attrs: { r: 1 } }), h('rect', { attrs: { width: 2 } })) }
    const App = counter(() => h('svg', null, h(F), h('g', { attrs: { id: 'g' } })))
    await mount(App, mode)
    expect([...document.querySelectorAll('svg *')].map(e => e.namespaceURI)).toEqual(Array(3).fill('http://www.w3.org/2000/svg'))
    expect(document.querySelector('svg').innerHTML).toBe('<circle r="1"></circle><rect width="2"></rect><g id="g"></g>')
  })

  it('an empty fragment becoming non-empty and back, between siblings', async () => {
    function F({ n }) { return n % 2 ? h(Fragment, null, h('span', null, 'a'), h('span', null, 'b')) : h(Fragment, null) }
    const App = counter((s) => h('div', null, h('b', null, 'pre'), h(F, { n: s.n }), h('input', { className: 'in' })))
    await mount(App, mode)
    await click('.b')
    expect(document.querySelector('main > div').innerHTML).toBe('<b>pre</b><span>a</span><span>b</span><input class="in">')
    await click('.b')
    expect(document.querySelector('main > div').innerHTML).toBe('<b>pre</b><input class="in">')
  })

  it('a root fragment (the app view itself)', async () => {
    function App({ state }) { return h(Fragment, null, h('button', { className: 'b' }, '+'), state.n ? h('i', null, 'n') : null, h('p', null, String(state.n))) }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ T: DOM.select('.b').events('click') })
    App.model = { T: (s) => ({ n: s.n + 1 }) }
    const r = await mount(App, mode)
    await click('.b')
    expect(r.out().replace(' data-sygnal-ssr=""', '')).toBe('<button class="b">+</button><i>n</i><p>1</p>')
  })
})

describe('hydration keeps the server elements in and after fragments', () => {
  it('Collection items returning fragments are adopted', async () => {
    function Item({ state }) { return h(Fragment, null, h('dt', null, state.k), h('dd', null, 'v' + state.k)) }
    function App() { return h('main', null, h('dl', null, h(Collection, { of: Item, from: 'items' })), h('input', { className: 'in' })) }
    App.initialState = { items: [{ id: 1, k: 'a' }, { id: 2, k: 'b' }] }
    const r = await mount(App, 'hydrated')
    expect(r.before.every(e => e.isConnected)).toBe(true)
  })

  it('a Portal inside a fragment: its siblings are adopted', async () => {
    function App() { return h('main', null, h('div', { id: 't' }), h('section', null, h(Fragment, null, h(Portal, { target: '#t' }, h('b', null, 'p')), h('span', { className: 'y' }, 'y'))), h('input', { className: 'in' })) }
    App.initialState = {}
    const r = await mount(App, 'hydrated')
    const kept = (sel) => r.before.includes(document.querySelector(sel))
    expect(kept('.y') && kept('.in')).toBe(true)
    expect(document.querySelector('#t').textContent).toBe('p')
  })
})

describe('Portal children', () => {
  it('a fragment among a Portal\'s children renders its elements', async () => {
    function App() { return h('main', null, h('div', { id: 't' }), h(Portal, { target: '#t' }, h(Fragment, null, h('b', null, '1'), h('i', null, '2')))) }
    App.initialState = {}
    await mount(App, 'fresh')
    expect(document.querySelector('#t > div').innerHTML).toBe('<b>1</b><i>2</i>')
  })
})

describe('thunk', () => {
  it("a fragment in a thunk's output (rendered during the patch) renders its elements", async () => {
    const render = (n) => h('div', null, h(Fragment, null, h('b', null, 'x' + n), h('i', null, 'y')), h('u', null, 'z'))
    const App = counter((s) => thunk('div', render, [s.n]))
    await mount(App, 'fresh')
    expect(document.querySelector('main > div').innerHTML).toBe('<b>x0</b><i>y</i><u>z</u>')
    await click('.b')
    expect(document.querySelector('main > div').innerHTML).toBe('<b>x1</b><i>y</i><u>z</u>')
  })
})

describe('a patch that throws', () => {
  // 3-V G-540: the guard no longer adopts the DOM again (that wiped widgets and duplicated
  // Portals): the error is reported once and the app's DOM stops updating (test/p5-3v-review)
  it('is reported once; the app no longer patches (the DOM stream still does not end)', async () => {
    let boom = 0
    const App = counter((s) => h('div', null,
      h('p', { hook: { update: () => { if (s.n == 1 && !boom++) throw new Error('hook failed') } } }, 'n=' + s.n),
      h('i', null, String(s.n))))
    await mount(App, 'fresh')
    await click('.b')
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual(['Error: hook failed'])
    errors.mockClear()
    await click('.b'); await click('.b')
    expect(document.querySelector('main > div').innerHTML).toBe('<p>n=0</p><i>0</i>')
    expect(errors).not.toHaveBeenCalled()
  })
})
