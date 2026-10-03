// @vitest-environment jsdom
// PLAN-3 5-2b + 5-3: resource reload semantics (D78, G-177) and makeFetchDriver's opt-in query
// cache (D79, D80; D88: queryCache()): stale-while-revalidate, de-duplication across senders, gcTime, focus /
// online / polling triggers, invalidation by tag / URL prefix / predicate, retries, Standard
// Schema validation, t.cache / t.focus / t.online, and the dev diagnostics SYG630-SYG633.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable } from '../src/switchable.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { queryCache } from '../src/extra/queryCache.js'
import { renderComponent } from '../src/extra/testing.js'
import { isStandardSchema, validateWith } from '../src/extra/standardSchema.js'
import { onBrowserSignals } from '../src/extra/browserSignals.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { waitFor, textOf, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'
import { clickWhenRendered } from './support/wait.js'

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}
const pathOf = (u) => { const x = new URL(String(u), 'http://localhost'); return x.pathname + x.search }

/** every fetch stays pending until answered by index; aborts reject like a browser */
function server() {
  const requests = []
  const fn = vi.fn((input, init) => new Promise((resolve, reject) => {
    const r = { path: pathOf(input), method: init?.method, resolve, reject, settled: false, signal: init?.signal }
    requests.push(r)
    init?.signal?.addEventListener('abort', () => {
      if (r.settled) return
      r.settled = r.aborted = true
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
  }))
  const settle = (i, how) => {
    const r = requests[i]
    if (!r) throw new Error(`no request #${i} (${requests.length} sent)`)
    if (r.settled) return
    r.settled = true
    how(r)
  }
  return {
    fn, requests,
    paths: () => requests.map(r => r.path),
    respond: (i, body) => settle(i, r => r.resolve(jsonResponse(body))),
    status: (i, s, headers) => settle(i, r => r.resolve(jsonResponse({ error: 'x' }, s, headers))),
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
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  _resetDiagnostics()
})
const start = (App, options) => (app = run(App, { HTTP: makeFetchDriver(options) }, { mountPoint: '#root' }))
const text = (sel) => textOf(document.querySelector(sel))
// G-176: a request can go out before the first render, so wait for the element
const click = async (sel) => { await clickWhenRendered(sel); await sleep(10) }

// the quote view shows status, refreshing, data and error
function Quote({ state }) {
  const q = state.quote
  return h('div', null,
    h('button', { className: 'next' }, 'next'),
    h('button', { className: 'prev' }, 'prev'),
    h('button', { className: 'refresh' }, 'refresh'),
    h('p', { className: 'status' }, `${q.status}${q.refreshing ? '+' : ''}`),
    h('p', { className: 'text' }, q.data ? q.data.text : ''),
    h('p', { className: 'err' }, q.error ? String(q.error.status ?? q.error.message) : ''))
}
const quote = (resource = (s) => `/api/quotes/${s.id}`, extra = {}) => {
  const C = (p) => Quote(p)
  C.initialState = { id: 1 }
  C.resources = { quote: resource }
  C.intent = ({ DOM }) => ({ NEXT: DOM.click('.next'), PREV: DOM.click('.prev'), REFRESH: DOM.click('.refresh') })
  C.model = {
    NEXT: (s) => ({ ...s, id: s.id + 1 }),
    PREV: (s) => ({ ...s, id: s.id - 1 }),
    REFRESH: { HTTP: { refresh: 'quote' } },
    ...extra,
  }
  return C
}

describe('D78: reload semantics', () => {
  it('a refresh keeps data and status (refreshing: true); success replaces data', async () => {
    start(quote())
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(text('.status')).toBe('success'))
    await click('.refresh')
    await waitFor(() => expect(text('.status')).toBe('success+'))
    expect(text('.text')).toBe('one')
    srv.respond(1, { text: 'one again' })
    await waitFor(() => expect(text('.status')).toBe('success'))
    expect(text('.text')).toBe('one again')
  })

  it('a key change clears data (loading); with keepPrevious: true it keeps it (refreshing)', async () => {
    start(quote())
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(text('.text')).toBe('one'))
    await click('.next')
    await waitFor(() => expect(text('.status')).toBe('loading'))
    expect(text('.text')).toBe('')
    app.dispose()

    srv = server()
    vi.stubGlobal('fetch', srv.fn)
    document.body.innerHTML = '<div id="root"></div>'
    start(quote((s) => ({ url: `/api/page/${s.id}`, keepPrevious: true })))
    await waitFor(() => expect(text('.status')).toBe('loading'))
    srv.respond(0, { text: 'page 1' })
    await waitFor(() => expect(text('.text')).toBe('page 1'))
    await click('.next')
    await waitFor(() => expect(text('.status')).toBe('success+'))
    expect(text('.text')).toBe('page 1')
    srv.respond(1, { text: 'page 2' })
    await waitFor(() => expect(text('.status')).toBe('success'))
    expect(text('.text')).toBe('page 2')
  })

  it('a failed refetch keeps data, with the error; the next refetch keeps the error', async () => {
    t = renderComponent(quote())
    await t.waitForState(s => s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'one' }, 'quote')
    t.simulateAction('REFRESH')
    await t.waitForState(s => s.quote.refreshing)
    await t.fail('HTTP', 500, 'quote')
    expect(t.state.quote).toMatchObject({ status: 'error', data: { text: 'one' }, error: { status: 500 } })
    expect(t.state.quote.refreshing).toBeFalsy()
    t.simulateAction('REFRESH')
    await t.waitForState(s => s.quote.refreshing)
    expect(t.state.quote).toMatchObject({ status: 'error', data: { text: 'one' }, error: { status: 500 } })
  })
})

