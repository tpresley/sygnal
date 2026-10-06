// @vitest-environment jsdom
// PLAN-5 3-J (G-456, G-466, D217): the app's first patch over markup already in its mount point
// (server HTML from renderToString, an Astro island, a Vike page) adopts the elements that match
// the client's vnodes: the same element (identity), its focus, typed text and scroll, and the
// server's attributes the client also renders. Before, snabbdom's toVNode put class and id in the
// selector (the pragma doesn't) and had no keys, so every element with a class or id, every keyed
// child (component roots, Collection items) and each later sibling was replaced; on a kept element
// the attributes module removed what the props module had just written (href, type, style,
// title, option value). A mismatch ends equal to a fresh client render. (The spike's probes:
// dev-plans/research/p5-g456 on branch p5-g456-spike.)
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, renderToString, Collection, VirtualCollection, Portal, Transition, createRef } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { Toaster } from '../src/ui/toaster.ts'

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

describe('3-J: each element kind is adopted with its attributes', () => {
  const cases = {
    plain: () => h('p', { 'data-t': 'x' }, 'plain text'),
    className: () => h('p', { className: 'c1 c2', 'data-t': 'x' }, 'with class'),
    classObj: () => h('p', { class: { k: true, off: false }, 'data-t': 'x' }, 'class object'),
    classBoth: () => h('p', { className: 'a', class: { k: true }, 'data-t': 'x' }, 'both'),
    id: () => h('p', { id: 'pid', 'data-t': 'x' }, 'with id'),
    href: () => h('a', { href: '/x', 'data-t': 'x' }, 'link'),
    attrs: () => h('div', { title: 'tt', role: 'note', 'aria-label': 'L', tabindex: 0, 'data-t': 'x' }, 'attrs'),
    style: () => h('div', { style: { color: 'red', marginTop: '2px' }, 'data-t': 'x' }, 'style'),
    dataset: () => h('div', { 'data-t': 'x', 'data-task-id': '7' }, 'data'),
    label: () => h('label', { htmlFor: 'f', 'data-t': 'x' }, 'label'),
    checkbox: () => h('input', { type: 'checkbox', 'data-t': 'x' }),
    disabled: () => h('button', { disabled: true, type: 'button', 'data-t': 'x' }, 'b'),
    img: () => h('img', { src: '/a.png', alt: 'a', width: 10, 'data-t': 'x' }),
    option: () => h('select', { 'data-t': 'x' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')),
    svg: () => h('svg', { viewBox: '0 0 10 10', className: 'icon', 'data-t': 'x' }, h('circle', { cx: 5, cy: 5, r: 2 })),
    svgCamel: () => h('svg', { 'data-t': 'x' }, h('defs', null, h('linearGradient', { id: 'g' }, h('stop', { offset: '0' }))), h('rect', { width: 5, height: 5, className: 'r' })),
    nested: () => h('div', { 'data-t': 'x' }, h('span', { className: 's' }, 'k'), h('b', null, 'b'), h('i', { id: 'i' }, 'i')),
  }
  for (const [name, view] of Object.entries(cases)) {
    it(name, async () => {
      const App = app(view)
      const want = await fresh(App)
      const r = await hydrate(App)
      const x = r.byT.x
      const server = attrs(x)
      expect(r.keptT('x'), 'the element is adopted').toBe(true)
      expect(r.kept.length, 'every descendant is adopted').toBe(r.all.length)
      expect(r.html()).toBe(want)
      // the server's attributes are the client's (data-sygnal-ssr is on main, not here)
      expect(attrs(r.now('x'))).toBe(server)
    })
  }

  it('a text child keeps its text node', async () => {
    const r = await hydrate(app(() => h('p', { className: 'c', 'data-t': 'x' }, 'hello')))
    expect(r.textKept('x')).toBe(true)
  })

  it('data-sygnal-ssr goes from the root element, which is adopted', async () => {
    const App = app(() => h('p', null, 'x'))
    const r = await hydrate(App)
    const main = r.all[0]
    expect(main.tagName).toBe('MAIN')
    expect(main.isConnected).toBe(true)
    expect(main.hasAttribute('data-sygnal-ssr')).toBe(false)
  })
})

describe('3-J: typed text, focus, scroll', () => {
  it('an uncontrolled input (with a class) keeps typed text and focus', async () => {
    const App = app(() => h('div', null, h('input', { className: 'f', 'data-t': 'in' }), h('input', { 'data-t': 'plain' })))
    const r = await hydrate(App, { prep: (t) => { t.in.value = 'typed'; t.plain.value = 'too'; t.in.focus() } })
    expect(r.keptT('in')).toBe(true)
    expect(r.now('in').value).toBe('typed')
    expect(r.now('plain').value).toBe('too')
    expect(document.activeElement).toBe(r.now('in'))
  })

  it('a controlled input is adopted and shows the state (as any controlled field)', async () => {
    const App = app((s) => h('input', { value: s.v, className: 'c', 'data-t': 'in' }), { v: 'ctl' })
    const r = await hydrate(App, { prep: (t) => { t.in.value = 'typed'; t.in.focus() } })
    expect(r.keptT('in')).toBe(true)
    expect(r.now('in').value).toBe('ctl')
    expect(document.activeElement).toBe(r.now('in'))
  })

  it('a checkbox the user checked before start-up: uncontrolled keeps it, controlled shows the state', async () => {
    const App = app((s) => h('div', null, h('input', { type: 'checkbox', 'data-t': 'u' }), h('input', { type: 'checkbox', checked: s.c, 'data-t': 'c' })), { c: false })
    const r = await hydrate(App, { prep: (t) => { t.u.checked = true; t.c.checked = true } })
    expect(r.keptT('u') && r.keptT('c')).toBe(true)
    expect(r.now('u').checked).toBe(true)
    expect(r.now('c').checked).toBe(false)
    expect(r.now('u').type).toBe('checkbox')
  })

  it('a scrolled element keeps its scroll position', async () => {
    const App = app(() => h('div', { className: 'scroller', 'data-t': 's' }, h('p', null, 'tall')))
    const r = await hydrate(App, { prep: (t) => { t.s.scrollTop = 100 } })
    expect(r.keptT('s')).toBe(true)
    expect(r.now('s').scrollTop).toBe(100)
  })
})

describe('3-J: keyed children', () => {
  function Item({ state }) { return h('li', { className: 'it', 'data-t': 'item-' + state.id }, state.label) }
  function Child() { return h('section', { className: 'cc', 'data-t': 'comp' }, h('span', { 'data-t': 'inner' }, 'child')) }
  const items = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }, { id: 3, label: 'three' }]

  it('Collection items and their wrapper', async () => {
    const App = app(() => h('ul', { className: 'list', 'data-t': 'ul' }, h(Collection, { of: Item, from: 'items' })), { items })
    const want = await fresh(App)
    const r = await hydrate(App)
    expect(r.kept.length).toBe(r.all.length)
    for (const t of ['ul', 'item-1', 'item-2', 'item-3']) expect(r.keptT(t), t).toBe(true)
    expect(r.html()).toBe(want)
  })

  it('a component root (with a class), and the siblings after it', async () => {
    const App = app(() => h('div', null, h(Child), h('p', { 'data-t': 'after' }, 'after'), h(Child)))
    const want = await fresh(App)
    const r = await hydrate(App)
    expect(r.kept.length).toBe(r.all.length)
    expect(r.html()).toBe(want)
  })

  it('a later change to the Collection patches the adopted items', async () => {
    const App = app((s) => h('ul', null, h(Collection, { of: Item, from: 'items' })), { items })
    App.intent = ({ DOM }) => ({ REV: DOM.select('ul').events('click') })
    App.model = { REV: (s) => ({ ...s, items: [...s.items].reverse() }) }
    const r = await hydrate(App)
    const one = r.now('item-1')
    expect(one).toBe(r.byT['item-1'])
    document.querySelector('ul').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await sleep(20)
    expect([...document.querySelectorAll('li')].map(l => l.textContent)).toEqual(['three', 'two', 'one'])
    expect(r.now('item-1')).toBe(one)
  })

  it('events reach the adopted elements and their components', async () => {
    let n = 0
    function Btn() { return h('button', { className: 'b', 'data-t': 'b' }, 'go') }
    Btn.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
    Btn.model = { GO: { EFFECT: () => { n++ } } }
    const App = app(() => h('div', { className: 'w' }, h(Btn)))
    const r = await hydrate(App)
    expect(r.keptT('b')).toBe(true)
    r.now('b').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await sleep(10)
    expect(n).toBe(1)
  })
})

