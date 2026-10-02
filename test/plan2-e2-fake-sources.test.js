// PLAN-2 E2 (a): renderComponent fakes the sources of driverless sinks: t.requests,
// t.respond, t.fail (with latest-only / abort emulation), no driver wiring in tests.
import { describe, it, expect, afterEach } from 'vitest'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import xs from 'xstream'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { ABORT } from '../src/component.js'
import { debounce } from '../src/extra/xstreamExtras.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  _resetDiagnostics()
})

function Quote({ state }) {
  return h('div', null, h('button', { className: 'get' }, 'Get'), h('p', { className: 'q' }, state.text))
}
Quote.initialState = { text: '', status: 'idle', code: null }
Quote.intent = ({ DOM, HTTP }) => ({
  LOAD: DOM.click('.get'),
  LOADED: HTTP.select('quote'),
  FAILED: HTTP.errors('quote'),
})
Quote.model = {
  LOAD: {
    STATE: s => ({ ...s, status: 'loading' }),
    HTTP: () => ({ category: 'quote', url: '/api/quote' }),
  },
  LOADED: (s, { value, status }) => ({ ...s, status: 'idle', text: `${value.text} (${status})` }),
  FAILED: (s, { status, error }) => ({ ...s, status: 'error', code: status, text: String(error.message) }),
}

function Search({ state }) {
  return h('div', null,
    h('input', { className: 'q', value: state.query }),
    h('ul', null, ...state.results.map(r => h('li', null, r))))
}
Search.initialState = { query: '', status: 'idle', results: [] }
Search.intent = ({ DOM, HTTP }) => {
  const q$ = DOM.input('.q').value()
  return {
    TYPE: q$,
    SEARCH: q$.compose(debounce(50)).filter(q => q !== ''),
    RESULTS: HTTP.select('search'),
    FAILED: HTTP.errors('search'),
  }
}
Search.model = {
  TYPE: {
    STATE: (s, query) => query === '' ? { ...s, query, status: 'idle', results: [] } : { ...s, query },
    HTTP: (s, query) => query === '' ? { category: 'search', abort: true } : ABORT,
  },
  SEARCH: {
    STATE: s => ({ ...s, status: 'searching' }),
    HTTP: (s, q) => ({ category: 'search', url: '/api/search', query: { q }, latest: true }),
  },
  RESULTS: (s, { value }) => ({ ...s, status: 'done', results: value }),
  FAILED: s => ({ ...s, status: 'error', results: [] }),
}

describe('E2: fake sources in renderComponent', () => {
  it('records the request and answers it with t.respond (no drivers option)', async () => {
    t = renderComponent(Quote)
    t.simulateEvent('.get', 'click')
    t.respond('HTTP', { text: 'Hi' })
    await t.next(s => s.text === 'Hi (200)')
    expect(t.requests('HTTP')).toEqual([{ category: 'quote', url: '/api/quote' }])
    // PLAN-3 1-C (G-141): t.requests lists requests (no { abort } commands); sinkValues everything
    expect(t.requests('HTTP')).toEqual(t.sinkValues('HTTP'))
  })

  it('t.fail with an HTTP status, a message or an Error goes to errors()', async () => {
    t = renderComponent(Quote)
    t.simulateEvent('.get', 'click')
    t.fail('HTTP', 404)
    await t.next(s => s.status === 'error')
    expect(t.states.at(-1)).toMatchObject({ code: 404, text: 'HTTP 404' })
    t.simulateEvent('.get', 'click')
    t.fail('HTTP', 'Failed to fetch')
    await t.next(s => s.status === 'error' && s.text === 'Failed to fetch')
    expect(t.states.at(-1).code).toBe(undefined)
  })

  it('t.respond waits for a debounced request and answers the latest pending one', async () => {
    t = renderComponent(Search)
    t.simulateEvent('.q', 'input', { value: 'du' })
    t.respond('HTTP', ['Dubliners'])
    await t.next(s => s.status === 'done')
    expect(t.html()).toContain('Dubliners')
    expect(t.requests('HTTP').at(-1)).toMatchObject({ query: { q: 'du' }, latest: true })
  })

  it('a request superseded by a later latest: true request gets nothing, even when answered explicitly', async () => {
    t = renderComponent(Search)
    t.simulateEvent('.q', 'input', { value: 'du' })
    await t.next(s => s.status === 'searching')
    t.simulateEvent('.q', 'input', { value: 'dune' })
    await t.next(s => s.query === 'dune')
    await new Promise(r => setTimeout(r, 80))
    const [du, dune] = t.requests('HTTP')
    expect(dune.query.q).toBe('dune')
    // stale: not pending (the real driver dropped it); PLAN-3 1-C (G-140): throws at the call
    expect(() => t.respond('HTTP', ['Dubliners'], { request: du })).toThrow(/no pending HTTP request/)
    t.respond('HTTP', ['Dune'])                         // the latest pending one
    await t.next(s => s.status === 'done')
    expect(t.states.at(-1).results).toEqual(['Dune'])
    expect(t.states.some(s => s.results.includes('Dubliners'))).toBe(false)
  })

  it('clearing while in flight ({ category, abort: true }) leaves nothing pending: t.respond throws', async () => {
    t = renderComponent(Search, { timeoutMs: 300 })
    t.simulateEvent('.q', 'input', { value: 'dun' })
    await t.next(s => s.status === 'searching')
    t.simulateEvent('.q', 'input', { value: '' })
    await t.next(s => s.status === 'idle')
    expect(() => t.respond('HTTP', ['Dungeon'])).toThrow(/no pending HTTP request\..*aborted or superseded/)
  })

  it('a response nothing selects fails the test, naming the categories listened to', async () => {
    t = renderComponent(Quote)
    t.simulateEvent('.get', 'click')
    t.respond('HTTP', { text: 'x' }, { category: 'qoute' })
    await expect(t.settle()).rejects.toThrow(/no pending HTTP request with category 'qoute'/)
  })

  it('a failure nothing handles fails the test with a hint', async () => {
    function NoErrors() { return h('button', { className: 'go' }, 'go') }
    NoErrors.initialState = {}
    NoErrors.intent = ({ DOM, API }) => ({ GO: DOM.click('.go'), DONE: API.select('x') })
    NoErrors.model = { GO: { API: () => ({ category: 'x', url: '/x' }) }, DONE: s => s }
    t = renderComponent(NoErrors)
    t.simulateEvent('.go', 'click')
    t.fail('API', 500)
    await expect(t.settle()).rejects.toThrow(/no intent listens to API\.errors\('x'\).*listening: API\.errors\(\)|no intent listens to API\.errors\('x'\)/)
  })

  it("a child's intent that reads a source no driver provides gets the shared fake", async () => {
    function Loader({ state }) { return h('p', { className: 'v' }, String(state.v)) }
    Loader.intent = ({ DATA }) => ({ GOT: DATA.select('v') })
    Loader.model = { GOT: (s, { value }) => ({ ...s, v: value }) }
    function App() { return h('div', null, h(Loader, { state: 'loader' })) }
    App.initialState = { loader: { v: 0 } }
    t = renderComponent(App)
    await t.ready()
    t.respond('DATA', 42, { category: 'v', request: null })
    await t.next(s => s.loader.v === 42)
    expect(t.html()).toContain('42')
  })

  it('a real driver passed in drivers wins; t.respond on it throws', async () => {
    t = renderComponent(Quote, { drivers: { HTTP: () => ({ select: () => xs.never(), errors: () => xs.never() }) } })
    expect(() => t.respond('HTTP', 1)).toThrow(/HTTP has a real driver/)
  })
})
