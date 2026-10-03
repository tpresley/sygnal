// @vitest-environment jsdom
// PLAN-4 3-C (GS-7): makeTimerDriver() under run(); SYG643 (a static with no driver to take it)
// and SYG422 (an invalid timer spec) from the dev entry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { run, makeTimerDriver, makeSocketDriver, makeFetchDriver } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

let app
beforeEach(() => { document.body.innerHTML = '<div id="root"></div>' })
afterEach(() => { app?.dispose(); app = null; vi.useRealTimers() })

function Clock({ state }) { return h('p', { className: 'n' }, String(state.n)) }
Clock.initialState = { running: true, n: 0 }
Clock.timers = (state) => ({ tick: state.running && { every: 1000, action: 'TICK' } })
Clock.model = { TICK: (state, { n }) => ({ ...state, n }) }

describe('run(App, { TIMER: makeTimerDriver() })', () => {
  it('ticks into the view; app dispose leaves no timer', async () => {
    vi.useFakeTimers()
    app = run(Clock, { TIMER: makeTimerDriver() }, { mountPoint: '#root' })
    await vi.advanceTimersByTimeAsync(3050)
    expect(document.querySelector('.n').textContent).toBe('3')
    app.dispose()
    app = null
    await vi.advanceTimersByTimeAsync(100)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the driver key is free: the core finds it by the static it takes', async () => {
    vi.useFakeTimers()
    app = run(Clock, { CLOCK: makeTimerDriver() }, { mountPoint: '#root' })
    await vi.advanceTimersByTimeAsync(2050)
    expect(document.querySelector('.n').textContent).toBe('2')
  })
})

describe('dev checks', () => {
  beforeEach(() => setupChecks())

  it('SYG643: timers declared with no timer driver registered', async () => {
    app = run(Clock, {}, { mountPoint: '#root', diagnostics: 'collect' })
    await new Promise(r => setTimeout(r, 20))
    expect(diagnostics('SYG643').map(d => [d.severity, d.component, d.data])).toEqual([
      ['warn', 'Clock', { static: 'timers', driver: 'makeTimerDriver()' }],
    ])
    expect(diagnostics('SYG643')[0].fix).toBe('Register the driver: run(App, { TIMER: makeTimerDriver() })')
  })

  it('SYG643 also for connections and resources without their drivers; none with them', async () => {
    function Feed({ state }) { return h('p', null, String(state.room)) }
    Feed.initialState = { room: 'a' }
    Feed.connections = (state) => ({ room: { socket: '/ws/' + state.room, message: 'MSG' } })
    Feed.resources = { quote: (state) => '/api/quote' }
    app = run(Feed, {}, { mountPoint: '#root', diagnostics: 'collect' })
    await new Promise(r => setTimeout(r, 20))
    expect(diagnostics('SYG643').map(d => d.data.static)).toEqual(['connections', 'resources'])
    app.dispose()
    setupChecks()
    const fetch = () => new Promise(() => {})
    app = run(Feed, { WS: makeSocketDriver({ WebSocket: class { close() {} } }), HTTP: makeFetchDriver({ fetch }) }, { mountPoint: '#root', diagnostics: 'collect' })
    await new Promise(r => setTimeout(r, 20))
    expect(diagnostics('SYG643')).toEqual([])
  })

  it('no SYG643 with the driver', async () => {
    app = run(Clock, { TIMER: makeTimerDriver() }, { mountPoint: '#root', diagnostics: 'collect' })
    await new Promise(r => setTimeout(r, 20))
    expect(diagnostics('SYG643')).toEqual([])
  })

  it('SYG422: an invalid spec is reported once and not started; the valid ones run', async () => {
    function Bad({ state }) { return h('p', { className: 'n' }, String(state.n)) }
    Bad.initialState = { n: 0 }
    Bad.timers = () => ({
      zero: { every: 0, action: 'TICK' },
      noAction: { after: 10 },
      both: { every: 10, after: 10, action: 'TICK' },
      frame: { frame: true },
      ok: { every: 10, action: 'TICK' },
    })
    Bad.model = { TICK: (state) => ({ ...state, n: state.n + 1 }) }
    app = run(Bad, { TIMER: makeTimerDriver() }, { mountPoint: '#root', diagnostics: 'collect' })
    await new Promise(r => setTimeout(r, 60))
    expect(diagnostics('SYG422').map(d => [d.severity, d.component, d.message])).toEqual([
      ['error', 'Bad', "Timer 'zero' every must be a positive number of ms (got 0); it is not started"],
      ['error', 'Bad', "Timer 'noAction' has no action (a string); it is not started"],
      ['error', 'Bad', "Timer 'both' has both every and after; it is not started"],
      ['error', 'Bad', "Timer 'frame' frame must be the action name (a string); it is not started"],
    ])
    expect(Number(document.querySelector('.n').textContent)).toBeGreaterThan(1)
  })
})
