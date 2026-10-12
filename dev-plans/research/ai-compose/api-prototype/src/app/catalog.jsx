// The sample catalog every candidate uses: dashboard parts, working parts with app state, a record
// part (one per customer), a part with local state and a free-text param, and three containers.
import { defineCatalog, byId } from '../lib/catalog.jsx'
import { Kpi, OrdersTable, TicketList, Weather } from '../widgets/static.jsx'
import Checklist from '../widgets/Checklist.jsx'
import FeedbackForm from '../widgets/FeedbackForm.jsx'

export function RevenueChart({ range }) {
  return <figure className="chart" data={{ range }}>Revenue ({range})</figure>
}

// a record part: its own record through a lens, tells the host when it is opened (PARENT)
export function CustomerCard({ state, node }) {
  return (
    <article className="customer" data={{ node }}>
      <h3>{state.name}</h3>
      <input className="notes" aria-label="Notes" value={state.notes} />
      <button className="open">Open</button>
    </article>
  )
}
CustomerCard.intent = ({ DOM }) => ({ NOTES: DOM.input('.notes').value(), OPEN: DOM.click('.open') })
CustomerCard.model = {
  NOTES: (s, notes) => ({ ...s, notes }),
  OPEN: { PARENT: (s) => ({ id: s.id }) },
}

// a part with local state (kept in the composition: state.page.local[nodeKey]) and a free-text title
export function Note({ state, title }) {
  return <section className="note"><h4>{title}</h4><textarea className="note-text" aria-label="Note" value={state.text} /></section>
}
Note.intent = ({ DOM }) => ({ TEXT: DOM.input('.note-text').value() })
Note.model = { TEXT: (s, text) => ({ ...s, text }) }

const tabsView = ({ children, ui, control }) => (
  <div className="tabs">
    <div role="tablist">
      {children.map((c, i) => <button role="tab" aria-selected={String(i === (ui.tab || 0))} {...control('tab', i)}>{c.part.title || c.part.id}</button>)}
    </div>
    {children.map((c, i) => <div role="tabpanel" hidden={i !== (ui.tab || 0)}>{c.vnode}</div>)}
  </div>
)

export const catalog = defineCatalog({
  parts: {
    revenue: { component: Kpi, props: () => ({ metric: 'revenue' }), title: 'Revenue', description: "KPI card: this month's revenue ($48.2k)" },
    churn: { component: Kpi, props: () => ({ metric: 'churn' }), title: 'Churn', description: 'KPI card: churn rate this month (2.1%)' },
    revenueChart: {
      component: RevenueChart, title: 'Revenue chart', description: 'Line chart: the revenue trend',
      params: { range: { enum: ['month', 'quarter', 'year'], default: 'year', description: 'The time range the chart shows' } },
    },
    orders: { component: OrdersTable, title: 'Orders', description: 'Table of the most recent orders' },
    tickets: { component: TicketList, title: 'Tickets', description: 'List of open support tickets' },
    weather: { component: Weather, title: 'Weather', description: "Today's weather" },
    tasks: { component: Checklist, state: 'tasks', title: 'Tasks', description: "Checklist of the user's tasks for today" },
    feedback: { component: FeedbackForm, state: 'feedback', title: 'Feedback', description: 'Form to send product feedback' },
    customer: {
      component: CustomerCard, title: 'Customer', description: 'Customer record card (name, notes)',
      params: { id: { from: (state) => state.customers.map((c) => ({ value: c.id, description: c.name })) } },
      state: (node) => byId('customers', node.params.id),
    },
    note: {
      component: Note, title: 'Note', description: 'A note the user can write in, with a heading', local: { text: '' },
      params: { title: { type: 'string', maxLength: 40, required: true, description: 'The heading of the note' } },
    },
  },
  containers: {
    row: { description: 'Elements side by side, in a row', render: ({ slots }) => <div className="row">{slots.default}</div> },
    tabs: { description: 'Elements as tabs, one shown at a time', render: tabsView },
  },
})

export const STATE = {
  opened: null,
  tasks: [{ id: 1, text: 'Reply to Globex', done: false }, { id: 2, text: 'Triage Safari bug', done: false }],
  feedback: { draft: '', sent: [] },
  customers: [{ id: 7, name: 'Northwind', notes: '' }, { id: 9, name: 'Globex', notes: '' }],
}
