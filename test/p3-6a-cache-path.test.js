// @vitest-environment jsdom
// PLAN-3 6-A (G-184): the path from a task to queryCache.
// - `updates` on a request (the setQueryData analogue): on a 2xx, the reply is written into the
//   sender's named resources (and their cache entries) at once; an older read in flight for them
//   is aborted; `invalidates` then refetches them keeping the written data.
// - invalidation aborts older in-flight reads: resources (with and without a queryCache) and
//   shared cache fetches (an older fetch never writes the cache).
// - the list/detail + save recipe of SKILL.md, under run() and renderComponent.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { queryCache } from '../src/extra/queryCache.js'
import { renderComponent } from '../src/extra/testing.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { waitFor, textOf, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const pathOf = (u) => new URL(String(u), 'http://localhost').pathname

/** every fetch stays pending until answered; aborts reject like a browser */
function server() {
  const requests = []
  const fn = vi.fn((input, init) => new Promise((resolve, reject) => {
    const r = { path: pathOf(input), method: (init?.method || 'GET').toUpperCase(), body: init?.body, resolve, reject, settled: false }
    requests.push(r)
    init?.signal?.addEventListener('abort', () => {
      if (r.settled) return
      r.settled = r.aborted = true
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
  }))
  const idx = (method, path) => requests.flatMap((r, i) => (r.method === method && r.path === path ? [i] : []))
  const settle = (i, how) => {
    const r = requests[i]
    if (!r) throw new Error(`no request #${i} (${requests.length} sent)`)
    if (r.settled) return
    r.settled = true
    how(r)
  }
  return {
    fn, requests,
    sent: () => requests.map((r) => `${r.method} ${r.path}`),
    last: (method, path) => idx(method, path).at(-1) ?? -1,
    count: (method, path) => idx(method, path).length,
    respond: (i, body) => settle(i, (r) => r.resolve(jsonResponse(body))),
    fail: (i, s = 500) => settle(i, (r) => r.resolve(jsonResponse({ error: 'x' }, s))),
  }
}

let srv, app, t
beforeEach(() => {
  srv = server()
  vi.stubGlobal('fetch', srv.fn)
  document.body.innerHTML = '<div id="root"></div>'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  try { t?.dispose() } catch (_) {}
  app = t = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  _resetDiagnostics()
})
const start = (App, options) => (app = run(App, { HTTP: makeFetchDriver(options) }, { mountPoint: '#root' }))
const text = (sel) => { const el = document.querySelector(sel); return el ? textOf(el) : '' }
const click = async (sel) => { document.querySelector(sel).click(); await sleep(10) }

// ---- the recipe (SKILL.md "List/detail + save"), with h() instead of JSX ----
const ITEMS = [{ id: 1, title: 'Alpha' }, { id: 2, title: 'Beta' }]
const ITEM1 = { id: 1, title: 'Alpha', body: 'One.' }
const statusOf = (r) => (r?.status === 'loading' ? 'Loading…' : r?.refreshing ? 'Updating…' : '')

function makeApp(save = {}) {
  function App({ state }) {
    const item = state.item?.data
    return state.view === 'list'
      ? h('section', { className: 'list' },
        h('p', { className: 'status' }, statusOf(state.items)),
        h('ul', { className: 'items' }, ...(state.items?.data ?? []).map((i) =>
          h('li', null, h('button', { className: 'open', attrs: { 'data-id': String(i.id) } }, i.title)))))
      : h('section', { className: 'detail' },
        h('button', { className: 'back' }, 'Back'),
        h('p', { className: 'status' }, statusOf(state.item)),
        h('h2', { className: 'item-title' }, item ? item.title : ''),
        h('button', { className: 'save' }, 'Save'),
        h('p', { className: 'save-error' }, state.saveError))
  }
  App.initialState = { view: 'list', id: null, draft: '', saveError: '' }
  // declared only while shown; staleTime on the request, so main.js and the test can't disagree
  App.resources = {
    items: (s) => s.view === 'list' && { url: '/api/items', staleTime: 2000 },
    item: (s) => s.view === 'detail' && { url: `/api/items/${s.id}`, staleTime: 2000 },
  }
  App.intent = ({ DOM }) => ({
    OPEN: DOM.click('.open').map((e) => Number(e.target.dataset.id)),
    BACK: DOM.click('.back'),
    SAVE: DOM.click('.save'),
  })
  App.model = {
    OPEN: (s, id) => ({ ...s, view: 'detail', id, draft: 'Renamed' }),
    BACK: (s) => ({ ...s, view: 'list' }),
    SAVE: {
      STATE: (s) => ({ ...s, saveError: '' }),
      HTTP: (s) => ({
        url: `/api/items/${s.id}`, method: 'PUT', json: { title: s.draft }, ok: 'SAVED', error: 'SAVE_FAILED',
        updates: 'item', invalidates: '/api/items', ...save,
      }),
    },
    SAVED: (s, reply) => ({ ...s, savedReply: reply }),
    SAVE_FAILED: (s) => ({ ...s, saveError: 'Could not save.' }),
  }
  return App
}

async function openItem1(App, options = { cache: queryCache() }) {
  start(App, options)
  await waitFor(() => expect(srv.sent()).toEqual(['GET /api/items']))
  srv.respond(0, ITEMS)
  await waitFor(() => expect(text('.items')).toBe('Alpha Beta'))
  await click('.open[data-id="1"]')
  await waitFor(() => expect(srv.count('GET', '/api/items/1')).toBe(1))
  srv.respond(srv.last('GET', '/api/items/1'), ITEM1)
  await waitFor(() => expect(text('.item-title')).toBe('Alpha'))
}

describe('updates: the reply written into a resource (setQueryData analogue)', () => {
  for (const [label, options] of [['with a queryCache', { cache: queryCache() }], ['without a cache', {}]]) {
    it(`${label}: the mounted resource shows the reply at once, and the ok action still gets it`, async () => {
      const App = makeApp({ invalidates: undefined })
      await openItem1(App, options)
      await click('.save')
      const put = srv.last('PUT', '/api/items/1')
      expect(JSON.parse(srv.requests[put].body)).toEqual({ title: 'Renamed' })
      srv.respond(put, { ...ITEM1, title: 'Renamed' })
      await waitFor(() => expect(text('.item-title')).toBe('Renamed'))
      expect(text('.status')).toBe('')
      await sleep(20)
      expect(srv.count('GET', '/api/items/1')).toBe(1)   // no invalidates: no refetch
    })
  }

  it('with invalidates: written first, then refetched keeping the written data (refreshing), and the refetch wins', async () => {
    await openItem1(makeApp())
    await click('.save')
    srv.respond(srv.last('PUT', '/api/items/1'), { ...ITEM1, title: 'Renamed' })
    await waitFor(() => expect(text('.item-title')).toBe('Renamed'))
    await waitFor(() => expect(srv.count('GET', '/api/items/1')).toBe(2))
    expect(text('.status')).toBe('Updating…')
    expect(text('.item-title')).toBe('Renamed')
    srv.respond(srv.last('GET', '/api/items/1'), { ...ITEM1, title: 'Renamed (server)' })
    await waitFor(() => expect(text('.item-title')).toBe('Renamed (server)'))
    expect(text('.status')).toBe('')
  })

  it('writes the cache entry: shown again while fresh, the written value with no request', async () => {
    await openItem1(makeApp({ invalidates: undefined }))
    await click('.save')
    srv.respond(srv.last('PUT', '/api/items/1'), { ...ITEM1, title: 'Renamed' })
    await waitFor(() => expect(text('.item-title')).toBe('Renamed'))
    await click('.back')
    await click('.open[data-id="1"]')
    expect(text('.item-title')).toBe('Renamed')
    expect(text('.status')).toBe('')
    await sleep(20)
    expect(srv.count('GET', '/api/items/1')).toBe(1)
  })

  it('aborts an older read of that resource in flight: its late reply never shows', async () => {
    const App = makeApp({ invalidates: undefined })
    App.model.REFRESH = { HTTP: { refresh: 'item' } }
    const intent = App.intent
    App.intent = (s) => ({ ...intent(s), REFRESH: s.DOM.click('.item-title') })
    await openItem1(App, {})
    await click('.item-title')                              // a refetch starts (before the save)
    await waitFor(() => expect(srv.count('GET', '/api/items/1')).toBe(2))
    const before = srv.last('GET', '/api/items/1')
    await click('.save')
    srv.respond(srv.last('PUT', '/api/items/1'), { ...ITEM1, title: 'Renamed' })
    await waitFor(() => expect(text('.item-title')).toBe('Renamed'))
    expect(srv.requests[before].aborted).toBe(true)
    srv.respond(before, ITEM1)
    await sleep(30)
    expect(text('.item-title')).toBe('Renamed')
    expect(text('.status')).toBe('')
  })

  it('a function per name gets (current data, reply); a failed write updates nothing', async () => {
    function Both({ state }) {
      return h('div', null,
        h('p', { className: 'list' }, (state.items?.data ?? []).map((i) => i.title).join(',')),
        h('p', { className: 'one' }, state.item?.data?.title ?? ''),
        h('button', { className: 'save' }, 'Save'))
    }
    Both.initialState = {}
    Both.resources = { items: () => '/api/items', item: () => '/api/items/1' }
    Both.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
    Both.model = {
      SAVE: { HTTP: () => ({
        url: '/api/items/1', method: 'PUT', json: { title: 'New' }, ok: 'SAVED', error: 'FAILED',
        updates: { item: true, items: (list, saved) => list.map((i) => (i.id === saved.id ? { ...i, title: saved.title } : i)) },
      }) },
      SAVED: (s) => s,
      FAILED: (s) => s,
    }
    start(Both, { cache: queryCache() })
    await waitFor(() => expect(srv.requests).toHaveLength(2))
    srv.respond(srv.last('GET', '/api/items'), ITEMS)
    srv.respond(srv.last('GET', '/api/items/1'), ITEM1)
    await waitFor(() => expect(text('.list')).toBe('Alpha,Beta'))
    await click('.save')
    srv.fail(srv.last('PUT', '/api/items/1'))
    await sleep(20)
    expect(text('.list')).toBe('Alpha,Beta')
    await click('.save')
    srv.respond(srv.last('PUT', '/api/items/1'), { ...ITEM1, title: 'New' })
    await waitFor(() => expect(text('.list')).toBe('New,Beta'))
    expect(text('.one')).toBe('New')
  })

  it('other mounted resources reading the same cache entry update too', async () => {
    function Viewer({ state }) { return h('p', { className: 'viewer' }, state.item?.data?.title ?? '') }
    Viewer.resources = { item: () => '/api/items/1' }

    function Editor({ state }) {
      return h('div', null, h('p', { className: 'editor' }, state.item?.data?.title ?? ''), h('button', { className: 'save' }, 'Save'))
    }
    Editor.resources = { item: () => '/api/items/1' }

    Editor.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
    Editor.model = { SAVE: { HTTP: () => ({ url: '/api/items/1', method: 'PUT', json: { title: 'New' }, updates: 'item' }) } }
    function Root() { return h('div', null, h(Viewer, { state: 'viewer' }), h(Editor, { state: 'editor' })) }
    Root.initialState = { viewer: {}, editor: {} }
    start(Root, { cache: queryCache() })
    await waitFor(() => expect(srv.count('GET', '/api/items/1')).toBe(1))   // de-duplicated
    srv.respond(0, ITEM1)
    await waitFor(() => expect(text('.viewer')).toBe('Alpha'))
    await click('.save')
    srv.respond(srv.last('PUT', '/api/items/1'), { ...ITEM1, title: 'New' })
    await waitFor(() => expect(text('.editor')).toBe('New'))
    await waitFor(() => expect(text('.viewer')).toBe('New'))
  })
})

describe('invalidation aborts older in-flight reads', () => {
  for (const [label, options] of [['with a queryCache', { cache: queryCache() }], ['without a cache', {}]]) {
    it(`${label}: a read in flight before the save never overwrites (task 24 "stale overwrite")`, async () => {
      const App = makeApp({ updates: undefined })
      App.model.REFRESH = { HTTP: { refresh: 'item' } }
      const intent = App.intent
      App.intent = (s) => ({ ...intent(s), REFRESH: s.DOM.click('.item-title') })
      await openItem1(App, options)
      await click('.item-title')
      await waitFor(() => expect(srv.count('GET', '/api/items/1')).toBe(2))
      const before = srv.last('GET', '/api/items/1')
      await click('.save')
      srv.respond(srv.last('PUT', '/api/items/1'), { ...ITEM1, title: 'Renamed' })
      await waitFor(() => expect(srv.count('GET', '/api/items/1')).toBe(3))
      expect(srv.requests[before].aborted).toBe(true)
      srv.respond(before, ITEM1)
      srv.respond(srv.last('GET', '/api/items/1'), { ...ITEM1, title: 'Renamed' })
      await waitFor(() => expect(text('.item-title')).toBe('Renamed'))
      await sleep(20)
      expect(text('.item-title')).toBe('Renamed')
    })
  }

  it('a shared cache fetch started before the invalidation never writes the cache', async () => {
    const cache = queryCache({ staleTime: 60000 })
    function P({ state }) { return h('div', null, h('p', { className: 'v' }, state.item?.data?.title ?? ''), h('button', { className: 'go' }, 'go'), h('button', { className: 'inv' }, 'inv')) }
    P.initialState = { show: false }
    P.resources = { item: (s) => s.show && '/api/items/1' }
    P.intent = ({ DOM }) => ({ GO: DOM.click('.go'), INV: DOM.click('.inv') })
    P.model = {
      INV: { HTTP: () => ({ invalidate: '/api/items' }) },
      GO: (s) => ({ ...s, show: true }),
    }
    start(P, { cache })
    await waitFor(() => expect(document.querySelector('.inv')).not.toBeNull())
    cache.prefetch('/api/items/1')                     // in flight, wanted by no resource
    await waitFor(() => expect(srv.requests).toHaveLength(1))
    await click('.inv')                                 // the entry is invalidated while it is in flight
    await click('.go')                                  // the resource must not join the older fetch
    await waitFor(() => expect(srv.requests).toHaveLength(2))
    srv.respond(1, { ...ITEM1, title: 'New' })
    await waitFor(() => expect(text('.v')).toBe('New'))
    srv.respond(0, ITEM1)                               // the older fetch answers last
    await sleep(20)
    expect(cache.list()[0].data.title).toBe('New')
    expect(text('.v')).toBe('New')
  })
})

describe('the recipe in app and test', () => {
  it('run(): loading, cache hit while fresh, save shows the new title at once, list refetched with Updating…', async () => {
    await openItem1(makeApp())
    await click('.back')                                // fresh list: from the cache, no request
    expect(text('.items')).toBe('Alpha Beta')
    expect(text('.status')).toBe('')
    expect(srv.count('GET', '/api/items')).toBe(1)
    await click('.open[data-id="1"]')
    expect(text('.item-title')).toBe('Alpha')
    await click('.save')
    srv.respond(srv.last('PUT', '/api/items/1'), { ...ITEM1, title: 'Renamed' })
    await waitFor(() => expect(text('.item-title')).toBe('Renamed'))
    expect(text('.status')).toBe('Updating…')
    srv.respond(srv.last('GET', '/api/items/1'), { ...ITEM1, title: 'Renamed' })
    await waitFor(() => expect(text('.status')).toBe(''))
    await click('.back')                                // the list was invalidated: shown, and refetched
    expect(text('.items')).toBe('Alpha Beta')
    await waitFor(() => expect(srv.count('GET', '/api/items')).toBe(2))
    expect(text('.status')).toBe('Updating…')
    srv.respond(srv.last('GET', '/api/items'), [{ id: 1, title: 'Renamed' }, ITEMS[1]])
    await waitFor(() => expect(text('.items')).toBe('Renamed Beta'))
  })

  it('renderComponent with { http: { cache: queryCache() } }: the same behaviour', async () => {
    t = renderComponent(makeApp(), { http: { cache: queryCache() } })
    await t.respond('HTTP', ITEMS, 'items')
    t.simulateAction('OPEN', 1)
    await t.respond('HTTP', ITEM1, 'item')
    t.simulateAction('BACK')
    await t.waitForState((s) => s.view === 'list')
    expect(t.state.items).toMatchObject({ status: 'success', data: ITEMS })
    t.simulateAction('OPEN', 1)
    await t.waitForState((s) => s.item?.status === 'success')
    expect(t.requests('HTTP').filter((r) => r.resource === 'item')).toHaveLength(1)
    t.simulateAction('SAVE')
    // G-189: the PUT leaves two microtasks after the action (G-158); t.respond waits for it
    await t.respond('HTTP', { ...ITEM1, title: 'Renamed' }, 'SAVED')
    expect(t.state.item).toMatchObject({ status: 'success', data: { title: 'Renamed' }, refreshing: true })
    expect(t.state.savedReply).toEqual({ ...ITEM1, title: 'Renamed' })
    await t.respond('HTTP', { ...ITEM1, title: 'Renamed' }, 'item')
    expect(t.state.item.refreshing).toBeFalsy()
  })

  it('renderComponent without a cache: SYG635 names the missing queryCache (staleTime is on the resource)', async () => {
    setupChecks()
    t = renderComponent(makeApp())
    await t.respond('HTTP', ITEMS, 'items')
    expect(diagnostics('SYG635').map((d) => d.data.what)).toEqual(['staleTime'])
    expect(() => t.expectNoDiagnostics()).toThrow(/queryCache/)
  })
})

describe('guides shipped in the package (offline)', () => {
  it('dist/guide/{resources,http}.md are built and current with the docs', async () => {
    const { copyGuides } = await import('../scripts/copy-guides.mjs')
    expect(copyGuides({ check: true })).toBe(0)
  })

  it('site links become relative (shipped pages) or absolute (the rest)', async () => {
    const { convert } = await import('../scripts/copy-guides.mjs')
    const md = '---\ntitle: HTTP\ndescription: x\n---\nSee [cache](/guide/resources/#the-query-cache), [errors](/reference/errors/#syg635) and [router](/guide/router/).'
    expect(convert(md)).toContain('# HTTP\nSee [cache](./resources.md#the-query-cache), [errors](https://sygnal.js.org/reference/errors/#syg635) and [router](https://sygnal.js.org/guide/router/).')
  })

  it('the skill and llms.txt point at the shipped paths, and the package ships dist', async () => {
    const fs = await import('node:fs')
    const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
    const skill = read('../skills/sygnal-dev/SKILL.md')
    const llms = read('../llms.txt')
    for (const text of [skill, llms]) expect(text).toContain('node_modules/sygnal/dist/guide/resources.md')
    expect(llms).toContain('node_modules/sygnal/dist/guide/http.md')
    expect(JSON.parse(read('../package.json')).files).toContain('dist')
  })
})
