// @vitest-environment jsdom
// PLAN-3 3-A (exp): the `resources` component static. Each resource maps state to a request
// (falsy = idle); the core sends `{ resources: { name: request | falsy } }` (sender-stamped,
// structurally equal repeats dropped) to the makeFetchDriver sink; the driver fetches a changed
// request with latest semantics and writes `state[name] = { status, data, error }` through the
// built-in RESOURCE action. `{ refresh: 'name' }` on the HTTP sink refetches.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { renderComponent } from '../src/extra/testing.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { waitFor, textOf, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const pathOf = (u) => new URL(String(u), 'http://localhost').pathname + new URL(String(u), 'http://localhost').search

/** every fetch stays pending until answered by index; aborts reject like a browser */
function server() {
  const requests = []
  const fn = vi.fn((input, init) => new Promise((resolve, reject) => {
    const r = { path: pathOf(input), resolve, reject, settled: false, signal: init?.signal }
    requests.push(r)
    init?.signal?.addEventListener('abort', () => {
      if (r.settled) return
      r.settled = r.aborted = true
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
  }))
  const settle = (i, how) => {
    const r = requests[i]
    if (!r) throw new Error(`no request #${i}`)
    if (r.settled) return
    r.settled = true
    how(r)
  }
  return {
    fn, requests,
    paths: () => requests.map(r => r.path),
    respond: (i, body) => settle(i, r => r.resolve(jsonResponse(body))),
    status: (i, s) => settle(i, r => r.resolve(jsonResponse({ error: 'x' }, s))),
    networkError: (i) => settle(i, r => r.reject(new TypeError('Failed to fetch'))),
  }
}

let srv, app, t, errorSpy
beforeEach(() => {
  srv = server()
  vi.stubGlobal('fetch', srv.fn)
  document.body.innerHTML = '<div id="root"></div>'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  try { t?.dispose() } catch (_) {}
  app = t = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  _resetDiagnostics()
})
const start = (App) => (app = run(App, { HTTP: makeFetchDriver() }, { mountPoint: '#root' }))
const text = (sel) => textOf(document.querySelector(sel))
const click = (sel) => document.querySelector(sel).click()

function Quote({ state }) {
  const q = state.quote
  return h('div', null,
    h('button', { className: 'next' }, 'next'),
    h('button', { className: 'none' }, 'none'),
    h('button', { className: 'refresh' }, 'refresh'),
    h('p', { className: 'status' }, q.status),
    h('p', { className: 'text' }, q.data ? q.data.text : ''),
    h('p', { className: 'err' }, q.error ? String(q.error.status ?? q.error.message) : ''))
}
Quote.initialState = { id: 1 }
Quote.resources = { quote: (s) => s.id && { url: `/api/quotes/${s.id}` } }
Quote.intent = ({ DOM }) => ({
  NEXT: DOM.click('.next'),
  NONE: DOM.click('.none'),
  REFRESH: DOM.click('.refresh'),
})
Quote.model = {
  NEXT: (s) => ({ ...s, id: s.id + 1 }),
  NONE: (s) => ({ ...s, id: 0 }),
  REFRESH: { HTTP: { refresh: 'quote' } },
}

describe('resources with makeFetchDriver', () => {
  it('fetches on mount: loading, then success with the parsed body', async () => {
    start(Quote)
    await waitFor(() => expect(srv.paths()).toEqual(['/api/quotes/1']))
    await waitFor(() => expect(text('.status')).toBe('loading'))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(text('.status')).toBe('success'))
    expect(text('.text')).toBe('one')
    await sleep(30)
    expect(srv.fn).toHaveBeenCalledTimes(1)
  })

  it('refetches when the derived request changes, aborting the stale one', async () => {
    start(Quote)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    click('.next')
    await waitFor(() => expect(srv.paths()).toEqual(['/api/quotes/1', '/api/quotes/2']))
    expect(srv.requests[0].aborted).toBe(true)
    srv.respond(1, { text: 'two' })
    await waitFor(() => expect(text('.text')).toBe('two'))
  })

  it('a state change that leaves the request structurally equal sends nothing', async () => {
    function C({ state }) { return h('p', { className: 'status' }, state.quote.status + state.n) }
    C.initialState = { id: 1, n: 0 }
    C.resources = { quote: (s) => ({ url: `/api/quotes/${s.id}`, query: { lang: 'en' } }) }
    C.intent = ({ DOM }) => ({ BUMP: DOM.click('p') })
    C.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }
    start(C)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    click('p'); click('p')
    await waitFor(() => expect(text('.status')).toBe('loading2'))
    await sleep(30)
    expect(srv.fn).toHaveBeenCalledTimes(1)
  })

  it('out-of-order replies: only the latest request is shown (also a same-id refetch)', async () => {
    start(Quote)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    click('.next')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    srv.respond(1, { text: 'two' })
    await waitFor(() => expect(text('.text')).toBe('two'))
    srv.respond(0, { text: 'one' })
    await sleep(30)
    expect(text('.text')).toBe('two')
    // same id twice: the first refresh's late reply is stale
    click('.refresh')
    click('.refresh')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(4))
    expect(srv.paths().slice(2)).toEqual(['/api/quotes/2', '/api/quotes/2'])
    srv.respond(3, { text: 'latest' })
    await waitFor(() => expect(text('.text')).toBe('latest'))
    srv.respond(2, { text: 'stale' })
    srv.networkError(2)
    await sleep(30)
    expect(text('.text')).toBe('latest')
    expect(text('.status')).toBe('success')
  })

  it('idle while the request is falsy: no fetch; becoming falsy aborts and goes idle', async () => {
    function C({ state }) { return h('p', { className: 'status' }, state.quote.status) }
    C.initialState = { id: 0 }
    C.resources = Quote.resources
    C.intent = ({ DOM }) => ({ PICK: DOM.click('p') })
    C.model = { PICK: (s) => ({ ...s, id: s.id ? 0 : 5 }) }
    start(C)
    await waitFor(() => expect(text('.status')).toBe('idle'))
    await sleep(30)
    expect(srv.fn).not.toHaveBeenCalled()
    click('p')
    await waitFor(() => expect(text('.status')).toBe('loading'))
    click('p')
    await waitFor(() => expect(text('.status')).toBe('idle'))
    expect(srv.requests[0].aborted).toBe(true)
  })

  it('REFRESH ({ refresh: name } on the HTTP sink) refetches the same request; nothing when idle', async () => {
    start(Quote)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(text('.text')).toBe('one'))
    click('.refresh')
    await waitFor(() => expect(srv.paths()).toEqual(['/api/quotes/1', '/api/quotes/1']))
    await waitFor(() => expect(text('.status')).toBe('loading'))
    srv.respond(1, { text: 'one again' })
    await waitFor(() => expect(text('.text')).toBe('one again'))
    click('.none')
    await waitFor(() => expect(text('.status')).toBe('idle'))
    click('.refresh')
    await sleep(30)
    expect(srv.fn).toHaveBeenCalledTimes(2)
  })

  it('loading and error clear data; a non-2xx error has its status; a network error its message', async () => {
    start(Quote)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(text('.text')).toBe('one'))
    click('.refresh')
    await waitFor(() => expect(text('.status')).toBe('loading'))
    expect(text('.text')).toBe('')
    srv.status(1, 500)
    await waitFor(() => expect(text('.status')).toBe('error'))
    expect(text('.err')).toBe('500')
    expect(text('.text')).toBe('')
    click('.refresh')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(3))
    srv.networkError(2)
    await waitFor(() => expect(text('.err')).toBe('Failed to fetch'))
    expect(text('.status')).toBe('error')
  })

  it('ok / error on a resource request also dispatch those actions (after the RESOURCE write)', async () => {
    function C({ state }) { return h('p', { className: 'log' }, state.log.join(',')) }
    C.initialState = { zip: '12345', log: [] }
    C.resources = { place: (s) => ({ url: `/api/zip/${s.zip}`, ok: 'FOUND', error: 'MISSING' }) }
    C.intent = ({ DOM }) => ({ AGAIN: DOM.click('p') })
    C.model = {
      AGAIN: { HTTP: { refresh: 'place' } },
      FOUND: (s, data) => ({ ...s, log: [...s.log, `found ${data.city} ${s.place.status}`] }),
      MISSING: (s, { error }) => ({ ...s, log: [...s.log, `missing ${error.status} ${s.place.status}`] }),
    }
    start(C)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { city: 'Springfield' })
    await waitFor(() => expect(text('.log')).toBe('found Springfield success'))
    click('p')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    srv.status(1, 404)
    await waitFor(() => expect(text('.log')).toBe('found Springfield success,missing 404 error'))
  })

  it('a Collection: each item has its own resource and gets only its own replies', async () => {
    function Item({ state }) {
      return h('li', { className: `item-${state.id}` }, h('button', { className: 'r' }, 'r'), h('span', { className: 'v' }, `${state.quote.status}:${state.quote.data?.text ?? ''}`))
    }
    Item.resources = { quote: (s) => `/api/quotes/${s.id}` }
    Item.intent = ({ DOM }) => ({ R: DOM.click('.r') })
    Item.model = { R: { HTTP: { refresh: 'quote' } } }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 'a' }, { id: 'b' }] }
    List.model = { NOOP: (s) => s }
    start(List)
    await waitFor(() => expect(srv.paths().sort()).toEqual(['/api/quotes/a', '/api/quotes/b']))
    const ia = srv.paths().indexOf('/api/quotes/a'), ib = srv.paths().indexOf('/api/quotes/b')
    srv.respond(ib, { text: 'B' })
    await waitFor(() => expect(text('.item-b .v')).toBe('success:B'))
    expect(text('.item-a .v')).toBe('loading:')
    srv.respond(ia, { text: 'A' })
    await waitFor(() => expect(text('.item-a .v')).toBe('success:A'))
    document.querySelector('.item-a .r').click()
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(3))
    expect(srv.paths()[2]).toBe('/api/quotes/a')
    await waitFor(() => expect(text('.item-a .v')).toBe('loading:'))
    expect(text('.item-b .v')).toBe('success:B')
  })

  it('dispose aborts a resource request in flight; a late reply does nothing', async () => {
    start(Quote)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    app.dispose()
    app = null
    expect(srv.requests[0].aborted).toBe(true)
  })

  it('a child component disposed by its parent aborts its resource', async () => {
    function Child({ state }) { return h('span', { className: 'c' }, state.quote.status) }
    Child.resources = { quote: () => '/api/child' }
    function Parent({ state }) {
      return h('div', null, h('button', { className: 'hide' }, 'x'), state.show ? h(Child, { state: 'child' }) : null)
    }
    Parent.initialState = { show: true, child: {} }
    Parent.intent = ({ DOM }) => ({ HIDE: DOM.click('.hide') })
    Parent.model = { HIDE: (s) => ({ ...s, show: false }) }
    start(Parent)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(text('.c')).toBe('loading'))
    click('.hide')
    await waitFor(() => expect(srv.requests[0].aborted).toBe(true))
  })
})

