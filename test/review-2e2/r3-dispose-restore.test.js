// 2E-2 regression test (PLAN-1 Phase 2 close-review fixes).
import { describe, it, expect } from 'vitest'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { inspect } from '../../src/extra/diagnostics/checks/index.js'
import { wait, track, useFreshDiagnostics } from './helpers.js'

useFreshDiagnostics()

// ─── R3: child disposal happens while diagnostics are still on ───────────────

describe('R3: t.dispose() disposes the whole tree before restoring diagnostics', () => {
  it('runs child onDispose hooks and leaves no inspect() records behind', async () => {
    const log = []
    function Badge() { return h('span', { className: 'b' }, 'x') }
    Badge.model = { DISPOSE: { EFFECT: () => { log.push('Badge DISPOSE') } } }
    function App() { return h('div', null, h(Badge, { state: 'badge' })) }
    App.initialState = { badge: { x: 1 } }
    App.model = { DISPOSE: { EFFECT: () => { log.push('App DISPOSE') } } }

    track({ onDispose(c) { log.push('onDispose ' + c.name) } })
    const t = renderComponent(App)
    await t.ready()
    await wait(20)
    const ids = t.inspect().components.map(c => c.id)
    expect(ids).toHaveLength(2)
    t.dispose()
    await wait(30)
    expect(log).toContain('onDispose App')
    expect(log).toContain('onDispose Badge')
    expect(log).toContain('Badge DISPOSE')
    // the global graph (no renderComponent filter) has nothing left from that instance
    expect(inspect().components.filter(c => ids.includes(c.id))).toEqual([])
  })
})