// a Switchable page with a resource (5-4a's D85 pause)
function InfoPage({ state }) {
  const i = state.info
  return h('section', { className: 'info' }, `${i?.status}${i?.refreshing ? '+' : ''}:${i?.data?.v ?? ''}`)
}
InfoPage.resources = { info: (s) => `/api/info/${s.id}` }
InfoPage.model = { NOOP: (s) => s }
function OtherPage() { return h('section', { className: 'other' }, 'other') }
function Pages({ state }) {
  return h('div', null,
    h('button', { className: 'to-info' }, 'info'),
    h('button', { className: 'to-other' }, 'other'),
    h('main', null, h(Switchable, { of: { info: InfoPage, other: OtherPage }, current: state.page })))
}
Pages.initialState = { page: 'info', id: 1 }
Pages.intent = ({ DOM }) => ({ INFO: DOM.click('.to-info'), OTHER: DOM.click('.to-other') })
Pages.model = { INFO: (s) => ({ ...s, page: 'info' }), OTHER: (s) => ({ ...s, page: 'other' }) }
const infoState = () => app.sources.STATE.stream._v?.info

describe('G-177: a hidden page keeps its resource', () => {
  it('hidden: aborts nothing settled and keeps the result; shown: a same-request refetch keeping data', async () => {
    start(Pages)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { v: 'hello' })
    await waitFor(() => expect(text('.info')).toBe('success:hello'))
    await click('.to-other')
    await sleep(20)
    expect(srv.fn).toHaveBeenCalledTimes(1)
    expect(infoState()).toMatchObject({ status: 'success', data: { v: 'hello' } })
    await click('.to-info')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(text('.info')).toBe('success+:hello'))
    srv.respond(1, { v: 'again' })
    await waitFor(() => expect(text('.info')).toBe('success:again'))
  })

  it('hidden while refreshing: refreshing off, data kept; hidden while first loading: idle', async () => {
    start(Pages)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    await click('.to-other')
    await waitFor(() => expect(srv.requests[0].aborted).toBe(true))
    expect(infoState()).toMatchObject({ status: 'idle' })
    expect(infoState().data).toBeUndefined()
    await click('.to-info')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(text('.info')).toBe('loading:'))
    srv.respond(1, { v: 'one' })
    await waitFor(() => expect(text('.info')).toBe('success:one'))
    await click('.to-other')
    await click('.to-info')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(text('.info')).toBe('success+:one'))
    await click('.to-other')
    await waitFor(() => expect(srv.requests[2].aborted).toBe(true))
    expect(infoState()).toMatchObject({ status: 'success', data: { v: 'one' } })
    expect(infoState().refreshing).toBeFalsy()
  })
})

describe('D79: stale-while-revalidate', () => {
  it('cache on: switching back shows the cached data at once (refreshing), then refetches', async () => {
    start(quote(), { cache: queryCache() })
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(text('.text')).toBe('one'))
    await click('.next')
    await waitFor(() => expect(text('.status')).toBe('loading'))
    srv.respond(1, { text: 'two' })
    await waitFor(() => expect(text('.text')).toBe('two'))
    await click('.prev')
    await waitFor(() => expect(text('.status')).toBe('success+'))
    expect(text('.text')).toBe('one')
    await waitFor(() => expect(srv.paths()).toEqual(['/api/quotes/1', '/api/quotes/2', '/api/quotes/1']))
    srv.respond(2, { text: 'one, newer' })
    await waitFor(() => expect(text('.status')).toBe('success'))
    expect(text('.text')).toBe('one, newer')
  })

  it('staleTime: a fresh entry is served without a fetch; cache off: every switch fetches', async () => {
    start(quote(), { cache: queryCache({ staleTime: 60000 }) })
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(text('.text')).toBe('one'))
    await click('.next')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    srv.respond(1, { text: 'two' })
    await waitFor(() => expect(text('.text')).toBe('two'))
    await click('.prev')
    await waitFor(() => expect(text('.text')).toBe('one'))
    expect(text('.status')).toBe('success')
    await click('.next')
    await waitFor(() => expect(text('.text')).toBe('two'))
    expect(text('.status')).toBe('success')
    await sleep(20)
    expect(srv.fn).toHaveBeenCalledTimes(2)
    // a refresh always fetches
    await click('.refresh')
    await waitFor(() => expect(text('.status')).toBe('success+'))
  })

  it('cache off (default): a switch back is a key change (loading, no data)', async () => {
    start(quote())
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(text('.text')).toBe('one'))
    await click('.next')
    await click('.prev')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(3))
    expect(text('.status')).toBe('loading')
    expect(text('.text')).toBe('')
  })
})

