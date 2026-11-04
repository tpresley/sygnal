// @vitest-environment jsdom
// makeRouter({ external }): URLs another app owns (a strangler migration, multi-zones). A
// navigation to one, from a link, a command, a guard's redirect or a block's proceed, is a full
// page load (location.assign / location.replace), never a pushState; the blocks are asked first.
// The router fake records page loads in t.pageLoads.
import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeRouter } from '../src/extra/router.js'

const routes = { home: '/', task: '/tasks/:id', billing: '/billing/:id', signOut: '/auth/logout', notFound: '*' }
const router = makeRouter({ routes, external: ['/billing/:id', '/auth/*'] })
const { href } = router

// the router fake's origin: the page's (jsdom's)
const O = location.origin

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

function App({ state }) {
  return h('main', null,
    h('p', { className: 'where' }, state.route ? state.route.name : '-'),
    h('a', { href: href('task', { id: 7 }), className: 'seven' }, 'seven'),
    h('a', { href: href('billing', { id: 3 }), className: 'bill' }, 'bill'),
    h('a', { href: '/auth/sso/callback?x=1', className: 'deep' }, 'deep'),
    h('a', { href: '/nowhere', className: 'lost' }, 'lost'))
}
App.route = 'ROUTE'
App.initialState = { route: null }
App.model = {
  ROUTE: (state, route) => ({ ...state, route }),
  BILL: { ROUTER: () => ({ to: 'billing', params: { id: 4 } }) },
  SIGN_OUT: { ROUTER: () => ({ to: 'signOut', replace: true }) },
}

