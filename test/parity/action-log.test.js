// @vitest-environment jsdom
// PLAN-4.6 parity: the action log that the next core builds from onAction / wrapHandler /
// onReducer / onNext hooks (spike 0-S §8), observed through renderComponent's public t.actions and
// t.explain (no hooks, no debug-text parsing in the test).
import { it, expect } from 'vitest'
import { parity, renderComponent, h } from './harness.js'

parity('parity: action log (t.actions, t.explain)', () => {
  function C({ state }) { return h('button', { className: 'b' }, String(state.n)) }
  C.initialState = { n: 0 }
  C.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
  C.model = {
    INC: { STATE: (s) => ({ ...s, n: s.n + 1 }), EFFECT: (s, d, next) => next('LATER', s.n, 5) },
    LATER: (s, v) => ({ ...s, n: s.n + 10 + v }),
  }

  it('records actions with their component, the sinks each fed and their cause; next() is a "next" action', async () => {
    const t = renderComponent(C)
    await t.ready()
    t.simulateEvent('.b', 'click')
    await t.waitForState((s) => s.n === 11)
    const mine = t.actions.filter((a) => a.cause !== 'built-in').map(({ component, type, sinks, cause, data }) => ({ component, type, sinks: [...sinks].sort(), cause, ...(type == 'LATER' && { data }) }))
    expect(mine).toEqual([
      { component: 'C', type: 'INC', sinks: ['EFFECT', 'STATE'], cause: 'intent' },
      { component: 'C', type: 'LATER', sinks: ['STATE'], cause: 'next', data: 0 },
    ])
    const e = t.explain((s) => s.n === 1)
    expect(e.type).toBe('INC')
    expect(e.state).toMatchObject({ n: 1 })
    t.dispose()
  })
})
