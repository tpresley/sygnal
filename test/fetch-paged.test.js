// @vitest-environment jsdom
// Paged resources (TanStack Query's useInfiniteQuery): a resource whose `url` is a function of the
// cursor owns its pages (`data: { pages, cursors }`, `hasMore`, `hasPrevious`, `loadingMore`);
// `{ more: name }` loads one more page; a refetch reloads the loaded pages from the first cursor.
// The old recipe (an `ok` action appending pages) failed three ways, covered here: (a) a refetch
// of the last page appended at the tail, (b) a cached revisit came back empty, (c) an
// invalidation never re-derived the pages from the head.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable } from '../src/switchable.js'
import { queryCache } from '../src/extra/queryCache.js'
import { renderComponent } from '../src/extra/testing.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

const page = (items, next, prev) => ({ items, next, prev })
const after = (r) => r.query.after

/** a feed over a cursor API: `{ items, next }`; `extra` adds to the paged spec */
function feed(extra = {}) {
  function Feed({ state }) { return h('ul', null, ...(state.feed.data?.pages ?? []).flatMap(p => p.items).map(i => h('li', null, i))) }
  Feed.initialState = { q: '', on: true }
  Feed.resources = {
    feed: (s) => s.on && {
      url: (cursor) => ({ url: '/api/feed', query: { after: cursor, q: s.q } }),
      next: (last) => last.next,
      tags: ['feed'],
      ...extra,
    },
  }
  Feed.model = {
    MORE: { HTTP: () => ({ more: 'feed' }) },
    BACK: { HTTP: () => ({ more: 'feed', previous: true }) },
    REFRESH: { HTTP: () => ({ refresh: 'feed' }) },
    RESET: { HTTP: () => ({ reset: 'feed' }) },
    SAVE: { HTTP: () => ({ url: '/api/feed', method: 'POST', json: {}, ok: 'SAVED', error: 'SAVE_FAILED', invalidates: ['feed'], invalidateOn: 'settled' }) },
    SAVED: (s) => s,
    SAVE_FAILED: (s) => s,
    FILTER: (s, q) => ({ ...s, q }),
    TOGGLE: (s) => ({ ...s, on: !s.on }),
  }
  return Feed
}
const reqs = () => t.requests('HTTP').filter(r => r.resource === 'feed')
/** two pages loaded: a, b | c, d (no more) */
async function twoPages(extra, options) {
  t = renderComponent(feed(extra), options)
  await t.waitForState(s => s.feed.status === 'loading')
  await t.respond('HTTP', page(['a', 'b'], 'c2'), 'feed')
  t.simulateAction('MORE')
  await t.waitForState(s => s.feed.loadingMore === 'next')
  await t.respond('HTTP', page(['c', 'd']), 'feed')
  await t.waitForState(s => s.feed.data.pages.length === 2)
}

