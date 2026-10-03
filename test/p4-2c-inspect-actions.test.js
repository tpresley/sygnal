// PLAN-4 2-C (GS-10): inspect({ actions: true }) lists the recent actions (bounded) from the
// 'sygnal/diagnostics' dev entry, in renderComponent (t.inspect) and under run().
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { inspect, installChecks } from '../src/extra/diagnostics/checks/index.js'
import { _resetDiagnostics, configureDiagnostics } from '../src/extra/diagnostics/index.js'
import { resetChecks } from '../src/extra/diagnostics/checks/index.js'
import { run } from '../src/index.js'
import { mockDOMSource } from '../src/cycle/dom/mockDOMSource.js'
import xs from 'xstream'

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
  resetChecks()
  installChecks()
})

function Counter({ state }) {
  return h('div', null, h('button', { className: 'inc' }, '+'), h('span', null, String(state.count)))
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (s) => ({ ...s, count: s.count + 1 }), SET: (s, n) => ({ ...s, count: n }) }

describe('inspect({ actions: true })', () => {
  it('t.inspect({ actions: true }) lists the recent actions with the component ids', async () => {
    installChecks()
    t = renderComponent(Counter)
    t.simulateEvent('.inc', 'click')
    t.simulateAction('SET', 4)
    await t.waitForState(s => s.count === 4)
    const g = t.inspect({ actions: true })
    const ids = g.components.map(c => c.id)
    const acts = g.recentActions
    expect(acts.map(a => a.type)).toEqual(['INITIALIZE', 'INC', 'SET'])
    expect(acts[1]).toMatchObject({ type: 'INC', component: 'Counter', cause: 'intent', sinks: ['STATE'] })
    expect(acts[2]).toMatchObject({ type: 'SET', data: 4, cause: 'simulateAction', sinks: ['STATE'] })
    expect(ids).toContain(acts[1].instance)
    expect(typeof acts[1].at).toBe('number')
    // without the option the graph is unchanged (the inspect schema has no recentActions yet)
    expect('recentActions' in t.inspect()).toBe(false)
  })

  it('under run() with diagnostics on (no renderComponent), bounded by the limit', async () => {
    installChecks()
    configureDiagnostics({ mode: 'collect' })
    function App() { return h('div') }
    App.initialState = { n: 0 }
    App.intent = () => ({ TICK: xs.periodic(1).take(30) })
    App.model = { TICK: (s) => ({ ...s, n: s.n + 1 }) }
    const { dispose } = run(App, { DOM: () => mockDOMSource({}) }, { diagnostics: 'collect' })
    await new Promise(r => setTimeout(r, 120))
    const all = inspect({ actions: 10 }).recentActions
    dispose()
    expect(all.length).toBe(10)
    expect(all.every(a => a.type === 'TICK' && a.cause === 'intent' && a.component === 'App')).toBe(true)
    expect(inspect({ actions: true }).recentActions.length).toBeGreaterThanOrEqual(30)
  })
})
