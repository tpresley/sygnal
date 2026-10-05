// @vitest-environment jsdom
// PLAN-4.6 R5: fixes of the R4 review (G-324 ... G-335), each pinned here (failing first).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/index.js'

let t
afterEach(() => { t?.dispose(); t = null; vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('G-324: a child-only fake sink answers an intent-less child', () => {
  function App() { return h('div', null, h(Loader, { state: 'loader' })) }
  function Loader({ state }) { return h('p', { className: 'l' }, String(state.data)) }
  Loader.model = { BOOTSTRAP: { API: () => ({ url: '/x', ok: 'LOADED' }) }, LOADED: (s, d) => ({ ...s, data: d.v }) }
  App.initialState = { loader: { data: 'none' } }

  it('t.respond reaches a child that has a model but no intent', async () => {
    t = renderComponent(App)
    await t.ready()
    await t.settle()
    expect(t.requests('API')).toHaveLength(1)
    await t.respond('API', { v: 'yes' })
    await t.settle()
    expect(t.state.loader.data).toBe('yes')
    expect(t.html()).toContain('yes')
  })
})

describe('G-325: a root with a model and no intent: its model actions are simulate-only, not unreachable', () => {
  it('no SYG102 with the dev entry loaded', async () => {
    await import('../src/extra/diagnostics/checks/index.js')
    function Counter({ state }) { return h('div', null, String(state.n)) }
    Counter.initialState = { n: 0 }
    Counter.model = { INC: (s) => ({ ...s, n: s.n + 1 }), RESET: (s) => ({ ...s, n: 0 }) }
    t = renderComponent(Counter)
    await t.ready()
    t.simulateAction('INC')
    await t.next()
    await t.settle()
    expect(t.diagnostics.filter((d) => d.code === 'SYG102')).toEqual([])
  })
})

describe("G-326: an input's next() cursor expires after a macrotask (moving the clock by hand)", () => {
  function C({ state }) { return h('div', null, String(state.phase)) }
  C.initialState = { phase: 'idle' }
  C.model = {
    LOAD: { STATE: (s) => ({ ...s, phase: 'loading' }), EFFECT: (s, d, next) => next('DONE', null, 40) },
    DONE: (s) => ({ ...s, phase: 'done' }),
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  it('simulateAction, a wait, then next(): the state after the call, not the one already past', async () => {
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('LOAD')
    await sleep(10)
    expect((await t.next()).phase).toBe('done')
  })

  it('fake timers: simulateAction, advanceTimersByTimeAsync, then next() (testing.md: move the clock by hand)', async () => {
    vi.useFakeTimers()
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('LOAD')
    await vi.advanceTimersByTimeAsync(5)
    expect((await t.next()).phase).toBe('done')
  })

  it('in the same tick, next() still starts at the input (D176)', async () => {
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('LOAD')
    expect((await t.next()).phase).toBe('loading')
    expect((await t.next()).phase).toBe('done')
  })
})