describe('3-J: markup the client renders differently', () => {
  const cases = {
    staleAttrs: [() => h('div', null, h('a', { title: 'new' }, 'x'), h('p', { className: 'b' }, 'y')),
      '<div><a href="/old" title="old" class="stale" data-old="1" style="color: red">x</a><p class="a b" id="stale">y</p></div>'],
    extraClientEl: [() => h('div', null, h('span', null, 'new'), h('p', { className: 'p' }, 'y')), '<div><p class="p">y</p></div>'],
    extraServerEl: [() => h('div', null, h('p', { className: 'p' }, 'y')), '<div><span>old</span><p class="p">y</p></div>'],
    otherTag: [() => h('div', null, h('section', null, 'a'), h('p', null, 'b')), '<div><article>a</article><p>b</p></div>'],
    textVsElement: [() => h('div', null, h('b', null, 'x')), '<div>x</div>'],
    elementVsText: [() => h('div', null, 'x'), '<div><b>x</b></div>'],
    moreText: [() => h('p', null, 'a', h('b', null, 'b'), 'c'), '<p>a<b>b</b></p>'],
    lessKids: [() => h('ul', null, h('li', null, '1')), '<ul><li>1</li><li>2</li><li>3</li></ul>'],
    voidWithKids: [() => h('div', null), '<div><p>x</p> y </div>'],
    styleDecls: [() => h('div', { style: { color: 'red' } }, 'x'), '<div style="color: red; margin: 0px">x</div>'],
  }
  for (const [name, [view, server]] of Object.entries(cases)) {
    it(name, async () => {
      function App() { return view() }
      App.initialState = {}
      const want = await fresh(App)
      const r = await hydrate(App, { server })
      expect(r.html()).toBe(want)
    })
  }

  it('the matching elements around a mismatch are still adopted (no cascade)', async () => {
    function App() { return h('div', null, h('p', { className: 'a', 'data-t': 'a' }, 'a'), h('span', { 'data-t': 'new' }, 'n'), h('p', { className: 'b', 'data-t': 'b' }, 'b'), h('p', { className: 'c', 'data-t': 'c' }, 'c')) }
    App.initialState = {}
    const r = await hydrate(App, { server: '<div><p class="a" data-t="a">a</p><em>old</em><p class="b" data-t="b">b</p><p class="c" data-t="c">c</p></div>' })
    for (const t of ['a', 'b', 'c']) expect(r.keptT(t), t).toBe(true)
    expect(r.html()).toBe(await fresh(App))
  })
})

