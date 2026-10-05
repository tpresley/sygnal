// @vitest-environment jsdom
// PLAN-5 2-R: fixes to the browser sources (G-384, G-387, G-388, G-389, G-390), under run() with
// stubbed observers and under renderComponent's fake.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { run, makeBrowserDriver, renderComponent, Collection } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))
let app
const saved = {}
const stub = (k, v) => { if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }) }
const observers = []
class FakeObserver {
  constructor(cb, opts) { this.cb = cb; this.opts = opts; this.els = new Set(); observers.push(this) }
  observe(el) { this.els.add(el) }
  unobserve(el) { this.els.delete(el) }
  disconnect() { this.els.clear(); this.off = true }
}
const fire = (el, entry) => observers.filter(o => !o.off && o.els.has(el)).forEach(o => o.cb([{ target: el, ...entry }]))

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  observers.length = 0
  stub('IntersectionObserver', FakeObserver)
  stub('ResizeObserver', FakeObserver)
  localStorage.clear()
})
afterEach(() => {
  app?.dispose(); app = null
  for (const k in saved) { const d = saved[k]; d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k]; delete saved[k] }
})

// a model that writes back what it reads (normalizing a missing value): it must settle
const echo = (counter) => {
  function Prefs({ state }) { return h('p', null, String(state.theme)) }
  Prefs.initialState = { theme: null }
  Prefs.browser = () => ({ theme: { storage: 'theme', action: 'THEME' } })
  Prefs.model = {
    THEME: {
      STATE: (s, d) => ({ ...s, theme: d.value }),
      BROWSER: (s, d) => { counter.n++; return counter.n > 50 ? undefined : { setItem: 'theme', value: d.value ?? 'light' } },
    },
  }
  return Prefs
}

