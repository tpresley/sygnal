// PLAN-3 6-B (G-185): the two renderComponent() traps REPORT-v3 found on tasks 23 and 25.
// 1. t.query() / t.queryAll() work on the default mock DOM: element-like snapshots of the
//    rendered vnode tree (no jsdom here: this file runs in the node environment).
// 2. `{ nth }` answers one request of t.requests(name) by position, so the older of two
//    identical requests can be answered, or shown to be no longer pending (G-140 still throws).
import { it, expect, afterEach, describe } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable } from '../src/switchable.js'
import { makeRouter } from '../src/extra/router.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

describe('t.query / t.queryAll on the mock DOM', () => {
  function Form({ state }) {
    return h('form', { className: 'signup' },
      h('h1', null, 'Sign ', h('em', null, 'up')),
      h('input', { attrs: { name: 'email', type: 'email' }, props: { value: state.email } }),
      h('input', { name: 'news', type: 'checkbox', checked: state.news }),
      ...['free', 'team'].map(p => h('label', { className: 'plan' }, h('input', { name: 'plan', type: 'radio', value: p, checked: state.plan === p }), p)),
      h('select', { name: 'size', value: state.size }, h('option', { value: 's' }, 'Small'), h('option', { value: 'l' }, 'Large')),
      h('textarea', { name: 'bio', value: state.bio }),
      h('ul', { className: 'rows' }, ...state.rows.map(r => h('li', { className: r.done ? 'row done' : 'row', 'data-id': String(r.id) }, h('span', null, r.text)))),
      h('button', { className: 'next', disabled: !state.email }, 'Next'),
      h('a', { className: 'home', href: '/', 'aria-label': 'Home' }, 'Home'))
  }
  Form.initialState = { email: '', news: false, plan: 'free', size: 'l', bio: 'hi', rows: [{ id: 1, text: 'a', done: true }, { id: 2, text: 'b', done: false }] }
  Form.intent = ({ DOM }) => ({ EMAIL: DOM.input('input[name="email"]').value(), NEWS: DOM.select('input[name="news"]').events('change').map(e => e.target.checked) })
  Form.model = { EMAIL: (s, email) => ({ ...s, email }), NEWS: (s, news) => ({ ...s, news }) }

  it('text, attributes, classes, value, checked, disabled, nested queries', async () => {
    t = renderComponent(Form)
    await t.ready()
    expect(t.query('h1').textContent).toBe('Sign up')
    expect(t.query('.missing')).toBeNull()
    expect(t.query('input[name="plan"]:checked').value).toBe('free')
    expect(t.query('input[name="plan"][value="team"]').checked).toBe(false)
    expect(t.query('input[name="news"]').checked).toBe(false)
    expect(t.query('input[name="email"]').value).toBe('')
    expect(t.query('select[name="size"]').value).toBe('l')
    expect(t.query('textarea').value).toBe('hi')
    expect(t.query('.next').disabled).toBe(true)
    expect(t.query('button:disabled').textContent).toBe('Next')
    expect(t.queryAll('.row')).toHaveLength(2)
    expect(t.queryAll('.row').map(e => e.dataset.id)).toEqual(['1', '2'])
    expect(t.queryAll('.row.done span').map(e => e.textContent)).toEqual(['a'])
    const row = t.query('.row:not(.done)')
    expect(row.className).toBe('row')
    expect(row.classList.contains('done')).toBe(false)
    expect(row.getAttribute('data-id')).toBe('2')
    expect(row.querySelector('span').textContent).toBe('b')
    expect(row.parentElement.tagName).toBe('UL')
    expect(row.closest('form').classList.contains('signup')).toBe(true)
    expect(row.matches('li.row')).toBe(true)
    expect(t.query('ul').children.map(c => c.textContent)).toEqual(['a', 'b'])
    expect(t.query('a.home').getAttribute('href')).toBe('/')
    expect(t.query('a.home').href).toBe('/')
    expect(t.query('a.home').getAttribute('aria-label')).toBe('Home')
    expect(t.query('a.home').hasAttribute('target')).toBe(false)
    expect(t.query('input[name="email"]').getAttribute('type')).toBe('email')
    expect(t.query('label.plan').textContent).toBe('free')
    expect(t.query('ul').innerHTML).toBe('<li class="row done" data-id="1"><span>a</span></li><li class="row" data-id="2"><span>b</span></li>')
  })

  it('reads the latest render after each wait', async () => {
    t = renderComponent(Form)
    t.simulateEvent('input[name="email"]', 'input', { value: 'ada@example.com' })
    await t.next(s => s.email === 'ada@example.com')
    expect(t.query('input[name="email"]').value).toBe('ada@example.com')
    expect(t.query('.next').disabled).toBe(false)
    expect(t.query('button:enabled').textContent).toBe('Next')
    t.simulateEvent('input[name="news"]', 'change', { checked: true })
    await t.next(s => s.news)
    expect(t.query('input[name="news"]:checked')).not.toBeNull()
  })

  it('throws before the first render, for unsupported selectors, and for real-DOM-only calls', async () => {
    t = renderComponent(Form)
    expect(t.container).toBe(null)
    await t.ready()
    expect(() => t.query('label:has(input)')).toThrow(/Unsupported selector syntax.*dom: 'real'/s)
    expect(() => t.query('input[name="email"]').focus()).toThrow(/dom: 'real'/)
  })
})

