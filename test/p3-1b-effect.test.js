// PLAN-3 workstream 1-B: async EFFECT hardening (PLAN-3 §1.2).
// - a returned thenable is expected (no SYG219);
// - a rejection is reported as SYG214, like a synchronous throw, with no unhandled rejection;
// - next() after dispose is a no-op (with a debug log saying why);
// - props.signal is an AbortSignal aborted on DISPOSE.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))
const codes = t => t.diagnostics.map(d => d.code)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const view = ({ state }) => h('div', null, String(state.n))

let t
let unhandled
const onUnhandled = reason => { unhandled.push(reason) }
beforeEach(() => {
  unhandled = []
  process.on('unhandledRejection', onUnhandled)
})
afterEach(() => {
  t?.dispose()
  t = undefined
  process.off('unhandledRejection', onUnhandled)
  delete process.env.SYGNAL_DEBUG
  vi.restoreAllMocks()
})

describe('1-B: async EFFECT', () => {
  it('an async EFFECT can await, then next() reaches the model', async () => {
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = {
      LOAD: { EFFECT: async (s, d, next) => { const v = await Promise.resolve(d * 2); next('DONE', v) } },
      DONE: (s, v) => ({ ...s, n: v }),
    }
    t = renderComponent(App)
    t.simulateAction('LOAD', 21)
    await t.waitForState(s => s.n === 42)
    expect(t.states.at(-1)).toEqual({ n: 42 })
    t.expectNoDiagnostics()
  })

  it('a returned promise is not reported as an ignored value (no SYG219)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { 'POKE | EFFECT': async () => 'ignored result' }
    t = renderComponent(App)
    t.simulateAction('POKE')
    await t.settle()
    await wait()
    expect(codes(t)).not.toContain('SYG219')
    t.expectNoDiagnostics()
    expect(warn.mock.calls.filter(c => String(c[0]).includes('SYG219'))).toEqual([])
  })

  it('any thenable counts, not only native promises', async () => {
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = {
      POKE: { EFFECT: () => ({ then: () => {} }) },
      BAD: { EFFECT: () => ({ then: (_ok, ko) => ko(new Error('thenable failed')) }) },
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    t = renderComponent(App)
    t.simulateAction('POKE')
    await t.settle()
    expect(codes(t)).toEqual([])
    t.simulateAction('BAD')
    await t.settle()
    expect(codes(t)).toEqual(['SYG214'])
  })

  it('a rejection is reported as SYG214, with no unhandled rejection, and the app continues', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = {
      FAIL: { EFFECT: async () => { await null; throw new Error('idb failed') } },
      INC: s => ({ ...s, n: s.n + 1 }),
    }
    t = renderComponent(App)
    t.simulateAction('FAIL')
    await t.settle()
    await wait()
    const d = t.diagnostics.find(x => x.code === 'SYG214')
    expect(d).toBeTruthy()
    expect(d.severity).toBe('error')
    expect(codes(t)).not.toContain('SYG219')
    expect(unhandled).toEqual([])
    // the operation failed, the app continues (D43)
    t.simulateAction('INC')
    await t.waitForState(s => s.n === 1)
  })

  it('a rejected promise returned without async/await is also SYG214', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { FAIL: { EFFECT: () => Promise.reject(new Error('nope')) } }
    t = renderComponent(App)
    t.simulateAction('FAIL')
    await t.settle()
    await wait()
    expect(codes(t)).toContain('SYG214')
    expect(unhandled).toEqual([])
  })

  it('next() after dispose is ignored, and the debug log says why', async () => {
    const gate = deferred()
    let done = 0
    let nextFn
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = {
      LOAD: { EFFECT: async (s, d, next) => { nextFn = next; await gate.promise; next('DONE', 1) } },
      DONE: s => { done++; return { ...s, n: 1 } },
    }
    t = renderComponent(App)
    t.simulateAction('LOAD')
    await t.settle()
    expect(nextFn).toBeTypeOf('function')
    t.dispose()
    t = undefined
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.SYGNAL_DEBUG = 'true'
    gate.resolve()
    await wait(50)
    expect(done).toBe(0)
    const lines = log.mock.calls.map(c => String(c[0]))
    expect(lines.some(l => l.includes('next(DONE) ignored: disposed'))).toBe(true)
    expect(lines.some(l => l.includes('EFFECT triggered a next() action'))).toBe(false)
    expect(unhandled).toEqual([])
  })

  it('props.signal is an AbortSignal that aborts on DISPOSE', async () => {
    let signal
    const aborted = vi.fn()
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = {
      WATCH: {
        EFFECT: (s, d, next, { signal: sig }) => {
          signal = sig
          sig.addEventListener('abort', aborted)
        },
      },
    }
    t = renderComponent(App)
    t.simulateAction('WATCH')
    await t.settle()
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    t.dispose()
    t = undefined
    expect(signal.aborted).toBe(true)
    expect(aborted).toHaveBeenCalledTimes(1)
  })

  it('every EFFECT of one instance gets the same signal; another instance gets its own', async () => {
    const seen = []
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { A: { EFFECT: (s, d, n, { signal }) => { seen.push(signal) } } }
    t = renderComponent(App)
    t.simulateAction('A')
    t.simulateAction('A')
    await t.settle()
    const t2 = renderComponent(App)
    t2.simulateAction('A')
    await t2.settle()
    expect(seen).toHaveLength(3)
    expect(seen[0]).toBe(seen[1])
    expect(seen[2]).not.toBe(seen[0])
    t2.dispose()
    expect(seen[2].aborted).toBe(true)
    expect(seen[0].aborted).toBe(false)
  })

  it('without AbortController, signal is undefined and EFFECTs still run', async () => {
    const AC = globalThis.AbortController
    let got = 'unset'
    try {
      // eslint-disable-next-line no-global-assign
      delete globalThis.AbortController
      function App(p) { return view(p) }
      App.initialState = { n: 0 }
      App.model = { A: { EFFECT: (s, d, n, props) => { got = props.signal } } }
      t = renderComponent(App)
      t.simulateAction('A')
      await t.settle()
      t.dispose()
      t = undefined
    } finally {
      globalThis.AbortController = AC
    }
    expect(got).toBeUndefined()
  })

  it('STATE and driver reducers do not get a signal (EFFECT only)', async () => {
    let stateProps, logProps
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { A: { STATE: (s, d, n, props) => { stateProps = props; return s }, LOG: (s, d, n, props) => { logProps = props; return 1 } } }
    t = renderComponent(App)
    t.simulateAction('A')
    await t.settle()
    expect(stateProps).toBeTruthy()
    expect('signal' in stateProps).toBe(false)
    expect('signal' in logProps).toBe(false)
  })
})

describe('1-B: synchronous EFFECT is unchanged', () => {
  it('a synchronous EFFECT runs and its next() reaches the model', async () => {
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { GO: { EFFECT: (s, d, next) => { next('SET', d) } }, SET: (s, d) => ({ ...s, n: d }) }
    t = renderComponent(App)
    t.simulateAction('GO', 7)
    await t.waitForState(s => s.n === 7)
    t.expectNoDiagnostics()
  })

  it('a returned non-thenable value still reports SYG219', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { GO: { EFFECT: () => ({ n: 1 }) } }
    t = renderComponent(App)
    t.simulateAction('GO')
    await t.settle()
    expect(codes(t)).toContain('SYG219')
    expect(t.states.at(-1)).toEqual({ n: 0 })
  })

  it('a synchronous throw is still SYG214', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { GO: { EFFECT: () => { throw new Error('sync') } } }
    t = renderComponent(App)
    t.simulateAction('GO')
    await t.settle()
    expect(codes(t)).toContain('SYG214')
  })
})
