// @vitest-environment jsdom
// PLAN-3 5-1 (H-9, D80): renderComponent's HTTP fake runs the real makeFetchDriver over an
// in-memory fetch. Every fetch is a pending entry that t.respond / t.fail resolve with a
// Response-like object, so latest, abort, isolation, reply routing, resources and timeouts are
// the driver's own. G-171(1): t.requests lists normalised request objects (a string GET is
// { url }, a resource fetch carries `resource: name`) and never the { resources } declarations
// or { refresh } commands (those stay in t.sinkValues).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { renderComponent } from '../src/extra/testing.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { waitFor, textOf, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'

let t, app
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
})
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  try { app?.dispose() } catch (_) {}
  t = app = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  _resetDiagnostics()
})

function Quote({ state }) {
  const q = state.quote
  return h('div', null,
    h('button', { className: 'next' }, 'next'),
    h('button', { className: 'refresh' }, 'refresh'),
    h('p', { className: 'status' }, q.status),
    h('p', { className: 'text' }, q.data ? q.data.text : ''))
}
Quote.initialState = { id: 1 }
Quote.resources = { quote: (s) => s.id && `/api/quotes/${s.id}` }
Quote.intent = ({ DOM }) => ({ NEXT: DOM.click('.next'), REFRESH: DOM.click('.refresh') })
Quote.model = {
  NEXT: (s) => ({ ...s, id: s.id + 1 }),
  REFRESH: { HTTP: { refresh: 'quote' } },
}

describe('G-171(1): t.requests lists normalised request objects', () => {
  it('a string GET is { url }; an object request is listed as sent; t.sinkValues keeps the string', async () => {
    function C({ state }) { return h('div', null, h('button', { className: 'a' }), h('button', { className: 'b' }), String(state.v)) }
    C.initialState = { v: '' }
    C.intent = ({ DOM, HTTP }) => ({ A: DOM.click('.a'), B: DOM.click('.b'), GOT: HTTP.select() })
    C.model = {
      A: { HTTP: () => '/api/plain' },
      B: { HTTP: () => ({ url: '/api/obj', query: { q: 'x' }, ok: 'LOADED' }) },
      GOT: (s, { value }) => ({ ...s, v: value }),
      LOADED: (s, v) => ({ ...s, v }),
    }
    t = renderComponent(C)
    t.simulateEvent('.a', 'click')
    t.simulateEvent('.b', 'click')
    await t.settle()
    expect(t.requests('HTTP')).toEqual([{ url: '/api/plain' }, { url: '/api/obj', query: { q: 'x' }, ok: 'LOADED' }])
    expect(t.sinkValues('HTTP')).toEqual(['/api/plain', { url: '/api/obj', query: { q: 'x' }, ok: 'LOADED' }])
    expect(t.requests('HTTP')[0]).toMatchObject({ url: '/api/plain' })
    await t.respond('HTTP', 'P', { url: '/api/plain' })
    expect(t.state.v).toBe('P')
  })

  it('a resource fetch is { url, …request, resource: name }; no { resources } / { refresh } values', async () => {
    function P({ state }) { return h('p', null, state.place.status) }
    P.initialState = { zip: '12345' }
    P.resources = { place: (s) => ({ url: `/api/zip/${s.zip}`, ok: 'FOUND' }) }
    P.model = { FOUND: (s) => s, REFRESH: { HTTP: { refresh: 'place' } } }
    t = renderComponent(Quote)
    await t.waitForState(s => s.quote?.status === 'loading')
    expect(t.requests('HTTP')).toEqual([{ url: '/api/quotes/1', resource: 'quote' }])
    expect(t.requests('HTTP')[0]).toMatchObject({ url: '/api/quotes/1' })
    await t.respond('HTTP', { text: 'one' })
    t.simulateEvent('.refresh', 'click')
    await t.waitForState(s => s.quote.status === 'loading')
    expect(t.requests('HTTP')).toEqual([{ url: '/api/quotes/1', resource: 'quote' }, { url: '/api/quotes/1', resource: 'quote' }])
    expect(t.requests('HTTP').some(r => 'resources' in r || 'refresh' in r)).toBe(false)
    expect(t.sinkValues('HTTP')).toContainEqual({ refresh: 'quote' })
    expect(t.sinkValues('HTTP').some(v => v && v.resources)).toBe(true)
    t.dispose()

    t = renderComponent(P)
    await t.waitForState(s => s.place?.status === 'loading')
    expect(t.requests('HTTP')).toEqual([{ url: '/api/zip/12345', ok: 'FOUND', resource: 'place' }])
  })

  it('nothing declared yet (an idle resource): t.requests is empty', async () => {
    function I({ state }) { return h('p', null, state.quote.status) }
    I.initialState = { id: 0 }
    I.resources = { quote: (s) => s.id && `/api/quotes/${s.id}` }
    I.model = { PICK: (s, id) => ({ ...s, id }) }
    t = renderComponent(I)
    await t.ready()
    await t.settle()
    expect(t.requests('HTTP')).toEqual([])
    expect(t.requests('HTTP')).toHaveLength(0)
    t.simulateAction('PICK', 7)
    await t.waitForState(s => s.quote.status === 'loading')
    expect(t.requests('HTTP')).toHaveLength(1)
  })
})

