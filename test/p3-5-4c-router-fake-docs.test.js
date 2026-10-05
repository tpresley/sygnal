// @vitest-environment jsdom
// PLAN-3 5-4c: the router docs' samples (guide/router.md, guide/head.md) under renderComponent,
// written as an agent would after reading guide/router.md's Testing section; `dom: 'real'` link
// clicks through the driver's own interception; a sub-component declaring route with no router.
import { it, expect, afterEach, describe } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable } from '../src/switchable.js'
import { ABORT } from '../src/shared.js'
import { makeRouter } from '../src/extra/router.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

// routes.js
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

describe('guide/router.md samples', () => {
  it('starts at `url`, follows a link, redirects from the model, shows not found', async () => {
    t = renderComponent(App, { router, url: '/tasks/2' })
    await t.ready()
    expect(t.html()).toContain('<h1>Beta</h1>')
    await t.navigate('/')
    t.simulateEvent('li:nth-child(1) a', 'click')
    await t.waitForState(s => s.route.name === 'task')
    expect(t.location.path + t.location.search).toBe('/tasks/1?tab=notes')
    expect(t.html()).toContain('<h1>Alpha</h1>')
    t.simulateEvent('.delete', 'click')
    await t.waitForState(s => s.route.name === 'home')
    expect(t.sent('ROUTER')).toEqual([{ to: 'home', replace: true }])
    await t.navigate('/nope')
    expect(t.html()).toContain('Not found')
  })

  it('integration/testing.md Routing sample, as written', async () => {
    t = renderComponent(App, { router, url: '/tasks/2' })
    await t.ready()
    expect(t.html()).toContain('<h1>Beta</h1>')
    await t.navigate('/')
    t.simulateEvent('li:nth-child(1) a', 'click')
    await t.waitForState(s => s.route.name === 'task')
    expect(t.location.path + t.location.search).toBe('/tasks/1?tab=notes')
    await t.back()
    expect(t.state.route.name).toBe('home')
    await t.navigate({ to: 'task', params: { id: 2 } })
    expect(t.html()).toContain('<h1>Beta</h1>')
  })

  it('Guards and Redirects', async () => {
    const r = makeRouter({ routes: { home: '/', admin: '/admin', login: '/login' } })
    function Guarded({ state }) { return h('main', null, h('h1', null, state.route.name)) }
    Guarded.route = 'ROUTE'
    Guarded.initialState = { route: { name: 'home', params: {}, query: {}, hash: '', path: '/' }, user: null }
    Guarded.model = {
      ROUTE: {
        STATE: (state, route) => (route.name == 'admin' && !state.user ? ABORT : { ...state, route }),
        ROUTER: (state, route) => (route.name == 'admin' && !state.user ? { to: 'login', replace: true } : ABORT),
      },
    }
    t = renderComponent(Guarded, { router: r })
    await t.ready()
    await t.navigate('/admin')
    await t.waitForState(s => s.route.name === 'login')
    expect(t.location.path).toBe('/login')
  })

  it('Unsaved Changes (the Editor under a Switchable)', async () => {
    const r = makeRouter({ routes: { home: '/', edit: '/edit' } })
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
    function Shell({ state }) {
      return h('main', null,
        h('a', { href: r.href('home'), className: 'to-home' }, 'home'),
        h(Switchable, { of: { home: Home, edit: Editor }, current: state.route.name, state: 'editor' }))
    }
    Shell.route = 'ROUTE'
    Shell.initialState = { route: r.current('/edit'), editor: { text: '', dirty: false, pending: null } }
    Shell.model = { ROUTE: (state, route) => ({ ...state, route }) }
    t = renderComponent(Shell, { router: r, url: '/edit' })
    await t.ready()
    t.simulateEvent('.text', 'input', { value: 'draft' })
    await t.waitForState(s => s.editor.dirty)
    t.simulateEvent('.to-home', 'click')
    await t.waitForState(s => !!s.editor.pending)
    expect(t.location.path).toBe('/edit')
    t.simulateEvent('.yes', 'click')
    await t.waitForState(s => s.route.name === 'home')
    expect(t.location.path).toBe('/')
    expect(t.html()).toContain('<p class="home">home</p>')
  })

  it('head.md: the route title and a page head static, through t.head()', async () => {
    const r = makeRouter({ routes: { home: '/', task: '/tasks/:id' } })
    const TITLES = { home: () => 'All tasks', task: (route) => `Task ${route.params.id}` }
    function Detail() { return h('h1', null, 'task') }
    Detail.head = (state) => ({ meta: { description: `Details of task ${state.route.params.id}` } })
    Detail.model = {}
    const Home = () => h('a', { href: r.href('task', { id: 2 }), className: 't2' }, 'two')
    function Site({ state }) {
      return h('main', null, h(Switchable, { of: { home: Home, task: Detail }, current: state.route.name }))
    }
    Site.route = 'ROUTE'
    Site.initialState = { route: r.current() }
    Site.head = (state) => ({ title: TITLES[state.route.name](state.route) })
    Site.model = { ROUTE: (state, route) => ({ ...state, route }) }
    t = renderComponent(Site, { router: r, titleTemplate: '%s · Tasks' })
    await t.ready()
    expect(t.head().title).toBe('All tasks · Tasks')
    // integration/testing.md's Head sample: right after navigate resolves
    await t.navigate({ to: 'task', params: { id: 2 } })
    expect(t.head()).toEqual({ title: 'Task 2 · Tasks', meta: { description: 'Details of task 2' }, link: [] })
    await t.back()
    t.simulateEvent('.t2', 'click')
    await t.waitForState(s => s.route.name === 'task')
    expect(t.head()).toEqual({ title: 'Task 2 · Tasks', meta: { description: 'Details of task 2' }, link: [] })
  })
})

describe("dom: 'real'", () => {
  it('a real click on a link goes through the driver\'s interception; the real location is untouched', async () => {
    const before = window.location.href
    t = renderComponent(App, { router, url: '/', dom: 'real' })
    await t.ready()
    t.simulateEvent('li:nth-child(2) a', 'click')
    await t.waitForState(s => s.route.name === 'task')
    expect(t.query('article h1').textContent).toBe('Beta')
    expect(t.location.search).toBe('?tab=notes')
    expect(window.location.href).toBe(before)
    // modified clicks are left to the browser
    t.simulateEvent('.all', 'click', { ctrlKey: true })
    await t.settle()
    expect(t.state.route.name).toBe('task')
    t.simulateEvent('.all', 'click')
    await t.waitForState(s => s.route.name === 'home')
    await t.back()
    expect(t.state.route.name).toBe('task')
  })

  it('dispose removes the document listener', async () => {
    t = renderComponent(App, { router, dom: 'real' })
    await t.ready()
    t.dispose()
    t = null
    const a = document.createElement('a')
    a.href = '/tasks/1'
    document.body.appendChild(a)
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    a.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    a.remove()
  })
})

it('a sub-component that declares route with no router fails the test, naming the option', async () => {
  function Page({ state }) { return h('span', null, '-') }
  Page.route = 'ROUTE'
  Page.model = { ROUTE: (state, route) => ({ ...state, route }) }
  function Shell() { return h('div', null, h(Page, { state: 'page' })) }
  Shell.initialState = { page: {} }
  t = renderComponent(Shell)
  await expect(t.settle()).rejects.toThrow(/Page declares `route`.*renderComponent\(Shell, \{ router \}\)/)
})
