// @vitest-environment jsdom
// Sift friction (7.2): a resource's identity leaves out the fields that only change behaviour
// (refetchEvery, ok, error, keepPrevious, retry, staleTime, cache, tags, ...). Toggling
// `refetchEvery: s.live ? ms : undefined` used to be a new request: 'loading', data cleared and a
// refetch. Now the new request is taken over with no fetch and no status change, and the poll is
// rescheduled (or stopped).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { queryCache } from '../src/extra/queryCache.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'
import { until } from './support/wait.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.restoreAllMocks()
  _resetDiagnostics()
})

const live = (resource, initialState = { live: false, ms: 40, id: 1 }) => {
  const C = ({ state }) => h('p', null, `${state.q.status}:${state.q.data?.v ?? ''}`)
  C.initialState = initialState
  C.resources = { q: resource }
  C.model = {
    LIVE: (s) => ({ ...s, live: true }),
    OFF: (s) => ({ ...s, live: false }),
    FAST: (s) => ({ ...s, ms: 120 }),
    NEXT: (s) => ({ ...s, id: s.id + 1 }),
    RENAME: (s) => ({ ...s, renamed: true }),
    GOT: (s, v) => ({ ...s, got: v.v }),
    GOT2: (s, v) => ({ ...s, got2: v.v }),
  }
  return C
}
const polled = (s) => ({ url: `/api/q/${s.id}`, refetchEvery: s.live ? s.ms : undefined })
const fetches = () => t.requests('HTTP').length
const pending = () => t.requests('HTTP').at(-1)

describe('resource identity leaves out behaviour-only fields', () => {
  it('toggling refetchEvery on keeps the data and status, and starts polling without a fetch', async () => {
    t = renderComponent(live(polled))
    await t.respond('HTTP', { v: 'one' }, 'q')
    expect(t.state.q).toMatchObject({ status: 'success', data: { v: 'one' } })
    await t.simulateAction('LIVE')
    expect(t.state.q).toMatchObject({ status: 'success', data: { v: 'one' } })
    expect(t.state.q.refreshing).toBeFalsy()
    expect(fetches()).toBe(1)
    // the poll: a refetch that keeps the data
    await t.waitForState((s) => s.q.refreshing)
    expect(fetches()).toBe(2)
    expect(t.state.q).toMatchObject({ status: 'success', data: { v: 'one' } })
    await t.respond('HTTP', { v: 'two' }, 'q')
    expect(t.state.q).toMatchObject({ status: 'success', data: { v: 'two' } })
    await until(() => expect(fetches()).toBe(3))
    expect(t.state.q).toMatchObject({ status: 'success', data: { v: 'two' }, refreshing: true })
  })

  it('toggling refetchEvery off stops the poll, with no fetch and no status change', async () => {
    t = renderComponent(live(polled, { live: true, ms: 25, id: 1 }))
    await t.respond('HTTP', { v: 'one' }, 'q')
    await t.simulateAction('OFF')
    expect(t.state.q).toMatchObject({ status: 'success', data: { v: 'one' } })
    expect(t.state.q.refreshing).toBeFalsy()
    await sleep(80)
    expect(fetches()).toBe(1)
    expect(t.state.q.refreshing).toBeFalsy()
  })

  it('turned off while a poll is in flight: that refetch completes and no other follows', async () => {
    t = renderComponent(live(polled, { live: true, ms: 20, id: 1 }))
    await t.respond('HTTP', { v: 'one' }, 'q')
    await t.waitForState((s) => s.q.refreshing)
    await t.simulateAction('OFF')
    expect(t.state.q).toMatchObject({ status: 'success', refreshing: true })
    await t.respond('HTTP', { v: 'two' }, 'q')
    expect(t.state.q).toMatchObject({ status: 'success', data: { v: 'two' } })
    await sleep(60)
    expect(fetches()).toBe(2)
  })

  it('changing the interval reschedules the poll from now', async () => {
    t = renderComponent(live(polled, { live: true, ms: 10000, id: 1 }))
    await t.respond('HTTP', { v: 'one' }, 'q')
    await sleep(30)
    expect(fetches()).toBe(1)
    await t.simulateAction('FAST')
    expect(t.state.q).toMatchObject({ status: 'success', data: { v: 'one' } })
    expect(fetches()).toBe(1)
    await t.waitForState((s) => s.q.refreshing)
    expect(fetches()).toBe(2)
  })

  it('a change of what is fetched (the URL) is still a new request', async () => {
    t = renderComponent(live(polled, { live: true, ms: 10000, id: 1 }))
    await t.respond('HTTP', { v: 'one' }, 'q')
    await t.simulateAction('NEXT')
    expect(t.state.q.status).toBe('loading')
    expect(t.state.q.data).toBeUndefined()
    expect(pending().url).toBe('/api/q/2')
  })

  it('a new ok action is used for the next reply, without a fetch', async () => {
    t = renderComponent(live((s) => ({ url: '/api/q', ok: s.renamed ? 'GOT2' : 'GOT', refetchEvery: 150 }), {}))
    await t.respond('HTTP', { v: 'one' }, 'q')
    expect(t.state.got).toBe('one')
    await t.simulateAction('RENAME')
    expect(fetches()).toBe(1)
    await t.waitForState((s) => s.q.refreshing)
    await t.respond('HTTP', { v: 'two' }, 'q')
    expect(t.state).toMatchObject({ got: 'one', got2: 'two' })
  })

  it('with a queryCache: keepPrevious, staleTime and tags changes refetch nothing either', async () => {
    const C = live((s) => ({ url: '/api/q', keepPrevious: !!s.live, staleTime: s.live ? 1000 : 0, tags: s.live ? ['a'] : ['b'] }), { live: false })
    t = renderComponent(C, { http: { cache: queryCache() } })
    await t.respond('HTTP', { v: 'one' }, 'q')
    await t.simulateAction('LIVE')
    expect(t.state.q).toMatchObject({ status: 'success', data: { v: 'one' } })
    expect(t.state.q.refreshing).toBeFalsy()
    expect(fetches()).toBe(1)
    expect(t.cache('HTTP')).toHaveLength(1)
    expect(t.cache('HTTP')[0].subscribers).toBe(1)
  })
})
