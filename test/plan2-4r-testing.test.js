// PLAN-2 4-R: renderComponent review fixes — dispose() rejects pending waits (R4-8), and in
// mock mode `await t.next(a); await t.next(b)` starts after the state a returned (G-129).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => { if (t) t.dispose(); t = null; vi.useRealTimers() })

function C({ state }) { return h('div', null, String(state.n)) }
C.initialState = { n: 0 }
C.model = { INC: (state) => ({ n: state.n + 1 }) }

const DISPOSED = /renderComponent was disposed/

describe('R4-8: dispose() rejects every pending wait', () => {
  it('next, waitForState and settle reject at once (real timers)', async () => {
    t = renderComponent(C)
    await t.ready()
    const waits = [t.next(s => s.n === 5, 5000), t.waitForState(s => s.n === 5, 5000), t.settle(5000)]
    // settle may resolve on its own before dispose if the tree is already quiet; next/waitForState can't
    const results = Promise.allSettled(waits)
    const start = Date.now()
    t.dispose(); t = null
    const [n, w] = await results
    expect(Date.now() - start).toBeLessThan(1000)
    expect(n.status).toBe('rejected')
    expect(n.reason.message).toMatch(DISPOSED)
    expect(w.status).toBe('rejected')
    expect(w.reason.message).toMatch(DISPOSED)
  })

  it('ready() pending when the component is disposed rejects', async () => {
    t = renderComponent(C)
    const p = t.ready() // ready comes a few ms after the first render
    t.dispose(); t = null
    const r = await Promise.race([p.then(() => 'resolved', e => e.message), new Promise(r => setTimeout(() => r('still pending'), 1000))])
    expect(r).toMatch(DISPOSED)
  })

  it('under fake timers, a pending next() rejects on dispose (no hang)', async () => {
    vi.useFakeTimers()
    t = renderComponent(C)
    await t.ready()
    const p = t.next(s => s.n === 5, 500)
    t.dispose(); t = null
    const r = await p.then(() => 'resolved', e => e.message)
    expect(r).toMatch(DISPOSED)
    // its timeout is cleared: running the clock past it changes nothing
    await vi.advanceTimersByTimeAsync(1000)
  })

  it('under fake timers, a pending settle() rejects on dispose and clears its timers', async () => {
    vi.useFakeTimers()
    t = renderComponent(C)
    const p = t.settle(5000)
    t.dispose(); t = null
    const r = await p.then(() => 'resolved', e => e.message)
    expect(r).toMatch(DISPOSED)
  })
})

describe('G-129: mock mode next() after next() starts after the returned state', () => {
  it('a state that arrived while the first next() settled is matched by the second', async () => {
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('INC')
    t.simulateAction('INC')
    expect(await t.next(s => s.n === 1)).toEqual({ n: 1 })
    expect(await t.next(s => s.n === 2)).toEqual({ n: 2 })
  })

  it('an input after the first next() still waits for a new state', async () => {
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('INC')
    t.simulateAction('INC')
    expect(await t.next(s => s.n === 1)).toEqual({ n: 1 })
    t.simulateAction('INC')
    expect(await t.next()).toEqual({ n: 3 })
  })
})