describe('resources answered by name, by URL and by a partial object', () => {
  it('by name', async () => {
    t = renderComponent(Quote)
    await t.waitForState(s => s.quote?.status === 'loading')
    await t.respond('HTTP', { text: 'one' }, 'quote')
    expect(t.state.quote).toEqual({ status: 'success', data: { text: 'one' }, error: undefined })
    expect(t.html()).toContain('one')
  })

  it('by URL (a bare string or { url })', async () => {
    t = renderComponent(Quote)
    await t.waitForState(s => s.quote?.status === 'loading')
    await t.respond('HTTP', { text: 'one' }, '/api/quotes/1')
    expect(t.state.quote.data).toEqual({ text: 'one' })
    t.simulateEvent('.next', 'click')
    await t.waitForState(s => s.id === 2 && s.quote.status === 'loading')
    await t.fail('HTTP', 404, { url: '/api/quotes/2' })
    expect(t.state.quote.status).toBe('error')
    expect(t.state.quote.error.status).toBe(404)
  })

  it('by a partial object ({ resource } or { url, resource })', async () => {
    t = renderComponent(Quote)
    await t.waitForState(s => s.quote?.status === 'loading')
    await t.respond('HTTP', { text: 'one' }, { resource: 'quote' })
    t.simulateEvent('.next', 'click')
    await t.waitForState(s => s.id === 2 && s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'two' }, { url: '/api/quotes/2', resource: 'quote' })
    expect(t.state.quote.data).toEqual({ text: 'two' })
  })

  it('a superseded resource fetch is no longer pending (the driver aborted it)', async () => {
    t = renderComponent(Quote)
    await t.waitForState(s => s.quote?.status === 'loading')
    t.simulateEvent('.next', 'click')
    await t.waitForState(s => s.id === 2)
    await t.settle()
    expect(() => t.respond('HTTP', {}, '/api/quotes/1')).toThrow(/no pending HTTP request matching '\/api\/quotes\/1'/)
    expect(() => t.respond('HTTP', {}, { url: '/api/quotes/1' })).toThrow(/no pending HTTP request/)
    await t.respond('HTTP', { text: 'two' }, 'quote')
    expect(t.html()).toContain('two')
  })
})

// The same scenario under run() + makeFetchDriver({ fetch: stub }) and under renderComponent:
// latest supersedes, abort by action name cancels, a stale reply is ignored.
function Search({ state }) {
  return h('div', null,
    h('input', { className: 'q' }),
    h('button', { className: 'clear' }, 'clear'),
    h('p', { className: 'log' }, state.log.join('|')))
}
Search.initialState = { log: [] }
Search.intent = ({ DOM }) => ({
  TYPE: DOM.input('.q').value(),
  CLEAR: DOM.click('.clear'),
})
Search.model = {
  TYPE: { HTTP: (s, q) => ({ url: '/s', query: { q }, ok: 'RESULTS', error: 'FAILED', latest: true }) },
  CLEAR: { HTTP: () => ({ abort: 'RESULTS' }) },
  RESULTS: (s, r) => ({ ...s, log: [...s.log, `RESULTS:${r.join(',')}`] }),
  FAILED: (s, { error, status }) => ({ ...s, log: [...s.log, `FAILED:${status ?? error.name}`] }),
}