// two components that read the same user
const reader = (name, extra = {}) => {
  const C = ({ state }) => h('p', { className: name }, state.user.status === 'success' ? state.user.data.name : state.user.status)
  Object.defineProperty(C, 'name', { value: name })
  C.resources = { user: () => '/api/user' }
  C.model = { NOOP: (s) => s }
  Object.assign(C, extra)
  return C
}
// a component that loads the user with reply actions (cache: true) and can abort
const loader = (name) => {
  const C = ({ state }) => h('div', null,
    h('button', { className: `load-${name}` }, 'load'),
    h('button', { className: `stop-${name}` }, 'stop'),
    h('p', { className: name }, state.got))
  Object.defineProperty(C, 'name', { value: name })
  C.intent = ({ DOM }) => ({ LOAD: DOM.click(`.load-${name}`), STOP: DOM.click(`.stop-${name}`) })
  C.model = {
    LOAD: { HTTP: () => ({ url: '/api/user', ok: 'GOT', cache: true }) },
    STOP: { HTTP: () => ({ abort: 'GOT' }) },
    GOT: (s, u) => ({ ...s, got: u.name }),
  }
  return C
}

describe('D79: de-duplication across senders', () => {
  it('two components with the same resource: one fetch, both get the data', async () => {
    const A = reader('a'), B = reader('b')
    function App() { return h('div', null, h(A, { state: 'a' }), h(B, { state: 'b' })) }
    App.initialState = { a: {}, b: {} }
    App.model = { NOOP: (s) => s }
    start(App, { cache: queryCache() })
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    await sleep(20)
    expect(srv.fn).toHaveBeenCalledTimes(1)
    srv.respond(0, { name: 'Ada' })
    await waitFor(() => expect(text('.a')).toBe('Ada'))
    expect(text('.b')).toBe('Ada')
  })

  it('without the cache each sender fetches', async () => {
    const A = reader('a'), B = reader('b')
    function App() { return h('div', null, h(A, { state: 'a' }), h(B, { state: 'b' })) }
    App.initialState = { a: {}, b: {} }
    App.model = { NOOP: (s) => s }
    start(App)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
  })

  it('reply actions with cache: true: one fetch, each sender gets its own action; one abort keeps the fetch, both abort it', async () => {
    const A = loader('a'), B = loader('b')
    function App() { return h('div', null, h(A, { state: 'a' }), h(B, { state: 'b' })) }
    App.initialState = { a: { got: '' }, b: { got: '' } }
    App.model = { NOOP: (s) => s }
    start(App, { cache: queryCache() })
    await sleep(20)
    await click('.load-a')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    await click('.load-b')
    await sleep(20)
    expect(srv.fn).toHaveBeenCalledTimes(1)
    await click('.stop-a')
    expect(srv.requests[0].aborted).toBeFalsy()
    srv.respond(0, { name: 'Ada' })
    await waitFor(() => expect(text('.b')).toBe('Ada'))
    await sleep(20)
    expect(text('.a')).toBe('')

    // a fresh entry? staleTime 0: the next load fetches again; both stop: the fetch is aborted
    await click('.load-a')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    await click('.load-b')
    await sleep(20)
    expect(srv.fn).toHaveBeenCalledTimes(2)
    await click('.stop-a')
    await click('.stop-b')
    await waitFor(() => expect(srv.requests[1].aborted).toBe(true))
  })

  it('a reply-action request without cache: true stays one-send-one-request', async () => {
    const A = loader('a')
    A.model.LOAD = { HTTP: () => ({ url: '/api/user', ok: 'GOT' }) }
    const B = loader('b')
    B.model.LOAD = { HTTP: () => ({ url: '/api/user', ok: 'GOT' }) }
    function App() { return h('div', null, h(A, { state: 'a' }), h(B, { state: 'b' })) }
    App.initialState = { a: { got: '' }, b: { got: '' } }
    App.model = { NOOP: (s) => s }
    start(App, { cache: queryCache() })
    await sleep(20)
    await click('.load-a')
    await click('.load-b')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
  })
})

