// @vitest-environment jsdom
// PLAN-3 1-C: renderComponent's fake sources answer requests with reply actions ({ url, ok, error }) like
// makeFetchDriver (to exactly the sender; latest/abort per sender; dispose drops them).
// t.respond / t.fail pick the request by content (an action name or category, { url }, a
// partial request, a predicate), throw at the call when nothing matching is pending (G-140)
// and return a promise for the rendered reply. t.requests lists requests only (G-141).
// G-131: child-only string requests are scope-tagged.
import { describe, it, expect, afterEach, vi } from 'vitest'

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/index.js'
import { debounce } from '../src/extra/xstreamExtras.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  _resetDiagnostics()
})

function Quote({ state }) {
  return h('div', null, h('button', { className: 'get' }, 'Get'), h('p', { className: 'q' }, state.text))
}
Quote.initialState = { text: '', status: 'idle' }
Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.get') })
Quote.model = {
  LOAD: {
    STATE: s => ({ ...s, status: 'loading' }),
    HTTP: () => ({ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }),
  },
  LOADED: (s, quote) => ({ ...s, status: 'done', text: quote.text }),
  FAILED: (s, { error, status, body, request }) => ({ ...s, status: 'error', text: error.message, code: status, body, url: request.url }),
}

describe('reply actions in the fake', () => {
  it('t.respond(name, body, okAction) delivers the parsed body as the ok action; the promise resolves after the render', async () => {
    t = renderComponent(Quote)
    t.simulateEvent('.get', 'click')
    await t.respond('HTTP', { text: 'Hi' }, 'LOADED')
    expect(t.state).toMatchObject({ status: 'done', text: 'Hi' })
    expect(t.html()).toContain('Hi')
    expect(t.requests('HTTP')).toEqual([{ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }])
  })

  it('t.fail delivers { error, request, status, body } as the error action', async () => {
    t = renderComponent(Quote)
    t.simulateEvent('.get', 'click')
    await t.fail('HTTP', 404, { body: { message: 'gone' } })
    expect(t.state).toMatchObject({ status: 'error', text: 'HTTP 404', code: 404, body: { message: 'gone' }, url: '/api/quote' })
  })

  it('the target may be the error action name too, or { url }', async () => {
    t = renderComponent(Quote)
    t.simulateEvent('.get', 'click')
    await t.fail('HTTP', 'offline', 'FAILED')
    expect(t.state).toMatchObject({ status: 'error', text: 'offline' })
    expect(t.state.code).toBe(undefined)
    t.simulateEvent('.get', 'click')
    await t.respond('HTTP', { text: 'again' }, { url: '/api/quote' })
    expect(t.state.text).toBe('again')
  })

  it('a parent and a child using the same ok name: each reply reaches exactly its sender', async () => {
    function Kid({ state }) { return h('div', { className: 'kid' }, h('button', { className: 'kload' }, 'k'), state.v) }
    Kid.intent = ({ DOM }) => ({ LOAD: DOM.click('.kload') })
    Kid.model = { LOAD: { HTTP: () => ({ url: '/kid', ok: 'LOADED' }) }, LOADED: (s, v) => ({ ...s, v }) }
    function Dad({ state }) { return h('div', null, h('button', { className: 'dload' }, 'd'), h('span', { className: 'dad' }, state.v), h(Kid, { state: 'kid' })) }
    Dad.initialState = { v: '-', kid: { v: '-' } }
    Dad.intent = ({ DOM }) => ({ LOAD: DOM.click('.dload') })
    Dad.model = { LOAD: { HTTP: () => ({ url: '/dad', ok: 'LOADED' }) }, LOADED: (s, v) => ({ ...s, v }) }
    t = renderComponent(Dad)
    t.simulateEvent('.dload', 'click')
    t.simulateEvent('.kload', 'click')
    await t.respond('HTTP', 'K', { url: '/kid' })
    expect(t.state).toMatchObject({ v: '-', kid: { v: 'K' } })
    await t.respond('HTTP', 'D', 'LOADED')
    expect(t.state).toMatchObject({ v: 'D', kid: { v: 'K' } })
  })

  it('a child-only request with reply actions (the root has no HTTP) gets its reply actions on the child', async () => {
    function Kid({ state }) { return h('div', { className: 'kid' }, h('button', { className: 'kload' }, 'k'), String(state.v)) }
    Kid.intent = ({ DOM }) => ({ LOAD: DOM.click('.kload') })
    Kid.model = { LOAD: { HTTP: () => ({ url: '/kid', ok: 'GOT' }) }, GOT: (s, v) => ({ ...s, v }) }
    function App() { return h('div', null, h(Kid, { state: 'kid' })) }
    App.initialState = { kid: { v: 0 } }
    t = renderComponent(App)
    t.simulateEvent('.kload', 'click')
    await t.respond('HTTP', 7, 'GOT')
    expect(t.state.kid.v).toBe(7)
  })

  it('two Collection items answered by url', async () => {
    function Item({ state }) {
      return h('li', { className: 'item', data: { id: state.id } }, h('button', { className: 'load' }, 'load'), `${state.id}:${state.detail || '-'}`)
    }
    Item.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
    Item.model = {
      LOAD: { HTTP: s => ({ url: `/items/${s.id}`, ok: 'GOT', latest: true }) },
      GOT: (s, detail) => ({ ...s, detail }),
    }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 1 }, { id: 2 }] }
    t = renderComponent(List)
    t.simulateEvent('.item[data-id="1"] .load', 'click')
    t.simulateEvent('.item[data-id="2"] .load', 'click')
    await t.respond('HTTP', 'D2', { url: '/items/2' })
    await t.respond('HTTP', 'D1', { url: '/items/1' })
    expect(t.html()).toContain('1:D1')
    expect(t.html()).toContain('2:D2')
  })

  it("a removed Collection item's request is no longer pending (dispose drops it)", async () => {
    function Item({ state }) { return h('li', { className: 'item', data: { id: state.id } }, h('button', { className: 'load' }, 'load')) }
    Item.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
    Item.model = { LOAD: { HTTP: s => ({ url: `/items/${s.id}`, ok: 'GOT' }) }, GOT: (s, detail) => ({ ...s, detail }) }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 1 }, { id: 2 }] }
    List.model = { DROP: s => ({ ...s, items: s.items.filter(i => i.id !== 1) }) }
    t = renderComponent(List)
    t.simulateEvent('.item[data-id="1"] .load', 'click')
    await t.settle()
    t.simulateAction('DROP')
    await t.next(s => s.items.length === 1)
    await t.settle()
    expect(() => t.respond('HTTP', 'x', { url: '/items/1' })).toThrow(/no pending HTTP request/)
  })
})