describe('paged resources', () => {
  it('the first page: data { pages, cursors }, hasMore; each page a request of the resource', async () => {
    t = renderComponent(feed())
    await t.waitForState(s => s.feed.status === 'loading')
    expect(t.state.feed).toMatchObject({ status: 'loading', hasMore: false, hasPrevious: false })
    expect(reqs()).toEqual([{ url: '/api/feed', query: { after: undefined, q: '' }, tags: ['feed'], resource: 'feed' }])
    await t.respond('HTTP', page(['a', 'b'], 'c2'), 'feed')
    expect(t.state.feed).toEqual({ status: 'success', data: { pages: [page(['a', 'b'], 'c2')], cursors: [undefined] }, hasMore: true, hasPrevious: false })
    expect(t.html()).toContain('<li>b</li>')
  })

  it('{ more }: the next page appended, loadingMore while it loads; ignored in flight and with no next cursor', async () => {
    t = renderComponent(feed())
    await t.waitForState(s => s.feed.status === 'loading')
    t.simulateAction('MORE')
    await t.respond('HTTP', page(['a', 'b'], 'c2'), 'feed')
    // (a `more` before any page is loaded did nothing)
    expect(reqs()).toHaveLength(1)
    t.simulateAction('MORE')
    await t.waitForState(s => s.feed.loadingMore === 'next')
    t.simulateAction('MORE')
    expect(reqs().map(after)).toEqual([undefined, 'c2'])
    expect(t.state.feed).toMatchObject({ status: 'success', refreshing: undefined, data: { pages: [{ items: ['a', 'b'] }] } })
    await t.respond('HTTP', page(['c', 'd']), 'feed')
    expect(t.state.feed).toMatchObject({ status: 'success', loadingMore: undefined, hasMore: false, data: { cursors: [undefined, 'c2'] } })
    expect(t.state.feed.data.pages.map(p => p.items)).toEqual([['a', 'b'], ['c', 'd']])
    t.simulateAction('MORE')
    await t.settle()
    expect(reqs()).toHaveLength(2)
    // { more } is a command, not a request
    expect(t.requests('HTTP')).toHaveLength(2)
    expect(t.sinkValues('HTTP').filter(v => v.more)).toHaveLength(4)
  })

  it('(a) a refetch reloads the pages from the first, each cursor from the fresh page before it, written once', async () => {
    await twoPages()
    t.simulateAction('REFRESH')
    await t.waitForState(s => s.feed.refreshing)
    await t.respond('HTTP', page(['new', 'a'], 'c2b'), 'feed')
    // the second page is asked after the fresh first page's cursor; the old pages still shown
    expect(reqs().map(after)).toEqual([undefined, 'c2', undefined, 'c2b'])
    expect(t.state.feed).toMatchObject({ refreshing: true, data: { pages: [{ items: ['a', 'b'] }, { items: ['c', 'd'] }] } })
    await t.respond('HTTP', page(['b', 'c'], 'c3'), 'feed')
    expect(t.state.feed).toMatchObject({ status: 'success', refreshing: undefined, hasMore: true, data: { cursors: [undefined, 'c2b'] } })
    expect(t.state.feed.data.pages.map(p => p.items)).toEqual([['new', 'a'], ['b', 'c']])
  })

  it('a refetch stops early when a cursor comes back empty', async () => {
    await twoPages()
    t.simulateAction('REFRESH')
    await t.waitForState(s => s.feed.refreshing)
    await t.respond('HTTP', page(['only']), 'feed')
    expect(t.state.feed).toMatchObject({ status: 'success', hasMore: false, data: { pages: [{ items: ['only'] }], cursors: [undefined] } })
    expect(reqs()).toHaveLength(3)
  })

  it('(b) a cached revisit shows the cached pages at once (success + refreshing), then refetches them', async () => {
    await twoPages({}, { http: { cache: queryCache() } })
    t.simulateAction('TOGGLE')
    await t.waitForState(s => s.feed.status === 'idle')
    t.simulateAction('TOGGLE')
    await t.waitForState(s => s.feed.refreshing)
    expect(t.state.feed).toMatchObject({ status: 'success', refreshing: true, hasMore: false })
    expect(t.state.feed.data.pages.map(p => p.items)).toEqual([['a', 'b'], ['c', 'd']])
    await t.respond('HTTP', page(['a', 'b'], 'c2'), 'feed')
    await t.respond('HTTP', page(['c', 'd', 'e']), 'feed')
    expect(t.state.feed.data.pages.map(p => p.items)).toEqual([['a', 'b'], ['c', 'd', 'e']])
    expect(t.cache('HTTP').find(e => e.key.endsWith(' pages'))).toMatchObject({ key: 'GET /api/feed?q= pages', data: t.state.feed.data })
  })

  it('a fresh cached entry (staleTime) is shown with no request', async () => {
    await twoPages({ staleTime: 60000 }, { http: { cache: queryCache() } })
    t.simulateAction('TOGGLE')
    t.simulateAction('TOGGLE')
    await t.waitForState(s => s.feed.status === 'success')
    await t.settle()
    expect(t.state.feed.data.pages).toHaveLength(2)
    expect(t.state.feed.refreshing).toBeUndefined()
    expect(reqs()).toHaveLength(2)
  })

  it('(c) an invalidation refetches every loaded page from the head; invalidateOn: settled after a failed write too', async () => {
    await twoPages()
    t.simulateAction('SAVE')
    await t.respond('HTTP', { ok: true }, 'SAVED')
    await t.waitForState(s => s.feed.refreshing)
    await t.respond('HTTP', page(['new', 'a'], 'c2b'), 'feed')
    await t.respond('HTTP', page(['b', 'c']), 'feed')
    expect(t.state.feed.data.pages.map(p => p.items)).toEqual([['new', 'a'], ['b', 'c']])
    t.simulateAction('SAVE')
    await t.fail('HTTP', 500, 'SAVE_FAILED')
    await t.waitForState(s => s.feed.refreshing)
    expect(reqs().map(after)).toEqual([undefined, 'c2', undefined, 'c2b', undefined])
  })

  it('{ reset } goes back to one page from the first cursor', async () => {
    await twoPages()
    t.simulateAction('RESET')
    await t.waitForState(s => s.feed.status === 'loading')
    expect(t.state.feed.data).toBeUndefined()
    await t.respond('HTTP', page(['x'], 'c2'), 'feed')
    expect(t.state.feed).toMatchObject({ status: 'success', hasMore: true, data: { pages: [{ items: ['x'] }], cursors: [undefined] } })
    expect(reqs()).toHaveLength(3)
  })

  it('an identity change (the first page\'s request) starts again at one page', async () => {
    await twoPages()
    t.simulateAction('FILTER', 'x')
    await t.waitForState(s => s.feed.status === 'loading')
    expect(t.state.feed.data).toBeUndefined()
    expect(reqs().at(-1).query).toEqual({ after: undefined, q: 'x' })
    await t.respond('HTTP', page(['x1'], 'c2'), 'feed')
    expect(t.state.feed.data).toEqual({ pages: [page(['x1'], 'c2')], cursors: [undefined] })
  })

  it('initialCursor; maxPages drops the oldest; previous loads before the first page', async () => {
    const extra = { initialCursor: 1, maxPages: 2, next: (p) => p.next, previous: (p) => p.prev }
    t = renderComponent(feed(extra))
    await t.waitForState(s => s.feed.status === 'loading')
    expect(reqs()[0].query.after).toBe(1)
    await t.respond('HTTP', page(['p1'], 2), 'feed')
    t.simulateAction('MORE')
    await t.respond('HTTP', page(['p2'], 3, 1), 'feed')
    t.simulateAction('MORE')
    await t.respond('HTTP', page(['p3'], undefined, 2), 'feed')
    expect(t.state.feed).toMatchObject({ hasMore: false, hasPrevious: true, data: { cursors: [2, 3] } })
    expect(t.state.feed.data.pages.map(p => p.items)).toEqual([['p2'], ['p3']])
    t.simulateAction('BACK')
    await t.waitForState(s => s.feed.loadingMore === 'previous')
    expect(reqs().at(-1).query.after).toBe(1)
    await t.respond('HTTP', page(['p1'], 2, null), 'feed')
    expect(t.state.feed).toMatchObject({ hasMore: true, hasPrevious: false, data: { cursors: [1, 2] } })
    expect(t.state.feed.data.pages.map(p => p.items)).toEqual([['p1'], ['p2']])
  })

  it('errors: a failed next page keeps the pages (more can try again); a failed refetch keeps the old pages', async () => {
    t = renderComponent(feed())
    await t.waitForState(s => s.feed.status === 'loading')
    await t.respond('HTTP', page(['a'], 'c2'), 'feed')
    t.simulateAction('MORE')
    await t.fail('HTTP', 500, 'feed')
    expect(t.state.feed).toMatchObject({ status: 'error', error: { status: 500 }, loadingMore: undefined, hasMore: true, data: { pages: [{ items: ['a'] }] } })
    t.simulateAction('MORE')
    await t.respond('HTTP', page(['b'], 'c3'), 'feed')
    expect(t.state.feed).toMatchObject({ status: 'success', error: undefined })
    expect(t.state.feed.data.pages.map(p => p.items)).toEqual([['a'], ['b']])
    t.simulateAction('REFRESH')
    await t.respond('HTTP', page(['a2'], 'c2'), 'feed')
    await t.fail('HTTP', 503, 'feed')
    expect(t.state.feed).toMatchObject({ status: 'error', error: { status: 503 }, refreshing: undefined })
    expect(t.state.feed.data.pages.map(p => p.items)).toEqual([['a'], ['b']])
  })

  it('a hidden page pauses it, keeping its pages; an invalidation while hidden fetches nothing; shown again it refetches, as a plain resource', async () => {
    const Feed = feed()
    function Other() { return h('p', null, 'other') }
    function App({ state }) { return h('div', null, h(Switchable, { of: { feed: Feed, other: Other }, current: state.tab })) }
    App.initialState = { tab: 'feed', q: '', on: true }
    App.model = { SHOW: (s, tab) => ({ ...s, tab }), INVAL: { HTTP: () => ({ invalidate: 'feed' }) } }
    t = renderComponent(App)
    await t.waitForState(s => s.feed?.status === 'loading')
    await t.respond('HTTP', page(['a'], 'c2'), 'feed')
    t.simulateAction('SHOW', 'other')
    await t.settle()
    t.simulateAction('INVAL')
    await t.settle()
    expect(reqs()).toHaveLength(1)
    expect(t.state.feed).toMatchObject({ status: 'success', data: { pages: [{ items: ['a'] }] } })
    t.simulateAction('SHOW', 'feed')
    await t.waitForState(s => s.feed.refreshing)
    expect(reqs()).toHaveLength(2)
    await t.respond('HTTP', page(['a', 'new']), 'feed')
    expect(t.state.feed.data.pages).toEqual([page(['a', 'new'])])
  })
})
