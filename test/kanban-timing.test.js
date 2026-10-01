// 2E-2 (G-049 / G-047): the kanban example under renderComponent, against the BUILT package
// (run `npm run build` first; like test/inspect-kanban.test.js). Without waiting between the
// calls, an Enter on '.new-task-input' (not rendered yet) adds the task to ONE lane, and
// waitForState/next resolve once the new TaskCard has rendered.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') globalThis.window = undefined

// the drag driver needs a real DOM; a source with the same API that never fires
const never = () => Object.assign(xs.never(), { data: () => xs.never() })
const DND = () => ({ dragstart: never, dragend: never, drop: never, dragover: never, dragenter: never, dragleave: never })

let sygnal, RootComponent, reactShim = false
beforeAll(async () => {
  sygnal = await import('sygnal')
  // the root vitest compiles the example's .jsx as classic React.createElement calls
  if (typeof globalThis.React === 'undefined') { globalThis.React = { createElement: sygnal.createElement }; reactShim = true }
  RootComponent = (await import('../examples/kanban/src/RootComponent.jsx')).default
})
afterAll(() => { if (reactShim) delete globalThis.React })

describe('kanban: simulateEvent timing (G-049)', () => {
  it('Enter on .new-task-input only affects one lane', async () => {
    const t = sygnal.renderComponent(RootComponent, { drivers: { DND } })
    try {
      const before = RootComponent.initialState.lanes.map(l => l.tasks.length)
      t.simulateEvent('.add-task-btn', 'click')
      t.simulateEvent('.new-task-input', 'keydown', { key: 'Enter', value: '  Write tests ' })
      const s = await t.next(s => s.lanes.some((l, i) => l.tasks.length !== before[i]))
      await t.settle()
      const after = t.states.at(-1).lanes.map(l => l.tasks.length)
      expect(after).toEqual(before.map((n, i) => (i === 0 ? n + 1 : n)))
      expect(s.lanes[0].tasks.at(-1).title).toBe('Write tests')
      // the new TaskCard has rendered
      expect(t.html()).toContain('Write tests')
    } finally {
      t.dispose()
    }
  })
})
