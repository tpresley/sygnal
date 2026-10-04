// @vitest-environment jsdom
// P45-R3 G-289: owned() (G-275) marked the caller's object itself, for good:
// - renderComponent(C, { initialState: C.initialState }) marked C's static, so the dev statics
//   freeze (D152) skipped it for the rest of the process (order-dependent);
// - a sealed (not frozen) fixture couldn't be marked and was then deep-frozen;
// - an object whose defineProperty throws (a Proxy) made renderComponent throw.
// renderComponent now marks a shallow copy of a plain object or array; owned() never throws.
import { it, expect, afterEach } from 'vitest'
import { setupChecks } from './diagnostics/helpers.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { owned, OWNED } from '../src/extra/owned.ts'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => {
  t?.dispose(); t = null
  globalThis.__SYGNAL_DIAGNOSTICS__?.__uninstallChecks?.()
  _resetDiagnostics()
})

function List({ state }) { return h('ul', null, ...state.items.map(i => h('li', null, String(i)))) }

it("renderComponent given the component's own initialState doesn't exempt it from the freeze", async () => {
  setupChecks()
  function L(p) { return List(p) }
  L.initialState = { items: [1] }
  t = renderComponent(L, { initialState: L.initialState })
  await t.ready()
  expect(L.initialState[OWNED]).toBeUndefined()
  t.dispose()
  t = renderComponent(L)
  await t.ready()
  expect(Object.isFrozen(L.initialState)).toBe(true)
})

it('a sealed fixture is not frozen', async () => {
  setupChecks()
  function L(p) { return List(p) }
  L.initialState = { items: [] }
  const fixture = Object.seal({ items: [1, 2] })
  t = renderComponent(L, { initialState: fixture })
  await t.ready()
  expect(t.html()).toContain('<li>2</li>')
  expect(Object.isFrozen(fixture)).toBe(false)
  expect(Object.isFrozen(fixture.items)).toBe(false)
  expect(Object.isFrozen(L.initialState)).toBe(true)
})

it('owned() of an object whose defineProperty throws returns it', () => {
  const p = new Proxy({ a: 1 }, { defineProperty() { throw new Error('no') } })
  expect(owned(p)).toBe(p)
})