describe('3-J: the mount point', () => {
  it('whitespace and comments around the app root (a template) go; the root is adopted', async () => {
    const App = app(() => h('p', null, 'a ', h('b', null, 'b'), ' c'))
    const want = await fresh(App)
    const r = await hydrate(App, { wrap: (html) => `<div id="root">\n  <!-- ssr -->\n  ${html}\n</div>` })
    expect(r.kept.length).toBe(r.all.length)
    expect(r.html()).toBe(want)
  })

  it("G-466: the mount point's own attributes are kept", async () => {
    const App = app(() => h('p', null, 'x'))
    const r = await hydrate(App, { wrap: (html) => `<div id="root" class="shell" data-theme="dark" style="color: red;" title="c">${html}</div>` })
    expect(attrs(document.getElementById('root'))).toBe('class=shell data-theme=dark id=root style=color: red; title=c')
    expect(r.kept.length).toBe(r.all.length)
  })

  it('an app root that is the mount point itself (same tag and id) is adopted', async () => {
    // (VNodeWrapper: the same tag, id and class as the mount point; before, `div` vs toVNode's
    // `div#root` replaced it)
    function App() { return h('div', { id: 'root', title: 't' }, h('p', { className: 'k' }, 'x')) }
    App.initialState = {}
    document.body.innerHTML = '<div id="root" data-x="1"><p class="k">x</p></div>'
    const root = document.getElementById('root'), p = root.firstChild
    apps.push(run(App, {}, { mountPoint: '#root' }))
    await sleep(30)
    expect(document.getElementById('root')).toBe(root)
    expect(root.firstChild).toBe(p)
    expect(attrs(root)).toBe('data-x=1 id=root title=t')
  })

  it('an empty mount point renders as before', async () => {
    const App = app(() => h('p', { className: 'k' }, 'x'))
    document.body.innerHTML = '<div id="root"></div>'
    apps.push(run(App, {}, { mountPoint: '#root' }))
    await sleep(30)
    expect(document.getElementById('root').innerHTML).toBe('<main><p class="k">x</p></main>')
  })
})