function Search({ state }) {
  return h('div', null, h('input', { className: 'q', value: state.query }), h('ul', null, ...state.results.map(r => h('li', null, r))))
}
Search.initialState = { query: '', status: 'idle', results: [] }
Search.intent = ({ DOM }) => ({ TYPE: DOM.input('.q').value() })
Search.model = {
  TYPE: {
    STATE: (s, query) => ({ ...s, query, status: query ? 'searching' : 'idle', results: [] }),
    HTTP: (s, q) => q ? { url: '/api/search', query: { q }, ok: 'RESULTS', latest: true } : { abort: 'RESULTS' },
  },
  RESULTS: (s, results) => ({ ...s, status: 'done', results }),
}

describe('G-140: t.respond / t.fail throw at the call when nothing matching is pending', () => {
  it('nothing sent at all', async () => {
    t = renderComponent(Quote)
    await t.ready()
    expect(() => t.respond('HTTP', 1)).toThrow(/t\.respond\('HTTP'\): no pending HTTP request.*sent none/s)
    expect(() => t.fail('HTTP', 500)).toThrow(/no pending HTTP request/)
  })

  it('latest: a superseded request is no longer pending; answering it throws, the newest is answered', async () => {
    t = renderComponent(Search)
    t.simulateEvent('.q', 'input', { value: 'du' })
    await t.next(s => s.query === 'du')
    t.simulateEvent('.q', 'input', { value: 'dune' })
    await t.next(s => s.query === 'dune')
    expect(() => t.respond('HTTP', ['Dubliners'], r => r.query.q === 'du')).toThrow(/no pending HTTP request matching the predicate.*sent 2/s)
    expect(() => t.respond('HTTP', ['Dubliners'], { query: { q: 'du' } })).toThrow(/no pending/)
    await t.respond('HTTP', ['Dune'], { query: { q: 'dune' } })
    expect(t.state.results).toEqual(['Dune'])
  })

  it('an answered request is no longer pending', async () => {
    t = renderComponent(Quote)
    t.simulateEvent('.get', 'click')
    await t.respond('HTTP', { text: 'a' })
    expect(() => t.respond('HTTP', { text: 'b' }, 'LOADED')).toThrow(/no pending HTTP request matching 'LOADED'/)
  })

  it('abort by action name cancels the request with reply actions', async () => {
    t = renderComponent(Search)
    t.simulateEvent('.q', 'input', { value: 'du' })
    t.simulateEvent('.q', 'input', { value: '' })
    await t.settle()
    expect(() => t.respond('HTTP', [], 'RESULTS')).toThrow(/aborted or superseded/)
  })

  it('abort by key, and { abort: true } (no key, no category) cancels requests with reply actions too (D65)', async () => {
    function K({ state }) { return h('div', null, h('button', { className: 'a' }), h('button', { className: 'b' }), h('button', { className: 'x' }), h('button', { className: 'all' }), state.v) }
    K.initialState = { v: '' }
    K.intent = ({ DOM }) => ({ A: DOM.click('.a'), B: DOM.click('.b'), X: DOM.click('.x'), ALL: DOM.click('.all') })
    K.model = {
      A: { HTTP: () => ({ url: '/a', ok: 'GOT', key: 'k' }) },
      B: { HTTP: () => ({ url: '/b', ok: 'GOT' }) },
      X: { HTTP: () => ({ abort: true, key: 'k' }) },
      ALL: { HTTP: () => ({ abort: true }) },
      GOT: (s, v) => ({ ...s, v }),
    }
    t = renderComponent(K)
    t.simulateEvent('.a', 'click')
    t.simulateEvent('.b', 'click')
    t.simulateEvent('.x', 'click')
    await t.settle()
    expect(() => t.respond('HTTP', 'A', 'k')).toThrow(/no pending HTTP request matching 'k'.*Pending: \{"url":"\/b"/s)
    t.simulateEvent('.all', 'click')
    await t.settle()
    expect(() => t.respond('HTTP', 'B', { url: '/b' })).toThrow(/no pending/)
    expect(t.requests('HTTP')).toEqual([{ url: '/a', ok: 'GOT', key: 'k' }, { url: '/b', ok: 'GOT' }])
  })

  it('a call queued behind simulate* still waits for the request (and fails the test later when none comes)', async () => {
    t = renderComponent(Quote, { timeoutMs: 300 })
    t.simulateEvent('.get', 'click')
    const p = t.respond('HTTP', {}, 'NOPE')
    await expect(p).rejects.toThrow(/no pending HTTP request matching 'NOPE' after 150ms/)
  })

  it('an un-awaited failing call fails the next wait', async () => {
    t = renderComponent(Quote, { timeoutMs: 300 })
    t.simulateEvent('.get', 'click')
    t.respond('HTTP', {}, 'NOPE')
    await expect(t.settle()).rejects.toThrow(/no pending HTTP request matching 'NOPE'/)
  })
})

describe('G-141 and content matching', () => {
  it('t.requests lists requests only; t.sinkValues keeps the abort commands', async () => {
    t = renderComponent(Search)
    t.simulateEvent('.q', 'input', { value: 'du' })
    t.simulateEvent('.q', 'input', { value: '' })
    await t.settle()
    expect(t.requests('HTTP')).toEqual([{ url: '/api/search', query: { q: 'du' }, ok: 'RESULTS', latest: true }])
    expect(t.sinkValues('HTTP')).toEqual([{ url: '/api/search', query: { q: 'du' }, ok: 'RESULTS', latest: true }, { abort: 'RESULTS' }])
  })

  it('a constant request object reused by the model is matched by content', async () => {
    const REQ = { url: '/api/courses', ok: 'LOADED' }
    function C({ state }) { return h('div', null, h('button', { className: 'load' }, 'load'), String(state.n)) }
    C.initialState = { n: 0 }
    C.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
    C.model = { LOAD: { HTTP: () => REQ }, LOADED: (s, n) => ({ ...s, n }) }
    t = renderComponent(C)
    t.simulateEvent('.load', 'click')
    await t.respond('HTTP', 1, { request: REQ })
    t.simulateEvent('.load', 'click')
    await t.respond('HTTP', 2, REQ)
    expect(t.state.n).toBe(2)
    expect(t.requests('HTTP')).toEqual([REQ, REQ])
  })

  it('the exact element of t.requests is preferred among equal pending requests', async () => {
    function C({ state }) { return h('div', null, h('button', { className: 'load' }, 'load'), state.log.join()) }
    C.initialState = { log: [], i: 0 }
    C.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
    C.model = { LOAD: { STATE: s => ({ ...s, i: s.i + 1 }), HTTP: () => ({ url: '/x', ok: 'GOT' }) }, GOT: (s, v) => ({ ...s, log: [...s.log, v] }) }
    t = renderComponent(C)
    t.simulateEvent('.load', 'click')
    t.simulateEvent('.load', 'click')
    await t.settle()
    const [first] = t.requests('HTTP')
    await t.respond('HTTP', 'a', { request: first })
    await t.respond('HTTP', 'b')
    expect(t.state.log).toEqual(['a', 'b'])
    expect(() => t.respond('HTTP', 'c', { url: '/x' })).toThrow(/no pending/)
  })
})

describe('plain requests (select / errors) are unchanged', () => {
  function Old({ state }) { return h('div', null, h('button', { className: 'get' }, 'Get'), state.text) }
  Old.initialState = { text: '' }
  Old.intent = ({ DOM, HTTP }) => ({ LOAD: DOM.click('.get'), LOADED: HTTP.select('quote'), FAILED: HTTP.errors('quote') })
  Old.model = {
    LOAD: { HTTP: () => ({ category: 'quote', url: '/q' }) },
    LOADED: (s, { value, status, category }) => ({ ...s, text: `${value}:${status}:${category}` }),
    FAILED: (s, { status }) => ({ ...s, text: `failed ${status}` }),
  }

  it('category string, select payload, errors payload', async () => {
    t = renderComponent(Old)
    t.simulateEvent('.get', 'click')
    await t.respond('HTTP', 'hi', 'quote')
    expect(t.state.text).toBe('hi:200:quote')
    t.simulateEvent('.get', 'click')
    await t.fail('HTTP', 503, { category: 'quote' })
    expect(t.state.text).toBe('failed 503')
  })

  it('half reply actions: ok only, a failure goes to errors()', async () => {
    function Half({ state }) { return h('div', null, h('button', { className: 'get' }, 'Get'), state.text) }
    Half.initialState = { text: '' }
    Half.intent = ({ DOM, HTTP }) => ({ LOAD: DOM.click('.get'), FAILED: HTTP.errors() })
    Half.model = {
      LOAD: { HTTP: () => ({ url: '/q', ok: 'LOADED' }) },
      LOADED: (s, v) => ({ ...s, text: v }),
      FAILED: (s, { status, request }) => ({ ...s, text: `failed ${status} ${request.url}` }),
    }
    t = renderComponent(Half)
    t.simulateEvent('.get', 'click')
    await t.fail('HTTP', 500, 'LOADED')
    expect(t.state.text).toBe('failed 500 /q')
  })
})

describe('G-131: child-only string requests are scope-tagged', () => {
  it("each child's plain string request is answered to that child only", async () => {
    function Kid({ state }) { return h('div', { className: `kid k${state.id}` }, h('button', { className: 'go' }, 'go'), String(state.v)) }
    Kid.intent = ({ DOM, HTTP }) => ({ GO: DOM.click('.go'), GOT: HTTP.select() })
    Kid.model = { GO: { HTTP: s => `/kid/${s.id}` }, GOT: (s, { value }) => ({ ...s, v: value }) }
    function App() { return h('div', null, h(Kid, { state: 'a' }), h(Kid, { state: 'b' })) }
    App.initialState = { a: { id: 'a', v: '-' }, b: { id: 'b', v: '-' } }
    t = renderComponent(App)
    t.simulateEvent('.ka .go', 'click')
    t.simulateEvent('.kb .go', 'click')
    await t.settle()
    expect(t.requests('HTTP')).toEqual(['/kid/a', '/kid/b'])
    await t.respond('HTTP', 'A', { url: '/kid/a' })
    expect(t.state).toMatchObject({ a: { v: 'A' }, b: { v: '-' } })
    await t.respond('HTTP', 'B', { request: '/kid/b' })
    expect(t.state).toMatchObject({ a: { v: 'A' }, b: { v: 'B' } })
  })
})

describe('when the request is sent on load, with fake timers, on the real DOM', () => {
  function Boot({ state }) { return h('p', { className: 'v' }, state.status) }
  Boot.initialState = { status: 'loading' }
  Boot.model = {
    BOOTSTRAP: { HTTP: () => ({ url: '/boot', ok: 'LOADED', error: 'FAILED' }) },
    LOADED: (s, v) => ({ ...s, status: v }),
    FAILED: s => ({ ...s, status: 'failed' }),
  }

  it('a call before the component is ready waits for the BOOTSTRAP request', async () => {
    t = renderComponent(Boot)
    await t.respond('HTTP', 'ready', 'LOADED')
    expect(t.html()).toContain('ready')
  })

  it('after await t.ready() the BOOTSTRAP request is pending', async () => {
    t = renderComponent(Boot)
    await t.ready()
    await t.fail('HTTP', 500, 'FAILED')
    expect(t.state.status).toBe('failed')
  })

  it('fake timers: a debounced request, then await t.respond drives the clock', async () => {
    vi.useFakeTimers()
    function S({ state }) { return h('div', null, h('input', { className: 'q' }), h('p', null, state.results.join())) }
    S.initialState = { results: [] }
    S.intent = ({ DOM }) => ({ SEARCH: DOM.input('.q').value().compose(debounce(300)) })
    S.model = { SEARCH: { HTTP: (s, q) => ({ url: '/s', query: { q }, ok: 'RESULTS', latest: true }) }, RESULTS: (s, results) => ({ ...s, results }) }
    t = renderComponent(S)
    await t.ready()
    t.simulateEvent('.q', 'input', { value: 'du' })
    await vi.advanceTimersByTimeAsync(299)
    expect(t.requests('HTTP')).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await t.respond('HTTP', ['Dune'], 'RESULTS')
    expect(t.html()).toContain('Dune')
  })

  it("dom: 'real': the promise resolves once the reply is in the DOM", async () => {
    t = renderComponent(Quote, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.get', 'click')
    await t.respond('HTTP', { text: 'Real' }, 'LOADED')
    expect(t.query('.q').textContent).toBe('Real')
  })

  it('dispose rejects a queued call without failing the dispose', async () => {
    t = renderComponent(Quote)
    t.simulateEvent('.get', 'click')
    const p = t.respond('HTTP', {}, 'LOADED')
    t.dispose()
    t = null
    await expect(p).rejects.toThrow(/disposed before this t.respond/)
  })
})
