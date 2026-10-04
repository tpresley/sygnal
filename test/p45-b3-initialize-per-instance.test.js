// PLAN-4.5 P45-B item 3 (G-252): a model without INITIALIZE got the default INITIALIZE reducer
// written onto the user's model object by the first instance ever created. That reducer closed
// over the first instance (its addCalculated and memo cache), so the first instance was never
// collected (with its intent streams: 1 retained ScopeChecker in the perf gate), and every later
// instance initialised its state with the first instance's calculated fields. Now each instance
// resolves its own default INITIALIZE and the user's model is left alone (the perf gate's
// 'Retained ScopeCheckers' count checks the collection: 0).
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { _resetDiagnostics, getDiagnostics } from '../src/extra/diagnostics/index.js'

let ts = []
afterEach(() => { ts.forEach(t => t.dispose()); ts = []; _resetDiagnostics() })
const render = (C, o) => { const t = renderComponent(C, o); ts.push(t); return t }

describe('G-252: the default INITIALIZE reducer is per instance', () => {
  it("the user's model object is not written to", async () => {
    const model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    function C({ state }) { return h('p', null, state.n) }
    C.initialState = { n: 1 }
    C.model = model
    const t = render(C)
    await t.ready()
    expect(Object.keys(model)).toEqual(['INC'])
    expect('INITIALIZE' in C.model).toBe(false)
  })

  it("a second instance initialises with its own calculated fields, not the first's", async () => {
    const shared = { NOOP: (s) => s }
    function A({ state }) { return h('p', null, state.x) }
    A.initialState = { n: 1 }
    A.model = shared
    A.calculated = { x: () => 'from A' }
    A.storeCalculatedInState = true
    function B({ state }) { return h('p', null, state.x) }
    B.initialState = { n: 1 }
    B.model = shared
    B.calculated = { x: () => 'from B' }
    B.storeCalculatedInState = true
    const a = render(A)
    await a.ready()
    expect(a.state.x).toBe('from A')
    const b = render(B)
    await b.ready()
    expect(b.state.x).toBe('from B')
  })

  it('SYG210: a non-STATE sink on INITIALIZE is still reported and ignored', async () => {
    function C({ state }) { return h('p', null, state.n) }
    C.initialState = { n: 1 }
    C.model = { INITIALIZE: { STATE: (s, d) => ({ ...d, n: 2 }), EVENTS: () => ({ type: 'x' }) } }
    const t = render(C)
    await t.ready()
    expect(t.state.n).toBe(2)
    expect(getDiagnostics().some(d => d.code === 'SYG210')).toBe(true)
  })

})
