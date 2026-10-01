// PLAN-2 2-R: renderComponent review fixes (R2-3 … R2-6)
import { describe, it, expect, afterEach } from 'vitest'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { _resetDiagnostics, getDiagnosticsMode } from '../src/extra/diagnostics/index.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
})

function Saver({ state }) { return h('button', { className: 'save' }, state.label) }
Saver.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
Saver.model = { SAVE: { API: s => ({ body: s.label }) }, DISPOSE: { API: () => 'bye' } }

// ─── R2-3: G-064 recording and next() explanations work with diagnostics: 'off' ─────

describe("R2-3: the harness's own hooks run with diagnostics: 'off'", () => {
  it("a child's driverless sink is recorded with diagnostics: 'off'", async () => {
    function App() { return h('div', null, h(Saver, { state: 'saver' })) }
    App.initialState = { saver: { label: 'one' } }
    t = renderComponent(App, { diagnostics: 'off' })
    expect(getDiagnosticsMode()).toBe('off')
    t.simulateEvent('.save', 'click')
    await t.settle()
    expect(t.sinkValues('API')).toEqual([{ body: 'one' }])
  })

  it("a next() timeout still names a pending model next() with diagnostics: 'off'", async () => {
    function S({ state }) { return h('p', null, state.status) }
    S.initialState = { status: 'idle' }
    S.model = {
      SAVE: { STATE: s => ({ ...s, status: 'saving' }), EFFECT: (_s, _d, next) => next('DONE', null, 400) },
      DONE: s => ({ ...s, status: 'done' }),
    }
    t = renderComponent(S, { diagnostics: 'off', timeoutMs: 100 })
    t.simulateAction('SAVE')
    await expect(t.next(s => s.status === 'done')).rejects.toThrow(/next\('DONE'\) scheduled by S.*400ms/s)
  })

  it("'off' still reports nothing: no diagnostics are collected", async () => {
    function App() { return h('div', null, h('p', { className: 'x' }, 'x')) }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.missing') })
    App.model = { GO: s => s }
    App.initialState = {}
    t = renderComponent(App, { diagnostics: 'off' })
    t.simulateEvent('.missing', 'click', { allowMissing: true })
    await t.settle()
    expect(t.diagnostics).toEqual([])
  })
})

// ─── R2-4: a removed child's DISPOSE output on a driverless sink is recorded ─────

describe("R2-4: a child's DISPOSE output on a driverless sink is recorded", () => {
  function App({ state }) { return h('div', null, state.show ? h(Saver, { state: 'saver' }) : h('p', null, 'gone')) }
  App.initialState = { show: true, saver: { label: 'x' } }
  App.model = { HIDE: s => ({ ...s, show: false }) }

  it('recorded like with a passed driver', async () => {
    t = renderComponent(App)
    await t.ready()
    await t.settle()
    t.simulateAction('HIDE')
    await t.settle()
    await sleep(30)
    expect(t.sinkValues('API')).toEqual(['bye'])
  })

  it('the passed-driver case (reference) gets the same value', async () => {
    const got = []
    const API = sink$ => { sink$.addListener({ next: v => got.push(v), error() {}, complete() {} }); return {} }
    t = renderComponent(App, { drivers: { API } })
    await t.ready()
    await t.settle()
    t.simulateAction('HIDE')
    await t.settle()
    await sleep(30)
    expect(got).toEqual(['bye'])
  })
})

// ─── R2-5: timing options are finite, setTimeout-safe and consistent ─────

describe('R2-5: timing option validation', () => {
  function C({ state }) { return h('p', null, String(state.n)) }
  C.initialState = { n: 0 }

  it('rejects Infinity, NaN and values above 2^31-1', () => {
    expect(() => renderComponent(C, { timeoutMs: Infinity })).toThrow(/timeoutMs must be a finite number of ms between 0 and 2147483647/)
    expect(() => renderComponent(C, { settleMs: NaN })).toThrow(/settleMs must be/)
    expect(() => renderComponent(C, { eventWaitMs: 2 ** 31 })).toThrow(/eventWaitMs must be/)
  })

  it('accepts 0 and 2^31-1', () => {
    t = renderComponent(C, { eventWaitMs: 0, timeoutMs: 2147483647 })
    t.dispose()
    t = null
  })

  it('rejects settleMs > timeoutMs', () => {
    expect(() => renderComponent(C, { settleMs: 500, timeoutMs: 100 })).toThrow(/settleMs \(500\) is longer than timeoutMs \(100\)/)
  })

  it('validates a per-call timeout too', async () => {
    t = renderComponent(C)
    expect(() => t.next(() => true, Infinity)).toThrow(/next: the timeout must be a finite number/)
    expect(() => t.settle(-1)).toThrow(/settle: the timeout must be/)
  })
})

// ─── R2-6: ready() cursor ─────

describe('R2-6: the ready() cursor', () => {
  function Counter({ state }) { return h('p', null, String(state.count)) }
  Counter.initialState = { count: 0 }
  Counter.model = { INC: s => ({ count: s.count + 1 }) }

  it('every next() started before one resolves begins at the cursor (Promise.all)', async () => {
    t = renderComponent(Counter)
    t.simulateAction('INC')
    t.simulateAction('INC')
    await t.ready()
    const [a, b] = await Promise.all([t.next(s => s.count === 1, 300), t.next(s => s.count === 2, 300)])
    expect(a).toEqual({ count: 1 })
    expect(b).toEqual({ count: 2 })
  })

  it('an unused cursor expires on the macrotask after ready() resolves', async () => {
    t = renderComponent(Counter)
    t.simulateAction('INC')
    t.ready() // not awaited, e.g. in a beforeEach
    await sleep(60)
    // a much later next() waits for a new state instead of returning { count: 1 }
    const p = t.next(undefined, 300)
    t.simulateAction('INC')
    expect(await p).toEqual({ count: 2 })
  })

  it('an unused cursor from an awaited ready() expires too', async () => {
    t = renderComponent(Counter)
    t.simulateAction('INC')
    await t.ready()
    await sleep(20)
    const p = t.next(undefined, 300)
    t.simulateAction('INC')
    expect(await p).toEqual({ count: 2 })
  })

  it('waitForState() disarms it', async () => {
    t = renderComponent(Counter)
    t.simulateAction('INC')
    await t.ready()
    await t.waitForState(s => s.count === 1, 300)
    const p = t.next(undefined, 300)
    t.simulateAction('INC')
    expect(await p).toEqual({ count: 2 })
  })
})
