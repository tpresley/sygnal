// @vitest-environment jsdom
// PLAN-5 2-R: lazy(…, { when }) fixes. G-385: inside Suspense, a placeholder whose import hasn't
// started isn't waited for (it stays in its own place, so it loads only when seen); once it
// starts, the boundary shows its fallback until the component is there; `placeholderHeight`.
// G-386: a `when` that never triggers keeps no disposed owner.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { run, lazy, Suspense, Collection } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { waiting } from '../src/core/markers/lazy.js'

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

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  observers.length = 0
  stub('IntersectionObserver', FakeIO)
})
afterEach(() => {
  app?.dispose(); app = null
  for (const k in saved) { const d = saved[k]; d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k]; delete saved[k] }
})

describe("G-385: when: 'visible' inside Suspense", () => {
  it('an untriggered placeholder is not pending: the boundary renders its children, the placeholder in its own place', async () => {
    let resolve
    const load = vi.fn(() => new Promise(r => { resolve = r }))
    const LazyChart = lazy(load, { when: 'visible' })
    function Page() {
      return h('div', null, [h(Suspense, { fallback: h('p', { className: 'skeleton' }, 'Loading…') }, [
        h('section', { className: 'tall' }, 'above the fold'),
        h(LazyChart, { title: 'Q3' }),
      ])])
    }
    Page.initialState = {}
    app = run(Page, {}, { mountPoint: '#root' })
    await sleep(20)
    expect(document.querySelector('.skeleton')).toBe(null)
    expect(document.querySelector('[data-sygnal-suspense="pending"]')).toBe(null)
    const ph = document.querySelector('[data-sygnal-when="visible"]')
    expect(ph).not.toBe(null)
    expect(ph.previousElementSibling?.className).toBe('tall') // its own position, after the section
    expect(load).not.toHaveBeenCalled()
    // seen: the import starts, and the boundary waits for it (its fallback) until the component is there
    show(ph)
    await until(() => expect(load).toHaveBeenCalledTimes(1))
    await until(() => expect(document.querySelector('.skeleton')).not.toBe(null))
    resolve({ default: Chart })
    await until(() => expect(document.querySelector('.chart')?.textContent).toBe('Q3'))
    expect(document.querySelector('.skeleton')).toBe(null)
    expect(document.querySelector('.tall')).not.toBe(null)
  })

  it('a READY-false sibling makes the boundary pending; the deferred placeholder is not moved into the fallback', async () => {
    const load = vi.fn(() => Promise.resolve({ default: Chart }))
    const LazyChart = lazy(load, { when: 'visible' })
    function Slow() { return h('p', { className: 'slow' }, 'slow') }
    Slow.model = { READY: { READY: () => false } }
    function Page() { return h('div', null, [h(Suspense, { fallback: h('p', { className: 'skeleton' }, '…') }, [h(Slow), h(LazyChart, { title: 'x' })])]) }
    Page.initialState = {}
    app = run(Page, {}, { mountPoint: '#root' })
    await sleep(20)
    expect(document.querySelector('.skeleton')).not.toBe(null)
    expect(document.querySelector('[data-sygnal-suspense="pending"] [data-sygnal-when]')).toBe(null)
    expect(load).not.toHaveBeenCalled()
  })

  it('placeholderHeight: a min-height on the placeholder (number: px)', async () => {
    const A = lazy(() => Promise.resolve({ default: Chart }), { when: 'visible', placeholderHeight: 120 })
    const B = lazy(() => Promise.resolve({ default: Chart }), { when: 'idle', placeholderHeight: '10rem' })
    stub('requestIdleCallback', () => 1)
    function Page() { return h('div', null, [h(A, { title: 'a' }), h(B, { title: 'b' })]) }
    Page.initialState = {}
    app = run(Page, {}, { mountPoint: '#root' })
    await sleep(20)
    const ph = [...document.querySelectorAll('[data-sygnal-lazy="deferred"]')]
    expect(ph.map(e => e.style.minHeight)).toEqual(['120px', '10rem'])
  })
})

describe('G-386: owners waiting for a deferred import', () => {
  it('a disposed owner leaves the waiting set (a never-triggered when keeps nothing)', async () => {
    const LazyChart = lazy(() => Promise.resolve({ default: Chart }), { when: 'visible' })
    function Item({ state }) { return h('li', null, [h(LazyChart, { title: String(state.id) })]) }
    function List() { return h('ul', null, [h(Collection, { of: Item, from: 'items' })]) }
    List.initialState = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    List.model = { CLEAR: (s) => ({ ...s, items: [] }) }
    app = run(List, {}, { mountPoint: '#root' })
    await sleep(20)
    expect(waiting.get(LazyChart).size).toBe(3)
    app.__runtime.dispatch('root', 'CLEAR')
    await sleep(20)
    expect(document.querySelectorAll('li').length).toBe(0)
    expect(waiting.get(LazyChart).size).toBe(0)
  })

  it('settled: the set is cleared and no owner is added afterwards (a failed load too)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Bad = lazy(() => Promise.reject(new Error('nope')))
    function Page() { return h('div', null, [h(Bad)]) }
    Page.initialState = {}
    app = run(Page, {}, { mountPoint: '#root' })
    await until(() => expect(document.querySelector('[data-sygnal-error="lazy"]')).not.toBe(null))
    await sleep(20)
    expect(waiting.get(Bad).size).toBe(0)
    expect(waiting.get(Bad).done).toBe(true)
    err.mockRestore()
  })
})
