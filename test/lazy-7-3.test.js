// @vitest-environment jsdom
// 7.3 (Sift's code split): lazy() without `when` imports at the first render, not at lazy();
// renderComponent starts every import at render and settle() waits for it; a failed import renders
// the owner's onError fallback and is tried again by load() or the next mount; load() can be
// called any number of times. On a server (no document) the import starts at lazy(): lazy-7-3-ssr.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, lazy, Outlet, renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const sleep = (ms = 10) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 5 })
function Page({ title }) { return h('p', { className: 'page' }, title || 'page') }
let app
afterEach(() => { app?.dispose(); app = null; vi.restoreAllMocks() })

describe('A: no `when`: the import starts at the first render', () => {
  it('a route table imports only the page shown, and the next one when it is shown', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const loads = { a: 0, b: 0, c: 0 }
    const PAGES = Object.fromEntries(Object.keys(loads).map(k => [k, lazy(() => (loads[k]++, Promise.resolve({ default: () => h('p', { className: 'page' }, k) })))]))
    expect(loads).toEqual({ a: 0, b: 0, c: 0 })
    function Root({ state }) { return h('main', null, [h(Outlet, { of: PAGES, current: state.page })]) }
    Root.initialState = { page: 'a' }
    Root.model = { GO: (s, page) => ({ ...s, page }) }
    app = run(Root, {}, { mountPoint: '#root' })
    await until(() => expect(document.querySelector('.page')?.textContent).toBe('a'))
    expect(loads).toEqual({ a: 1, b: 0, c: 0 })
    app.__runtime.dispatch('root', 'GO', 'b')
    await until(() => expect(document.querySelector('.page')?.textContent).toBe('b'))
    expect(loads).toEqual({ a: 1, b: 1, c: 0 })
  })

  it("when: 'render' is the same; the placeholder is the loading one (a Suspense boundary waits for it)", async () => {
    const load = vi.fn(() => new Promise(() => {}))
    const L = lazy(load, { when: 'render' })
    function Root() { return h('div', null, [h(L)]) }
    Root.initialState = {}
    const t = renderComponent(Root)
    await t.ready()
    expect(load).toHaveBeenCalledTimes(1)
    expect(t.html()).toContain('data-sygnal-lazy="loading"')
    t.dispose()
  })
})

describe('B: renderComponent starts deferred imports, and settle() waits for them', () => {
  it("Sift's repro: an Outlet page with when: 'idle' shows after settle()", async () => {
    let imports = 0
    const A = lazy(() => (imports++, sleep(30).then(() => ({ default: Page }))), { when: 'idle' })
    function Root({ state }) { return h('main', null, [h(Outlet, { of: { a: A }, current: state.page })]) }
    Root.initialState = { page: 'a' }
    const t = renderComponent(Root)
    await t.ready()
    await t.settle()
    expect(imports).toBe(1)
    expect(t.html()).toContain('class="page"')
    t.dispose()
  })
})

describe('C: a failed import', () => {
  it("renders the owner's onError fallback in its place; load() tries again and the component replaces it", async () => {
    document.body.innerHTML = '<div id="root"></div>'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0, fail = true
    const A = lazy(() => (calls++, fail ? Promise.reject(new Error('Failed to fetch dynamically imported module')) : Promise.resolve({ default: Page })))
    const seen = []
    function Root() { return h('main', null, [h('h1', null, 'app'), h(A, { title: 'back' })]) }
    Root.initialState = {}
    Root.onError = (e, { componentName }) => (seen.push([e.message, componentName]), h('p', { className: 'oops' }, 'reload?'))
    app = run(Root, {}, { mountPoint: '#root' })
    await until(() => expect(document.querySelector('.oops')).not.toBe(null))
    expect(seen).toEqual([['Failed to fetch dynamically imported module', 'lazy']])
    expect(document.querySelector('h1').textContent).toBe('app')
    await sleep(30)
    expect(calls).toBe(1)
    fail = false
    await A.load()
    await until(() => expect(document.querySelector('.page')?.textContent).toBe('back'))
    expect(document.querySelector('.oops')).toBe(null)
    expect(calls).toBe(2)
  })

  it('without onError: the error <div>; the next mount tries again, a render of the owner does not', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const A = lazy(() => (calls++, Promise.reject(new Error('nope'))))
    function Root({ state }) { return h('main', null, [h('span', null, String(state.n)), state.show ? h(A) : null]) }
    Root.initialState = { n: 0, show: true }
    Root.model = { TICK: (s) => ({ ...s, n: s.n + 1 }), SHOW: (s, show) => ({ ...s, show }) }
    app = run(Root, {}, { mountPoint: '#root' })
    await until(() => expect(document.querySelector('[data-sygnal-error="lazy"]')).not.toBe(null))
    app.__runtime.dispatch('root', 'TICK')
    await sleep(30)
    expect(document.querySelector('span').textContent).toBe('1')
    expect(calls).toBe(1)
    app.__runtime.dispatch('root', 'SHOW', false)
    await sleep(20)
    app.__runtime.dispatch('root', 'SHOW', true)
    await until(() => expect(calls).toBe(2))
    await until(() => expect(document.querySelector('[data-sygnal-error="lazy"]')).not.toBe(null))
    await sleep(30)
    expect(calls).toBe(2)
  })
})

describe('D: load() any number of times', () => {
  it('returns the one import, before and after it has loaded', async () => {
    for (const when of [undefined, 'idle', 'visible']) {
      const load = vi.fn(() => Promise.resolve({ default: Page }))
      const A = lazy(load, when && { when })
      const p = A.load()
      expect(A.load()).toBe(p)
      await p
      expect(A.load()).toBe(p)
      expect(load).toHaveBeenCalledTimes(1)
    }
  })
})