describe('3-J: hooks', () => {
  it('an element with an insert-only hook (Transition enter) is made again in place, without a cascade', async () => {
    const App = app(() => h('div', null, h(Transition, { name: 'fade', duration: 1 }, h('p', { className: 't', 'data-t': 't' }, 'T')), h('p', { className: 'after', 'data-t': 'after' }, 'after')))
    const r = await hydrate(App)
    expect(r.now('t')).toBeTruthy()
    expect(r.keptT('t')).toBe(false)
    expect(r.keptT('after')).toBe(true)
    expect(r.html()).toBe(await fresh(App))
  })

  it('VirtualCollection: the container is adopted, its rows (measured on insert) made again', async () => {
    function Row({ state }) { return h('div', { 'data-t': 'row-' + state.id }, state.label) }
    const App = app(() => h('div', { 'data-t': 'wrap' }, h(VirtualCollection, { of: Row, from: 'items', estimateSize: 20, className: 'vc' })), { items: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }] })
    const html = renderToString(App, { state: App.initialState })
    const r = await hydrate(App, { server: html })
    expect(r.keptT('wrap')).toBe(true)
    const vc = document.querySelector('.vc')
    expect(vc).toBeTruthy()
    expect(r.all.includes(vc)).toBe(true)
    // the server's rows are made again (keyed, insert-only hook); the client's rows render
    expect(r.byT['row-1']).toBeTruthy()
    expect(r.keptT('row-1')).toBe(false)
    expect(r.now('row-1')?.textContent).toBe('one')
    expect(document.querySelectorAll('[data-t="row-1"]').length).toBe(1)
  })

  it('the toaster region (placed by its insert hook) is made again in its adopted home', async () => {
    const App = app(() => h('div', { className: 'page' }, h('p', { 'data-t': 'p' }, 'p'), h(Toaster)))
    const r = await hydrate(App)
    const home = r.all.find(e => e.className == 'toaster-home'), region = r.all.find(e => e.localName == 'section')
    expect(home.isConnected).toBe(true)
    expect(region.isConnected).toBe(false)
    expect(document.querySelectorAll('section.toaster').length).toBe(1)
    expect(document.querySelector('section.toaster').parentNode).toBe(home)
    expect(r.keptT('p')).toBe(true)
  })

  it('a ref and autoFocus on adopted elements', async () => {
    const ref = createRef()
    const App = app(() => h('div', null, h('input', { className: 'af', autoFocus: true, 'data-t': 'af' }), h('p', { ref, className: 'r', 'data-t': 'r' }, 'r')))
    const r = await hydrate(App)
    expect(r.keptT('af')).toBe(true)
    expect(r.keptT('r')).toBe(true)
    expect(ref.current).toBe(r.byT.r)
    expect(document.activeElement).toBe(r.byT.af)
  })

  // 3-Q G-521: was adopted (postpatch ran, insert never did: a chart never initialised)
  it('a hook with insert and postpatch: made again, its insert runs', async () => {
    const calls = []
    const hook = { insert: (v) => calls.push(['insert', v.elm]), postpatch: (o, v) => calls.push(['postpatch', v.elm]) }
    const App = app(() => h('div', { hook, className: 'h', 'data-t': 'h' }, 'x'))
    const r = await hydrate(App)
    expect(r.keptT('h')).toBe(false)
    expect(calls).toEqual([['insert', r.now('h')]])
  })

  it('a hook with insert only: made again in place, its insert runs', async () => {
    const calls = []
    const hook = { insert: (v) => calls.push(v.elm) }
    const App = app(() => h('div', null, h('div', { hook, 'data-t': 'h' }, 'x'), h('p', { 'data-t': 'p' }, 'p')))
    const r = await hydrate(App)
    expect(r.keptT('h')).toBe(false)
    expect(r.keptT('p')).toBe(true)
    expect(calls).toEqual([r.now('h')])
  })

  it('Portal: its content reaches the target; the elements around it are adopted', async () => {
    const App = app(() => h('div', null, h('div', { id: 'target', 'data-t': 'target' }), h(Portal, { target: '#target' }, h('p', { className: 'ported' }, 'P')), h('p', { className: 'after', 'data-t': 'after' }, 'a')))
    const r = await hydrate(App)
    await sleep(30)
    expect(r.keptT('target')).toBe(true)
    expect(r.keptT('after')).toBe(true)
    expect(document.querySelectorAll('.ported').length).toBe(1)
    expect(document.querySelector('#target .ported')).toBeTruthy()
  })
})

