// @vitest-environment jsdom
// Sift friction (7.2): bulk cache reset, React Query's resetQueries / clear. `{ reset }` on the
// HTTP sink (true, a tag, tags, a '/url-prefix' or a predicate, matched like `invalidate`) drops
// the matching cache entries and resets the matching resources: mounted ones go back to
// 'loading' with no data and no error and refetch, paused ones lose their kept result ('idle').
// `queryCache().clear()` drops every entry and leaves the resources alone.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable } from '../src/switchable.js'
import { renderComponent } from '../src/extra/testing.js'
import { queryCache } from '../src/extra/queryCache.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.restoreAllMocks()
  _resetDiagnostics()
})

// two resources: `me` (tagged 'session') and `news` (untagged)
const App = () => {
  const C = ({ state }) => h('p', null, `${state.me.status}:${state.me.data?.name ?? ''}|${state.news.status}:${state.news.data?.n ?? ''}`)
  C.initialState = {}
  C.resources = {
    me: () => ({ url: '/api/me', tags: ['session'] }),
    news: () => '/api/news',
  }
  C.model = {
    LOGOUT: { HTTP: () => ({ reset: true }) },
    RESET_SESSION: { HTTP: () => ({ reset: 'session' }) },
    RESET_PREFIX: { HTTP: () => ({ reset: '/api/news' }) },
    RESET_FN: { HTTP: () => ({ reset: (r) => r.url === '/api/me' }) },
    REFRESH: { HTTP: () => ({ refresh: ['me', 'news'] }) },
  }
  return C
}
const loaded = async () => {
  await t.respond('HTTP', { name: 'ann' }, 'me')
  await t.respond('HTTP', { n: 1 }, 'news')
  expect(t.html()).toContain('success:ann|success:1')
}
const fetches = (url) => t.requests('HTTP').filter(r => r.url === url).length

describe('{ reset } without a cache', () => {
  it('reset: true puts every mounted resource back to loading with no data, then refetches', async () => {
    t = renderComponent(App())
    await loaded()
    await t.simulateAction('LOGOUT')
    expect(t.state.me).toMatchObject({ status: 'loading' })
    expect(t.state.me.data).toBeUndefined()
    expect(t.state.me.refreshing).toBeFalsy()
    expect(t.state.news.status).toBe('loading')
    expect(fetches('/api/me')).toBe(2)
    expect(fetches('/api/news')).toBe(2)
    await t.respond('HTTP', { name: 'guest' }, 'me')
    expect(t.state.me).toMatchObject({ status: 'success', data: { name: 'guest' } })
  })

  it('clears an error too', async () => {
    t = renderComponent(App())
    await t.fail('HTTP', 401, 'me')
    expect(t.state.me.status).toBe('error')
    await t.simulateAction('LOGOUT')
    expect(t.state.me.status).toBe('loading')
    expect(t.state.me.error).toBeUndefined()
  })

  it('a tag, a URL prefix or a predicate resets only what it matches', async () => {
    t = renderComponent(App())
    await loaded()
    await t.simulateAction('RESET_SESSION')
    expect(t.state.me.status).toBe('loading')
    expect(t.state.news).toMatchObject({ status: 'success', data: { n: 1 } })
    await t.respond('HTTP', { name: 'ann' }, 'me')
    await t.simulateAction('RESET_PREFIX')
    expect(t.state.me).toMatchObject({ status: 'success', data: { name: 'ann' } })
    expect(t.state.news.status).toBe('loading')
    await t.respond('HTTP', { n: 2 }, 'news')
    await t.simulateAction('RESET_FN')
    expect(t.state.me.status).toBe('loading')
    expect(t.state.news).toMatchObject({ status: 'success', data: { n: 2 } })
  })

  it('a reply to the read in flight before the reset never lands', async () => {
    t = renderComponent(App())
    await loaded()
    await t.simulateAction('REFRESH')
    expect(t.state.me.refreshing).toBe(true)
    await t.simulateAction('LOGOUT')
    // the refresh was aborted: only the reset's fetch is pending
    expect(() => t.respond('HTTP', { name: 'old' }, { nth: 1 })).toThrow(/not pending/)
    await t.respond('HTTP', { name: 'new' }, 'me')
    expect(t.state.me).toMatchObject({ status: 'success', data: { name: 'new' } })
  })

  it('is not listed in t.requests', async () => {
    t = renderComponent(App())
    await loaded()
    await t.simulateAction('LOGOUT')
    expect(t.requests('HTTP').some(r => 'reset' in r)).toBe(false)
  })
})

