// @vitest-environment jsdom
// PLAN-5 3-W: after a patch error (D224, G-543) the app's root element is marked
// data-sygnal-error="patch" (removed on dispose); only dispose patches a stopped app (G-549); a
// user-supplied DOM driver reports to onError too (G-545); a throwing hooks' onError or
// renderComponent onError is logged and swallowed (G-546 / G-547); and the review of 3-V's derived
// keys: linear in the nesting depth (G-544), BigInt / Symbol keys don't throw (G-548).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, makeViewTransitionDOMDriver } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.ts'
import { Fragment } from '../src/cycle/dom/fragment.ts'
import { flat } from '../src/cycle/dom/utils.ts'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let apps = [], errors
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1))
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
const click = async (sel = '.b') => { document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(30) }
const counter = (view) => {
  function App({ state }) { return view(state) ?? h('main', null, h('button', { className: 'b' }, '+'), h('output', null, String(state.n)), bomb(state.n)) }
  App.initialState = { n: 0 }
  App.intent = ({ DOM }) => ({ T: DOM.select('.b').events('click') })
  App.model = { T: (s) => ({ n: s.n + 1 }) }
  return App
}
async function mount(App, opts = {}, drivers = {}) {
  document.body.innerHTML = '<div id="root"></div>'
  const app = run(App, drivers, { mountPoint: '#root', ...opts })
  apps.push(app)
  await sleep(40)
  return app
}
let armed = false
const bomb = (n) => h('i', { hook: { update: () => { if (armed) { armed = false; throw new Error('once') } } } }, String(n))
const root = () => document.querySelector('#root')
const out = () => document.querySelector('output')?.textContent

describe('G-543 (D224): the root element is marked after a patch error', () => {
  it('absent normally; data-sygnal-error="patch" once DOM updates stop; removed on dispose', async () => {
    const app = await mount(counter(() => null))
    await click()
    expect(out()).toBe('1')
    expect(root().hasAttribute('data-sygnal-error')).toBe(false)
    armed = true
    await click()
    expect(root().getAttribute('data-sygnal-error')).toBe('patch')
    expect(root().matches('[data-sygnal-error="patch"]')).toBe(true)
    await click()
    expect(root().getAttribute('data-sygnal-error')).toBe('patch')
    app.dispose(); apps = []
    await sleep(30)
    expect(root().hasAttribute('data-sygnal-error')).toBe(false)
    expect(root().innerHTML).toBe('')
  })
})

describe('G-549: after a patch error only dispose patches the app', () => {
  it('a render with no children (the view returns null) is not patched', async () => {
    const app = await mount(counter((s) => s.n >= 2 ? null : undefined))
    armed = true
    await click()
    const html = root().innerHTML
    await click()                 // n = 2: the view returns null (a root vnode with no children)
    expect(root().innerHTML).toBe(html)
    expect(out()).toBe('1')           // written by the failed patch before the hook threw
    app.dispose(); apps = []
    await sleep(30)
    expect(root().innerHTML).toBe('')
  })
})

describe('G-545: a DOM driver passed to run() reports patch errors to onError', () => {
  it('makeViewTransitionDOMDriver: onError gets phase patch (not console.error), and the root is marked', async () => {
    const seen = []
    await mount(counter(() => null), { onError: (e, i) => seen.push([e.message, i.phase]) }, { DOM: makeViewTransitionDOMDriver('#root') })
    armed = true
    await click()
    expect(seen).toEqual([['once', 'patch']])
    expect(errors).not.toHaveBeenCalled()
    expect(root().getAttribute('data-sygnal-error')).toBe('patch')
  })
})

describe("G-546: a throwing hooks' onError is logged and swallowed", () => {
  it('patch phase: the app keeps running (state, events)', async () => {
    let n = 0
    const App = counter(() => null)
    App.model = { T: (s) => (n++, { n: s.n + 1 }) }
    await mount(App, { onError: () => {}, __hooks: { onError: () => { throw new Error('hookthrow') } } })
    armed = true
    await click(); await click()
    expect(n).toBe(2)
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual(['Error: hookthrow'])
  })

  it('a view error: the error boundary still renders', async () => {
    function Kid() { throw new Error('view') }
    Kid.onError = () => h('p', { className: 'fb' }, 'fallback')
    function App() { return h('main', null, h(Kid)) }
    await mount(App, { onError: () => {}, __hooks: { onError: () => { throw new Error('hookthrow') } } })
    expect(document.querySelector('.fb')?.textContent).toBe('fallback')
    expect(errors.mock.calls.map(c => String(c[0]))).toContain('Error: hookthrow')
  })
})

describe("G-547: renderComponent({ dom: 'real' }) guards a throwing onError", () => {
  it('logged and swallowed; the state goes on', async () => {
    const t = renderComponent(counter(() => null), { dom: 'real', onError: () => { throw new Error('userOnError') } })
    await t.ready()
    armed = true
    t.query('.b').click(); await t.waitForState(s => s.n == 1)
    t.query('.b').click(); await t.waitForState(s => s.n == 2)
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual(['Error: userOnError'])
    t.dispose()
  })
})

describe('G-544 / G-548: derived keys', () => {
  it('nested keyed fragments: key length grows linearly (no JSON-in-JSON doubling)', () => {
    let f = h('i', null, 'leaf')
    for (let i = 0; i < 40; i++) f = h(Fragment, { key: 'k' + i }, f)
    const k = flat(h('div', null, f)).children[0].key
    expect(k.length).toBeLessThan(400)
  })

  it('recursive keyed-fragment components 30 deep: renders and patches', async () => {
    function Node({ depth }) { return h(Fragment, null, h('span', null, 'd' + depth), depth > 0 ? h(Node, { key: 'n', depth: depth - 1 }) : null) }
    await mount(counter((s) => h('main', null, h('button', { className: 'b' }), h('output', null, String(s.n)), h('div', null, h(Node, { key: 't', depth: 30 })))))
    await click()
    expect(out()).toBe('1')
    expect(document.querySelectorAll('span').length).toBe(31)
    expect(errors).not.toHaveBeenCalled()
  })

  it('distinct paths still give distinct keys (prefix + key, tag and count)', () => {
    const keys = flat(h('ul', null,
      h(Fragment, { key: 'src' }, h('li', { key: 'a/b.ts' })),
      h(Fragment, { key: 'src/a' }, h('li', { key: 'b.ts' })),
      h(Fragment, { key: 'k' }, h('li', { key: 'li1' }), h('li', null), h(Fragment, { key: 'x' }, h('li', null))),
      h(Fragment, { key: 1 }, h('li', null)),
      h(Fragment, { key: '1:' }, h('li', null)))).children.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('a BigInt or Symbol key does not throw', () => {
    expect(() => flat(h('div', null, h(Fragment, { key: 1n }, h('i'))))).not.toThrow()
    expect(() => flat(h('div', null, h(Fragment, { key: 'k' }, h('i', { key: Symbol('a') }), h('i', { key: 2n }))))).not.toThrow()
  })
})