describe('3-J: other shapes', () => {
  it('a fragment-rooted component', async () => {
    function Frag() { return [h('p', { className: 'f1' }, '1'), h('p', { className: 'f2' }, '2')] }
    const App = app(() => h('div', null, h('span', null, 's'), h(Frag), h('b', null, 'b')))
    const want = await fresh(App)
    const r = await hydrate(App)
    expect(r.html()).toBe(want)
  })

  it('a hyperscript selector with class and id (h("div#sid.sel")): made again (3-M G-486), the rest adopted', async () => {
    const App = app(() => h('div', null, h('div#sid.sel', null, h('p', null, 'x')), h('p', { 'data-t': 'after' }, 'y')))
    const want = await fresh(App)
    const r = await hydrate(App, { server: '<main><div><div class="sel" id="sid"><p>x</p></div><p data-t="after">y</p></div></main>' })
    expect(document.querySelector('#sid')).not.toBe(r.all.find(e => e.id == 'sid'))
    expect(r.keptT('after')).toBe(true)
    expect(r.html()).toBe(want)
  })

  it('an element with an innerHTML prop', async () => {
    const App = app(() => h('div', { className: 'md', innerHTML: '<b>bold</b> text', 'data-t': 'md' }))
    const want = await fresh(App)
    const r = await hydrate(App)
    expect(r.keptT('md')).toBe(true)
    expect(r.html()).toBe(want)
  })

  it('textarea and select values', async () => {
    const App = app((s) => h('div', null, h('textarea', { value: s.t, 'data-t': 'ta' }), h('select', { value: s.s, 'data-t': 'sel' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'))), { t: 'tv', s: 'b' })
    const r = await hydrate(App)
    expect(r.keptT('ta') && r.keptT('sel')).toBe(true)
    expect(r.now('ta').value).toBe('tv')
    expect(r.now('sel').value).toBe('b')
  })

  it('later patches after the adopting one work as before', async () => {
    const App = app((s) => h('div', { className: s.n % 2 ? 'odd' : 'even', 'data-t': 'd' }, h('button', { className: 'inc' }, 'inc'), h('span', null, String(s.n))), { n: 0 })
    App.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
    App.model = { INC: (s) => ({ n: s.n + 1 }) }
    const r = await hydrate(App)
    expect(r.keptT('d')).toBe(true)
    document.querySelector('.inc').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await sleep(20)
    expect(r.now('d')).toBe(r.byT.d)
    expect(r.html()).toBe('<main><div class="odd" data-t="d"><button class="inc">inc</button><span>1</span></div></main>')
  })
})
