// The parts a model may place: one catalog for both backends (a decision model and a chat LLM).
//
// A part is a working component with the app's own data. `description` is all a model sees of
// it: "Noun (what it shows)", leading with the word a user says, never naming another part's
// content. Params are the only inputs a model gives, each picked from a fixed list (an enum, or a
// number the decision model picks as a bin). `state` is a lens into the app state, so the
// checklist's ticks and the feedback draft survive any recomposition.
import { defineCatalog } from 'sygnal/ai'
import { Kpi, RevenueChart, OrdersTable, TicketList, Weather } from './widgets/static.jsx'
import Checklist from './widgets/Checklist.jsx'
import FeedbackForm from './widgets/FeedbackForm.jsx'

export const catalog = defineCatalog({
  parts: {
    revenue: {
      component: Kpi, props: { metric: 'revenue' },
      description: "Revenue (KPI card: this month's revenue total as one number, $48.2k)",
    },
    signups: {
      component: Kpi, props: { metric: 'signups' },
      description: 'Signups (KPI card: new signups this week, 312)',
    },
    churn: {
      component: Kpi, props: { metric: 'churn' },
      description: 'Churn (KPI card: the customer churn rate this month, 2.1%)',
    },
    revenueChart: {
      component: RevenueChart,
      description: 'Revenue chart (line chart of the revenue trend over time)',
      params: {
        range: {
          label: 'time range', default: 'year',
          options: { year: 'the last 12 months (this year)', quarter: 'the last 3 months (this quarter)', month: 'the last 30 days (this month)' },
        },
      },
    },
    orders: {
      component: OrdersTable,
      description: 'Orders (table of the most recent orders: customer, amount, status)',
      params: {
        status: {
          label: 'order status', default: 'any',
          options: { any: 'orders of every status', paid: 'paid orders', pending: 'pending orders (not paid yet)', refunded: 'refunded orders' },
        },
        limit: {
          type: 'number', label: 'how many rows', default: 5, min: 1, max: 8,
          bins: { 3: 'a few (top 3)', 5: 'five (the default)', 8: 'all of the recent orders' },
        },
      },
    },
    tickets: {
      component: TicketList,
      description: 'Tickets (list of open support tickets, by priority)',
      params: {
        priority: { label: 'priority', default: 'any', options: { any: 'every open ticket', high: 'only high-priority (urgent) tickets' } },
      },
    },
    tasks: { component: Checklist, state: 'tasks', description: "Tasks (checklist of the user's tasks for today)" },
    weather: { component: Weather, description: "Weather (today's weather forecast for the office city)" },
    feedback: {
      component: FeedbackForm, state: 'feedback',
      description: 'Feedback form (a form to send product feedback: a message and a send button)',
    },
  },
})
