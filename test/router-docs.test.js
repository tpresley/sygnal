// @vitest-environment jsdom
// PLAN-3 5-4b: the docs samples of guide/router.md and guide/head.md, run (transcribed from
// JSX to h()): the routes module + App/TaskList/TaskPage with a Switchable, the DELETE
// redirect, the admin guard, the unsaved-changes Editor, and the route title in HEAD.
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import run from '../src/extra/run.js'
import { ABORT } from '../src/component.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable } from '../src/switchable.js'
import { makeRouter } from '../src/extra/router.js'
import { makeHeadDriver } from '../src/extra/head.js'
import { waitFor, textOf, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'

let app
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  document.head.innerHTML = '<title>Tasks</title>'
  document.body.innerHTML = '<div id="root"></div>'
  window.scrollTo = () => {}
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  vi.restoreAllMocks()
})
const text = sel => textOf(document.querySelector(sel))
const click = sel => document.querySelector(sel).click()
const path = () => window.location.pathname + window.location.search

it('Setup / Reading the Route / Links / Navigating from the Model', async () => {
  const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', notFound: '*' } })
  const { href } = router
  const TASKS = [{ id: 1, title: 'Alpha' }, { id: 2, title: 'Beta' }]

  function TaskList({ state }) {
    return h('ul', null, ...state.tasks.map(task => h('li', null, h('a', { href: href('task', { id: task.id }, { tab: 'notes' }) }, task.title))))
  }
  function TaskPage({ state }) {
    return h('article', null, h('h1', null, state.task.title), h('button', { className: 'delete' }, 'Delete'))
  }
  TaskPage.intent = ({ DOM }) => ({ DELETE: DOM.click('.delete') })
  TaskPage.model = {
    DELETE: {
      STATE: (state) => ({ ...state, deleted: true }),
      ROUTER: () => ({ to: 'home', replace: true }),
    },
  }
  const NotFound = () => h('p', { className: 'nf' }, 'Not found')

  function App({ state }) {
    return h('main', null,
      h('nav', null, h('a', { href: href('home'), className: 'all' }, 'All tasks')),
      h(Switchable, { of: { home: TaskList, task: TaskPage, notFound: NotFound }, current: state.route.name }))
  }
  App.route = 'ROUTE'
  App.initialState = { route: router.current(), tasks: TASKS }
  App.calculated = { task: s => TASKS.find(t => String(t.id) == s.route.params.id) || { title: '?' } }
  App.model = { ROUTE: (state, route) => ({ ...state, route }) }

  app = run(App, { ROUTER: router.driver }, { mountPoint: '#root' })
  await waitFor(() => !!document.querySelector('li a'))
  expect(document.querySelector('li a').getAttribute('href')).toBe('/tasks/1?tab=notes')
  document.querySelectorAll('li a')[1].click()
  await waitFor(() => expect(text('article h1')).toBe('Beta'))
  expect(path()).toBe('/tasks/2?tab=notes')
  const len = window.history.length
  click('.delete')
  await waitFor(() => expect(path()).toBe('/'))
  expect(window.history.length).toBe(len)
  window.history.pushState(null, '', '/nope')
  window.dispatchEvent(new PopStateEvent('popstate'))
  await waitFor(() => expect(text('.nf')).toBe('Not found'))
})

it('Guards and Redirects', async () => {
  const router = makeRouter({ routes: { home: '/', admin: '/admin', login: '/login' } })
  function App({ state }) { return h('main', null, h('h1', null, state.route.name)) }
  App.route = 'ROUTE'
  App.initialState = { route: { name: 'home', params: {}, query: {}, hash: '', path: '/' }, user: null }
  App.model = {
    ROUTE: {
      STATE: (state, route) => (route.name == 'admin' && !state.user ? ABORT : { ...state, route }),
      ROUTER: (state, route) => (route.name == 'admin' && !state.user ? { to: 'login', replace: true } : ABORT),
    },
  }
  window.history.replaceState(null, '', '/admin')
  app = run(App, { ROUTER: router.driver }, { mountPoint: '#root' })
  await waitFor(() => expect(text('h1')).toBe('login'))
  expect(path()).toBe('/login')
})

