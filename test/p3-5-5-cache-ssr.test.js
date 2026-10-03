// @vitest-environment jsdom
// PLAN-3 5-5: queryCache() as its own export (D88), SSR cache seeding (H-7: dehydrate /
// hydrate / initial / set, renderToString({ cache })), { prefetch } on the HTTP sink and the
// router's prefetch hook, and SYG635 (caching asked for without a queryCache).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import xs from 'xstream'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable } from '../src/switchable.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { queryCache } from '../src/extra/queryCache.js'
import { makeRouter } from '../src/extra/router.js'
import { renderToString } from '../src/extra/ssr.js'
import { renderComponent } from '../src/extra/testing.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { waitFor, textOf, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'

const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const pathOf = (u) => { const x = new URL(String(u), 'http://localhost'); return x.pathname + x.search }

/** every fetch stays pending until answered by index */
function server() {
  const requests = []
  const fn = vi.fn((input, init) => new Promise((resolve, reject) => {
    const r = { path: pathOf(input), resolve, settled: false }
    requests.push(r)
    init?.signal?.addEventListener('abort', () => { if (!r.settled) { r.settled = r.aborted = true; reject(new DOMException('aborted', 'AbortError')) } })
  }))
  return {
    fn, requests,
    paths: () => requests.map(r => r.path),
    respond: (i, body) => { const r = requests[i]; r.settled = true; r.resolve(jsonResponse(body)) },
  }
}