describe('resources under renderComponent (the HTTP fake)', () => {
  it('t.respond / t.fail by resource name or URL; t.states shows every RESOURCE write; t.requests the fetches', async () => {
    t = renderComponent(Quote)
    await t.ready()
    await t.waitForState(s => s.quote?.status === 'loading')
    expect(t.requests('HTTP')).toEqual([{ url: '/api/quotes/1' }])
    await t.respond('HTTP', { text: 'one' }, 'quote')
    expect(t.state.quote).toEqual({ status: 'success', data: { text: 'one' }, error: undefined })
    expect(t.html()).toContain('one')
    t.simulateAction('NEXT')
    await t.waitForState(s => s.id === 2 && s.quote.status === 'loading')
    // the earlier request is no longer pending
    expect(() => t.respond('HTTP', {}, { url: '/api/quotes/1' })).toThrow(/no pending HTTP request/)
    await t.fail('HTTP', 404, { url: '/api/quotes/2' })
    expect(t.state.quote.status).toBe('error')
    expect(t.state.quote.error.status).toBe(404)
    // INITIALIZE stores the idle slot; NEXT's own state still has the old success, then loading
    expect(t.states.map(s => s.quote?.status).filter(Boolean)).toEqual(['idle', 'loading', 'success', 'success', 'loading', 'error'])
    t.simulateAction('REFRESH')
    await t.waitForState(s => s.quote.status === 'loading')
    expect(t.requests('HTTP')).toEqual([{ url: '/api/quotes/1' }, { url: '/api/quotes/2' }, { url: '/api/quotes/2' }])
    await t.respond('HTTP', { text: 'two' })
    expect(t.state.quote.data).toEqual({ text: 'two' })
  })

  it('the view reads idle before any request; ok/error hooks are answered too', async () => {
    function C({ state }) { return h('p', null, `${state.place.status}|${state.log.join(',')}`) }
    C.initialState = { zip: '', log: [] }
    C.resources = { place: (s) => s.zip.length === 5 && { url: `/api/zip/${s.zip}`, ok: 'FOUND' } }
    C.model = {
      SET: (s, zip) => ({ ...s, zip }),
      FOUND: (s, d) => ({ ...s, log: [...s.log, d.city] }),
    }
    t = renderComponent(C)
    await t.ready()
    expect(t.html()).toContain('idle|')
    t.simulateAction('SET', '12345')
    await t.waitForState(s => s.place?.status === 'loading')
    await t.respond('HTTP', { city: 'X' }, 'place')
    expect(t.html()).toContain('success|X')
    t.simulateAction('SET', '1')
    await t.waitForState(s => s.place.status === 'idle')
    expect(t.html()).toContain('idle|X')
  })

  it('a Collection under the fake: answering one item\'s resource by URL', async () => {
    function Item({ state }) { return h('li', null, `${state.id}:${state.quote.status}`) }
    Item.resources = { quote: (s) => `/api/q/${s.id}` }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 'a' }, { id: 'b' }] }
    List.model = { NOOP: (s) => s }
    t = renderComponent(List)
    await t.ready()
    await t.waitForState(s => s.items.every(i => i.quote?.status === 'loading'))
    await t.respond('HTTP', { x: 1 }, { url: '/api/q/b' })
    await t.waitForState(s => s.items[1].quote.status === 'success')
    expect(t.state.items[0].quote.status).toBe('loading')
  })
})

