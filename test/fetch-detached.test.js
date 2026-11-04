// @vitest-environment jsdom
// `detached: true` (maintainer decision, after preview.6; Sift Phase C): a write that outlives its
// sender. When the sender is disposed (a page left before the reply) its requests with reply
// actions are aborted, so a POST the server may still apply lost its `updates` and `invalidates`
// (TanStack Query's mutations finish after an unmount). A detached request isn't aborted: its
// `updates` still write the cache, its `invalidates` still run, and its ok / error actions, with
// no sender to reach, are dropped.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { queryCache } from '../src/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

function makeApp(detached) {
  function Page({ state }) { return h('div', null, h('p', { className: 'name' }, state.item?.data?.name ?? '-'), h('button', { className: 'save' }, 'Save')) }
  Page.resources = { item: () => ({ url: '/api/items/1' }) }
  Page.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
  Page.model = {
    SAVE: { HTTP: () => ({ url: '/api/items/1', method: 'PUT', json: { name: 'new' }, ok: 'SAVED', updates: 'item', invalidates: 'list', ...(detached !== undefined && { detached }) }) },
    SAVED: (s) => ({ ...s, saved: true }),
  }
  function App({ state }) { return h('div', null, h('p', { className: 'count' }, String(state.list?.data?.length ?? '-')), state.open ? h(Page, { state: 'page' }) : null) }
  App.initialState = { open: true, page: {} }
  App.resources = { list: () => ({ url: '/api/items', tags: ['list'] }) }
  App.model = { CLOSE: (s) => ({ ...s, open: false }), OPEN: (s) => ({ ...s, open: true }) }
  return App
}
const lists = () => t.requests('HTTP').filter(r => r.url === '/api/items').length

describe('detached: a write that outlives its sender', () => {
  it('the page is left before the reply: the write is still answered, updates and invalidates apply', async () => {
    t = renderComponent(makeApp(true), { http: { cache: queryCache() } })
    await t.ready()
    await t.respond('HTTP', [{ id: 1 }], 'list')
    await t.respond('HTTP', { name: 'old' }, 'item')
    await t.simulateEvent('.save', 'click')
    await t.simulateAction('CLOSE')
    expect(t.query('.name')).toBeFalsy()
    const before = lists()
    await t.respond('HTTP', { name: 'new' }, { url: '/api/items/1', method: 'PUT' })
    // invalidates: the list is fetched again
    expect(lists()).toBe(before + 1)
    // updates: the page's resource entry in the cache holds the reply
    expect(t.cache('HTTP').find(e => e.key.includes('/api/items/1'))?.data).toEqual({ name: 'new' })
    // the ok action had no sender to reach
    expect(t.state.page.saved).toBeUndefined()
    // back on the page, the cache shows the saved name
    await t.simulateAction('OPEN')
    expect(t.query('.name').textContent).toBe('new')
  })

  for (const d of [undefined, false]) {
    it(`without it (detached: ${d}), the write is aborted with its sender, as before`, async () => {
      t = renderComponent(makeApp(d), { http: { cache: queryCache() } })
      await t.ready()
      await t.respond('HTTP', [{ id: 1 }], 'list')
      await t.respond('HTTP', { name: 'old' }, 'item')
      await t.simulateEvent('.save', 'click')
      await t.simulateAction('CLOSE')
      expect(() => t.respond('HTTP', { name: 'new' }, { url: '/api/items/1', method: 'PUT' })).toThrow(/no pending HTTP request/)
    })
  }
})