describe('latest / abort parity with the real driver', () => {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('run() + makeFetchDriver({ fetch }) and renderComponent give the same actions', async () => {
    // under run()
    const calls = []
    const fetch = vi.fn((url, init) => new Promise((resolve, reject) => {
      const c = { url, resolve, reject, aborted: false }
      calls.push(c)
      init.signal.addEventListener('abort', () => { c.aborted = true; reject(new DOMException('aborted', 'AbortError')) })
    }))
    app = run(Search, { HTTP: makeFetchDriver({ fetch }) }, { mountPoint: '#root' })
    const input = (v) => {
      const el = document.querySelector('.q')
      el.value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await waitFor(() => expect(document.querySelector('.q')).toBeTruthy())
    input('a')
    input('b')
    await waitFor(() => expect(calls).toHaveLength(2))
    calls[0].resolve(json(['A']))       // superseded: aborted, ignored
    calls[1].resolve(json(['B']))
    await waitFor(() => expect(textOf(document.querySelector('.log'))).toBe('RESULTS:B'))
    input('c')
    await waitFor(() => expect(calls).toHaveLength(3))
    document.querySelector('.clear').click()
    await waitFor(() => expect(calls[2].aborted).toBe(true))
    calls[2].resolve(json(['C']))
    input('d')
    await waitFor(() => expect(calls).toHaveLength(4))
    calls[3].resolve(json({ error: 'x' }, 500))
    await waitFor(() => expect(textOf(document.querySelector('.log'))).toBe('RESULTS:B|FAILED:500'))
    await sleep(30)
    const underRun = textOf(document.querySelector('.log'))
    expect(calls.map(c => c.aborted)).toEqual([true, false, true, false])
    app.dispose()
    app = null

    // under renderComponent
    t = renderComponent(Search)
    t.simulateEvent('.q', 'input', { value: 'a' })
    t.simulateEvent('.q', 'input', { value: 'b' })
    await t.settle()
    expect(() => t.respond('HTTP', ['A'], { query: { q: 'a' } })).toThrow(/no pending/)
    await t.respond('HTTP', ['B'], { query: { q: 'b' } })
    t.simulateEvent('.q', 'input', { value: 'c' })
    t.simulateEvent('.clear', 'click')
    await t.settle()
    expect(() => t.respond('HTTP', ['C'], 'RESULTS')).toThrow(/no pending/)
    t.simulateEvent('.q', 'input', { value: 'd' })
    await t.settle()
    await t.fail('HTTP', 500, { query: { q: 'd' } })
    expect(t.html()).toContain(underRun)
    expect(t.state.log.join('|')).toBe(underRun)
    expect(t.requests('HTTP').map(r => r.query.q)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('timers: timeoutMs runs on the test clock', () => {
  function Slow({ state }) { return h('div', null, h('button', { className: 'go' }, 'go'), h('p', null, state.status)) }
  Slow.initialState = { status: 'idle' }
  Slow.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  Slow.model = {
    GO: { STATE: (s) => ({ ...s, status: 'loading' }), HTTP: () => ({ url: '/slow', ok: 'GOT', error: 'FAILED', timeoutMs: 5000 }) },
    GOT: (s) => ({ ...s, status: 'done' }),
    FAILED: (s, { error }) => ({ ...s, status: error.name }),
  }

  it('fake timers: the request times out after timeoutMs (TimeoutError) and is no longer pending', async () => {
    vi.useFakeTimers()
    t = renderComponent(Slow)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await t.next(s => s.status === 'loading')
    await vi.advanceTimersByTimeAsync(4000)
    expect(t.state.status).toBe('loading')
    await vi.advanceTimersByTimeAsync(1000)
    await t.next(s => s.status === 'TimeoutError')
    expect(t.html()).toContain('TimeoutError')
    expect(() => t.respond('HTTP', 'late', 'GOT')).toThrow(/no pending HTTP request/)
  })

  it('answered before the timeout: the reply wins and nothing fires later', async () => {
    vi.useFakeTimers()
    t = renderComponent(Slow)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await t.next(s => s.status === 'loading')
    await t.respond('HTTP', 'ok', 'GOT')
    await vi.advanceTimersByTimeAsync(10000)
    expect(t.state.status).toBe('done')
  })
})

describe('the reply is a Response-like object the driver parses', () => {
  it("parse: 'text' gets a string body as text; parse: 'response' gets status and json()", async () => {
    function R({ state }) { return h('p', null, state.out) }
    R.initialState = { out: '' }
    R.model = {
      BOOTSTRAP: { HTTP: () => ({ url: '/t', parse: 'text', ok: 'TEXT' }) },
      TEXT: { STATE: (s, v) => ({ ...s, out: `${typeof v}:${v}` }), HTTP: () => ({ url: '/r', parse: 'response', ok: 'RES' }) },
      RES: (s, res) => ({ ...s, out: `${s.out}|${res.status}|${res.ok}` }),
    }
    t = renderComponent(R)
    await t.respond('HTTP', 'hello', { url: '/t' })
    expect(t.state.out).toBe('string:hello')
    await t.respond('HTTP', { a: 1 }, { request: { url: '/r' }, status: 201 })
    expect(t.state.out).toBe('string:hello|201|true')
  })
})

// Task 23 (evals/agent-ergonomics/hidden/23-quote-resource) with the canonical `resources`
// solution, tested the way an agent would after reading the testing docs.
const Q101 = { id: 101, text: 'Simplicity is prerequisite for reliability.', author: 'Edsger W. Dijkstra' }
const Q101_EDITED = { id: 101, text: 'Simplicity is a great virtue.', author: 'Edsger W. Dijkstra' }
const Q101_LATEST = { id: 101, text: 'Simplicity is hard work.', author: 'Edsger W. Dijkstra' }
const Q102 = { id: 102, text: 'Premature optimization is the root of all evil.', author: 'Donald Knuth' }
const Q103 = { id: 103, text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' }
const QUOTE_IDS = [101, 102, 103]
const STATUS_TEXT = { loading: 'Loading…', error: 'Could not load the quote.' }
// D78: a refresh keeps the quote in `data` (refreshing: true); the task hides it while loading
function App({ state }) {
  const { status, data: d, refreshing } = state.quote
  const data = status === 'success' && !refreshing ? d : null
  return h('div', { className: 'quotes' },
    h('ul', { className: 'quote-list' }, ...QUOTE_IDS.map((id) =>
      h('li', null, h('button', { className: id === state.selected ? 'pick selected' : 'pick', data: { id: String(id) } }, `Quote ${id}`)))),
    h('section', { className: 'detail' },
      state.selected === null
        ? h('p', { className: 'placeholder' }, 'Select a quote.')
        : h('div', { className: 'quote' },
          h('button', { className: 'refresh' }, 'Refresh'),
          h('p', { className: 'status' }, refreshing ? 'Loading…' : STATUS_TEXT[status] ?? ''),
          h('blockquote', { className: 'quote-text' }, data?.text ?? ''),
          h('p', { className: 'quote-author' }, data?.author ?? ''))))
}
App.initialState = { selected: null }
App.resources = { quote: (state) => state.selected !== null && `/api/quotes/${state.selected}` }
App.intent = ({ DOM }) => ({
  SELECT: DOM.click('.pick').map((e) => Number(e.target.dataset.id)),
  REFRESH: DOM.click('.refresh'),
})
App.model = {
  SELECT: (state, selected) => ({ ...state, selected }),
  REFRESH: { HTTP: { refresh: 'quote' } },
}

describe('task 23 with resources, under renderComponent', () => {
  const pick = (id) => t.simulateEvent(`.pick[data-id="${id}"]`, 'click')

  it('loads nothing until a quote is picked, then loads and shows it', async () => {
    t = renderComponent(App)
    await t.ready()
    expect(t.html()).toContain('Select a quote.')
    expect(t.requests('HTTP')).toHaveLength(0)
    pick(101)
    await t.waitForState(s => s.quote.status === 'loading')
    expect(t.requests('HTTP')).toEqual([{ url: '/api/quotes/101', resource: 'quote' }])
    expect(t.requests('HTTP')[0]).toMatchObject({ url: '/api/quotes/101' })
    expect(t.html()).toContain('Loading…')
    await t.respond('HTTP', Q101, 'quote')
    expect(t.html()).toContain(Q101.text)
    expect(t.html()).not.toContain('Loading…')
  })

  it('out of order: only the latest pick is shown; the stale request is not pending', async () => {
    t = renderComponent(App)
    pick(101)
    pick(102)
    await t.waitForState(s => s.selected === 102 && s.quote.status === 'loading')
    expect(t.requests('HTTP').map(r => r.url)).toEqual(['/api/quotes/101', '/api/quotes/102'])
    expect(() => t.respond('HTTP', Q101, { url: '/api/quotes/101' })).toThrow(/no pending/)
    await t.respond('HTTP', Q102, { url: '/api/quotes/102' })
    expect(t.html()).toContain(Q102.text)
    pick(103)
    pick(101)
    await t.waitForState(s => s.selected === 101 && s.quote.status === 'loading')
    expect(() => t.respond('HTTP', Q103, '/api/quotes/103')).toThrow(/no pending/)
    expect(t.html()).toContain('Loading…')
    expect(t.html()).not.toContain(Q102.text)
    await t.respond('HTTP', Q101, 'quote')
    expect(t.html()).toContain(Q101.text)
  })

  it('a failure shows the error, and Refresh loads the quote again', async () => {
    t = renderComponent(App)
    pick(102)
    await t.waitForState(s => s.quote.status === 'loading')
    await t.fail('HTTP', 500, 'quote')
    expect(t.html()).toContain('Could not load the quote.')
    t.simulateEvent('.refresh', 'click')
    await t.waitForState(s => s.quote.refreshing)
    expect(t.html()).toContain('Loading…')
    expect(t.requests('HTTP').map(r => r.url)).toEqual(['/api/quotes/102', '/api/quotes/102'])
    await t.fail('HTTP', 'Failed to fetch', 'quote')
    expect(t.html()).toContain('Could not load the quote.')
    expect(t.state.quote.data).toBe(undefined)
    t.simulateEvent('.refresh', 'click')
    await t.waitForState(s => s.quote.refreshing)
    await t.respond('HTTP', Q102, 'quote')
    expect(t.html()).toContain(Q102.text)
  })

  it('two refreshes in a row: the first one is superseded; picking away and back makes the first stale', async () => {
    t = renderComponent(App)
    pick(101)
    await t.waitForState(s => s.quote.status === 'loading')
    await t.respond('HTTP', Q101, 'quote')
    t.simulateEvent('.refresh', 'click')
    t.simulateEvent('.refresh', 'click')
    await t.settle()
    expect(t.requests('HTTP')).toHaveLength(3)
    // only the newest refresh is pending: after one answer, nothing is
    await t.respond('HTTP', Q101_LATEST, 'quote')
    expect(() => t.respond('HTTP', Q101, 'quote')).toThrow(/no pending/)
    expect(t.html()).toContain(Q101_LATEST.text)

    pick(102)
    pick(101)
    await t.waitForState(s => s.selected === 101 && s.quote.status === 'loading')
    expect(() => t.respond('HTTP', Q102, '/api/quotes/102')).toThrow(/no pending/)
    await t.respond('HTTP', Q101_EDITED, '/api/quotes/101')
    expect(t.html()).toContain(Q101_EDITED.text)
    expect(t.html()).not.toContain(Q101_LATEST.text)
  })
})

describe('the testing docs Resources sample', () => {
  function DocQuote({ state }) {
    return h('p', { className: 'status' }, state.quote.status === 'success' ? state.quote.data.text : state.quote.status)
  }
  DocQuote.initialState = { id: null }
  DocQuote.resources = { quote: (state) => state.id && `/api/quotes/${state.id}` }
  DocQuote.model = { PICK: (state, id) => ({ ...state, id }), REFRESH: { HTTP: { refresh: 'quote' } } }

  it('loads the picked quote, and only the latest one', async () => {
    t = renderComponent(DocQuote)
    await t.ready()
    expect(t.requests('HTTP')).toEqual([])
    t.simulateAction('PICK', 1)
    t.simulateAction('PICK', 2)
    await t.waitForState((s) => s.id === 2 && s.quote.status === 'loading')
    expect(t.requests('HTTP')).toEqual([
      { url: '/api/quotes/1', resource: 'quote' },
      { url: '/api/quotes/2', resource: 'quote' },
    ])
    expect(() => t.respond('HTTP', { text: 'old' }, '/api/quotes/1')).toThrow()
    await t.respond('HTTP', { text: 'Hi' }, 'quote')
    expect(t.html()).toContain('Hi')
    t.simulateAction('REFRESH')
    await t.waitForState((s) => s.quote.refreshing)
    await t.fail('HTTP', 500, 'quote')
    expect(t.state.quote.error.status).toBe(500)
  })
})
