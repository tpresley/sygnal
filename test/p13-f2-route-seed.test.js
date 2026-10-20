// @vitest-environment jsdom
// PLAN-13 F-2 (#38): renderComponent({ router, url }) delivers the root's route action with the
// test URL before the first render, so a deep-link test starts on its page: the first render shows
// it and no request goes out for the route initialState read at module load ('/').
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { makeRouter } from '../src/extra/router.js'
import { Switchable } from '../src/switchable.js'

const router = makeRouter({ routes: { home: '/', item: '/items/:id' } })

function Item({ state }) { return h('p', { className: 'item' }, `item ${state.item?.data?.id ?? '…'}`) }
Item.resources = { item: (s, { route }) => route.name === 'item' && `/api/items/${route.params.id}` }
function Home() { return h('p', { className: 'home' }, 'home') }
function App({ state }) { return h('main', null, h(Switchable, { of: { home: Home, item: Item }, current: state.route.name, state: { item: 'itemPage' } })) }
// as an app writes it: read at module load, when the location is '/'
App.initialState = { route: router.current('/'), itemPage: {}, routes: 0 }
App.route = 'ROUTE'
App.context = { route: (s) => s.route }
App.model = { ROUTE: (s, route) => ({ ...s, route, routes: s.routes + 1 }) }

describe('F-2: deep-link tests start on the real route', () => {
  it('the first render shows the URL\'s page, and only its request is sent', async () => {
    const t = renderComponent(App, { router, url: '/items/7' })
    await t.ready()
    expect(t.states[0].route.name).toBe('item')
    expect(t.html()).toContain('item …')
    expect(t.requests('HTTP').map((r) => r.url)).toEqual(['/api/items/7'])
    await t.respond('HTTP', { id: 7 }, { url: '/api/items/7' })
    expect(t.html()).toContain('item 7')
    t.dispose()
  })

  it('the URL that matches initialState anyway: no change', async () => {
    const t = renderComponent(App, { router, url: '/' })
    await t.ready()
    expect(t.html()).toContain('home')
    expect(t.requests('HTTP')).toEqual([])
    t.dispose()
  })
})