let srv, app, t, errorSpy
beforeEach(() => {
  srv = server()
  vi.stubGlobal('fetch', srv.fn)
  window.history.replaceState(null, '', '/')
  window.scrollTo = () => {}
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
const text = (sel) => textOf(document.querySelector(sel))

// a quote page: the view shows status (+ while refreshing) and the text
function Quote({ state }) {
  const q = state.quote
  return h('div', null,
    h('button', { className: 'next' }, 'next'),
    h('p', { className: 'status' }, `${q.status}${q.refreshing ? '+' : ''}`),
    h('p', { className: 'text' }, q.data ? q.data.text : ''))
}
Quote.initialState = { id: 1 }
Quote.resources = { quote: (s) => s.id && { url: `/api/quotes/${s.id}`, tags: ['quotes'] } }
Quote.intent = ({ DOM }) => ({ NEXT: DOM.click('.next') })
Quote.model = { NEXT: (s) => ({ ...s, id: s.id + 1 }) }

/** every text the .status element showed, in order, from the first paint */
function watchStatus() {
  const seen = []
  const root = document.querySelector('#root')
  const look = () => {
    const el = document.querySelector('.status')
    const v = el && textOf(el)
    if (v != null && seen[seen.length - 1] !== v) seen.push(v)
  }
  const mo = new MutationObserver(look)
  mo.observe(root, { subtree: true, childList: true, characterData: true })
  return { seen, stop: () => mo.disconnect() }
}

/** a server-side snapshot: a loader wrote /api/quotes/1 `ageMs` ago */
function serverSnapshot(ageMs = 0) {
  const server = queryCache()
  server.set({ url: '/api/quotes/1', tags: ['quotes'] }, { text: 'seeded' })
  const snap = JSON.parse(JSON.stringify(server.dehydrate()))
  snap[0].updatedAt -= ageMs
  return snap
}

describe('D88: queryCache() is its own export', () => {
  it('makeFetchDriver({ cache: true }) is refused with a pointer to queryCache()', () => {
    expect(() => makeFetchDriver({ cache: true })).toThrow(/queryCache/)
    expect(() => makeFetchDriver({ cache: { staleTime: 1 } })).toThrow(/queryCache/)
  })

  it('without a queryCache: no cache listing, and cache: true on a request just sends it', async () => {
    const C = (p) => Quote(p)
    Object.assign(C, Quote, { resources: { quote: (s) => ({ url: `/api/quotes/${s.id}`, cache: true }) } })
    t = renderComponent(C)
    await t.waitForState(s => s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'one' }, 'quote')
    expect(t.cache('HTTP')).toEqual([])
    expect(t.state.quote).toMatchObject({ status: 'success', data: { text: 'one' } })
  })

  it('the driver exposes its cache (the Vike glue hydrates it)', () => {
    const cache = queryCache()
    expect(makeFetchDriver({ cache }).cache).toBe(cache)
    expect(makeFetchDriver().cache).toBeUndefined()
  })
})

describe('H-7: dehydrate / hydrate', () => {
  it('round trip: a fetched entry dehydrates to { key, data, updatedAt, tags } and hydrates into another cache', async () => {
    const a = queryCache()
    t = renderComponent(Quote, { http: { cache: a } })
    await t.waitForState(s => s.quote.status === 'loading')
    // nothing to dehydrate before data arrives
    expect(a.dehydrate()).toEqual([])
    const before = Date.now()
    await t.respond('HTTP', { text: 'one' }, 'quote')
    const snap = a.dehydrate()
    expect(snap).toEqual([{ key: 'GET /api/quotes/1', data: { text: 'one' }, updatedAt: expect.any(Number), tags: ['quotes'] }])
    expect(snap[0].updatedAt).toBeGreaterThanOrEqual(before)
    const json = JSON.parse(JSON.stringify(snap))
    expect(json).toEqual(snap.map(({ tags, ...e }) => ({ ...e, tags })))
    const b = queryCache({ initial: json })
    expect(b.dehydrate()).toEqual(snap)
    const c = queryCache()
    c.hydrate(json)
    expect(c.dehydrate()).toEqual(snap)
  })

  it('hydrate keeps an entry newer than the snapshot; set() keys like the request; null is a no-op', () => {
    const c = queryCache()
    c.set('/api/quotes/1', { text: 'newer' })
    c.set({ url: '/api/search', query: { q: 'x', a: 1 } }, ['r'])
    c.hydrate([{ key: 'GET /api/quotes/1', data: { text: 'older' }, updatedAt: 1 }])
    c.hydrate(null)
    expect(c.dehydrate().map(e => [e.key, e.data])).toEqual([['GET /api/quotes/1', { text: 'newer' }], ['GET /api/search?a=1&q=x', ['r']]])
  })

  for (const inval of ['quotes', '/api/quotes']) {
    it(`a hydrated entry is invalidated by ${inval[0] == '/' ? 'URL prefix' : 'tag'}`, async () => {
      const C = (p) => Quote(p)
      Object.assign(C, Quote, { model: { ...Quote.model, INVAL: { HTTP: { invalidate: inval } } } })
      t = renderComponent(C, { http: { cache: queryCache({ staleTime: 60000, initial: serverSnapshot() }) } })
      await t.waitForState(s => s.quote.status === 'success')
      expect(t.cache('HTTP')).toMatchObject([{ key: 'GET /api/quotes/1', stale: false, tags: ['quotes'] }])
      expect(t.requests('HTTP')).toEqual([])
      t.simulateAction('INVAL')
      await t.waitForState(s => s.quote.refreshing)
      expect(t.cache('HTTP')).toMatchObject([{ stale: true }])
      expect(t.requests('HTTP')).toMatchObject([{ url: '/api/quotes/1', resource: 'quote' }])
    })
  }
})

describe('H-7: seeded first paint', () => {
  it('run(): a fresh seeded entry paints success first, and nothing is fetched while it is fresh', async () => {
    const watch = watchStatus()
    app = run(Quote, { HTTP: makeFetchDriver({ cache: queryCache({ staleTime: 60000, initial: serverSnapshot(1000) }) }) }, { mountPoint: '#root' })
    await waitFor(() => expect(text('.text')).toBe('seeded'))
    await sleep(30)
    watch.stop()
    expect(watch.seen).toEqual(['success'])
    expect(srv.fn).not.toHaveBeenCalled()
  })

  it('run(): a stale seeded entry paints success (refreshing) first, then refetches', async () => {
    const watch = watchStatus()
    app = run(Quote, { HTTP: makeFetchDriver({ cache: queryCache({ staleTime: 60000, initial: serverSnapshot(120000) }) }) }, { mountPoint: '#root' })
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    expect(text('.text')).toBe('seeded')
    srv.respond(0, { text: 'fresh' })
    await waitFor(() => expect(text('.text')).toBe('fresh'))
    watch.stop()
    expect(watch.seen).toEqual(['success+', 'success'])
  })

  it('staleTime 0 (the default): the seeded data shows at once and refetches', async () => {
    t = renderComponent(Quote, { http: { cache: queryCache({ initial: serverSnapshot() }) } })
    await t.waitForState(s => s.quote.refreshing)
    expect(t.state.quote).toMatchObject({ status: 'success', data: { text: 'seeded' } })
    expect(t.requests('HTTP')).toMatchObject([{ url: '/api/quotes/1', resource: 'quote' }])
  })

  it('renderToString({ cache }): a cached resource renders success, others loading / idle; the hydration state is left alone', () => {
    const cache = queryCache({ initial: serverSnapshot() })
    const html = renderToString(Quote, { cache, hydrateState: true })
    expect(html).toContain('<p class="status">success</p><p class="text">seeded</p>')
    expect(html).toContain('window.__SYGNAL_STATE__={"id":1}')
    expect(renderToString(Quote, { state: { id: 2 }, cache })).toContain('<p class="status">loading</p>')
    expect(renderToString(Quote, { state: { id: 0 }, cache })).toContain('<p class="status">idle</p>')
    // without a cache, resources render loading (nothing is fetched on the server)
    expect(renderToString(Quote)).toContain('<p class="status">loading</p>')
    // a sub-component's resources read the same cache
    function Shell() { return h('main', null, h(Quote, { state: 'page' })) }
    Shell.initialState = { page: { id: 1 } }
    expect(renderToString(Shell, { cache })).toContain('<p class="text">seeded</p>')
  })
})

// a component that prefetches the next quote on hover
const prefetcher = () => {
  const C = (p) => h('div', null, Quote(p), h('button', { className: 'warm' }, 'warm'))
  Object.assign(C, Quote)
  C.intent = ({ DOM }) => ({ NEXT: DOM.click('.next'), WARM: DOM.click('.warm') })
  C.model = { ...Quote.model, WARM: { HTTP: (s) => ({ prefetch: `/api/quotes/${s.id + 1}` }) } }
  return C
}

describe('H-7: { prefetch }', () => {
  it('warms the cache with no reply; a resource that reads it later is served without a fetch', async () => {
    const cache = queryCache({ staleTime: 60000 })
    t = renderComponent(prefetcher(), { http: { cache } })
    await t.waitForState(s => s.quote.status === 'loading')
    await t.respond('HTTP', { text: 'one' }, 'quote')
    t.simulateAction('WARM')
    await t.settle()
    expect(t.requests('HTTP')).toMatchObject([{ url: '/api/quotes/1', resource: 'quote' }, { url: '/api/quotes/2', prefetch: true }])
    await t.respond('HTTP', { text: 'two' }, '/api/quotes/2')
    expect(t.state.quote.data).toEqual({ text: 'one' })
    // a fresh entry: prefetching it again sends nothing
    t.simulateAction('WARM')
    await t.settle()
    expect(t.requests('HTTP')).toHaveLength(2)
    t.simulateAction('NEXT')
    await t.waitForState(s => s.id === 2)
    expect(t.state.quote).toMatchObject({ status: 'success', data: { text: 'two' } })
    expect(t.state.quote.refreshing).toBeFalsy()
    expect(t.requests('HTTP')).toHaveLength(2)
  })

  it('run(): nothing reaches select() / errors(); a resource declared while the prefetch is in flight shares its fetch', async () => {
    const cache = queryCache({ staleTime: 60000 })
    const C = prefetcher()
    const seen = []
    C.intent = ({ DOM, HTTP }) => ({ NEXT: DOM.click('.next'), WARM: DOM.click('.warm'), SEEN: xs.merge(HTTP.select(), HTTP.errors()).map(v => seen.push(v)) })
    C.model = { ...C.model, SEEN: (s) => s }
    app = run(C, { HTTP: makeFetchDriver({ cache }) }, { mountPoint: '#root' })
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    srv.respond(0, { text: 'one' })
    await waitFor(() => expect(text('.text')).toBe('one'))
    document.querySelector('.warm').click()
    await waitFor(() => expect(srv.paths()).toEqual(['/api/quotes/1', '/api/quotes/2']))
    document.querySelector('.next').click()
    await sleep(20)
    expect(srv.fn).toHaveBeenCalledTimes(2)
    expect(text('.status')).toBe('loading')
    srv.respond(1, { text: 'two' })
    await waitFor(() => expect(text('.text')).toBe('two'))
    expect(seen).toEqual([])
  })

  it('cache.prefetch(request) goes through the driver given the cache', async () => {
    const cache = queryCache({ staleTime: 60000 })
    app = run(Quote, { HTTP: makeFetchDriver({ cache }) }, { mountPoint: '#root' })
    await waitFor(() => expect(srv.fn).toHaveBeenCalledTimes(1))
    cache.prefetch('/api/quotes/3')
    expect(srv.paths()).toEqual(['/api/quotes/1', '/api/quotes/3'])
    srv.respond(1, { text: 'three' })
    await waitFor(() => expect(cache.dehydrate().map(e => e.key)).toEqual(['GET /api/quotes/3']))
  })
})

// the docs recipe: route data as a map from route name to requests, used by the page's
// resources and by the router's prefetch option
describe('the router prefetch hook (docs recipe)', () => {
  const routes = { home: '/', task: '/tasks/:id' }
  const routeData = { task: ({ params }) => [`/api/tasks/${params.id}`] }

  function Task({ state }) {
    const t = state.task
    return h('section', { className: 'task' }, `${t.status}${t.refreshing ? '+' : ''}:${t.data?.title ?? ''}`)
  }
  Task.resources = { task: (state) => routeData.task(state.route)[0] }
  function Home() {
    return h('section', { className: 'home' }, 'home')
  }

  it('{ prefetch } on the ROUTER sink warms the route data; navigating renders it without a fetch', async () => {
    const cache = queryCache({ staleTime: 30000 })
    const router = makeRouter({ routes, prefetch: (route) => routeData[route.name]?.(route).forEach(cache.prefetch) })
    function App({ state }) {
      return h('main', null,
        h('nav', null, h('a', { href: '/tasks/7', className: 'to-7' }, 'seven'), h('button', { className: 'hover' }, 'hover')),
        h(Switchable, { of: { home: Home, task: Task }, current: state.route.name }))
    }
    App.route = 'ROUTE'
    App.initialState = { route: router.current() }
    App.intent = ({ DOM }) => ({ HOVER: DOM.select('.hover').events('click') })
    App.model = {
      ROUTE: (s, route) => ({ ...s, route }),
      HOVER: { ROUTER: () => ({ prefetch: 'task', params: { id: 7 } }) },
    }
    app = run(App, { ROUTER: router.driver, HTTP: makeFetchDriver({ cache }) }, { mountPoint: '#root' })
    await waitFor(() => expect(document.querySelector('.hover')).toBeTruthy())
    document.querySelector('.hover').click()
    await waitFor(() => expect(srv.paths()).toEqual(['/api/tasks/7']))
    expect(window.location.pathname).toBe('/')
    srv.respond(0, { title: 'Seven' })
    await waitFor(() => expect(cache.dehydrate()).toHaveLength(1))
    document.querySelector('.to-7').click()
    await waitFor(() => expect(text('.task')).toBe('success:Seven'))
    await sleep(20)
    expect(srv.fn).toHaveBeenCalledTimes(1)
  })
})

describe('SYG635: caching asked for without a queryCache', () => {
  beforeEach(() => setupChecks())

  it('cache: true / staleTime / { prefetch } without a queryCache warn once each; with one, nothing', async () => {
    const C = prefetcher()
    C.resources = { quote: (s) => ({ url: `/api/quotes/${s.id}`, staleTime: 1000 }) }
    C.model = { ...C.model, NEXT: { HTTP: () => ({ url: '/api/x', cache: true, ok: 'GOT' }) }, GOT: (s) => s }
    app = run(C, { HTTP: makeFetchDriver() }, { mountPoint: '#root', diagnostics: 'collect' })
    await settle(20)
    document.querySelector('.warm').click()
    document.querySelector('.next').click()
    await settle(20)
    const found = diagnostics('SYG635')
    expect(found.map(d => d.data.what).sort()).toEqual(['cache: true', 'staleTime', '{ prefetch }'])
    expect(found[0].severity).toBe('warn')
    expect(found[0].fix).toContain('queryCache(')
    app.dispose()
    _resetDiagnostics()
    setupChecks()
    document.body.innerHTML = '<div id="root"></div>'
    app = run(C, { HTTP: makeFetchDriver({ cache: queryCache() }) }, { mountPoint: '#root', diagnostics: 'collect' })
    await settle(20)
    document.querySelector('.warm').click()
    document.querySelector('.next').click()
    await settle(20)
    expect(diagnostics('SYG635')).toEqual([])
  })
})
