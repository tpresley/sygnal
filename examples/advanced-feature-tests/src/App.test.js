// Smoke test: renders the feature-test app with the dev checks
// ('sygnal/diagnostics') and strict mode on, drives the portal, slot,
// command, disposal and collection demos through simulateEvent, and asserts
// that no diagnostics were reported.
import { describe, it, expect } from 'vitest'
import 'sygnal/diagnostics'
import { renderComponent, xs } from 'sygnal'
import App from './App.jsx'

const wait = (ms) => new Promise(r => setTimeout(r, ms))

describe('advanced-feature-tests App (smoke)', () => {
  it('drives the demos and reports no diagnostics', async () => {
    // the app's MOCK driver (see main.js), recording what it receives
    const mock = []
    const MOCK = (sink$) => {
      sink$.addListener({ next: msg => mock.push(msg), error: () => {}, complete: () => {} })
      return xs.never()
    }
    const t = renderComponent(App, { strict: true, drivers: { MOCK } })
    // waitForState also matches states recorded earlier; this runs `act` and
    // waits for a matching state emitted after it (events can update the state
    // synchronously, so the count is taken before acting)
    const after = (act, predicate) => {
      const seen = t.states.length
      act()
      return t.waitForState(s => {
        const i = t.states.indexOf(s)
        return (i === -1 || i >= seen) && predicate(s)
      })
    }
    try {
      await t.ready()
      expect(t.html()).toContain('Feature Tests')

      // Test 1: internal portal
      t.simulateEvent('.toggle-internal', 'click')
      await t.waitForState(s => s.showInternal)
      t.simulateEvent('.internal-btn', 'click')
      await t.waitForState(s => s.internalClicks === 1)

      // Test 2: slot content handled by the SlotCard child
      t.simulateEvent('.toggle-slot-theme', 'click')
      await t.waitForState(s => s.slotCard.theme === 'dark')

      // Test 4: mount and unmount the disposable child (DISPOSE → MOCK sink)
      t.simulateEvent('.toggle-dispose', 'click')
      await t.waitForState(s => s.showDisposable)
      await wait(50)
      expect(t.html()).toContain('Disposable Component')
      await after(() => t.simulateEvent('.toggle-dispose', 'click'), s => !s.showDisposable)
      await wait(20)
      expect(mock).toContainEqual(expect.objectContaining({ type: 'dispose' }))

      // Test 5: Collection items remove themselves via EVENTS
      t.simulateEvent('.add-item', 'click')
      t.simulateEvent('.add-item', 'click')
      await t.waitForState(s => s.items.length === 2)
      // new Collection items subscribe to their DOM events a few ms after they mount
      await wait(20)
      const afterRemove = await after(() => t.simulateEvent('.remove-item', 'click'), s => s.items.length === 1)
      expect(afterRemove.items.map(i => i.id)).toEqual([2])
      expect(t.emitted.some(e => e.type === 'REMOVE_ITEM' && e.data === 1)).toBe(true)

      // Test 7: parent → child commands from EFFECT entries
      t.simulateEvent('.send-command', 'click')
      t.simulateEvent('.send-command', 'click')
      await t.waitForState(s => s.commandChild.count === 2)
      await after(() => t.simulateEvent('.send-reset', 'click'), s => s.commandChild.count === 0)

      // Test 8: the isolatedState child renders
      t.simulateEvent('.toggle-good-child', 'click')
      await t.waitForState(s => s.showGoodChild)
      await wait(20)
      expect(t.html()).toContain('Good child with isolated state')

      t.expectNoDiagnostics()
    } finally {
      t.dispose()
    }
  })
})