describe('G-384: same-page storage writes', () => {
  it('a model that echoes the stored value settles (real driver)', async () => {
    const c = { n: 0 }
    app = run(echo(c), { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick(60)
    expect(c.n).toBe(2) // null -> 'light' (changed: heard again) -> 'light' (unchanged: silent)
    expect(document.querySelector('p').textContent).toBe('light')
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('a model that echoes the stored value settles (fake)', async () => {
    const c = { n: 0 }
    const t = renderComponent(echo(c))
    await t.ready()
    await tick(60)
    expect(c.n).toBe(2)
    expect(t.state.theme).toBe('light')
    expect(t.browser.storage('theme')).toBe('light')
    t.dispose()
  })

  it('an unchanged write is silent; a change reaches every storage declaration of the key on the page, not window listeners', async () => {
    localStorage.setItem('k', 'a')
    const heard = []
    const onStorage = (e) => heard.push(e.key)
    window.addEventListener('storage', onStorage)
    function Reader({ state }) { return h('i', null, `${state.v}:${state.n}`) }
    Reader.browser = () => ({ k: { storage: 'k', action: 'K' } })
    Reader.model = { K: (s, d) => ({ ...s, v: d.value, n: (s.n || 0) + 1 }) }
    function Writer({ state }) { return h('div', null, [h(Reader, { state: 'r' }), h('b', null, String(state.n))]) }
    Writer.initialState = { n: 0, r: { v: null, n: 0 } }
    Writer.intent = ({ DOM }) => ({ WRITE: DOM.select('b').events('click').map(e => e.target.dataset.v) })
    Writer.model = { WRITE: { BROWSER: (s, v) => ({ setItem: 'k', value: v }) } }
    app = run(Writer, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    const b = document.querySelector('b'), i = () => document.querySelector('i').textContent
    expect(i()).toBe('a:1')
    b.dataset.v = 'a'; b.click(); await tick()
    expect(i()).toBe('a:1')
    b.dataset.v = 'b'; b.click(); await tick()
    expect(i()).toBe('b:2')
    window.removeEventListener('storage', onStorage)
    expect(heard).toEqual([])
  })

  it('removeItem of an absent key is silent', async () => {
    let n = 0
    function C() { return h('p', null, 'x') }
    C.initialState = {}
    C.browser = () => ({ k: { storage: 'gone', action: 'K' } })
    C.intent = ({ DOM }) => ({ RM: DOM.select('p').events('click') })
    C.model = { K: (s) => (n++, s), RM: { BROWSER: () => ({ removeItem: 'gone' }) } }
    app = run(C, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    expect(n).toBe(1)
    document.querySelector('p').click()
    await tick()
    expect(n).toBe(1)
  })
})

// a component that sends `cmd` on click and records its ok / error replies
const commander = (cmd, log) => {
  function C() { return h('button', null, 'go') }
  C.initialState = {}
  C.intent = ({ DOM }) => ({ GO: DOM.select('button').events('click') })
  C.model = {
    GO: { BROWSER: () => cmd },
    OK: (s, d) => (log.push(['ok', d]), s),
    BAD: (s, d) => (log.push(['error', d]), s),
  }
  return C
}

describe('G-388 / G-389: commands', () => {
  it('a command is recognised by any known key, not only the first ({ ok, copy })', async () => {
    const written = []
    stub('navigator', { ...navigator, clipboard: { writeText: async (t) => { written.push(t) } } })
    const log = []
    app = run(commander({ ok: 'OK', copy: 'hello' }, log), { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    document.querySelector('button').click()
    await tick()
    expect(written).toEqual(['hello'])
    expect(log).toEqual([['ok', { text: 'hello' }]])
  })

  it('{ ok, copy } in the fake too', async () => {
    const log = []
    const t = renderComponent(commander({ ok: 'OK', copy: 'hi' }, log))
    await t.ready()
    await t.simulateEvent('button', 'click')
    await t.settle()
    expect(t.browser.clipboard()).toBe('hi')
    expect(log).toEqual([['ok', { text: 'hi' }]])
    t.dispose()
  })

  it('a value JSON.stringify throws on (BigInt) goes to the error action', async () => {
    const log = []
    app = run(commander({ setItem: 'k', value: { n: 1n }, json: true, ok: 'OK', error: 'BAD' }, log), { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    document.querySelector('button').click()
    await tick()
    expect(log.length).toBe(1)
    expect(log[0][0]).toBe('error')
    expect(log[0][1].name).toBe('TypeError')
    expect(localStorage.getItem('k')).toBe(null)
  })

  it('a cyclic value in the fake goes to the error action too', async () => {
    const log = [], v = {}; v.self = v
    const t = renderComponent(commander({ setItem: 'k', value: v, json: true, error: 'BAD' }, log))
    await t.ready()
    await t.simulateEvent('button', 'click')
    await t.settle()
    expect(log.map(e => e[0])).toEqual(['error'])
    t.dispose()
  })

  it('a clipboard without writeText: the error action; with none named, SYG665 (not a thrown driver error)', async () => {
    setupChecks()
    stub('navigator', { ...navigator, clipboard: {} })
    const log = []
    app = run(commander({ copy: 'x', error: 'BAD' }, log), { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    document.querySelector('button').click()
    await tick()
    expect(log.map(e => e[0])).toEqual(['error'])
    app.dispose()
    document.body.innerHTML = '<div id="root"></div>'
    app = run(commander({ copy: 'x' }, log), { BROWSER: makeBrowserDriver() }, { mountPoint: '#root', diagnostics: 'collect' })
    await tick()
    document.querySelector('button').click()
    await tick()
    expect(diagnostics('SYG665').map(d => d.data.failure.name)).toEqual(['TypeError'])
  })
})

describe('G-387: the t.browser fake reports at start, and checks selectors under dom: real', () => {
  function Card({ state }) { return h('div', { className: 'card' }, [h('img', { className: 'cover' }), h('p', null, String(state.n))]) }
  Card.initialState = { n: 0, seen: null, size: null }
  Card.browser = () => ({ cover: { intersection: '.cover', action: 'SEEN' }, size: { resize: true, action: 'SIZE' } })
  Card.model = { SEEN: (s, d) => ({ ...s, n: s.n + 1, seen: d }), SIZE: (s, d) => ({ ...s, size: d }) }

  it('intersection starts with { visible: false, ratio: 0 }, resize with { width: 0, height: 0 }, as the observers do', async () => {
    const t = renderComponent(Card)
    await t.ready()
    await t.settle()
    expect(t.state.seen).toEqual({ visible: false, ratio: 0, index: 0, dataset: {} })
    expect(t.state.size).toEqual({ width: 0, height: 0, index: 0, dataset: {} })
    expect(t.state.n).toBe(1)
    await t.browser.intersect('.cover', true)
    expect(t.state.seen).toEqual({ visible: true, ratio: 1, index: 0, dataset: {} })
    t.dispose()
  })

  it('dom: real: a selector that matches no element of the component is SYG668', async () => {
    setupChecks()
    function Typo() { return h('div', null, [h('img', { className: 'cover' })]) }
    Typo.initialState = {}
    Typo.browser = () => ({ cover: { intersection: '.covr', action: 'SEEN' }, ok: { intersection: '.cover', action: 'SEEN' }, me: { resize: true, action: 'SEEN' } })
    Typo.model = { SEEN: (s) => s }
    const t = renderComponent(Typo, { dom: 'real', diagnostics: 'collect' })
    await t.ready()
    await t.settle()
    await tick()
    const d = diagnostics('SYG668')
    expect(d.map(x => [x.data.name, x.data.reason])).toEqual([['cover', 'none']])
    expect(d[0].message).toMatch(/\.covr/)
    t.dispose()
  })
})

describe('G-390: shared observers', () => {
  function Item({ state }) { return h('li', { className: 'item' }, [h('span', { className: 'n' }, String(state.id))]) }
  Item.browser = () => ({ me: { intersection: true, action: 'SEEN' }, n: { intersection: '.n', action: 'SEEN' }, sz: { resize: '.n', action: 'SZ' } })
  Item.model = { SEEN: (s) => ({ ...s, seen: (s.seen || 0) + 1 }), SZ: (s) => s }
  function List({ state }) { return h('div', null, [h('b', null, String(state.n)), h('ul', null, [h(Collection, { of: Item, from: 'items' })])]) }
  List.initialState = { n: 0, items: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) }
  List.intent = ({ DOM }) => ({ INC: DOM.select('b').events('click') })
  List.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }

  it('a 100-item Collection: one observer per kind and options, each element observed once; one query per (instance, selector) a patch', async () => {
    app = run(List, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    expect(observers.length).toBe(2) // IntersectionObserver (both entries: same options), ResizeObserver
    expect(observers.map(o => o.els.size)).toEqual([200, 100])
    const qsa = Element.prototype.querySelectorAll
    let q = 0
    Element.prototype.querySelectorAll = function (s) { if (s.includes('.n')) q++; return qsa.call(this, s) }
    try {
      document.querySelector('b').click()
      await tick()
    } finally { Element.prototype.querySelectorAll = qsa }
    expect(q).toBe(100) // '.n' is declared twice per item (intersection, resize): queried once
  })

  it('options differ: separate observers; a declaration joining an observed element hears its last report; the last one gone disconnects', async () => {
    function C({ state }) { return h('div', { className: 'c' }, String(state.a) + String(state.b)) }
    C.initialState = { a: 0, b: 0, on: false, done: false }
    C.browser = (s) => ({
      a: !s.done && { intersection: true, action: 'A' },
      b: s.on && !s.done && { intersection: true, action: 'B' },
      c: !s.done && { intersection: true, action: 'A', threshold: 0.5 },
    })
    C.intent = ({ DOM }) => ({ ON: DOM.select('.c').events('click') })
    C.model = {
      A: (s, d) => ({ ...s, a: s.a + (d.visible ? 1 : 0) }),
      B: (s, d) => ({ ...s, b: s.b + (d.visible ? 1 : 0) }),
      ON: (s) => s.on ? { ...s, done: true } : { ...s, on: true },
    }
    app = run(C, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
    await tick()
    expect(observers.length).toBe(2)
    const el = observers[0].els.values().next().value
    fire(el, { isIntersecting: true, intersectionRatio: 1 })
    await tick()
    expect(el.textContent).toBe('20') // a heard both observers' report
    document.querySelector('.c').click() // b starts on the observed element: it hears the last report
    await tick()
    expect(el.textContent).toBe('21')
    document.querySelector('.c').click() // all stop
    await tick()
    expect(observers.map(o => o.off)).toEqual([true, true])
  })
})