describe('answering one of two identical pending requests: { nth }', () => {
  // two identical requests, both pending (no latest): answer the older one
  function Feed({ state }) {
    return h('div', null, h('button', { className: 'load' }, 'Load'), h('ul', null, ...state.loads.map(l => h('li', null, l))))
  }
  Feed.initialState = { loads: [] }
  Feed.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
  Feed.model = {
    LOAD: { HTTP: () => ({ url: '/api/feed', ok: 'LOADED', error: 'FAILED' }) },
    LOADED: (s, body) => ({ ...s, loads: [...s.loads, body.n] }),
    FAILED: (s, { status, body }) => ({ ...s, loads: [...s.loads, `${status} ${body.m}`] }),
  }

  it('{ nth: 0 } answers the first of two identical pending requests, { nth: -1 } the newest', async () => {
    t = renderComponent(Feed)
    t.simulateEvent('.load', 'click')
    t.simulateEvent('.load', 'click')
    await t.settle()
    expect(t.requests('HTTP')[0]).toEqual(t.requests('HTTP')[1])
    expect(t.requests('HTTP')).toHaveLength(2)
    await t.respond('HTTP', { n: 'first' }, { nth: 0 })
    await t.respond('HTTP', { n: 'second' }, { nth: -1 })
    expect(t.state.loads).toEqual(['first', 'second'])
    expect(() => t.respond('HTTP', { n: 'again' }, { nth: 0 })).toThrow(/t\.requests\('HTTP'\)\[0\].*not pending/)
    expect(() => t.respond('HTTP', { n: 'x' }, { nth: 5 })).toThrow(/2 requests/)
  })

  it('{ request, nth } counts only the requests matching `request`; fail() takes it too', async () => {
    t = renderComponent(Feed)
    t.simulateEvent('.load', 'click')
    t.simulateEvent('.load', 'click')
    await t.settle()
    await t.fail('HTTP', 500, { request: { ok: 'LOADED' }, nth: 0, body: { m: 'x' } })
    expect(() => t.respond('HTTP', {}, { request: { url: '/other' }, nth: 0 })).toThrow(/no pending HTTP request/)
    await t.respond('HTTP', { n: 'b' }, { request: { url: '/api/feed' }, nth: 1 })
    expect(t.state.loads).toEqual(['500 x', 'b'])
  })

  // a refetch of a resource sends an identical request; the older one is superseded
  function Quote({ state }) {
    const q = state.quote
    return h('p', { className: 'status' }, !q || q.status === 'loading' || q.refreshing ? 'Loading…' : q.status === 'success' ? q.data.text : q.status)
  }
  Quote.initialState = { id: 1 }
  Quote.resources = { quote: (state) => `/api/quotes/${state.id}` }
  Quote.model = { REFRESH: { HTTP: { refresh: 'quote' } } }

  it('the superseded older request throws at the call (G-140), by nth and by URL', async () => {
    t = renderComponent(Quote)
    await t.respond('HTTP', { text: 'one' }, 'quote')
    t.simulateAction('REFRESH')
    await t.next(s => s.quote.refreshing)
    t.simulateAction('REFRESH')
    await t.settle()
    const reqs = t.requests('HTTP')
    expect(reqs).toHaveLength(3)
    expect(reqs[1]).toEqual(reqs[2])
    expect(() => t.respond('HTTP', { text: 'stale' }, { nth: 1 })).toThrow(/t\.requests\('HTTP'\)\[1\].*not pending/)
    expect(() => t.respond('HTTP', { text: 'stale' }, { nth: -2 })).toThrow(/not pending/)
    // a URL or name still picks the newest pending (the live refetch)
    await t.respond('HTTP', { text: 'fresh' }, { nth: -1 })
    expect(t.query('.status').textContent).toBe('fresh')
    expect(() => t.respond('HTTP', { text: 'late' }, '/api/quotes/1')).toThrow(/no pending HTTP request/)
  })
})

