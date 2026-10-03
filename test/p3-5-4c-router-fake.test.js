// PLAN-3 5-4c: the router and HEAD fakes in renderComponent(). With `{ router }` (the app's
// makeRouter() object) and no ROUTER driver, renderComponent runs the router's real driver over
// an in-memory window (location, history with async popstate, document listeners), so
// guards, redirect order, block and link interception are the driver's own code. t.navigate,
// t.back, t.forward, t.location, t.sent('ROUTER'); a HEAD fake records the merged head (t.head()).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable } from '../src/switchable.js'
import { ABORT } from '../src/component.js'
import { makeRouter } from '../src/extra/router.js'

const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', login: '/login', admin: '/admin', notFound: '*' } })
const { href } = router

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; vi.useRealTimers() })

/** a root that declares the route and shows its path */
function App({ state }) {
  return h('main', null,
    h('p', { className: 'where' }, state.route ? state.route.path : '-'),
    h('a', { href: href('task', { id: 7 }), className: 'seven' }, 'seven'),
    h('a', { href: 'https://example.com/x', className: 'ext' }, 'ext'),
    h('a', { href: href('task', { id: 8 }), target: '_blank', className: 'blank' }, 'blank'))
}
App.route = 'ROUTE'
App.initialState = { route: null, user: null }
App.model = { ROUTE: (state, route) => ({ ...state, route }) }