it('Unsaved Changes (kept alive by Switchable: YES clears the block)', async () => {
  const router = makeRouter({ routes: { home: '/', edit: '/edit' } })
  function Editor({ state }) {
    return h('div', null,
      h('textarea', { className: 'text', value: state.text }),
      state.pending && h('p', { className: 'confirm' }, 'Discard changes? ', h('button', { className: 'yes' }, 'Leave'), h('button', { className: 'no' }, 'Stay')))
  }
  Editor.intent = ({ DOM }) => ({ EDIT: DOM.input('.text').value(), YES: DOM.click('.yes'), NO: DOM.click('.no') })
  Editor.model = {
    EDIT: {
      STATE: (state, text) => ({ ...state, text, dirty: true }),
      ROUTER: () => ({ block: 'CONFIRM_LEAVE' }),
    },
    CONFIRM_LEAVE: (state, attempt) => ({ ...state, pending: attempt.proceed }),
    YES: {
      STATE: (state) => ({ ...state, dirty: false, pending: null }),
      ROUTER: (state) => ({ ...state.pending, block: false }),
    },
    NO: (state) => ({ ...state, pending: null }),
  }
  const Home = () => h('p', { className: 'home' }, 'home')
  function App({ state }) {
    return h('main', null,
      h('a', { href: router.href('home'), className: 'to-home' }, 'home'),
      h('a', { href: router.href('edit'), className: 'to-edit' }, 'edit'),
      h(Switchable, { of: { home: Home, edit: Editor }, current: state.route.name, state: 'editor' }))
  }
  window.history.replaceState(null, '', '/edit')
  App.route = 'ROUTE'
  App.initialState = { route: router.current(), editor: { text: '', dirty: false, pending: null } }
  App.model = { ROUTE: (state, route) => ({ ...state, route }) }
  app = run(App, { ROUTER: router.driver }, { mountPoint: '#root' })
  await waitFor(() => !!document.querySelector('.text'))
  const ta = document.querySelector('.text')
  ta.value = 'draft'
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(20)
  click('.to-home')
  await waitFor(() => !!document.querySelector('.confirm'))
  expect(path()).toBe('/edit')
  click('.no')
  await waitFor(() => !document.querySelector('.confirm'))
  click('.to-home')
  await waitFor(() => !!document.querySelector('.yes'))
  click('.yes')
  await waitFor(() => expect(path()).toBe('/'))
  await waitFor(() => expect(text('.home')).toBe('home'))
  // the block is gone: the kept-alive Editor doesn't stop later navigation
  click('.to-edit')
  await waitFor(() => expect(path()).toBe('/edit'))
  click('.to-home')
  await waitFor(() => expect(path()).toBe('/'))
})

it('head.md: the route title from the app state, titleTemplate, a page head static', async () => {
  const router = makeRouter({ routes: { home: '/', task: '/tasks/:id' } })
  const TITLES = { home: () => 'All tasks', task: (route) => `Task ${route.params.id}` }
  function TaskPage() { return h('h1', null, 'task') }
  TaskPage.head = (state) => ({ meta: { description: `Details of task ${state.route.params.id}` } })
  TaskPage.model = {}
  const Home = () => h('a', { href: router.href('task', { id: 2 }), className: 't2' }, 'two')
  function App({ state }) {
    return h('main', null, h(Switchable, { of: { home: Home, task: TaskPage }, current: state.route.name }))
  }
  App.route = 'ROUTE'
  App.initialState = { route: router.current() }
  App.head = (state) => ({ title: TITLES[state.route.name](state.route) })
  App.model = { ROUTE: (state, route) => ({ ...state, route }) }
  app = run(App, { ROUTER: router.driver, HEAD: makeHeadDriver({ titleTemplate: '%s · Tasks' }) }, { mountPoint: '#root' })
  await waitFor(() => expect(document.title).toBe('All tasks · Tasks'))
  await waitFor(() => !!document.querySelector('.t2'))
  click('.t2')
  await waitFor(() => expect(document.title).toBe('Task 2 · Tasks'))
  await waitFor(() => expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Details of task 2'))
})