// ── Ported from the p3-v6 trials, written as the agents wrote them (no dom: 'real', no
// identity predicates) ────────────────────────────────────────────────────────────────

describe('task 23 (sygnal-23-t2, first test file; t.query on the mock DOM)', () => {
  const QUOTE_IDS = [101, 102, 103]
  const STATUS_TEXT = { idle: '', loading: 'Loading…', error: 'Could not load the quote.', loaded: '' }
  function App({ state }) {
    return h('div', { className: 'quotes' },
      h('h1', null, 'Quotes'),
      h('ul', { className: 'quote-list' }, ...QUOTE_IDS.map(id => h('li', null,
        h('button', { className: id === state.selected ? 'pick selected' : 'pick', 'data-id': String(id) }, `Quote ${id}`)))),
      h('section', { className: 'detail' }, state.selected === null
        ? h('p', { className: 'placeholder' }, 'Select a quote.')
        : h('div', { className: 'quote' },
          h('h2', null, `Quote ${state.selected}`),
          h('button', { className: 'refresh' }, 'Refresh'),
          h('p', { className: 'status' }, STATUS_TEXT[state.status]),
          h('blockquote', { className: 'quote-text' }, state.status === 'loaded' ? state.quote.text : ''),
          h('p', { className: 'quote-author' }, state.status === 'loaded' ? state.quote.author : ''))))
  }
  App.initialState = { selected: null, status: 'idle', quote: null }
  App.intent = ({ DOM }) => ({
    SELECT: DOM.click('.pick').map((e) => Number(e.target.dataset.id)),
    REFRESH: DOM.click('.refresh'),
  })
  App.model = {
    SELECT: {
      STATE: (state, selected) => ({ ...state, selected, status: 'loading', quote: null }),
      HTTP: (state, selected) => ({ url: `/api/quotes/${selected}`, ok: 'LOADED', error: 'FAILED', key: 'quote', latest: true }),
    },
    REFRESH: {
      STATE: (state) => ({ ...state, status: 'loading', quote: null }),
      HTTP: (state) => ({ url: `/api/quotes/${state.selected}`, ok: 'LOADED', error: 'FAILED', key: 'quote', latest: true }),
    },
    LOADED: (state, quote) => ({ ...state, status: 'loaded', quote }),
    FAILED: (state) => ({ ...state, status: 'error', quote: null }),
  }

  const dijkstra = { id: 101, text: 'Simplicity is prerequisite for reliability.', author: 'Edsger W. Dijkstra' }
  const other = { id: 102, text: 'Other text', author: 'Someone' }

  it('loads the picked quote, showing Loading… meanwhile', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent('.pick[data-id="101"]', 'click')
    await t.next((s) => s.status === 'loading')
    expect(t.requests('HTTP').at(-1).url).toBe('/api/quotes/101')
    expect(t.query('.status').textContent).toBe('Loading…')
    await t.respond('HTTP', dijkstra, { url: '/api/quotes/101' })
    expect(t.query('.detail .quote-text').textContent).toBe(dijkstra.text)
    expect(t.query('.detail .quote-author').textContent).toBe(dijkstra.author)
    expect(t.query('.status').textContent).toBe('')
    t.expectNoDiagnostics()
  })

  it('shows the error and hides the quote on failure', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent('.pick[data-id="101"]', 'click')
    await t.next((s) => s.status === 'loading')
    await t.respond('HTTP', dijkstra)
    t.simulateEvent('.refresh', 'click')
    await t.next((s) => s.status === 'loading')
    expect(t.query('.quote-text').textContent).toBe('')
    expect(t.query('.quote-author').textContent).toBe('')
    await t.fail('HTTP', 500)
    expect(t.query('.status').textContent).toBe('Could not load the quote.')
    expect(t.query('.quote-text').textContent).toBe('')
    t.simulateEvent('.refresh', 'click')
    await t.next((s) => s.status === 'loading')
    await t.fail('HTTP', new TypeError('network'))
    expect(t.query('.status').textContent).toBe('Could not load the quote.')
    t.expectNoDiagnostics()
  })

  it('ignores superseded requests, even for the same quote', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent('.pick[data-id="101"]', 'click')
    await t.next((s) => s.status === 'loading')
    t.simulateEvent('.refresh', 'click')
    await t.next(() => t.requests('HTTP').length === 2)
    expect(() => t.respond('HTTP', dijkstra, { nth: 0 })).toThrow()   // was (r) => r === first

    t.simulateEvent('.pick[data-id="102"]', 'click')
    await t.next((s) => s.selected === 102)
    t.simulateEvent('.pick[data-id="101"]', 'click')
    await t.next((s) => s.selected === 101)
    expect(() => t.respond('HTTP', other, { url: '/api/quotes/102' })).toThrow()
    expect(() => t.respond('HTTP', dijkstra, { nth: 1 })).toThrow()  // was (r) => r === reqs[1]
    expect(t.query('.status').textContent).toBe('Loading…')
    await t.respond('HTTP', dijkstra, { nth: -1 })                     // was (r) => r === reqs.at(-1)
    expect(t.query('.quote-text').textContent).toBe(dijkstra.text)
    t.expectNoDiagnostics()
  })
})

