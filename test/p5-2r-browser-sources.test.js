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
