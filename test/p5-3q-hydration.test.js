// @vitest-environment jsdom
// PLAN-5 3-Q: review fixes for the hydrating first patch (3-M): `form` stays an attribute on
// custom elements (G-519), a user hook with an insert hook makes its element again (G-521),
// adjacent client text vnodes split the server's one text node (G-520), `open` (G-523: the
// documented rule). Each test fails on the 3-M code, except the G-523 ones (the rule, pinned).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, renderToString, createRef } from '../src/index.js'
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

/** The server's HTML (renderToString, or `server`) in #root, `prep` run on it, then run() */
async function hydrate(App, { server, prep } = {}) {
  const html = server ?? renderToString(App, { state: App.initialState })
  document.body.innerHTML = `<div id="root">${html}</div>`
  const all = [...document.querySelectorAll('#root *')]
  const byT = Object.fromEntries([...document.querySelectorAll('[data-t]')].map(e => [e.dataset.t, e]))
  prep?.(byT)
  const app = run(App, {}, { mountPoint: '#root' })
  apps.push(app)
  await sleep(40)
  const now = (t) => document.querySelector(`[data-t="${t}"]`)
  return { all, byT, now, app, html, keptT: (t) => now(t) === byT[t], out: () => document.getElementById('root').innerHTML }
}
const app = (view, initialState = {}) => {
  function App({ state }) { return h('main', null, view(state)) }
  App.initialState = initialState
  return App
}

describe('G-519: form is an attribute on every tag; list a prop on custom elements', () => {
  // the MDN form-associated custom element: `form` is a getter (ElementInternals.form; jsdom has
  // no form association, so the getter reads the attribute here: the browser suite checks the
  // real link)
  class FaceInput extends HTMLElement {
    static formAssociated = true
    get form() { return document.getElementById(this.getAttribute('form')) }
  }
  if (!customElements.get('p5q-face')) customElements.define('p5q-face', FaceInput)

  it('the pragma routes form to attrs on a custom element, list stays a prop', () => {
    for (const sel of ['p5q-face', 'p5q-face.c', 'p5q-face#i']) {
      const d = h(sel, { form: 'signup', list: [1, 2] }).data
      expect(d.attrs, sel).toEqual({ form: 'signup' })
      expect(d.props, sel).toEqual({ list: [1, 2] })
    }
  })

  it('a form-associated element renders (no getter-only throw) and is linked to <form id> by the attribute', async () => {
    function App() { return h('main', null, h('form', { id: 'signup' }), h('p5q-face', { form: 'signup', 'data-t': 'f' }), h('p', null, 'after')) }
    App.initialState = {}
    document.body.innerHTML = '<div id="root"></div>'
    apps.push(run(App, {}, { mountPoint: '#root' }))
    await sleep(40)
    const el = document.querySelector('p5q-face')
    expect(el.getAttribute('form')).toBe('signup')
    expect(el.form).toBe(document.getElementById('signup'))
    expect(document.querySelector('main p').textContent).toBe('after')
  })

  it('SSR writes the form attribute; hydration adopts the element and keeps the link', async () => {
    const App = app(() => h('div', null, h('form', { id: 'f1' }), h('p5q-face', { form: 'f1', 'data-t': 'f' })))
    const html = renderToString(App, { state: {} })
    expect(html).toContain('<p5q-face form="f1" data-t="f"></p5q-face>')
    const r = await hydrate(App)
    expect(r.keptT('f')).toBe(true)
    expect(r.now('f').form).toBe(document.getElementById('f1'))
  })
})

