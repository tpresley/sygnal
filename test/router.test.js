// @vitest-environment jsdom
// PLAN-3 5-4b router (D81, D84): makeRouter + the `route` declaration static. A component
// declares `App.route = 'ROUTE'`; the driver replies ROUTE with { name, params, query, hash,
// path } on start and on every change. The first 10 tests are the 5-0c spike's, ported.
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import run from '../src/extra/run.js'
import { ABORT } from '../src/component.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable } from '../src/switchable.js'
import { makeRouter } from '../src/extra/router.js'
import { waitFor, textOf } from '../evals/agent-ergonomics/hidden/_support/queries.js'

const routes = { home: '/', task: '/tasks/:id', notFound: '*' }
const TASKS = { 1: 'Alpha', 2: 'Beta' }

let app, errorSpy, ROUTER, href, router
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  document.body.innerHTML = '<div id="root"></div>'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  router = makeRouter({ routes })
  ROUTER = router.driver
  href = router.href
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  vi.restoreAllMocks()
})

// --- the demo app: list / detail / notFound, a redirect for an unknown id -----------------
function Home() {
  return h('ul', { className: 'home' },
    ...Object.entries(TASKS).map(([id, title]) => h('li', null, h('a', { href: href('task', { id }, { tab: 'notes' }), className: `t${id}` }, title))),
    h('li', null, h('a', { href: href('task', { id: 99 }), className: 'bad' }, 'missing')),
    h('li', null, h('a', { href: '/nowhere', className: 'lost' }, 'lost')),
    h('li', null, h('a', { href: 'https://example.com/tasks/1', className: 'ext' }, 'external')),
    h('li', null, h('a', { href: href('task', { id: 1 }), target: '_blank', className: 'blank' }, 'new tab')),
    h('li', null, h('a', { href: href('task', { id: 1 }), download: 'x', className: 'dl' }, 'download')),
    h('li', null, h('a', { href: href('task', { id: 1 }), 'data-router-ignore': '', className: 'ign' }, 'ignored')))
}
function Task({ state }) {
  return h('div', { className: 'task' }, h('h1', null, TASKS[state.route.params.id] || '?'), h('a', { href: href('home'), className: 'back' }, 'back'))
}
function NotFound() { return h('p', { className: 'nf' }, 'Not found') }

// a second declaring component with its own state slice
function Crumb({ state }) { return h('span', { className: 'crumb' }, state.path || '') }
Crumb.route = 'ROUTE'
Crumb.model = { ROUTE: (s, r) => ({ ...s, path: r.path }) }

function App({ state }) {
  return h('main', null,
    h(Crumb, { state: 'crumb' }),
    state.route ? h(Switchable, { of: { home: Home, task: Task, notFound: NotFound }, current: state.route.name }) : h('p', { className: 'loading' }, '...'))
}
App.route = 'ROUTE'
App.initialState = { route: null, crumb: { path: '' }, seen: [] }
App.model = {
  ROUTE: {
    // a guard: an unknown task id redirects home (the state keeps the previous route)
    STATE: (s, r) => r.name == 'task' && !TASKS[r.params.id] ? ABORT : { ...s, route: r, seen: [...s.seen, r.path] },
    ROUTER: (s, r) => r.name == 'task' && !TASKS[r.params.id] ? { to: 'home', replace: true } : ABORT,
  },
}

const start = () => (app = run(App, { ROUTER }, { mountPoint: '#root' }))
const text = sel => textOf(document.querySelector(sel))
const click = sel => document.querySelector(sel).click()
const path = () => window.location.pathname + window.location.search

it('delivers the initial route to the declaring component', async () => {
  window.history.replaceState(null, '', '/tasks/1?tab=notes#c3')
  start()
  await waitFor(() => expect(text('.task h1')).toBe('Alpha'))
  await waitFor(() => expect(text('.crumb')).toBe('/tasks/1'))
})

it('a link click navigates without a reload; params and query are parsed', async () => {
  start()
  await waitFor(() => !!document.querySelector('.home .t2'))
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  document.querySelector('.t2').dispatchEvent(ev)
  expect(ev.defaultPrevented).toBe(true)
  expect(path()).toBe('/tasks/2?tab=notes')
  await waitFor(() => expect(text('.task h1')).toBe('Beta'))
  expect(window.history.length).toBeGreaterThan(1)
})