describe('t.cache and gcTime', () => {
  it('lists entries (key, age, stale, subscribers, data); an unused entry is evicted after gcTime', async () => {
    t = renderComponent(quote(), { http: { cache: queryCache({ gcTime: 40 }) } })
    await t.waitForState(s => s.quote.status === 'loading')
    expect(t.cache('HTTP')).toEqual([{ key: 'GET /api/quotes/1', age: undefined, stale: true, subscribers: 1, data: undefined, tags: undefined }])
    await t.respond('HTTP', { text: 'one' }, 'quote')
    const [e] = t.cache('HTTP')
    expect(e).toMatchObject({ key: 'GET /api/quotes/1', stale: true, subscribers: 1, data: { text: 'one' } })
    expect(e.age).toBeGreaterThanOrEqual(0)
    t.simulateAction('NEXT')
    await t.waitForState(s => s.id === 2 && s.quote.status === 'loading')
    expect(t.cache('HTTP').map(e => [e.key, e.subscribers])).toEqual([['GET /api/quotes/1', 0], ['GET /api/quotes/2', 1]])
    await sleep(80)
    expect(t.cache('HTTP').map(e => e.key)).toEqual(['GET /api/quotes/2'])
  })

  it('the key sorts the query and includes method, body and parse; staleTime makes an entry fresh', async () => {
    const C = quote((s) => ({ url: '/api/search', query: { q: 'x', a: s.id } }))
    t = renderComponent(C, { http: { cache: queryCache({ staleTime: 60000 }) } })
    await t.waitForState(s => s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'r' }, 'quote')
    expect(t.cache('HTTP')).toMatchObject([{ key: 'GET /api/search?a=1&q=x', stale: false }])
  })
})

describe('triggers: focus, online, polling', () => {
  it('t.focus / t.online refetch stale mounted resources (cache on), keeping data', async () => {
    t = renderComponent(quote(), { http: { cache: queryCache() } })
    await t.waitForState(s => s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'one' }, 'quote')
    t.focus()
    await t.waitForState(s => s.quote.refreshing)
    expect(t.state.quote.data).toEqual({ text: 'one' })
    expect(t.requests('HTTP')).toHaveLength(2)
    await t.respond('HTTP', { text: 'two' }, 'quote')
    t.online()
    await t.waitForState(s => s.quote.refreshing)
    expect(t.requests('HTTP')).toHaveLength(3)
  })

  it('fresh entries, refetchOnFocus: false and cache off: no refetch', async () => {
    for (const http of [{ cache: queryCache({ staleTime: 60000 }) }, { cache: queryCache({ refetchOnFocus: false, refetchOnReconnect: false }) }, undefined]) {
      t = renderComponent(quote(), { http })
      await t.waitForState(s => s.quote.status === 'loading')
      await t.respond('HTTP', { text: 'one' }, 'quote')
      t.focus()
      t.online()
      await t.settle()
      expect(t.requests('HTTP')).toHaveLength(1)
      t.dispose()
    }
  })

  it('run(): window focus refetches (cache on); a hidden page\'s resource does not', async () => {
    start(Pages, { cache: queryCache() })
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { v: 'hello' })
    await waitFor(() => expect(text('.info')).toBe('success:hello'))
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(text('.info')).toBe('success+:hello'))
    srv.respond(1, { v: 'again' })
    await waitFor(() => expect(text('.info')).toBe('success:again'))
    await click('.to-other')
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await sleep(20)
    expect(srv.fn).toHaveBeenCalledTimes(2)
  })

  it('refetchEvery polls after each result and skips while the document is hidden', async () => {
    start(quote((s) => ({ url: `/api/quotes/${s.id}`, refetchEvery: 30 })))
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(text('.status')).toBe('success+'))
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      srv.respond(1, { text: 'two' })
      await waitFor(() => expect(text('.text')).toBe('two'))
      await sleep(100)
      expect(srv.fn).toHaveBeenCalledTimes(2)
    } finally {
      delete document.visibilityState
    }
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(3))
  })

  it('polling stops when the resource goes away', async () => {
    start(quote((s) => s.id === 1 && { url: `/api/quotes/${s.id}`, refetchEvery: 20 }))
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(text('.text')).toBe('one'))
    await click('.next')
    await waitFor(() => expect(text('.status')).toBe('idle'))
    await sleep(60)
    expect(srv.fn).toHaveBeenCalledTimes(1)
  })

  it('onBrowserSignals: focus, visible and online call back; unsubscribe stops them', () => {
    const seen = []
    const off = onBrowserSignals(s => seen.push(s))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    off()
    window.dispatchEvent(new Event('focus'))
    expect(seen).toEqual(['focus', 'online', 'focus'])
  })
})

