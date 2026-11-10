// @vitest-environment jsdom
// Research spike (dev-plans/research/files-touched): a root component names its own drivers,
// `App.drivers = { HTTP: makeFetchDriver() }`, so a feature doesn't edit main.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { run, makeTimerDriver, makeFetchDriver, renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

let app
beforeEach(() => { document.body.innerHTML = '<div id="root"></div>' })
afterEach(() => { app?.dispose(); app = null; vi.useRealTimers(); vi.unstubAllGlobals() })

const json = (body) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(body), json: async () => body })

function Quote({ state }) { return h('p', { className: 'q' }, state.quote?.data?.text ?? 'loading') }
Quote.initialState = {}
Quote.resources = { quote: () => ({ url: '/api/quote' }) }
Quote.drivers = { HTTP: makeFetchDriver() }

function Clock({ state }) { return h('p', { className: 'n' }, String(state.n)) }
Clock.initialState = { n: 0 }
Clock.timers = () => ({ tick: { every: 1000, action: 'TICK' } })
Clock.model = { TICK: (state, { n }) => ({ ...state, n }) }
Clock.drivers = { TIMER: makeTimerDriver() }

const settled = () => new Promise((r) => setTimeout(r, 20))

describe('App.drivers', () => {
  it('run(App) wires the drivers the root names', async () => {
    const fetchMock = vi.fn(async () => json({ text: 'hello' }))
    vi.stubGlobal('fetch', fetchMock)
    app = run(Quote, undefined, { mountPoint: '#root' })
    await settled()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/quote')
    expect(document.querySelector('.q').textContent).toBe('hello')
  })

  it('a timer driver works the same way', async () => {
    vi.useFakeTimers()
    app = run(Clock, undefined, { mountPoint: '#root' })
    await vi.advanceTimersByTimeAsync(2050)
    expect(document.querySelector('.n').textContent).toBe('2')
  })

  it("run()'s argument overrides the static by name (baseUrl, a test double)", async () => {
    const fetchMock = vi.fn(async () => json({ text: 'there' }))
    vi.stubGlobal('fetch', fetchMock)
    app = run(Quote, { HTTP: makeFetchDriver({ baseUrl: 'https://api.example.com' }) }, { mountPoint: '#root' })
    await settled()
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.com/api/quote')
  })

  it('a second app gets a fresh driver from the same factory', async () => {
    const fetchMock = vi.fn(async () => json({ text: 'two apps' }))
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const a = run(Quote, undefined, { mountPoint: '#a' })
    const b = run(Quote, undefined, { mountPoint: '#b' })
    await settled()
    expect(document.querySelector('#a .q').textContent).toBe('two apps')
    expect(document.querySelector('#b .q').textContent).toBe('two apps')
    a.dispose()
    b.dispose()
  })

  it('renderComponent ignores it: tests stay driverless', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const t = renderComponent(Quote, { initialState: {} })
    await t.settle?.()
    expect(fetchMock).not.toHaveBeenCalled()
    t.dispose()
  })

  it('no drivers static: nothing changes', async () => {
    function Plain({ state }) { return h('p', { className: 'p' }, state.v) }
    Plain.initialState = { v: 'plain' }
    app = run(Plain, undefined, { mountPoint: '#root' })
    await settled()
    expect(document.querySelector('.p').textContent).toBe('plain')
    expect(app.sources.HTTP).toBeUndefined()
  })
})

describe('dev checks', () => {
  beforeEach(() => setupChecks())

  it('SYG643 stays quiet when the static provides the driver, and fires without it', async () => {
    app = run(Clock, undefined, { mountPoint: '#root', diagnostics: 'collect' })
    await settled()
    expect(diagnostics('SYG643')).toEqual([])
    app.dispose()
    function NoDriver({ state }) { return h('p', null, String(state.n)) }
    NoDriver.initialState = { n: 0 }
    NoDriver.timers = Clock.timers
    NoDriver.model = Clock.model
    app = run(NoDriver, undefined, { mountPoint: '#root', diagnostics: 'collect' })
    await settled()
    expect(diagnostics('SYG643').length).toBe(1)
  })
})
