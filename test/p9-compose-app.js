// PLAN-9 (A): the sample catalog and host the compose suites share (ported from
// research/ai-compose/api-prototype/src/app): read-only parts, parts on app state, a record part
// (one per customer, a byId lens), a part with local state and a required free-text param, a part
// with a Collection inside, a part that reads context, a tabs container with a control, and a host
// with the compose behavior. Not a test file.
import { createElement as h } from '../src/pragma/index.ts'
import { Collection } from '../src/collection.ts'
import { byId } from '../src/extra/lens.ts'
import { ABORT } from '../src/shared.ts'
import { defineCatalog, compose, Composed } from '../src/extra/ai/index.ts'

// PLAN-9 M-1: the suites that use this host run twice: as written (catalog.render in the view) and
// through the <Composed> marker (test/p9-composed-parity.test.js sets globalThis.__COMPOSE_VIA)
export const VIA = () => globalThis.__COMPOSE_VIA || 'render'
/** the composition at `key` in the host's view, the way the run asks for */
export const show = (cat, state, key) => VIA() === 'marker' ? h(Composed, { catalog: cat, from: key }) : cat.render(state[key], state)

export const KPIS = { revenue: '$48.2k', churn: '2.1%' }
export function Kpi({ metric }) { return h('div', { className: 'kpi', 'data-metric': metric }, KPIS[metric]) }
export function RevenueChart({ range }) { return h('figure', { className: 'chart', 'data-range': range }, `Revenue (${range})`) }
export function Orders({ limit }) { return h('table', { className: 'orders', 'data-limit': String(limit) }, 'Orders') }
export function Tickets() { return h('ul', { className: 'tickets' }, h('li', null, 'Checkout fails')) }
export function Weather() { return h('div', { className: 'weather' }, '27°C') }

export function Checklist({ state }) {
  return h('ul', { className: 'checklist' }, ...state.map((t) => h('li', null,
    h('input', { type: 'checkbox', className: 'task-toggle', checked: t.done, 'data-id': t.id, 'aria-label': t.text }))))
}
Checklist.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.task-toggle').data('id', Number) })
Checklist.model = { TOGGLE: (tasks, id) => tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }

export function FeedbackForm({ state }) {
  return h('form', { className: 'feedback-form' }, h('textarea', { className: 'feedback-draft', value: state.draft, 'aria-label': 'Feedback' }))
}
FeedbackForm.intent = ({ DOM }) => ({ DRAFT: DOM.input('.feedback-draft').value() })
FeedbackForm.model = { DRAFT: (s, draft) => ({ ...s, draft }) }

// a record part: its own record through a byId lens; tells the host when it is opened (PARENT)
export function CustomerCard({ state, node }) {
  return h('article', { className: 'customer', 'data-node': node },
    h('h3', null, state.name), h('input', { className: 'notes', value: state.notes, 'aria-label': 'Notes' }),
    h('button', { className: 'open', type: 'button' }, 'Open'))
}
CustomerCard.intent = ({ DOM }) => ({ NOTES: DOM.input('.notes').value(), OPEN: DOM.click('.open') })
CustomerCard.model = { NOTES: (s, notes) => ({ ...s, notes }), OPEN: { PARENT: (s) => ({ id: s.id }) } }

// local state (kept in the composition: slice.local[nodeKey]) and a required free-text title
export const renders = { Note: 0 }
export function Note({ state, title }) {
  renders.Note++
  return h('section', { className: 'note' }, h('h4', null, title), h('textarea', { className: 'note-text', value: state.text, 'aria-label': 'Note' }))
}
Note.intent = ({ DOM }) => ({ TEXT: DOM.input('.note-text').value() })
Note.model = { TEXT: (s, text) => ({ ...s, text }) }

// a Collection inside a part
export function TodoItem({ state }) {
  return h('li', { className: 'todo' }, h('button', { className: 'todo-done', type: 'button' }, state.done ? 'done' : 'open'), state.text)
}
TodoItem.intent = ({ DOM }) => ({ DONE: DOM.click('.todo-done') })
TodoItem.model = { DONE: (s) => ({ ...s, done: !s.done }) }
export function TodoList() { return h('ul', { className: 'todos' }, h(Collection, { of: TodoItem, from: 'items' })) }

// reads the host's context
export function Badge({ context }) { return h('span', { className: 'badge' }, context.theme) }