// a list (resource tagged 'quotes') and an editor that saves and invalidates
function List({ state }) {
  const q = state.list
  return h('p', { className: 'list' }, `${q.status}${q.refreshing ? '+' : ''}:${q.data?.join(',') ?? ''}`)
}
List.resources = { list: () => ({ url: '/api/quotes', tags: ['quotes'] }) }
List.model = { NOOP: (s) => s }
function Editor({ state }) {
  return h('div', null, h('button', { className: 'save' }, 'save'), h('button', { className: 'inval' }, 'inval'), h('p', { className: 'saved' }, state.saved))
}
Editor.intent = ({ DOM }) => ({ SAVE: DOM.click('.save'), INVAL: DOM.click('.inval') })
const editorApp = (inval, saveExtra = {}) => {
  const E = (p) => Editor(p)
  E.intent = Editor.intent
  E.model = {
    SAVE: { HTTP: () => ({ url: '/api/quotes/1', method: 'PUT', json: { text: 'x' }, ok: 'SAVED', error: 'SAVE_FAILED', invalidates: ['quotes'], ...saveExtra }) },
    INVAL: { HTTP: () => ({ invalidate: inval }) },
    SAVED: (s) => ({ ...s, saved: 'yes' }),
    SAVE_FAILED: (s) => ({ ...s, saved: 'no' }),
  }
  function App() { return h('div', null, h(List, { state: 'l' }), h(E, { state: 'e' })) }
  App.initialState = { l: {}, e: { saved: '' } }
  App.model = { NOOP: (s) => s }
  return App
}

describe('D80: invalidation', () => {
  for (const [what, inval] of [['a tag', 'quotes'], ['tags', ['other', 'quotes']], ['a URL prefix', '/api/quotes'], ['a predicate', (req) => req.url === '/api/quotes']]) {
    it(`by ${what}: the mounted resource refetches, keeping data`, async () => {
      start(editorApp(inval))
      await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
      srv.respond(0, ['a'])
      await waitFor(() => expect(text('.list')).toBe('success:a'))
      await click('.inval')
      await waitFor(() => expect(text('.list')).toBe('success+:a'))
      srv.respond(1, ['a', 'b'])
      await waitFor(() => expect(text('.list')).toBe('success:a,b'))
    })
  }

  it('a tag or prefix that matches nothing refetches nothing', async () => {
    for (const inval of ['users', '/api/users', () => false]) {
      start(editorApp(inval))
      await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
      srv.respond(0, ['a'])
      await waitFor(() => expect(text('.list')).toBe('success:a'))
      await click('.inval')
      await sleep(20)
      expect(srv.fn).toHaveBeenCalledTimes(1)
      app.dispose()
      srv = server()
      vi.stubGlobal('fetch', srv.fn)
      document.body.innerHTML = '<div id="root"></div>'
    }
  })

  it('invalidates: on success only', async () => {
    start(editorApp('nothing'))
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, ['a'])
    await waitFor(() => expect(text('.list')).toBe('success:a'))
    await click('.save')
    await waitFor(() => expect(srv.requests[1]?.method).toBe('PUT'))
    srv.status(1, 500)
    await waitFor(() => expect(text('.saved')).toBe('no'))
    await sleep(20)
    expect(srv.fn).toHaveBeenCalledTimes(2)
    await click('.save')
    await waitFor(() => expect(srv.requests.length).toBeGreaterThan(2))
    srv.respond(2, { ok: true })
    await waitFor(() => expect(text('.saved')).toBe('yes'))
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(4))
    expect(srv.paths()[3]).toBe('/api/quotes')
    await waitFor(() => expect(text('.list')).toBe('success+:a'))
  })

  it('cache entries: an unmounted match is marked stale, so a fresh entry is refetched on return', async () => {
    const C = quote((s) => ({ url: `/api/quotes/${s.id}`, tags: ['quotes'] }), { INVAL: { HTTP: { invalidate: 'quotes' } } })
    t = renderComponent(C, { http: { cache: queryCache({ staleTime: 60000 }) } })
    await t.waitForState(s => s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'one' }, 'quote')
    t.simulateAction('NEXT')
    await t.waitForState(s => s.id === 2 && s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'two' }, 'quote')
    expect(t.cache('HTTP').map(e => e.stale)).toEqual([false, false])
    t.simulateAction('INVAL')
    await t.waitForState(s => s.quote.refreshing)
    expect(t.cache('HTTP').map(e => e.stale)).toEqual([true, true])
    await t.respond('HTTP', { text: 'two again' }, 'quote')
    t.simulateAction('PREV')
    await t.waitForState(s => s.id === 1 && s.quote.refreshing)
    expect(t.state.quote.data).toEqual({ text: 'one' })
    expect(t.requests('HTTP').map(r => r.url)).toEqual(['/api/quotes/1', '/api/quotes/2', '/api/quotes/2', '/api/quotes/1'])
    // { invalidate } is a command, not a request
    expect(t.sinkValues('HTTP').filter(v => v.invalidate)).toHaveLength(1)
  })
})

