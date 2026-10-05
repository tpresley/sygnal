// @vitest-environment jsdom
// PLAN-5 2-R, G-383: a component whose definition was cached before the first browser driver
// existed (an island without the driver, an earlier test using the t.browser fake) still gets
// its DOM binding once a driver is made: the definition hooks are part of the cache's
// staleness check, and so is `browser`. This file must make no browser driver before the first
// test (the bug needs the definition cached first).
import { it, expect, beforeEach } from 'vitest'
import { run, makeBrowserDriver, renderComponent } from '../src/index.js'
import { browserDriver, intersectionSource } from '../src/extra/browserSources.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import xs from 'xstream'

const tick = (ms = 10) => new Promise(r => setTimeout(r, ms))
const observers = []
class FakeObserver {
  constructor(cb, o) { this.cb = cb; this.els = new Set(); observers.push(this) }
  observe(e) { this.els.add(e) }
  unobserve(e) { this.els.delete(e) }
  disconnect() { this.els.clear(); this.off = true }
}
globalThis.IntersectionObserver = FakeObserver
globalThis.ResizeObserver = FakeObserver
beforeEach(() => { observers.length = 0; document.body.innerHTML = '<div id="root"></div>' })

function Card() { return h('div', { className: 'card' }, 'c') }
Card.browser = () => ({ me: { intersection: true, action: 'SEEN' } })
Card.model = { SEEN: (s) => ({ ...s, seen: s.seen + 1 }) }
function App() { return h('div', null, [h(Card, { state: 'card' })]) }
App.initialState = { card: { seen: 0 } }

it('a child defined before the first browser driver is made still observes (G-383)', async () => {
  let app = run(App, {}, { mountPoint: '#root' }) // an island without the driver: Card's def is cached
  await tick(); app.dispose()
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
  await tick()
  expect(observers.length).toBe(1)
  expect([...observers[0].els].map(e => e.className)).toEqual(['card'])
  app.dispose()
})

it('a test file mixing the t.browser fake and a real driver: both bind (G-383)', async () => {
  function Tile() { return h('section', { className: 'tile' }, 't') }
  Tile.browser = () => ({ me: { intersection: true, action: 'SEEN' } })
  Tile.initialState = { seen: 0 }
  Tile.model = { SEEN: (s, d) => d.visible ? { ...s, seen: s.seen + 1 } : s }
  const t = renderComponent(Tile)
  await t.ready()
  await t.browser.intersect(true)
  expect(t.state.seen).toBe(1)
  t.dispose()
  const app = run(Tile, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
  await tick()
  expect(observers.length).toBe(1)
  expect(observers[0].els.size).toBe(1)
  app.dispose()
})

it('a `browser` static assigned after the definition was cached is read (G-383)', async () => {
  function Late() { return h('p', { className: 'late' }, 'l') }
  Late.model = { SEEN: (s) => s }
  function Host() { return h('div', null, [h(Late, { state: 'late' })]) }
  Host.initialState = { late: {} }
  let app = run(Host, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
  await tick(); app.dispose()
  expect(observers.length).toBe(0)
  Late.browser = () => ({ me: { intersection: true, action: 'SEEN' } })
  document.body.innerHTML = '<div id="root"></div>'
  app = run(Host, { BROWSER: makeBrowserDriver() }, { mountPoint: '#root' })
  await tick()
  expect(observers.length).toBe(1)
  app.dispose()
})

it('SYG666: an intersection / resize declaration with no DOM to observe is reported (G-383)', async () => {
  setupChecks()
  const sink$ = xs.create()
  const src = browserDriver([intersectionSource], new Map())(sink$, 'BROWSER')
  sink$.shamefullySendNext({ browser: { me: { intersection: true, action: 'SEEN' } }, __emitterId: 7, __emitterName: 'Orphan' })
  await tick()
  const d = diagnostics('SYG666')
  expect(d.length).toBe(1)
  expect(d[0].component).toBe('Orphan')
  expect(d[0].message).toMatch(/me/)
  src.dispose()
})