it('the route value has name, params, query, hash, path', () => {
  window.history.replaceState(null, '', '/tasks/7?tab=notes&x=1#c3')
  const seen = []
  const Probe = () => h('div')
  Probe.route = 'ROUTE'
  Probe.initialState = {}  // the static is derived from state: a root without state never declares
  Probe.model = { ROUTE: { EFFECT: (_, r) => seen.push(r) } }
  app = run(Probe, { ROUTER }, { mountPoint: '#root' })
  return waitFor(() => expect(seen[0]).toEqual({ name: 'task', params: { id: '7' }, query: { tab: 'notes', x: '1' }, hash: 'c3', path: '/tasks/7' }))
})

it('modified, middle, target, download, external and opted-out clicks are left alone', async () => {
  start()
  await waitFor(() => !!document.querySelector('.home .t1'))
  const tries = [
    ['.t1', { metaKey: true }], ['.t1', { ctrlKey: true }], ['.t1', { shiftKey: true }], ['.t1', { altKey: true }],
    ['.t1', { button: 1 }], ['.blank', {}], ['.dl', {}], ['.ext', {}], ['.ign', {}],
  ]
  for (const [sel, init] of tries) {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
    document.querySelector(sel).dispatchEvent(ev)
    expect(ev.defaultPrevented, sel + JSON.stringify(init)).toBe(false)
    expect(path()).toBe('/')
  }
})

it('back/forward (popstate) restore the route', async () => {
  start()
  await waitFor(() => !!document.querySelector('.home .t1'))
  click('.t1')
  await waitFor(() => expect(text('.task h1')).toBe('Alpha'))
  window.history.back()
  await waitFor(() => expect(document.querySelector('.home')).not.toBeNull())
  expect(path()).toBe('/')
  window.history.forward()
  await waitFor(() => expect(text('.task h1')).toBe('Alpha'))
})

it('the { back: true } sink command goes back', async () => {
  const Nav = ({ state }) => h('div', null, h('span', { className: 'p' }, state.route?.path || ''), h('button', { className: 'b' }, 'back'))
  Nav.route = 'ROUTE'
  Nav.initialState = { route: null }
  Nav.model = { ROUTE: (s, r) => ({ ...s, route: r }), BACK: { ROUTER: () => ({ back: true }) }, TO: { ROUTER: () => ({ to: 'task', params: { id: 5 } }) } }
  Nav.intent = ({ DOM }) => ({ BACK: DOM.select('.b').events('click'), TO: DOM.select('.p').events('click') })
  app = run(Nav, { ROUTER }, { mountPoint: '#root' })
  await waitFor(() => expect(text('.p')).toBe('/'))
  click('.p')
  await waitFor(() => expect(text('.p')).toBe('/tasks/5'))
  click('.b')
  await waitFor(() => expect(text('.p')).toBe('/'))
})

it('an unmatched path is the notFound route', async () => {
  start()
  await waitFor(() => !!document.querySelector('.home .lost'))
  click('.lost')
  await waitFor(() => expect(text('.nf')).toBe('Not found'))
  expect(path()).toBe('/nowhere')
})

it('a model redirect (ROUTE returns ROUTER: { to, replace: true }) replaces the entry', async () => {
  start()
  await waitFor(() => !!document.querySelector('.home .bad'))
  const len = window.history.length
  click('.bad')
  await waitFor(() => expect(path()).toBe('/'))
  await waitFor(() => expect(document.querySelector('.home')).not.toBeNull())
  expect(window.history.length).toBe(len + 1) // pushed /tasks/99, then replaced by /
  // the crumb (a second declarer) ends on the redirect target too
  await waitFor(() => expect(text('.crumb')).toBe('/'))
})

it('two declaring components both receive every change', async () => {
  start()
  await waitFor(() => !!document.querySelector('.home .t2'))
  expect(text('.crumb')).toBe('/')
  click('.t2')
  await waitFor(() => expect(text('.crumb')).toBe('/tasks/2'))
  await waitFor(() => expect(text('.task h1')).toBe('Beta'))
})

it('href() and match() are pure (SSR-safe)', () => {
  const r = makeRouter({ routes, base: '/app/' })
  expect(r.href('task', { id: 'a b' }, { q: 'x', n: null }, 'top')).toBe('/app/tasks/a%20b?q=x#top')
  expect(r.match('/app/tasks/3')).toMatchObject({ name: 'task', params: { id: '3' } })
  expect(r.match('/app/tasks/3/x')).toMatchObject({ name: 'notFound', params: {} })
  expect(makeRouter({ routes: { home: '/' } }).match('/x')).toMatchObject({ name: null, params: {} })
})