// a component that loads with retries
const retrying = (retry, extra = {}) => {
  const C = ({ state }) => h('div', null, h('button', { className: 'go' }, 'go'), h('p', { className: 'out' }, state.out))
  C.initialState = { out: '' }
  C.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  C.model = {
    GO: { HTTP: () => ({ url: '/api/r', ok: 'GOT', error: 'FAILED', retry, ...extra }) },
    GOT: (s, v) => ({ ...s, out: `got ${v.v}` }),
    FAILED: (s, f) => ({ ...s, out: `failed ${f.status ?? f.error.message} after ${f.attempts}` }),
  }
  return C
}
const fast = (count) => ({ count, delayMs: 10, jitter: false })

describe('D80: retries', () => {
  it('network errors and 5xx are retried; the reply arrives once', async () => {
    start(retrying(fast(2)))
    await sleep(20)
    await click('.go')
    await waitFor(() => expect(srv.requests.length).toBeGreaterThan(0))
    srv.status(0, 500)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    srv.networkError(1)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(3))
    srv.respond(2, { v: 1 })
    await waitFor(() => expect(text('.out')).toBe('got 1'))
  })

  it('the error action fires once, after the last attempt, with attempts', async () => {
    const C = retrying(fast(2))
    const failed = vi.fn(C.model.FAILED)
    C.model.FAILED = failed
    start(C)
    await sleep(20)
    await click('.go')
    for (let i = 0; i < 3; i++) {
      await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(i + 1))
      srv.status(i, 503)
    }
    await waitFor(() => expect(text('.out')).toBe('failed 503 after 3'))
    await sleep(40)
    expect(srv.fn).toHaveBeenCalledTimes(3)
    expect(failed).toHaveBeenCalledTimes(1)
  })

  it('other 4xx are never retried; 408 is', async () => {
    start(retrying(fast(3)))
    await sleep(20)
    await click('.go')
    await waitFor(() => expect(srv.requests.length).toBeGreaterThan(0))
    srv.status(0, 404)
    await waitFor(() => expect(text('.out')).toBe('failed 404 after 1'))
    await click('.go')
    await waitFor(() => expect(srv.requests.length).toBeGreaterThan(1))
    srv.status(1, 408)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(3))
  })

  it('429 honours Retry-After (seconds) over the backoff', async () => {
    start(retrying({ count: 1, delayMs: 60000 }))
    await sleep(20)
    await click('.go')
    await waitFor(() => expect(srv.requests.length).toBeGreaterThan(0))
    srv.status(0, 429, { 'Retry-After': '0.03' })
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
  })

  it('default 0: no retry; the driver option applies to GET only, a request option to any method', async () => {
    start(retrying(undefined))
    await sleep(20)
    await click('.go')
    await waitFor(() => expect(srv.requests.length).toBeGreaterThan(0))
    srv.status(0, 500)
    await waitFor(() => expect(text('.out')).toBe('failed 500 after undefined'))
    app.dispose()

    srv = server()
    vi.stubGlobal('fetch', srv.fn)
    document.body.innerHTML = '<div id="root"></div>'
    start(retrying(undefined, { method: 'POST', json: {} }), { retry: fast(2) })
    await sleep(20)
    await click('.go')
    await waitFor(() => expect(srv.requests.length).toBeGreaterThan(0))
    srv.status(0, 500)
    await waitFor(() => expect(text('.out')).toContain('failed 500'))
    expect(srv.fn).toHaveBeenCalledTimes(1)
    app.dispose()

    srv = server()
    vi.stubGlobal('fetch', srv.fn)
    document.body.innerHTML = '<div id="root"></div>'
    start(retrying(fast(1), { method: 'POST', json: {} }))
    await sleep(20)
    await click('.go')
    await waitFor(() => expect(srv.requests.length).toBeGreaterThan(0))
    srv.status(0, 500)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
  })

  it('latest cancels a pending retry; so does abort', async () => {
    // G-176: a real-time backoff; the second click must land while the retry is pending, so the
    // delay is far longer than a loaded machine's timer lag, and the check waits past it
    start(retrying({ count: 3, delayMs: 300, jitter: false }, { latest: true }))
    await sleep(20)
    await click('.go')
    await waitFor(() => expect(srv.requests.length).toBeGreaterThan(0))
    srv.status(0, 500)
    await sleep(5)
    await click('.go')
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    await sleep(450)
    expect(srv.fn).toHaveBeenCalledTimes(2)
  })

  it('a resource retries too (retry on the resource request); refetches start over', async () => {
    start(quote((s) => ({ url: `/api/quotes/${s.id}`, retry: fast(1) })))
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.status(0, 502)
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(text('.status')).toBe('loading'))
    srv.status(1, 502)
    await waitFor(() => expect(text('.status')).toBe('error'))
  })

  it('renderComponent: retries run on the test clock (fake timers)', async () => {
    vi.useFakeTimers()
    t = renderComponent(retrying({ count: 1, delayMs: 1000, jitter: false }))
    await t.ready()
    t.simulateEvent('.go', 'click')
    await t.settle()
    expect(t.requests('HTTP')).toHaveLength(1)
    t.fail('HTTP', 500).catch(() => {})
    await vi.advanceTimersByTimeAsync(900)
    expect(t.state.out).toBe('')
    await vi.advanceTimersByTimeAsync(300)
    // the retry is pending (t.requests lists what the component sent: one request)
    await t.fail('HTTP', 503)
    expect(t.state.out).toBe('failed 503 after 2')
    expect(t.requests('HTTP')).toHaveLength(1)
  })
})