describe('router fake', () => {
  it('the initial route comes from `url` (default /); t.location reads the in-memory location', async () => {
    t = renderComponent(App, { router, url: '/tasks/2?tab=notes#c' })
    const s = await t.waitForState(s => !!s.route)
    expect(s.route).toEqual({ name: 'task', params: { id: '2' }, query: { tab: 'notes' }, hash: 'c', path: '/tasks/2' })
    expect(t.location).toMatchObject({ path: '/tasks/2', search: '?tab=notes', hash: '#c' })
    expect(t.location.href).toMatch(/\/tasks\/2\?tab=notes#c$/)
    t.dispose()
    t = renderComponent(App, { router })
    expect((await t.waitForState(s => !!s.route)).route.name).toBe('home')
    expect(t.location.path).toBe('/')
  })

  it('t.navigate by URL and by { to, params, query }; resolves after reduce and render', async () => {
    t = renderComponent(App, { router })
    await t.waitForState(s => !!s.route)
    await t.navigate('/tasks/3')
    expect(t.state.route).toMatchObject({ name: 'task', params: { id: '3' } })
    expect(t.html()).toContain('<p class="where">/tasks/3</p>')
    await t.navigate({ to: 'task', params: { id: 4 }, query: { tab: 'x' } })
    expect(t.state.route).toMatchObject({ name: 'task', params: { id: '4' }, query: { tab: 'x' } })
    expect(t.location.path + t.location.search).toBe('/tasks/4?tab=x')
    await t.navigate('/nowhere/at/all')
    expect(t.state.route.name).toBe('notFound')
  })

  it('t.navigate throws at the call for an unknown route or a missing param', async () => {
    t = renderComponent(App, { router })
    await t.waitForState(s => !!s.route)
    expect(() => t.navigate({ to: 'tasks', params: { id: 1 } })).toThrow(/no route named 'tasks'.*home, task/)
    expect(() => t.navigate({ to: 'task' })).toThrow(/needs params: id/)
    expect(() => t.navigate('https://example.com/x')).toThrow(/another origin/)
  })

  it('t.back / t.forward traverse the in-memory history; they throw with nowhere to go', async () => {
    t = renderComponent(App, { router })
    await t.waitForState(s => !!s.route)
    expect(() => t.back()).toThrow(/no history entry/)
    await t.navigate('/tasks/1')
    await t.navigate('/tasks/2')
    await t.back()
    expect(t.state.route.path).toBe('/tasks/1')
    await t.back()
    expect(t.state.route.path).toBe('/')
    await t.forward()
    expect(t.state.route.path).toBe('/tasks/1')
    expect(t.location.path).toBe('/tasks/1')
  })

  it('a guard redirect from the model (ROUTE → ROUTER { to, replace }); t.sent lists the command', async () => {
    function Guarded({ state }) { return h('h1', null, state.route.name) }
    Guarded.route = 'ROUTE'
    Guarded.initialState = { route: router.current('/'), user: null }
    Guarded.model = {
      ROUTE: {
        STATE: (state, route) => (route.name == 'admin' && !state.user ? ABORT : { ...state, route }),
        ROUTER: (state, route) => (route.name == 'admin' && !state.user ? { to: 'login', replace: true } : ABORT),
      },
    }
    t = renderComponent(Guarded, { router, url: '/admin' })
    await t.waitForState(s => s.route.name === 'login')
    expect(t.html()).toBe('<h1>login</h1>')
    expect(t.location.path).toBe('/login')
    expect(t.states.some(s => s.route.name === 'admin')).toBe(false)
    expect(t.sent('ROUTER')).toEqual([{ to: 'login', replace: true }])
    await t.navigate('/admin')
    expect(t.state.route.name).toBe('login')
    // replace: the redirect took the /admin entry's place, so back goes to the first /login
    await t.back()
    expect(t.location.path).toBe('/login')
  })

  it('block: t.navigate and t.back reach the blocker; proceed (with block: false) goes', async () => {
    function Editor({ state }) {
      return h('div', null, h('p', { className: 'where' }, state.route ? state.route.path : '-'), state.pending ? h('p', { className: 'confirm' }, 'Discard?') : null)
    }
    Editor.route = 'ROUTE'
    Editor.initialState = { route: null, pending: null }
    Editor.model = {
      ROUTE: (state, route) => ({ ...state, route }),
      EDIT: { ROUTER: () => ({ block: 'CONFIRM_LEAVE' }) },
      CONFIRM_LEAVE: (state, attempt) => ({ ...state, pending: attempt.proceed }),
      YES: {
        STATE: (state) => ({ ...state, pending: null }),
        ROUTER: (state) => ({ ...state.pending, block: false }),
      },
      NO: (state) => ({ ...state, pending: null }),
    }
    t = renderComponent(Editor, { router, url: '/tasks/1' })
    await t.waitForState(s => !!s.route)
    await t.navigate('/tasks/2')
    t.simulateAction('EDIT')
    await t.settle()
    await t.navigate('/login')
    expect(t.state.pending).toEqual({ url: '/login', force: true })
    expect(t.location.path).toBe('/tasks/2')
    expect(t.html()).toContain('Discard?')
    t.simulateAction('NO')
    await t.settle()
    // back is undone (history.go back again) and reported to the blocker
    await t.back()
    await t.waitForState(s => !!s.pending)
    await t.settle()
    expect(t.state.pending).toEqual({ go: -1, force: true })
    expect(t.location.path).toBe('/tasks/2')
    t.simulateAction('YES')
    await t.waitForState(s => s.route.path === '/tasks/1')
    expect(t.location.path).toBe('/tasks/1')
    // the block is gone
    await t.navigate('/login')
    expect(t.state.route.name).toBe('login')
    expect(t.sent('ROUTER')).toEqual([{ block: 'CONFIRM_LEAVE' }, { go: -1, force: true, block: false }])
  })

  it('two declarers: the root (guard owner) and a page both get the route', async () => {
    function Page({ state }) { return h('span', { className: 'page' }, state.mine ? state.mine.path : '-') }
    Page.route = 'MINE'
    Page.model = { MINE: (state, route) => ({ ...state, mine: route }) }
    function Root({ state }) { return h('div', null, h('b', null, state.route ? state.route.name : '-'), h(Page, { state: 'page' })) }
    Root.route = 'ROUTE'
    Root.initialState = { route: null, page: { mine: null } }
    Root.model = { ROUTE: (state, route) => ({ ...state, route }) }
    t = renderComponent(Root, { router, url: '/tasks/5' })
    await t.waitForState(s => !!s.route && !!s.page.mine)
    expect(t.state.page.mine.path).toBe('/tasks/5')
    await t.navigate({ to: 'home' })
    await t.waitForState(s => s.page.mine.path === '/')
    expect(t.html()).toContain('<span class="page">/</span>')
  })

  it('a sub-component that declares route works with the router passed (the root does not declare it)', async () => {
    function Page({ state }) { return h('span', null, state.route ? state.route.name : '-') }
    Page.route = 'ROUTE'
    Page.model = { ROUTE: (state, route) => ({ ...state, route }) }
    function Shell({ state }) { return h('div', null, h(Page, { state: 'page' })) }
    Shell.initialState = { page: { route: null } }
    t = renderComponent(Shell, { router, url: '/login' })
    await t.waitForState(s => s.page.route?.name === 'login')
    await t.navigate('/tasks/1')
    expect(t.html()).toBe('<div><span>task</span></div>')
  })

  it('without { router }: a clear error naming the option', () => {
    expect(() => renderComponent(App)).toThrow(/renderComponent\(App, \{ router \}\)/)
    // a real driver passed instead: no fake, and t.navigate says so
    t = renderComponent(App, { drivers: { ROUTER: () => ({}) } })
    expect(() => t.navigate('/x')).toThrow(/real driver/)
  })

  it('mock DOM: simulateEvent click on an <a> goes through the driver\'s link interception', async () => {
    t = renderComponent(App, { router })
    await t.waitForState(s => !!s.route)
    t.simulateEvent('a.seven', 'click')
    await t.waitForState(s => s.route.path === '/tasks/7')
    // external and target=_blank links (and modified clicks) are left to the browser
    t.simulateEvent('a.ext', 'click')
    t.simulateEvent('a.blank', 'click')
    t.simulateEvent('a.seven', 'click', { metaKey: true })
    await t.settle()
    expect(t.location.path).toBe('/tasks/7')
    expect(t.states.filter(s => s.route?.path === '/tasks/7')).toHaveLength(1)
  })

  it('routerSink names the sink; scroll/focus are off by default', async () => {
    function Nav({ state }) { return h('h1', null, state.where ? state.where.path : '-') }
    Nav.route = 'WHERE'
    Nav.initialState = { where: null }
    Nav.model = { WHERE: (state, where) => ({ ...state, where }), GO: { NAV: () => ({ to: 'task', params: { id: 9 } }) } }
    t = renderComponent(Nav, { router, routerSink: 'NAV' })
    await t.waitForState(s => !!s.where)
    t.simulateAction('GO')
    await t.waitForState(s => s.where.path === '/tasks/9')
    expect(t.sent('NAV')).toEqual([{ to: 'task', params: { id: 9 } }])
  })

  it('works under fake timers', async () => {
    vi.useFakeTimers()
    t = renderComponent(App, { router, url: '/tasks/1' })
    await t.waitForState(s => !!s.route)
    await t.navigate('/tasks/2')
    expect(t.state.route.path).toBe('/tasks/2')
    await t.back()
    expect(t.state.route.path).toBe('/tasks/1')
    t.simulateEvent('a.seven', 'click')
    await t.waitForState(s => s.route.path === '/tasks/7')
  })
})

describe('HEAD fake', () => {
  it('t.head(): the merged title, meta and links; a page title per route', async () => {
    const TITLES = { home: () => 'All tasks', task: (route) => `Task ${route.params.id}` }
    function TaskPage() { return h('h1', null, 'task') }
    TaskPage.head = (state) => ({ meta: { description: `Details of task ${state.route.params.id}` }, link: [{ rel: 'canonical', href: `/tasks/${state.route.params.id}` }] })
    TaskPage.model = {}
    const Home = () => h('p', null, 'home')
    function Site({ state }) {
      return h('main', null, h(Switchable, { of: { home: Home, task: TaskPage }, current: state.route.name }))
    }
    Site.route = 'ROUTE'
    Site.initialState = { route: router.current('/') }
    Site.head = (state) => ({ title: TITLES[state.route.name](state.route) })
    Site.model = { ROUTE: (state, route) => ({ ...state, route }) }
    t = renderComponent(Site, { router, titleTemplate: '%s · Tasks' })
    await t.ready()
    await t.settle()
    expect(t.head()).toEqual({ title: 'All tasks · Tasks', meta: {}, link: [] })
    await t.navigate({ to: 'task', params: { id: 2 } })
    await t.settle()
    expect(t.head()).toEqual({
      title: 'Task 2 · Tasks',
      meta: { description: 'Details of task 2' },
      link: [{ rel: 'canonical', href: '/tasks/2' }],
    })
    await t.back()
    await t.settle()
    // the hidden page's head is paused (D85)
    expect(t.head()).toEqual({ title: 'All tasks · Tasks', meta: {}, link: [] })
  })

  it('without a router, and from a model entry; a real HEAD driver passed: t.head() throws', async () => {
    function Doc({ state }) { return h('p', null, state.title) }
    Doc.initialState = { title: 'One' }
    Doc.head = (state) => ({ title: state.title })
    Doc.model = { RENAME: (state, title) => ({ ...state, title }) }
    t = renderComponent(Doc)
    await t.ready()
    await t.settle()
    expect(t.head().title).toBe('One')
    t.simulateAction('RENAME', 'Two')
    await t.settle()
    expect(t.head()).toEqual({ title: 'Two', meta: {}, link: [] })
    t.dispose()
    // a model entry (one entry per component: its latest value)
    function Share({ state }) { return h('p', null, state.title) }
    Share.initialState = { title: 'x' }
    Share.model = { SHARE: { HEAD: (state, title) => ({ meta: { 'og:title': title } }) } }
    t = renderComponent(Share)
    t.simulateAction('SHARE', 'Hello')
    await t.settle()
    expect(t.head()).toEqual({ title: undefined, meta: { 'og:title': 'Hello' }, link: [] })
    t.dispose()
    t = renderComponent(Doc, { drivers: { HEAD: () => ({}) } })
    expect(() => t.head()).toThrow(/real driver/)
  })
})