// Task 23 (evals/agent-ergonomics/tasks/23-quote-resource) solved with `resources`; the hidden
// test's assertions ported to run() with makeFetchDriver.
const QUOTE_IDS = [101, 102, 103]
const STATUS_TEXT = { loading: 'Loading…', error: 'Could not load the quote.' }
function App({ state }) {
  const { status, data } = state.quote
  return h('div', { className: 'quotes' },
    h('ul', { className: 'quote-list' }, ...QUOTE_IDS.map(id => h('li', null,
      h('button', { className: id === state.selected ? 'pick selected' : 'pick', 'data-id': String(id) }, `Quote ${id}`)))),
    h('section', { className: 'detail' }, state.selected === null
      ? h('p', { className: 'placeholder' }, 'Select a quote.')
      : h('div', { className: 'quote' },
        h('button', { className: 'refresh' }, 'Refresh'),
        h('p', { className: 'status' }, STATUS_TEXT[status] ?? ''),
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

describe('task 23 with resources (hidden assertions)', () => {
  const Q101 = { id: 101, text: 'Simplicity is prerequisite for reliability.', author: 'Edsger W. Dijkstra' }
  const Q101_EDITED = { id: 101, text: 'Simplicity is a great virtue.', author: 'Edsger W. Dijkstra' }
  const Q101_LATEST = { id: 101, text: 'Simplicity is hard work.', author: 'Edsger W. Dijkstra' }
  const Q102 = { id: 102, text: 'Premature optimization is the root of all evil.', author: 'Donald Knuth' }
  const Q103 = { id: 103, text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' }
  const ALL = [Q101, Q101_EDITED, Q101_LATEST, Q102, Q103].map(q => q.text)
  const detail = () => document.querySelector('.detail')
  const inDetail = (sel) => { const el = detail()?.querySelector(sel); return el ? textOf(el) : '' }
  const pick = async (id) => { [...document.querySelectorAll('button')].find(b => textOf(b) === `Quote ${id}`).click(); await sleep(20) }
  const refresh = async () => { document.querySelector('.refresh').click(); await sleep(20) }
  const expectLoading = () => {
    expect(inDetail('.status')).toBe('Loading…')
    expect(inDetail('.quote-text')).toBe('')
    for (const s of ALL) expect(textOf(detail())).not.toContain(s)
  }
  const expectShown = (q) => {
    expect(inDetail('.quote-text')).toBe(q.text)
    expect(inDetail('.quote-author')).toContain(q.author)
    expect(inDetail('.status')).toBe('')
  }
  const begin = async () => { start(App); await waitFor(() => expect(textOf(detail())).toContain('Select a quote.')) }

  it('loads nothing until picked, then loads and shows it', async () => {
    await begin()
    await sleep(50)
    expect(srv.fn).not.toHaveBeenCalled()
    await pick(101)
    await waitFor(() => expect(srv.paths()).toEqual(['/api/quotes/101']))
    await waitFor(() => expectLoading())
    srv.respond(0, Q101)
    await waitFor(() => expectShown(Q101))
  })

  it('picking another shows Loading… instead of the old quote', async () => {
    await begin()
    await pick(101)
    srv.respond(0, Q101)
    await waitFor(() => expectShown(Q101))
    await pick(102)
    await waitFor(() => expectLoading())
    srv.respond(1, Q102)
    await waitFor(() => expectShown(Q102))
  })

  it('out-of-order responses; failure; refresh; same-quote staleness', async () => {
    await begin()
    await pick(101); await pick(102); await pick(101)
    await waitFor(() => expect(srv.paths()).toEqual(['/api/quotes/101', '/api/quotes/102', '/api/quotes/101']))
    srv.respond(0, Q101)
    await sleep(50)
    expectLoading()
    srv.respond(1, Q102)
    await sleep(50)
    expectLoading()
    srv.respond(2, Q101_EDITED)
    await waitFor(() => expectShown(Q101_EDITED))
    await refresh(); await refresh()
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(5))
    srv.respond(4, Q101_LATEST)
    await waitFor(() => expectShown(Q101_LATEST))
    srv.networkError(3)
    await sleep(50)
    expectShown(Q101_LATEST)
    await refresh()
    await waitFor(() => expectLoading())
    srv.status(5, 500)
    await waitFor(() => expect(inDetail('.status')).toBe('Could not load the quote.'))
    expect(inDetail('.quote-text')).toBe('')
    await pick(103)
    srv.respond(6, Q103)
    await waitFor(() => expectShown(Q103))
  })
})

describe('a string static (5-0c router spike fix)', () => {
  it('is sent as is, not iterated: no SYG216', async () => {
    const seen = []
    const routeDriver = (sink$) => {
      sink$.addListener({ next: (v) => seen.push(v), error: () => {}, complete: () => {} })
      return { __sygnalStatic: 'route' }
    }
    function App() { return h('p', { className: 'p' }, 'app') }
    App.route = 'ROUTE'
    app = run(App, { ROUTER: routeDriver }, { mountPoint: '#root' })
    await waitFor(() => expect(seen).toEqual([{ route: 'ROUTE' }]))
    await sleep(10)
    expect(seen).toEqual([{ route: 'ROUTE' }])
    expect(errorSpy.mock.calls.flat().join(' ')).not.toMatch(/SYG216/)
  })
})
