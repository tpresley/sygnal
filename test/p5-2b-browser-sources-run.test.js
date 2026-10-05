// @vitest-environment jsdom
// PLAN-5 B-3: browser sources under run(), with the browser APIs jsdom lacks stubbed
// (IntersectionObserver, ResizeObserver, matchMedia, geolocation, clipboard). The real-browser
// behaviour is in browser-tests/tests/browser-sources.test.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  run, makeBrowserDriver, makeBrowserDriverWith, intersectionSource, mediaSource, Collection, Switchable,
} from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

const tick = (ms = 10) => new Promise(r => setTimeout(r, ms))
let app
const saved = {}
const stub = (k, v) => { if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }) }

// observers that record what they observe; `fire(el, entry)` calls back
const observers = []
class FakeObserver {
  constructor(cb, opts) { this.cb = cb; this.opts = opts; this.els = new Set(); observers.push(this) }
  observe(el) { this.els.add(el) }
  unobserve(el) { this.els.delete(el) }
  disconnect() { this.els.clear(); this.off = true }
}
const fire = (el, entry) => observers.filter(o => !o.off && o.els.has(el)).forEach(o => o.cb([{ target: el, ...entry }]))

// matchMedia with listeners and settable matches
const queries = {}
const mm = (q) => (queries[q] ||= { matches: false, media: q, ls: new Set(), addEventListener(_, f) { this.ls.add(f) }, removeEventListener(_, f) { this.ls.delete(f) } })
const setMedia = (q, m) => { const o = mm(q); o.matches = m; o.ls.forEach(f => f()) }

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  observers.length = 0
  for (const k in queries) delete queries[k]
  stub('IntersectionObserver', FakeObserver)
  stub('ResizeObserver', FakeObserver)
  stub('matchMedia', mm)
  localStorage.clear()
})
afterEach(() => {
  app?.dispose(); app = null
  for (const k in saved) { const d = saved[k]; d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k]; delete saved[k] }
})