describe('task 25 (sygnal-25-t1; written for the mock DOM, before it added dom: \'real\')', () => {
  const router = makeRouter({ routes: { list: '/', task: '/tasks/:id', edit: '/tasks/:id/edit', notFound: '*' } })
  const { href } = router
  const routeTask = (state) =>
    state.route.params.id === undefined ? undefined : state.tasks.find((t) => String(t.id) === state.route.params.id)
  const pageOf = (state) =>
    (state.route.name === 'task' || state.route.name === 'edit') && !routeTask(state) ? 'notFound' : state.route.name

  function TaskList({ state }) {
    return h('section', { className: 'task-list' }, h('h1', null, 'Tasks'),
      h('ul', { className: 'tasks' }, ...state.tasks.map(task => h('li', null, h('a', { href: href('task', { id: task.id }) }, task.title)))))
  }
  function TaskPage({ state }) {
    const task = routeTask(state)
    return h('section', { className: 'task-page' }, h('h1', null, task ? task.title : ''),
      task && h('a', { className: 'edit', href: href('edit', { id: task.id }) }, 'Edit'))
  }
  function EditPage({ state }) {
    const task = routeTask(state)
    return h('section', { className: 'edit-page' },
      h('h1', null, 'Edit task'),
      h('input', { name: 'title', value: state.draft }),
      h('button', { className: 'save' }, 'Save'),
      task && h('a', { className: 'cancel', href: href('task', { id: task.id }) }, 'Cancel'),
      state.leaving && h('div', { className: 'confirm' },
        h('p', null, 'Discard your changes?'),
        h('button', { className: 'leave' }, 'Leave'),
        h('button', { className: 'stay' }, 'Stay')))
  }
  EditPage.intent = ({ DOM }) => ({
    TYPE: DOM.input('input[name="title"]').value(),
    SAVE: DOM.click('.save'),
    LEAVE: DOM.click('.leave'),
    STAY: DOM.click('.stay'),
  })
  EditPage.model = {
    TYPE: {
      STATE: (state, draft) => ({ ...state, draft }),
      ROUTER: (state, draft) => (draft === routeTask(state).title ? { block: false } : { block: 'CONFIRM_LEAVE' }),
    },
    CONFIRM_LEAVE: (state, { proceed }) => ({ ...state, leaving: proceed }),
    LEAVE: {
      STATE: (state) => ({ ...state, leaving: null }),
      ROUTER: (state) => ({ ...state.leaving, block: false }),
    },
    STAY: (state) => ({ ...state, leaving: null }),
    SAVE: {
      STATE: (state) => {
        const id = routeTask(state).id
        return { ...state, tasks: state.tasks.map((t) => (t.id === id ? { ...t, title: state.draft } : t)) }
      },
      ROUTER: (state) => ({ to: 'task', params: { id: state.route.params.id }, block: false }),
    },
  }
  const NotFound = () => h('section', { className: 'not-found' }, h('h1', null, 'Not found'))
  function App({ state }) {
    return h('div', { className: 'app' },
      h('nav', null, h('a', { href: href('list') }, 'All tasks')),
      h('main', null, h(Switchable, { of: { list: TaskList, task: TaskPage, edit: EditPage, notFound: NotFound }, current: pageOf(state), instance: state.route.path })))
  }
  const tasks = [{ id: 1, title: 'Write the report' }, { id: 2, title: 'Book the venue' }, { id: 3, title: 'Send the invites' }]
  const draftFor = (state) => routeTask(state)?.title ?? ''
  const route = router.current()
  App.initialState = { route, draft: draftFor({ route, tasks }), leaving: null, tasks }
  App.route = 'ROUTE'
  App.model = {
    ROUTE: (state, route) => ({ ...state, route, draft: draftFor({ ...state, route }), leaving: null }),
  }

  const h1 = () => t.query('h1').textContent

  it('navigates with links, back and forward', async () => {
    t = renderComponent(App, { strict: true, router, url: '/' })
    await t.ready()
    t.simulateEvent('ul.tasks a[href="/tasks/2"]', 'click')
    await t.next((s) => s.route.path === '/tasks/2')
    expect(t.location.path).toBe('/tasks/2')
    expect(h1()).toBe('Book the venue')
    t.simulateEvent('a.edit', 'click')
    await t.next((s) => s.route.name === 'edit')
    expect(t.location.path).toBe('/tasks/2/edit')
    expect(t.query('input[name="title"]').value).toBe('Book the venue')
    t.simulateEvent('a.cancel', 'click')
    await t.next((s) => s.route.name === 'task')
    t.simulateEvent('nav a', 'click')
    await t.next((s) => s.route.name === 'list')
    expect(h1()).toBe('Tasks')
    await t.back()
    await t.settle()
    expect(t.location.path).toBe('/tasks/2')
    await t.forward()
    await t.settle()
    expect(h1()).toBe('Tasks')
    t.expectNoDiagnostics()
  })

  it('asks before leaving unsaved changes: Stay, then Leave', async () => {
    t = renderComponent(App, { strict: true, router, url: '/tasks/2/edit' })
    await t.ready()
    t.simulateEvent('input[name="title"]', 'input', { value: 'Changed' })
    await t.next((s) => s.draft === 'Changed')
    await t.settle()
    t.simulateEvent('nav a', 'click')
    await t.next((s) => s.leaving)
    expect(t.query('div.confirm').textContent).toContain('Discard your changes?')
    expect(t.location.path).toBe('/tasks/2/edit')
    expect(h1()).toBe('Edit task')

    t.simulateEvent('.stay', 'click')
    await t.next((s) => !s.leaving)
    expect(t.query('div.confirm')).toBeNull()
    expect(t.query('input[name="title"]').value).toBe('Changed')

    t.simulateEvent('a.cancel', 'click')
    await t.next((s) => s.leaving)
    t.simulateEvent('.leave', 'click')
    await t.next((s) => s.route.name === 'task')
    await t.settle()
    expect(t.location.path).toBe('/tasks/2')
    expect(h1()).toBe('Book the venue')
    t.expectNoDiagnostics()
  })
})
