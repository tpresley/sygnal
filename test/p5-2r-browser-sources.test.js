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