describe('makeRouter({ external })', () => {
  it('a link to an external URL is left to the browser: a page load, no pushState, no route', async () => {
    t = renderComponent(App, { router, url: '/tasks/1' })
    await t.waitForState(s => s.route?.name === 'task')
    const before = t.states.length
    t.simulateEvent('a.bill', 'click')
    t.simulateEvent('a.deep', 'click')
    await t.settle()
    expect(t.pageLoads).toEqual([
      { url: O + '/billing/3', replace: false },
      { url: O + '/auth/sso/callback?x=1', replace: false },
    ])
    expect(t.location.path).toBe('/tasks/1')
    expect(t.states.length).toBe(before)
    // the router's own routes stay client-side; an unmatched URL is still the not-found route
    t.simulateEvent('a.seven', 'click')
    await t.waitForState(s => s.route.path === '/tasks/7')
    t.simulateEvent('a.lost', 'click')
    await t.waitForState(s => s.route.name === 'notFound')
    expect(t.location.path).toBe('/nowhere')
    expect(t.pageLoads).toHaveLength(2)
  })

  it('{ to } and { url } commands: location.assign, or location.replace for a replace', async () => {
    t = renderComponent(App, { router })
    await t.waitForState(s => !!s.route)
    t.simulateAction('BILL')
    t.simulateAction('SIGN_OUT')
    await t.settle()
    await t.navigate('/auth/login')
    expect(t.pageLoads).toEqual([
      { url: O + '/billing/4', replace: false },
      { url: O + '/auth/logout', replace: true },
      { url: O + '/auth/login', replace: false },
    ])
    expect(t.location.path).toBe('/')
    expect(t.state.route.name).toBe('home')
  })

  it('a guard redirect to an external URL is a page load (Sift: sign-out to the old app)', async () => {
    function Guard({ state }) { return h('p', null, state.route ? state.route.name : '-') }
    Guard.route = 'ROUTE'
    Guard.initialState = { route: null, user: null }
    Guard.model = {
      ROUTE: {
        STATE: (state, route) => ({ ...state, route }),
        ROUTER: (state, route) => route.name === 'task' && !state.user ? { url: '/auth/login?next=' + route.path, replace: true } : undefined,
      },
    }
    t = renderComponent(Guard, { router, url: '/tasks/2' })
    await t.waitForState(s => !!s.route)
    await t.settle()
    expect(t.pageLoads).toEqual([{ url: O + '/auth/login?next=/tasks/2', replace: true }])
    expect(t.location.path).toBe('/tasks/2')
  })

  it('a leave block is asked first; its proceed makes the page load', async () => {
    function Editor({ state }) { return h('div', null, h('a', { href: '/billing/9', className: 'bill' }, 'bill')) }
    Editor.route = 'ROUTE'
    Editor.initialState = { route: null, pending: null }
    Editor.model = {
      ROUTE: (state, route) => ({ ...state, route }),
      EDIT: { ROUTER: () => ({ block: 'CONFIRM_LEAVE' }) },
      CONFIRM_LEAVE: (state, attempt) => ({ ...state, pending: attempt.proceed }),
      YES: {
        STATE: (state) => ({ ...state, pending: null }),
        ROUTER: (state, data, next, { previousState }) => ({ ...previousState.pending, block: false }),
      },
    }
    t = renderComponent(Editor, { router })
    await t.waitForState(s => !!s.route)
    t.simulateAction('EDIT')
    await t.settle()
    // the link click is stopped (the browser doesn't follow it) and reported to the blocker
    t.simulateEvent('a.bill', 'click')
    await t.waitForState(s => !!s.pending)
    expect(t.state.pending).toEqual({ url: '/billing/9', force: true })
    expect(t.pageLoads).toEqual([])
    t.simulateAction('YES')
    await t.settle()
    expect(t.pageLoads).toEqual([{ url: O + '/billing/9', replace: false }])
    // a command too
    t.simulateAction('EDIT')
    await t.settle()
    await t.navigate({ to: 'signOut', replace: true })
    expect(t.state.pending).toEqual({ url: '/auth/logout', replace: true, force: true })
    expect(t.pageLoads).toHaveLength(1)
  })

  it('a function of the URL; patterns match the path without base', async () => {
    const r = makeRouter({ routes, external: (u) => u.pathname.startsWith('/billing/') || u.searchParams.has('legacy') })
    t = renderComponent(App, { router: r })
    await t.waitForState(s => !!s.route)
    t.simulateEvent('a.bill', 'click')
    await t.navigate('/tasks/1?legacy=1')
    await t.navigate('/tasks/2')
    expect(t.pageLoads.map(l => l.url)).toEqual([O + '/billing/3', O + '/tasks/1?legacy=1'])
    expect(t.location.path).toBe('/tasks/2')

    const based = makeRouter({ routes: { home: '/', billing: '/billing', notFound: '*' }, base: '/app', external: ['/billing'] })
    expect(based.href('billing')).toBe('/app/billing')
    function B({ state }) { return h('p', null, state.route ? state.route.name : '-') }
    B.route = 'ROUTE'
    B.initialState = { route: null }
    B.model = { ROUTE: (state, route) => ({ ...state, route }), GO: { ROUTER: () => ({ to: 'billing' }) } }
    const t2 = renderComponent(B, { router: based, url: '/app' })
    try {
      await t2.waitForState(s => !!s.route)
      t2.simulateAction('GO')
      await t2.settle()
      expect(t2.pageLoads).toEqual([{ url: O + '/app/billing', replace: false }])
    } finally { t2.dispose() }
  })

  it('dom: real: a real click on an external link is not prevented', async () => {
    t = renderComponent(App, { router, dom: 'real' })
    await t.waitForState(s => !!s.route)
    let prevented = null
    // (after the fake's own window listener recorded it; jsdom can't load another document)
    const spy = (e) => { prevented = e.defaultPrevented; e.preventDefault() }
    window.addEventListener('click', spy)
    try {
      t.query('a.bill').click()
      expect(prevented).toBe(false)
      t.query('a.seven').click()
      expect(prevented).toBe(true)
    } finally { window.removeEventListener('click', spy) }
    await t.waitForState(s => s.route.path === '/tasks/7')
    expect(t.pageLoads).toEqual([{ url: O + '/billing/3', replace: false }])
  })

  it('Vike (navigate): commands to an external URL load the page instead of calling navigate()', () => {
    const calls = [], loads = []
    const on = {}
    const w = {
      location: { href: 'http://x/', pathname: '/', search: '', hash: '', origin: 'http://x',
        assign: (u) => loads.push(['assign', u]), replace: (u) => loads.push(['replace', u]) },
      history: { state: null, replaceState() {}, pushState() { throw new Error('pushState') } },
      document: { addEventListener() {}, removeEventListener() {} },
      addEventListener: (k, f) => { (on[k] ||= []).push(f) }, removeEventListener() {},
      scrollTo() {},
    }
    const r = makeRouter({ routes, external: ['/billing/:id', '/auth/*'], window: w, navigate: (url, o) => calls.push([url, o]) })
    const sink$ = xs.create()
    const src = r.driver(sink$)
    sink$.shamefullySendNext({ to: 'billing', params: { id: 1 } })
    sink$.shamefullySendNext({ url: '/auth/logout', replace: true })
    sink$.shamefullySendNext({ to: 'task', params: { id: 1 } })
    expect(loads).toEqual([['assign', '/billing/1'], ['replace', '/auth/logout']])
    expect(calls).toEqual([['/tasks/1', { overwriteLastHistoryEntry: false }]])
    src.dispose()
  })
})
