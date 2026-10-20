// @vitest-environment jsdom
// PLAN-13 F-1 (#37): the declaration statics get (state, context) and are re-run when the
// component's context object changes (D603: identity, as SP-F1's variant A). A routed page reads
// the route from context, so its slice keeps no copy of the params.
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.js'
import { makeRouter } from '../src/extra/router.js'
import { defineBehavior } from '../src/extra/behaviors.js'

const router = makeRouter({ routes: { item: '/items/:id', list: '/items' } })
const route1 = { name: 'item', params: { id: '1' }, query: {}, hash: '', path: '/items/1' }

function shell(Page, extra = {}) {
  function Root() { return h('main', null, h(Page, { state: 'page' })) }
  Root.initialState = { route: route1, page: {}, other: 0, ...extra }
  Root.route = 'ROUTE'
  Root.context = { route: (s) => s.route }
  Root.model = { ROUTE: (s, route) => ({ ...s, route }), OTHER: (s) => ({ ...s, other: s.other + 1 }) }
  return Root
}

describe('F-1: statics see context', () => {
  it('resources: navigation refetches through context; an unrelated write re-runs nothing', async () => {
    let calls = 0
    function Page({ state }) { return h('p', null, String(state.item?.data?.id ?? '')) }
    Page.resources = { item: (s, { route }) => (calls++, `/api/items/${route.params.id}`) }
    const t = renderComponent(shell(Page), { router, url: '/items/1' })
    await t.respond('HTTP', { id: 1 }, { url: '/api/items/1' })
    await t.navigate('/items/2')
    await t.settle()
    expect(t.requests('HTTP').filter(r => r.resource).map(r => r.url)).toEqual(['/api/items/1', '/api/items/2'])
    await t.respond('HTTP', { id: 2 }, { url: '/api/items/2' })
    expect(t.state.page.item.data).toEqual({ id: 2 })
    expect(t.state.page).not.toHaveProperty('route')
    const before = calls
    t.simulateAction('OTHER')
    await t.next((s) => s.other === 1)
    expect(calls).toBe(before)
    t.dispose()
  })

  it('timers, connections and head get the context too', async () => {
    function Page() { return h('p', null, 'x') }
    Page.timers = (s, { route }) => ({ poll: { every: 1000 * Number(route.params.id), action: 'POLL' } })
    Page.connections = (s, { route }) => ({ feed: { sse: `/events/${route.params.id}`, message: 'MSG' } })
    Page.head = (s, { route }) => ({ title: `Item ${route.params.id}` })
    Page.model = { POLL: (s) => s, MSG: (s) => s }
    const t = renderComponent(shell(Page), { router, url: '/items/1' })
    await t.ready()
    expect(t.timers()).toMatchObject([{ name: 'poll', every: 1000 }])
    expect(t.connections('WS')).toMatchObject([{ name: 'feed', sse: '/events/1' }])
    expect(t.head().title).toBe('Item 1')
    await t.navigate('/items/3')
    await t.settle()
    expect(t.timers()).toMatchObject([{ name: 'poll', every: 3000 }])
    expect(t.connections('WS')).toMatchObject([{ name: 'feed', sse: '/events/3' }])
    expect(t.head().title).toBe('Item 3')
    t.dispose()
  })

  it("a behavior's timers get the host's context", async () => {
    const ticker = defineBehavior({ initialState: { n: 0 }, model: { TICK: (s) => ({ ...s, n: s.n + 1 }) }, timers: (slice) => ({ t: { every: 500, action: 'TICK' } }) })
    function Page() { return h('p', null, 'x') }
    Page.uses = { tick: ticker() }
    Page.timers = (s, ctx) => ({ own: { every: ctx.route.params.id === '1' ? 100 : 200, action: 'OWN' } })
    Page.model = { OWN: (s) => s }
    const t = renderComponent(shell(Page), { router, url: '/items/1' })
    await t.ready()
    expect(t.timers().map(x => [x.name, x.every]).sort()).toEqual([['own', 100], ['tick.t', 500]])
    t.dispose()
  })

  it('renderToString: resources and head see the context', () => {
    function Page({ state }) { return h('p', null, state.item.status) }
    Page.resources = { item: (s, { route }) => route && `/api/items/${route.params.id}` }
    Page.head = (s, { route }) => ({ title: `Item ${route.params.id}` })
    function Root() { return h('main', null, h(Page, { state: 'page' })) }
    Root.context = { route: (s) => s.route }
    const head = []
    const html = renderToString(Root, { state: { route: route1, page: {} }, head })
    expect(html).toContain('<p>loading</p>')
    expect(head).toEqual([{ title: 'Item 1' }])
  })
})