describe('G-521: a user hook with insert makes its element again at hydration', () => {
  it('insert + postpatch: insert runs once, on the element in the page', async () => {
    const calls = []
    const App = app(() => h('div', { 'data-t': 'c', hook: { insert: (v) => calls.push(['insert', v.elm.isConnected]), postpatch: () => calls.push(['postpatch']) } }, 'chart'))
    const r = await hydrate(App)
    expect(calls).toEqual([['insert', true]])
    expect(r.keptT('c')).toBe(false)
    expect(r.now('c').textContent).toBe('chart')
  })

  it('hook-insert (the module-name form) with a ref: insert runs, the ref has the new element', async () => {
    const calls = [], ref = createRef()
    const App = app(() => h('div', { 'data-t': 'c', ref, 'hook-insert': () => calls.push('insert'), 'hook-postpatch': () => calls.push('postpatch') }, 'c'))
    const r = await hydrate(App)
    expect(calls).toEqual(['insert'])
    expect(ref.current).toBe(r.now('c'))
  })

  it("Sygnal's own hooks (ref, autoFocus) still adopt; a user hook without insert too", async () => {
    const ref = createRef(), calls = []
    const App = app(() => h('div', null,
      h('input', { ref, autoFocus: true, 'data-t': 'i' }),
      h('p', { 'data-t': 'p', hook: { postpatch: () => calls.push('pp'), update: () => calls.push('u') } }, 'p')))
    const r = await hydrate(App, { prep: (t) => { t.i.value = 'typed' } })
    expect(r.keptT('i') && r.keptT('p')).toBe(true)
    expect(ref.current).toBe(r.byT.i)
    expect(r.now('i').value).toBe('typed')
    expect(calls).toContain('pp')
  })

  it('a user hook with insert is not mutated by the pragma', () => {
    const hook = { insert() {}, postpatch() {} }
    h('div', { hook })
    expect(Object.keys(hook)).toEqual(['insert', 'postpatch'])
  })
})

describe('G-520: adjacent text vnodes and the one server text node', () => {
  it("the review's probe: `Hello, {name}! <input>`: the input and its typed text are kept", async () => {
    const App = app((s) => h('p', null, 'Hello, ', s.name, '! ', h('input', { 'data-t': 'in' })), { name: 'Bob' })
    const r = await hydrate(App, { prep: (t) => { t.in.value = 'typed'; t.in.focus() } })
    expect(r.keptT('in')).toBe(true)
    expect(r.now('in').value).toBe('typed')
    expect(document.activeElement).toBe(r.now('in'))
    expect(r.now('in').parentNode.textContent).toBe('Hello, Bob! ')
  })

  it('the split text nodes are the ones a later patch updates', async () => {
    function App({ state }) { return h('main', null, h('button', { className: 'b' }, '+'), h('p', null, 'n = ', String(state.n), ' items', h('input', { 'data-t': 'in' }))) }
    App.initialState = { n: 1 }
    App.intent = ({ DOM }) => ({ INC: DOM.select('.b').events('click') })
    App.model = { INC: (s) => ({ n: s.n + 1 }) }
    const r = await hydrate(App)
    const p = r.now('in').parentNode
    expect([...p.childNodes].filter(n => n.nodeType == 3).map(n => n.data)).toEqual(['n = ', '1', ' items'])
    document.querySelector('.b').click()
    await sleep(30)
    expect(p.textContent).toBe('n = 2 items')
    expect(r.keptT('in')).toBe(true)
  })

  it('across a fragment boundary: text before and inside a fragment', async () => {
    function F() { return h(Fragment, null, 'world', h('b', null, '!')) }
    const App = app(() => h('p', null, 'hello ', h(F), h('input', { 'data-t': 'in' })))
    const r = await hydrate(App, { prep: (t) => { t.in.value = 'typed' } })
    expect(r.keptT('in')).toBe(true)
    expect(r.now('in').value).toBe('typed')
    expect(r.now('in').parentNode.innerHTML).toBe('hello world<b>!</b><input data-t="in">')
  })

  it('no prefix match (the states differ): the text is replaced, the element after is still adopted', async () => {
    const App = app((s) => h('p', null, 'Hi ', s.name, h('input', { 'data-t': 'in' })), { name: 'Ann' })
    const r = await hydrate(App, { server: '<main><p>Hi Bob<input data-t="in"></p></main>' })
    expect(r.keptT('in')).toBe(true)
    expect(r.now('in').parentNode.textContent).toBe('Hi Ann')
  })
})

describe('G-523: open (the documented rule)', () => {
  it('open={isOpen} (always a key) is controlled: state closed closes the server-open <details>', async () => {
    const App = app((s) => h('details', { open: s.isOpen, 'data-t': 'd' }, h('summary', null, 's')), { isOpen: false })
    const r = await hydrate(App, { server: '<main><details open="" data-t="d"><summary>s</summary></details></main>' })
    expect(r.keptT('d')).toBe(true)
    expect(r.now('d').open).toBe(false)
  })

  it('a conditional spread (no key when closed) is uncontrolled at hydration: the server open stays', async () => {
    const App = app((s) => h('details', { ...(s.isOpen && { open: true }), 'data-t': 'd' }, h('summary', null, 's')), { isOpen: false })
    const r = await hydrate(App, { server: '<main><details open="" data-t="d"><summary>s</summary></details></main>' })
    expect(r.now('d').open).toBe(true)
  })
})