const tabsView = ({ children, ui, control }) => h('div', { className: 'tabs' },
  h('div', { role: 'tablist' }, ...children.map((c, i) => h('button', { role: 'tab', type: 'button', 'aria-selected': String(i === (ui.tab || 0)), ...control('tab', i) }, c.part.id))),
  ...children.map((c, i) => h('div', { role: 'tabpanel', hidden: i !== (ui.tab || 0) }, c.vnode)))

export const catalog = defineCatalog({
  parts: {
    revenue: { component: Kpi, props: { metric: 'revenue' }, description: "Revenue (KPI card: this month's total)" },
    churn: { component: Kpi, props: () => ({ metric: 'churn' }), description: 'Churn (KPI card: churn rate this month)' },
    revenueChart: { component: RevenueChart, description: 'Revenue chart (the revenue trend)',
      params: { range: { label: 'time range', default: 'year', options: { month: 'the last 30 days', quarter: 'the last 3 months', year: 'the last 12 months' } } } },
    orders: { component: Orders, description: 'Orders (the most recent orders)', in: ['page', 'tabs'],
      params: { limit: { type: 'number', default: 10, min: 1, max: 50, bins: { 5: 'a few', 10: 'ten', 25: 'many' } } } },
    tickets: { component: Tickets, description: 'Tickets (open support tickets)' },
    weather: { component: Weather, description: "Weather (today's weather)" },
    tasks: { component: Checklist, state: 'tasks', description: "Tasks (the user's checklist)", in: ['page', 'tabs'] },
    feedback: { component: FeedbackForm, state: 'feedback', description: 'Feedback (a form to send feedback)', in: ['page', 'tabs'] },
    customer: { component: CustomerCard, description: 'Customer (a record card: name, notes)', maxUses: 4,
      params: { id: { label: 'customer', from: (s) => s.customers.map((c) => ({ value: c.id, name: c.name, description: c.name })) } },
      state: (node) => byId('customers', node.params.id) },
    note: { component: Note, local: { text: '' }, description: 'Note (a scratch note with a heading)', maxUses: 2,
      params: { title: { type: 'text', label: 'heading', maxLength: 40, required: true } } },
    todos: { component: TodoList, state: 'todos', description: 'Todos (a todo list)' },
    badge: { component: Badge, description: 'Badge (the theme)' },
  },
  containers: {
    tabs: { slots: { overview: 'Overview tab', billing: 'Billing tab' }, minSlots: 2, render: tabsView },
  },
})

export const STATE = {
  opened: null, theme: 'dark', lastDone: null, doneCount: 0,
  tasks: [{ id: 1, text: 'Reply to Globex', done: false }, { id: 2, text: 'Triage', done: false }],
  feedback: { draft: '' },
  customers: [{ id: 7, name: 'Northwind', notes: '' }, { id: 9, name: 'Globex', notes: '' }],
  todos: { items: [{ id: 'a', text: 'Milk', done: false }, { id: 'b', text: 'Eggs', done: false }] },
}

/** the host: a prompt form, the status, and the composition */
export function makeApp(backend, extra = {}) {
  function App({ state }) {
    const page = state.page
    return h('div', { className: 'app' },
      h('form', { className: 'ask' }, h('input', { className: 'prompt', value: page.prompt, 'aria-label': 'What to show' }), h('button', { type: 'submit' }, 'Compose')),
      h('p', { className: 'status' }, page.status),
      h('p', { className: 'opened' }, String(state.opened ?? '')),
      h('main', { className: page.preview ? 'canvas preview' : 'canvas' }, show(catalog, state, 'page')))
  }
  App.initialState = { ...STATE }
  App.uses = { page: compose(catalog, { backend, form: '.ask', prompt: '.prompt' }) }
  App.context = { theme: (s) => s.theme }
  App.intent = ({ CHILD }) => ({ OPENED: CHILD.select(CustomerCard) })
  App.model = {
    OPENED: (state, { id }) => ({ ...state, opened: id }),
    // runs after the behavior's own DONE
    'page.DONE': (state, layout) => ({ ...state, lastDone: Object.keys(layout.nodes).length, doneCount: state.doneCount + 1 }),
    THEME: (state, theme) => (theme === state.theme ? ABORT : { ...state, theme }),
    BUMP: (state) => ({ ...state, tasks: [...state.tasks] }),
  }
  Object.assign(App, extra)
  return App
}