describe('{ reset } with a queryCache', () => {
  it('drops the entries: the refetch shows loading, not the cached data', async () => {
    const cache = queryCache({ gcTime: Infinity })
    t = renderComponent(App(), { http: { cache } })
    await loaded()
    cache.set('/api/other', { x: 1 })
    expect(cache.dehydrate().map(e => e.key).sort()).toEqual(['GET /api/me', 'GET /api/news', 'GET /api/other'])
    await t.simulateAction('LOGOUT')
    expect(t.state.me).toMatchObject({ status: 'loading' })
    expect(t.state.me.data).toBeUndefined()
    expect(cache.dehydrate()).toEqual([])
    // the mounted resources' entries stay subscribed (no data); the unused one is gone
    expect(t.cache('HTTP').map(e => [e.key, e.subscribers, e.data])).toEqual([['GET /api/me', 1, undefined], ['GET /api/news', 1, undefined]])
    await t.respond('HTTP', { name: 'guest' }, 'me')
    expect(t.cache('HTTP').find(e => e.key == 'GET /api/me')).toMatchObject({ data: { name: 'guest' }, subscribers: 1 })
  })

  it('a tag drops only the matching entries', async () => {
    const cache = queryCache()
    t = renderComponent(App(), { http: { cache } })
    await loaded()
    await t.simulateAction('RESET_SESSION')
    expect(t.state.me.status).toBe('loading')
    expect(cache.dehydrate().map(e => e.key)).toEqual(['GET /api/news'])
  })

  it('a fresh entry is not served after a reset: the resource refetches', async () => {
    const cache = queryCache({ staleTime: 60000 })
    t = renderComponent(App(), { http: { cache } })
    await loaded()
    await t.simulateAction('LOGOUT')
    expect(fetches('/api/me')).toBe(2)
    expect(t.state.me.status).toBe('loading')
  })
})

describe('{ reset } on a paused resource', () => {
  function Page({ state }) { return h('section', null, `${state.info.status}:${state.info.data?.v ?? ''}`) }
  Page.resources = { info: () => '/api/info' }
  Page.model = { NOOP: (s) => s }
  function Other() { return h('section', null, 'other') }
  function Pages({ state }) { return h('main', null, h(Switchable, { of: { info: Page, other: Other }, current: state.page })) }
  Pages.initialState = { page: 'info', info: { status: 'idle' } }
  Pages.model = {
    INFO: (s) => ({ ...s, page: 'info' }),
    OTHER: (s) => ({ ...s, page: 'other' }),
    LOGOUT: { HTTP: () => ({ reset: true }) },
  }

  it('loses its kept result (idle) and loads anew when shown', async () => {
    t = renderComponent(Pages)
    await t.respond('HTTP', { v: 'secret' }, 'info')
    await t.simulateAction('OTHER')
    expect(t.state.info).toMatchObject({ status: 'success', data: { v: 'secret' } })
    await t.simulateAction('LOGOUT')
    expect(t.state.info.status).toBe('idle')
    expect(t.state.info.data).toBeUndefined()
    expect(t.requests('HTTP')).toHaveLength(1)
    await t.simulateAction('INFO')
    expect(t.state.info.status).toBe('loading')
    expect(t.requests('HTTP')).toHaveLength(2)
  })
})

describe('queryCache().clear()', () => {
  it('drops every entry and leaves the mounted resources as they are', async () => {
    const cache = queryCache({ gcTime: Infinity })
    t = renderComponent(App(), { http: { cache } })
    await loaded()
    cache.set('/api/other', { x: 1 })
    cache.clear()
    expect(cache.dehydrate()).toEqual([])
    expect(t.state.me).toMatchObject({ status: 'success', data: { name: 'ann' } })
    expect(t.state.news).toMatchObject({ status: 'success', data: { n: 1 } })
    // a refetch writes the entry again, still counted as used by its resource
    await t.simulateAction('REFRESH')
    expect(t.state.me).toMatchObject({ status: 'success', data: { name: 'ann' }, refreshing: true })
    await t.respond('HTTP', { name: 'bob' }, 'me')
    expect(t.cache('HTTP').find(e => e.key == 'GET /api/me')).toMatchObject({ data: { name: 'bob' }, subscribers: 1 })
  })

  it('a shared fetch in flight never writes the cleared cache', async () => {
    const cache = queryCache()
    t = renderComponent(App(), { http: { cache } })
    await t.waitForState((s) => s.me?.status === 'loading')
    expect(t.requests('HTTP')).toHaveLength(2)
    cache.clear()
    await t.respond('HTTP', { name: 'ann' }, 'me')
    expect(t.state.me).toMatchObject({ status: 'success', data: { name: 'ann' } })
    expect(cache.dehydrate().find(e => e.key == 'GET /api/me')).toBeUndefined()
  })
})
