// The parts a model may place on the dashboard.
import { defineCatalog } from 'sygnal/ai'
import { Kpi, OrdersTable } from './parts.jsx'
import Goals from './Goals.jsx'

export const catalog = defineCatalog({
  parts: {
    revenue: {
      component: Kpi, props: { metric: 'revenue' },
      description: "Revenue (KPI card: this month's revenue total)",
    },
    signups: {
      component: Kpi, props: { metric: 'signups' },
      description: 'Signups (KPI card: new signups this week)',
    },
    orders: {
      component: OrdersTable,
      description: 'Orders (table of the most recent orders: customer, amount, status)',
      params: {
        status: {
          label: 'order status', default: 'any',
          options: { any: 'orders of every status', paid: 'paid orders', pending: 'pending orders (not paid yet)', refunded: 'refunded orders' },
        },
      },
    },
    goals: {
      component: Goals, local: { ticks: {} }, props: ({ period = 'week' } = {}, state) => ({ period, goals: state.goals }),
      description: "Goals (checklist of the team's goals, ticked when done)",
      params: {
        period: {
          label: 'period', default: 'week',
          options: { week: "this week's goals", month: "this month's goals" },
        },
      },
    },
  },
})
