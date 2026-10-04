// @vitest-environment jsdom
// P45-R G-268: the dev-only statics freeze (D152) froze the instance's merged initialState too,
// which can be the caller's object (renderComponent's initialState option, a host's props): a
// test fixture became frozen. Only the component function's own statics are frozen now.
import { it, expect, afterEach } from 'vitest'
import { setupChecks } from './diagnostics/helpers.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => {
  t?.dispose(); t = null
  globalThis.__SYGNAL_DIAGNOSTICS__?.__uninstallChecks?.()
  _resetDiagnostics()
})

it("renderComponent's initialState fixture is not frozen; the component's static is", async () => {
  setupChecks()
  function List({ state }) { return h('ul', null, ...state.items.map(i => h('li', null, String(i)))) }
  List.initialState = { items: [] }
  const fixture = { items: [1, 2] }
  t = renderComponent(List, { initialState: fixture })
  await t.ready()
  expect(Object.isFrozen(fixture)).toBe(false)
  expect(Object.isFrozen(fixture.items)).toBe(false)
  expect(Object.isFrozen(List.initialState)).toBe(true)
})