// a Standard Schema without a library
const schema = (check, transform = (v) => v, async = false) => ({
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => {
      const r = check(v) ? { value: transform(v) } : { issues: [{ message: 'text must be a string', path: ['text'] }] }
      return async ? Promise.resolve(r) : r
    },
  },
})
const isQuote = (v) => typeof v?.text === 'string'

describe('D80: validate (Standard Schema)', () => {
  it('standardSchema helpers', async () => {
    expect(isStandardSchema(schema(isQuote))).toBe(true)
    expect(isStandardSchema({})).toBe(false)
    expect(isStandardSchema(null)).toBe(false)
    await expect(validateWith(schema(isQuote, (v) => v.text), { text: 'a' })).resolves.toBe('a')
    await expect(validateWith(schema(isQuote, undefined, true), { text: 1 })).rejects.toMatchObject({ name: 'ValidationError', issues: [{ message: 'text must be a string' }] })
  })

  it('a resource: failure goes to error with issues; success uses the transformed value', async () => {
    t = renderComponent(quote((s) => ({ url: `/api/quotes/${s.id}`, validate: schema(isQuote, (v) => ({ text: v.text.toUpperCase() })) })))
    await t.waitForState(s => s.quote.status === 'loading')
    await t.respond('HTTP', { text: 1 }, 'quote')
    expect(t.state.quote.status).toBe('error')
    expect(t.state.quote.error.issues).toEqual([{ message: 'text must be a string', path: ['text'] }])
    t.simulateAction('REFRESH')
    await t.waitForState(s => s.quote.refreshing)
    await t.respond('HTTP', { text: 'hi' }, 'quote')
    expect(t.state.quote).toMatchObject({ status: 'success', data: { text: 'HI' } })
  })

  it('reply actions: the error action gets { error, status, issues }; ok the validated value (async schema)', async () => {
    const C = retrying(undefined, { validate: schema((v) => typeof v.v === 'number', (v) => ({ v: v.v * 10 }), true) })
    C.model.FAILED = (s, f) => ({ ...s, out: `invalid ${f.status} ${f.issues[0].message}` })
    t = renderComponent(C)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await t.respond('HTTP', { v: 'x' }, 'GOT')
    expect(t.state.out).toBe('invalid 200 text must be a string')
    t.simulateEvent('.go', 'click')
    await t.respond('HTTP', { v: 4 }, 'GOT')
    expect(t.state.out).toBe('got 40')
  })

  it('validate that is not a Standard Schema fails the request', async () => {
    const C = retrying(undefined, { validate: (v) => v })
    C.model.FAILED = (s, f) => ({ ...s, out: f.error.name })
    t = renderComponent(C)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await t.respond('HTTP', { v: 1 }, 'GOT')
    expect(t.state.out).toBe('TypeError')
  })
})