describe('declarations', () => {
  it('intersection: observes the selector in the component, actions with { visible, ratio, index, dataset }', async () => {
    function Page({ state }) { return h('div', null, [h('p', { className: 'cover', 'data-id': 'a' }, 'x'), h('p', { className: 'n' }, String(state.seen))]) }
    Page.initialState = { seen: 0, last: null }
    Page.browser = (s) => ({ cover: { intersection: '.cover', action: 'SEEN', threshold: 0.5 } })
    Page.model = { SEEN: (s, d) => ({ ...s, seen: s.seen + 1, last: d }) }
    app = run(Page, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    const cover = document.querySelector('.cover')
    expect(observers.length).toBe(1)
    expect(observers[0].opts).toEqual({ threshold: 0.5, rootMargin: undefined })
    expect([...observers[0].els]).toEqual([cover])
    fire(cover, { isIntersecting: true, intersectionRatio: 0.75 })
    await tick()
    expect(document.querySelector('.n').textContent).toBe('1')
  })

  it('intersection: true observes the root element; Collection items each observe their own', async () => {
    function Item({ state }) { return h('li', { className: 'item' }, state.seen ? 'seen' : 'not') }
    Item.browser = (s) => ({ me: !s.seen && { intersection: true, action: 'SEEN' } })
    Item.model = { SEEN: (s, d) => d.visible ? { ...s, seen: true } : s }
    function List() { return h('ul', null, [h(Collection, { of: Item, from: 'items' })]) }
    List.initialState = { items: [{ id: 1, seen: false }, { id: 2, seen: false }] }
    app = run(List, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    const lis = [...document.querySelectorAll('.item')]
    expect(observers.length).toBe(2)
    expect(observers.map(o => [...o.els][0])).toEqual(lis)
    fire(lis[1], { isIntersecting: true, intersectionRatio: 1 })
    await tick()
    expect([...document.querySelectorAll('.item')].map(e => e.textContent)).toEqual(['not', 'seen'])
    // the seen item's declaration became falsy: its observer is disconnected
    expect(observers[1].off).toBe(true)
    expect(observers[0].off).toBeUndefined()
  })

  it('elements that appear later are observed; removed ones unobserved', async () => {
    function Page({ state }) { return h('div', null, state.cards.map(c => h('p', { className: 'card', key: c, 'data-n': String(c) }, String(c)))) }
    Page.initialState = { cards: [1] }
    Page.browser = () => ({ cards: { intersection: '.card', action: 'VIS' } })
    Page.intent = ({ DOM }) => ({})
    Page.model = { VIS: (s, d) => ({ ...s, got: d }), ADD: (s) => ({ ...s, cards: [1, 2] }), DROP: (s) => ({ ...s, cards: [2] }) }
    app = run(Page, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    expect(observers[0].els.size).toBe(1)
    app.__runtime.dispatch('root', 'ADD')
    await tick()
    expect([...observers[0].els].map(e => e.dataset.n)).toEqual(['1', '2'])
    const second = document.querySelectorAll('.card')[1]
    fire(second, { isIntersecting: true, intersectionRatio: 1 })
    await tick()
    app.__runtime.dispatch('root', 'DROP')
    await tick()
    expect([...observers[0].els].map(e => e.dataset.n)).toEqual(['2'])
  })

  it('resize: { width, height } from the content box', async () => {
    const got = []
    function Chart() { return h('div', { className: 'chart' }) }
    Chart.initialState = {}
    Chart.browser = () => ({ size: { resize: '.chart', action: 'SIZE' } })
    Chart.model = { SIZE: (s, d) => { got.push(d); return s } }
    app = run(Chart, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    fire(document.querySelector('.chart'), { contentRect: { width: 300, height: 120 } })
    await tick()
    expect(got).toEqual([{ width: 300, height: 120, index: 0, dataset: {} }])
  })

  it('media: the current value at start, then each change; a falsy entry stops it', async () => {
    const got = []
    function Theme({ state }) { return h('p', { className: 't' }, state.dark ? 'dark' : 'light') }
    Theme.initialState = { dark: false, watch: true }
    Theme.browser = (s) => ({ dark: s.watch && { media: '(prefers-color-scheme: dark)', action: 'DARK' } })
    Theme.model = { DARK: (s, d) => { got.push(d); return { ...s, dark: d.matches } }, STOP: (s) => ({ ...s, watch: false }) }
    setMedia('(prefers-color-scheme: dark)', true)
    app = run(Theme, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    expect(document.querySelector('.t').textContent).toBe('dark')
    setMedia('(prefers-color-scheme: dark)', false)
    await tick()
    expect(document.querySelector('.t').textContent).toBe('light')
    expect(got).toEqual([{ matches: true, media: '(prefers-color-scheme: dark)' }, { matches: false, media: '(prefers-color-scheme: dark)' }])
    app.__runtime.dispatch('root', 'STOP')
    await tick()
    expect(queries['(prefers-color-scheme: dark)'].ls.size).toBe(0)
  })

  it('storage: reads the key, observes other tabs and setItem / removeItem commands', async () => {
    localStorage.setItem('theme', '"dark"')
    const got = []
    function Prefs() { return h('p', null, 'x') }
    Prefs.initialState = {}
    Prefs.browser = () => ({ theme: { storage: 'theme', json: true, action: 'THEME' } })
    Prefs.model = {
      THEME: (s, d) => { got.push(d.value); return s },
      SET: { BROWSER: () => ({ setItem: 'theme', value: 'light', json: true, ok: 'SAVED' }) },
      CLEAR: { BROWSER: { removeItem: 'theme' } },
      SAVED: (s, d) => ({ ...s, saved: d }),
    }
    app = run(Prefs, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    expect(got).toEqual(['dark'])
    // another tab's write (the browser fires `storage` with this tab's storage area)
    localStorage.setItem('theme', '"blue"')
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: '"blue"', storageArea: localStorage }))
    // other keys and areas are ignored
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '1', storageArea: localStorage }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: '1', storageArea: sessionStorage }))
    await tick()
    expect(got).toEqual(['dark', 'blue'])
    app.__runtime.dispatch('root', 'SET')
    await tick()
    expect(localStorage.getItem('theme')).toBe('"light"')
    expect(got).toEqual(['dark', 'blue', 'light'])
    expect(app.__runtime.root.state.saved).toEqual({ key: 'theme' })
    app.__runtime.dispatch('root', 'CLEAR')
    await tick()
    expect(localStorage.getItem('theme')).toBe(null)
    expect(got).toEqual(['dark', 'blue', 'light', null])
  })

  it('visibility and online: the current value, then each change', async () => {
    const got = []
    function Status() { return h('p', null, 'x') }
    Status.initialState = {}
    Status.browser = () => ({ vis: { visibility: true, action: 'VIS' }, net: { online: true, action: 'NET' } })
    Status.model = { VIS: (s, d) => { got.push(['vis', d]); return s }, NET: (s, d) => { got.push(['net', d]); return s } }
    app = run(Status, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    expect(got).toEqual([['vis', { visible: true }], ['net', { online: true }]])
    stub('navigator', Object.create(navigator, { onLine: { value: false } }))
    window.dispatchEvent(new Event('offline'))
    await tick()
    expect(got.at(-1)).toEqual(['net', { online: false }])
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await tick()
    delete document.visibilityState
    expect(got.at(-1)).toEqual(['vis', { visible: false }])
  })

  it('geolocation: positions and failures; no error action → nothing dispatched', async () => {
    const watches = new Map()
    let n = 0
    stub('navigator', Object.create(navigator, { geolocation: { value: {
      watchPosition: (ok, ko, opts) => { watches.set(++n, { ok, ko, opts }); return n },
      clearWatch: (id) => watches.delete(id),
    } } }))
    const got = []
    function Map_() { return h('p', null, 'x') }
    Map_.initialState = { on: true }
    Map_.browser = (s) => ({ pos: s.on && { geolocation: { enableHighAccuracy: true }, action: 'POS', error: 'GEO_ERR' } })
    Map_.model = { POS: (s, d) => { got.push(d); return s }, GEO_ERR: (s, d) => { got.push(['err', d]); return s }, OFF: (s) => ({ ...s, on: false }) }
    app = run(Map_, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    const w = watches.get(1)
    expect(w.opts).toEqual({ enableHighAccuracy: true })
    w.ok({ coords: { latitude: 1, longitude: 2, accuracy: 3, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: 9 })
    w.ko({ code: 1, message: 'denied' })
    await tick()
    expect(got).toEqual([
      { latitude: 1, longitude: 2, accuracy: 3, altitude: null, altitudeAccuracy: null, heading: null, speed: null, timestamp: 9 },
      ['err', { code: 1, message: 'denied' }],
    ])
    app.__runtime.dispatch('root', 'OFF')
    await tick()
    expect(watches.size).toBe(0)
  })

  it('clipboard: copy and paste commands answer with reply actions', async () => {
    let clip = ''
    stub('navigator', Object.create(navigator, { clipboard: { value: {
      writeText: async (t) => { clip = t },
      readText: async () => clip,
    } } }))
    const got = []
    function Copy() { return h('p', null, 'x') }
    Copy.initialState = { text: 'hello' }
    Copy.model = {
      COPY: { BROWSER: (s) => ({ copy: s.text, ok: 'COPIED' }) },
      PASTE: { BROWSER: { paste: true, ok: 'PASTED', error: 'NO_PASTE' } },
      COPIED: (s, d) => { got.push(['copied', d]); return s },
      PASTED: (s, d) => { got.push(['pasted', d]); return s },
    }
    app = run(Copy, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    app.__runtime.dispatch('root', 'COPY')
    await tick()
    app.__runtime.dispatch('root', 'PASTE')
    await tick()
    expect(clip).toBe('hello')
    expect(got).toEqual([['copied', { text: 'hello' }], ['pasted', { text: 'hello' }]])
  })
})

describe('lifecycle', () => {
  it('a hidden Switchable page stops its sources unless background: true; shown again restarts them', async () => {
    const got = []
    function A() { return h('p', null, 'a') }
    A.initialState = {}
    A.isolatedState = true
    A.browser = () => ({ fg: { media: '(min-width: 1px)', action: 'FG' }, bg: { media: '(min-width: 2px)', action: 'BG', background: true } })
    A.model = { FG: (s, d) => { got.push('fg'); return s }, BG: (s) => { got.push('bg'); return s } }
    function B() { return h('p', null, 'b') }
    function App({ state }) { return h('div', null, [h(Switchable, { of: { A, B }, current: state.page })]) }
    App.initialState = { page: 'A' }
    App.model = { GO: (s, p) => ({ ...s, page: p }) }
    app = run(App, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    expect(got.sort()).toEqual(['bg', 'fg'])
    app.__runtime.dispatch('root', 'GO', 'B')
    await tick()
    expect(mm('(min-width: 1px)').ls.size).toBe(0)
    expect(mm('(min-width: 2px)').ls.size).toBe(1)
    got.length = 0
    app.__runtime.dispatch('root', 'GO', 'A')
    await tick()
    expect(got).toEqual(['fg'])
  })

  it('dispose stops everything', async () => {
    function C() { return h('div', { className: 'c' }) }
    C.initialState = {}
    C.browser = () => ({ m: { media: '(x)', action: 'M' }, i: { intersection: '.c', action: 'I' } })
    C.model = { M: (s) => s, I: (s) => s }
    app = run(C, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    expect(mm('(x)').ls.size).toBe(1)
    app.dispose(); app = null
    expect(mm('(x)').ls.size).toBe(0)
    expect(observers[0].off).toBe(true)
  })

  it('makeBrowserDriverWith: only the given sources', async () => {
    function C() { return h('div', { className: 'c' }) }
    C.initialState = {}
    C.browser = () => ({ m: { media: '(y)', action: 'M' }, i: { intersection: '.c', action: 'I' } })
    C.model = { M: (s) => s, I: (s) => s }
    app = run(C, { BROWSER: makeBrowserDriverWith(mediaSource) }, { mountPoint: '#root' })
    await tick()
    expect(mm('(y)').ls.size).toBe(1)
    expect(observers.length).toBe(0)
  })
})

describe('dev checks', () => {
  beforeEach(() => setupChecks())

  it('SYG643: browser declared with no browser driver', async () => {
    function C() { return h('p', null, 'x') }
    C.initialState = {}
    C.browser = () => ({ m: { media: '(x)', action: 'M' } })
    C.model = { M: (s) => s }
    app = run(C, {}, { mountPoint: '#root', diagnostics: 'collect' })
    await tick()
    expect(diagnostics('SYG643').map(d => d.data)).toEqual([{ static: 'browser', driver: 'makeBrowserDriver()' }])
  })

  it('SYG663 invalid spec or command; SYG664 a source the driver lacks; SYG665 a failure with no error action', async () => {
    stub('navigator', Object.create(navigator, { clipboard: { value: { writeText: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }) } } } }))
    function C() { return h('p', null, 'x') }
    C.initialState = {}
    C.browser = () => ({
      noKind: { action: 'M' },
      noAction: { media: '(x)' },
      badTarget: { intersection: 3, action: 'M' },
      lacking: { intersection: '.x', action: 'M' },
      ok: { media: '(x)', action: 'M' },
    })
    C.model = { M: (s) => s, BAD: { BROWSER: { shout: 'x' } }, COPY: { BROWSER: { copy: 'x' } } }
    app = run(C, { BROWSER: makeBrowserDriverWith(mediaSource, { c: { copy: (v, ok, fail) => fail({ name: 'NotAllowedError', message: 'denied' }) } }) }, { mountPoint: '#root', diagnostics: 'collect' })
    await tick()
    app.__runtime.dispatch('root', 'BAD')
    app.__runtime.dispatch('root', 'COPY')
    await tick()
    expect(diagnostics('SYG663').map(d => d.data.name)).toEqual(['noKind', 'noAction', 'badTarget', 'shout'])
    expect(diagnostics('SYG664').map(d => [d.data.name, d.data.kind])).toEqual([['lacking', 'intersection']])
    expect(diagnostics('SYG665').map(d => [d.data.name, d.data.failure])).toEqual([['copy', { name: 'NotAllowedError', message: 'denied' }]])
    expect(diagnostics('SYG663')[0].component).toBe('C')
  })
})
