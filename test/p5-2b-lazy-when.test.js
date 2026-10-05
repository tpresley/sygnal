// @vitest-environment jsdom
// PLAN-5 B-4 (D103): lazy(load, { when: 'visible' | 'idle' }): the import starts when the
// placeholder enters the viewport, or when the browser is idle, not at lazy(). With Suspense the
// fallback shows meanwhile (the deferred placeholder stays in the pending boundary, observed).
// SSR renders the placeholder and never loads. Real browsers: browser-tests/tests/browser-sources.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { run, lazy, Suspense, renderToString, renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const sleep = (ms = 10) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 5 })
let app
const saved = {}
const stub = (k, v) => { if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }) }

const observers = []
class FakeIO {
  constructor(cb, opts) { this.cb = cb; this.opts = opts; this.els = new Set(); observers.push(this) }
  observe(el) { this.els.add(el) }
  unobserve(el) { this.els.delete(el) }
  disconnect() { this.els.clear(); this.off = true }
}
const show = (el) => observers.filter(o => o.els.has(el)).forEach(o => o.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }]))

function Chart({ title }) { return h('h2', { className: 'chart' }, title) }
const loader = () => { const load = vi.fn(() => Promise.resolve({ default: Chart })); return load }

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  observers.length = 0
  stub('IntersectionObserver', FakeIO)
})
afterEach(() => {
  app?.dispose(); app = null
  for (const k in saved) { const d = saved[k]; d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k]; delete saved[k] }
})

describe("when: 'visible'", () => {
  it('loads only once the placeholder is visible', async () => {
    const load = loader()
    const LazyChart = lazy(load, { when: 'visible', rootMargin: '200px' })
    expect(load).not.toHaveBeenCalled()
    function Page() { return h('div', null, [h(LazyChart, { title: 'Sales' })]) }
    Page.initialState = {}
    app = run(Page, {}, { mountPoint: '#root' })
    await sleep(20)
    const ph = document.querySelector('[data-sygnal-lazy="deferred"]')
    expect(ph).not.toBe(null)
    expect(load).not.toHaveBeenCalled()
    expect(observers[0].opts).toEqual({ rootMargin: '200px' })
    expect([...observers[0].els]).toEqual([ph])
    show(ph)
    await until(() => expect(load).toHaveBeenCalledTimes(1))
    await until(() => expect(document.querySelector('.chart')?.textContent).toBe('Sales'))
    expect(observers[0].off).toBe(true)
  })

  it('in Suspense: the fallback shows while deferred and loading; the placeholder stays observed', async () => {
    const load = loader()
    const LazyChart = lazy(load, { when: 'visible' })
    function Page() { return h('div', null, [h(Suspense, { fallback: h('p', { className: 'skeleton' }, 'Loading…') }, [h(LazyChart, { title: 'Q3' })])]) }
    Page.initialState = {}
    app = run(Page, {}, { mountPoint: '#root' })
    await sleep(20)
    expect(document.querySelector('.skeleton')).not.toBe(null)
    const pending = document.querySelector('[data-sygnal-suspense="pending"]')
    const ph = pending.querySelector('[data-sygnal-lazy="deferred"]')
    expect(ph).not.toBe(null)
    expect(load).not.toHaveBeenCalled()
    show(ph)
    await until(() => expect(document.querySelector('.chart')?.textContent).toBe('Q3'))
    expect(document.querySelector('.skeleton')).toBe(null)
  })

  it('without IntersectionObserver it loads when the placeholder is inserted', async () => {
    stub('IntersectionObserver', undefined)
    const load = loader()
    const LazyChart = lazy(load, { when: 'visible' })
    function Page() { return h('div', null, [h(LazyChart, { title: 'x' })]) }
    Page.initialState = {}
    app = run(Page, {}, { mountPoint: '#root' })
    await until(() => expect(document.querySelector('.chart')).not.toBe(null))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('load() starts it at once (preload on hover, tests); every instance shares one import', async () => {
    const load = loader()
    const LazyChart = lazy(load, { when: 'visible' })
    function Page() { return h('div', null, [h(LazyChart, { title: 'a' }), h(LazyChart, { title: 'b' })]) }
    Page.initialState = {}
    app = run(Page, {}, { mountPoint: '#root' })
    await sleep(20)
    expect(document.querySelectorAll('[data-sygnal-lazy="deferred"]').length).toBe(2)
    expect(observers.length).toBe(1)
    expect(observers[0].els.size).toBe(2)
    const mod = await LazyChart.load()
    expect(mod).toBeUndefined()
    await until(() => expect([...document.querySelectorAll('.chart')].map(e => e.textContent)).toEqual(['a', 'b']))
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe("when: 'idle'", () => {
  it('requestIdleCallback (with a timeout) starts it once the placeholder is on the page', async () => {
    const idle = []
    stub('requestIdleCallback', (f, o) => { idle.push([f, o]); return 1 })
    const load = loader()
    const LazyChart = lazy(load, { when: 'idle' })
    function Page() { return h('div', null, [h(LazyChart, { title: 'idle' })]) }
    Page.initialState = {}
    app = run(Page, {}, { mountPoint: '#root' })
    await sleep(20)
    expect(load).not.toHaveBeenCalled()
    expect(idle.length).toBe(1)
    expect(idle[0][1]).toEqual({ timeout: 2000 })
    idle[0][0]()
    await until(() => expect(document.querySelector('.chart')?.textContent).toBe('idle'))
  })

  it('without requestIdleCallback: a timeout', async () => {
    stub('requestIdleCallback', undefined)
    const load = loader()
    const LazyChart = lazy(load, { when: 'idle' })
    function Page() { return h('div', null, [h(LazyChart, { title: 'later' })]) }
    Page.initialState = {}
    app = run(Page, {}, { mountPoint: '#root' })
    await until(() => expect(document.querySelector('.chart')?.textContent).toBe('later'))
  })
})

describe('SSR, tests, and no option', () => {
  it('renderToString renders the placeholder and never loads', async () => {
    const load = loader()
    const LazyChart = lazy(load, { when: 'visible' })
    function Page() { return h('div', null, [h(Suspense, { fallback: 'Loading' }, [h(LazyChart, { title: 'x' })])]) }
    Page.initialState = {}
    const html = renderToString(Page)
    expect(html).toContain('data-sygnal-lazy="deferred"')
    await sleep(5)
    expect(load).not.toHaveBeenCalled()
  })

  it('renderComponent (mock DOM): the placeholder until load()', async () => {
    const load = loader()
    const LazyChart = lazy(load, { when: 'idle' })
    function Page() { return h('div', null, [h(LazyChart, { title: 'mock' })]) }
    Page.initialState = {}
    const t = renderComponent(Page)
    await t.ready()
    expect(load).not.toHaveBeenCalled()
    await LazyChart.load()
    await t.settle()
    expect(t.html()).toContain('mock')
    t.dispose()
  })

  it('without when: loads at lazy() as before, and load() returns the same promise', async () => {
    const load = loader()
    const LazyChart = lazy(load)
    expect(load).toHaveBeenCalledTimes(1)
    await LazyChart.load()
    expect(LazyChart.__sygnalLazyLoaded()).toBe(true)
  })
})