describe('dev diagnostics', () => {
  beforeEach(() => setupChecks())
  const startDiag = (App, options) => (app = run(App, { HTTP: makeFetchDriver(options) }, { mountPoint: '#root', diagnostics: 'collect' }))
  const sender = (requests) => {
    const C = ({ state }) => h('div', null, ...Object.keys(requests).map(k => h('button', { className: k.toLowerCase() }, k)), h('p', null, String(state.n)))
    Object.defineProperty(C, 'name', { value: 'Sender' })
    C.initialState = { n: 0 }
    C.intent = ({ DOM }) => Object.fromEntries(Object.keys(requests).map(k => [k, DOM.click('.' + k.toLowerCase())]))
    C.model = { ...Object.fromEntries(Object.entries(requests).map(([k, r]) => [k, { HTTP: () => r }])), GOT: (s) => ({ ...s, n: s.n + 1 }) }
    return C
  }

  it('SYG630: cache: true / staleTime on a POST; not on a GET', async () => {
    startDiag(sender({ POST: { url: '/api/x', json: { a: 1 }, cache: true, ok: 'GOT' }, PUT: { url: '/api/y', method: 'PUT', staleTime: 1000, ok: 'GOT' }, GET: { url: '/api/z', cache: true, ok: 'GOT' } }))
    await settle(20)
    await click('.post'); await click('.put'); await click('.get')
    await settle(20)
    const found = diagnostics('SYG630')
    expect(found.map(d => d.data.method)).toEqual(['POST', 'PUT'])
    expect(found[0].severity).toBe('warn')
    expect(found[0].fix).toContain('invalidates')
  })

  it('SYG631: validate that is not a Standard Schema (requests and resources)', async () => {
    const C = sender({ GO: { url: '/api/x', validate: { parse: () => 1 }, ok: 'GOT' } })
    C.resources = { r: () => ({ url: '/api/res', validate: (v) => v }) }
    startDiag(C)
    await settle(20)
    await click('.go')
    await settle(20)
    const found = diagnostics('SYG631')
    expect(found.map(d => d.data.url).sort()).toEqual(['/api/res', '/api/x'])
    expect(found[0].severity).toBe('error')
  })

  it('SYG632: invalidate matching nothing is reported (info); a match is not', async () => {
    const C = sender({ MISS: { invalidate: 'users' }, HIT: { invalidate: '/api/res' } })
    C.resources = { r: () => '/api/res' }
    startDiag(C)
    await settle(20)
    await click('.miss'); await click('.hit')
    await settle(20)
    const found = diagnostics('SYG632')
    expect(found.map(d => d.data.invalidate)).toEqual(['"users"'])
    expect(found[0].severity).toBe('info')
  })

  it('SYG633 (G-175): abort by the ok name while the requests use another key', async () => {
    startDiag(sender({ GO: { url: '/api/x', ok: 'GOT', key: 'search' }, STOP: { abort: 'GOT' }, STOP2: { abort: true, key: 'search' } }))
    await settle(20)
    await click('.go'); await click('.stop'); await click('.stop2')
    await settle(20)
    const found = diagnostics('SYG633')
    expect(found).toHaveLength(1)
    expect(found[0].fix).toContain("{ abort: true, key: 'search' }")
    expect(srv.requests[0].aborted).toBe(true)
  })

  it('inspect(): each instance\'s resources, and the cache by sink', async () => {
    t = renderComponent(quote(), { http: { cache: queryCache() } })
    await t.waitForState(s => s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'one' }, 'quote')
    t.simulateAction('REFRESH')
    await t.waitForState(s => s.quote.refreshing)
    const g = t.inspect()
    expect(g.components[0].resources).toEqual([{ name: 'quote', status: 'success', refreshing: true, hasData: true, error: undefined }])
    expect(g.cache.HTTP).toMatchObject([{ key: 'GET /api/quotes/1', subscribers: 1, data: { text: 'one' } }])
  })

  it('no reports for canonical cached reads', async () => {
    const C = sender({ GO: { url: '/api/x', ok: 'GOT', cache: true }, STOP: { abort: 'GOT' } })
    C.resources = { r: () => ({ url: '/api/res', tags: ['res'] }) }
    startDiag(C, { cache: queryCache() })
    await settle(20)
    await click('.go'); await click('.stop')
    await settle(20)
    expect(['SYG630', 'SYG631', 'SYG632', 'SYG633'].flatMap(c => diagnostics(c))).toEqual([])
  })
})

describe('the Resources and Caching docs Testing sample', () => {
  function DocQuote({ state }) {
    const { status, data, refreshing } = state.quote
    return h('div', { className: 'quote' },
      h('p', { className: 'status' }, status === 'loading' ? 'Loading…' : status === 'error' ? 'Could not load the quote.' : ''),
      h('p', { className: 'text' }, data?.text),
      refreshing && h('p', { className: 'busy' }, 'Updating…'))
  }
  DocQuote.initialState = { id: 1 }
  DocQuote.resources = { quote: (state) => state.id && `/api/quotes/${state.id}` }
  DocQuote.model = { NEXT: (state) => ({ ...state, id: state.id + 1 }), REFRESH: { HTTP: { refresh: 'quote' } } }

  it('refreshes in place, and shows the cached quote when coming back', async () => {
    t = renderComponent(DocQuote, { http: { cache: queryCache() } })
    await t.waitForState((s) => s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'One' }, 'quote')
    t.simulateAction('REFRESH')
    await t.waitForState((s) => s.quote.refreshing)
    expect(t.html()).toContain('One')
    await t.respond('HTTP', { text: 'One, edited' }, 'quote')
    t.simulateAction('NEXT')
    await t.waitForState((s) => s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'Two' }, 'quote')
    expect(t.cache('HTTP').map((e) => e.key)).toEqual(['GET /api/quotes/1', 'GET /api/quotes/2'])
  })
})
