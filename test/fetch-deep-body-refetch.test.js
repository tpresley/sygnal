// @vitest-environment jsdom
// A resource whose json body is a few levels deep compares unequal in the core's statics on every
// action (objIsEqual stops at depth 5), so `resources` is re-sent with the same request as a new
// object. A refetch started outside a drain (a mutation's `invalidates`, a poll tick) dispatched
// its `refreshing` write, the drain re-sent the request, and load() took the new object for a
// superseded request (the R-1 guard compared objects): nothing was sent, the resource stayed
// `refreshing: true` and polling stopped. The guard now compares the request's identity.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { queryCache } from '../src/extra/queryCache.js'
import { until } from './support/wait.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
})

const deep = () => ({ a: { b: { c: { d: { e: { f: 1 } } } } } })
const reads = () => t.requests('HTTP').filter((r) => r.resource === 'items')

function App({ state }) { return h('p', null, `${state.items.status}${state.items.refreshing ? '*' : ''}:${JSON.stringify(state.items.data ?? null)}`) }
App.initialState = { n: 0 }
App.model = {
  SAVE: { HTTP: () => ({ url: '/api/save', method: 'POST', json: { x: 1 }, ok: 'SAVED', invalidates: ['items'] }) },
  SAVED: (s) => ({ ...s, n: s.n + 1 }),
}

describe('a deep request body does not lose refetches', () => {
  it("a mutation's invalidates refetch is sent and its reply clears refreshing", async () => {
    App.resources = { items: () => ({ url: '/api/items', method: 'POST', json: deep(), tags: ['items'] }) }
    t = renderComponent(App, { http: { cache: queryCache() } })
    await t.respond('HTTP', ['one'], 'items')
    expect(t.state.items).toMatchObject({ status: 'success', data: ['one'] })
    await t.simulateAction('SAVE')
    await t.respond('HTTP', { saved: true }, 'SAVED')
    await until(() => expect(reads()).toHaveLength(2))
    expect(t.state.items).toMatchObject({ status: 'success', refreshing: true, data: ['one'] })
    await t.respond('HTTP', ['two'], 'items')
    expect(t.state.items).toMatchObject({ status: 'success', data: ['two'] })
    expect(t.state.items.refreshing).toBeFalsy()
  })

  it('refetchEvery keeps polling', async () => {
    App.resources = { items: () => ({ url: '/api/items', method: 'POST', json: deep(), refetchEvery: 20 }) }
    t = renderComponent(App)
    for (let i = 1; i <= 3; i++) {
      await until(() => expect(reads()).toHaveLength(i))
      await t.respond('HTTP', [i], 'items')
      // the next poll may already be in flight on a loaded machine (refreshing: the fake-timer test checks it's cleared)
      expect(t.state.items).toMatchObject({ status: 'success', data: [i] })
    }
    await until(() => expect(reads()).toHaveLength(4))
    expect(t.state.items).toMatchObject({ status: 'success', refreshing: true, data: [3] })
  })

  it('refetchEvery keeps polling under fake timers', async () => {
    vi.useFakeTimers()
    App.resources = { items: () => ({ url: '/api/items', method: 'POST', json: deep(), refetchEvery: 1000 }) }
    t = renderComponent(App)
    await t.respond('HTTP', [1], 'items')
    for (let i = 2; i <= 4; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      expect(reads()).toHaveLength(i)
      await t.respond('HTTP', [i], 'items')
      expect(t.state.items).toMatchObject({ status: 'success', data: [i] })
      expect(t.state.items.refreshing).toBeFalsy()
    }
  })
})

describe('t.respond with nothing pending for a polled resource', () => {
  it('says the resource polls and when its next request is sent', async () => {
    App.resources = { items: () => ({ url: '/api/items', refetchEvery: 5000 }) }
    t = renderComponent(App)
    await t.respond('HTTP', [1], 'items')
    let err
    try { await t.respond('HTTP', [2], { url: '/api/items' }) } catch (e) { err = e }
    expect(err?.message).toMatch(/no pending HTTP request/)
    expect(err.message).toMatch(/Resource 'items' polls every 5000ms \(refetchEvery\): its next request is sent 5000ms after the last reply/)
    expect(err.message).toMatch(/vi\.advanceTimersByTime\(5000\)/)
    expect(err.message).toMatch(/lists every request sent, answered or not/)
    expect(err.message).not.toMatch(/wait for a later one/)
  })

  it('a resource that does not poll keeps the general hint', async () => {
    App.resources = { items: () => ({ url: '/api/items' }) }
    t = renderComponent(App)
    await t.respond('HTTP', [1], 'items')
    let err
    try { await t.respond('HTTP', [2], { url: '/api/items' }) } catch (e) { err = e }
    expect(err?.message).toMatch(/no pending HTTP request/)
    expect(err.message).not.toMatch(/polls every/)
  })
})
