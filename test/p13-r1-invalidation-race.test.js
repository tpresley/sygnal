// @vitest-environment jsdom
// PLAN-13 R-1 (#36): a write whose `ok` action navigates (ROUTER) and whose `invalidates` (a URL
// prefix or a tag) matches the page's resource. The navigation changes the resource's request and
// sends the new one; the invalidation must not send the old request after it (on 7.0.0 the stale
// /api/items/1 went out last, in the same lane, and superseded /api/items/2). Modelled on Temper's
// repro (sp-5.3-router/src/race.test.tsx), for a lens-bound child, a key-bound child and the root.
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { queryCache } from '../src/extra/queryCache.js'
import { makeRouter } from '../src/extra/router.js'

const router = makeRouter({ routes: { item: '/items/:id' } })
const route1 = { name: 'item', params: { id: '1' }, query: {}, hash: '', path: '/items/1' }

// the page: shows its item, saves it, and on success moves to the next item
function makePage(invalidates, extra = {}) {
  const Page = ({ state }) => h('div', null, h('p', { className: 'id' }, String(state.item?.data?.id ?? '')), h('button', { className: 'save' }, 'save'))
  Page.resources = { item: (s) => ({ url: `/api/items/${s.route.params.id}`, tags: ['items'] }) }
  Page.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
  Page.model = {
    SAVE: { HTTP: (s) => ({ url: `/api/items/${s.route.params.id}`, method: 'PUT', json: {}, ok: 'SAVED', ...(invalidates && { invalidates }) }) },
    SAVED: { ROUTER: (s) => ({ to: 'item', params: { id: String(Number(s.route.params.id) + 1) } }), ...extra },
  }
  return Page
}

// the page as a lens-bound child, a key-bound child, or the root itself
function app(binding, Page) {
  if (binding === 'root') {
    Page.initialState = { route: route1 }
    Page.route = 'ROUTE'
    Page.model.ROUTE = (s, route) => ({ ...s, route })
    return { Root: Page, page: (s) => s }
  }
  const lens = { get: (s) => ({ ...s.page, route: s.route }), set: (s, { route, ...page }) => ({ ...s, page }) }
  const Root = () => h('main', null, h(Page, { state: binding === 'lens' ? lens : 'page' }))
  Root.route = 'ROUTE'
  if (binding === 'lens') {
    Root.initialState = { route: route1, page: {} }
    Root.model = { ROUTE: (s, route) => ({ ...s, route }) }
  } else {
    Root.initialState = { route: route1, page: { route: route1 } }
    Root.model = { ROUTE: (s, route) => ({ ...s, route, page: { ...s.page, route } }) }
  }
  return { Root, page: (s) => s.page }
}

const reads = (t) => t.requests('HTTP').filter((r) => r.resource === 'item').map((r) => r.url)

describe('R-1: invalidation with navigation in the ok action', () => {
  for (const binding of ['lens', 'key', 'root']) {
    for (const [how, opts] of [['a URL prefix', { invalidates: ['/api/items'] }], ['a tag', { invalidates: ['items'] }], ['refresh', { extra: { HTTP: () => ({ refresh: 'item' }) } }]]) {
      it(`${binding} page, ${how}: the new request is the last one sent and wins`, async () => {
        const { Root, page } = app(binding, makePage(opts.invalidates, opts.extra))
        const t = renderComponent(Root, { router, url: '/items/1', http: { cache: queryCache() } })
        await t.respond('HTTP', { id: 1 }, { url: '/api/items/1' })
        await t.settle()
        expect(page(t.state).item?.data?.id).toBe(1)

        t.simulateEvent('.save', 'click')
        await t.respond('HTTP', {}, 'SAVED')
        await t.settle()
        expect(t.location.path).toBe('/items/2')
        // no read of the old item after the new one (the invalidation or refresh may have
        // refetched the old request before the navigation, or the new one after it)
        const sent = reads(t)
        expect(sent.lastIndexOf('/api/items/1')).toBeLessThan(sent.indexOf('/api/items/2'))
        expect(sent.at(-1)).toBe('/api/items/2')

        // the new request is still live: its answer shows on the new page
        await t.respond('HTTP', { id: 2 }, { url: '/api/items/2' })
        await t.settle()
        expect(page(t.state).item?.status).toBe('success')
        expect(page(t.state).item?.data?.id).toBe(2)
        expect(t.query('.id').textContent).toBe('2')
        t.dispose()
      })
    }
  }

  it('two resources on the page: neither sends its old request after the new one', async () => {
    const Page = makePage(['items'])
    Page.resources = { ...Page.resources, notes: (s) => ({ url: `/api/items/${s.route.params.id}/notes`, tags: ['items'] }) }
    const { Root, page } = app('lens', Page)
    const t = renderComponent(Root, { router, url: '/items/1', http: { cache: queryCache() } })
    await t.respond('HTTP', { id: 1 }, { url: '/api/items/1' })
    await t.respond('HTTP', ['n1'], { url: '/api/items/1/notes' })
    t.simulateEvent('.save', 'click')
    await t.respond('HTTP', {}, 'SAVED')
    await t.settle()
    const sent = t.requests('HTTP').filter((r) => r.resource).map((r) => r.url)
    for (const old of ['/api/items/1', '/api/items/1/notes'])
      expect(sent.lastIndexOf(old)).toBeLessThan(sent.indexOf('/api/items/2'))
    await t.respond('HTTP', { id: 2 }, { url: '/api/items/2' })
    await t.respond('HTTP', ['n2'], { url: '/api/items/2/notes' })
    await t.settle()
    expect(page(t.state).item.data).toEqual({ id: 2 })
    expect(page(t.state).notes.data).toEqual(['n2'])
    t.dispose()
  })

  it('an invalidation that does not navigate still refetches the same request (keeping data)', async () => {
    const Page = makePage(['/api/items'])
    Page.model.SAVED = { STATE: (s) => ({ ...s, saved: true }) }
    const { Root, page } = app('lens', Page)
    const t = renderComponent(Root, { router, url: '/items/1', http: { cache: queryCache() } })
    await t.respond('HTTP', { id: 1 }, { url: '/api/items/1' })
    t.simulateEvent('.save', 'click')
    await t.respond('HTTP', {}, 'SAVED')
    await t.settle()
    expect(reads(t)).toEqual(['/api/items/1', '/api/items/1'])
    expect(page(t.state).item).toMatchObject({ status: 'success', refreshing: true, data: { id: 1 } })
    await t.respond('HTTP', { id: 11 }, { url: '/api/items/1' })
    await t.settle()
    expect(page(t.state).item).toMatchObject({ status: 'success', data: { id: 11 } })
    t.dispose()
  })
})
