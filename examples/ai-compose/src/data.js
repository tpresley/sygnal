// The app's own data: every number, label and row the composed page shows comes from here, never
// from a model.

/** a part's card title (its params can narrow it: "Revenue, last 3 months") */
export const TITLES = {
  revenue: 'Revenue',
  signups: 'Signups',
  churn: 'Churn',
  revenueChart: 'Revenue',
  orders: 'Recent orders',
  tickets: 'Open tickets',
  tasks: 'Today',
  weather: 'Weather',
  feedback: 'Send feedback',
}

export const KPIS = {
  revenue: { value: '$48.2k', delta: '+12%', trend: 'up' },
  signups: { value: '312', delta: '+4%', trend: 'up' },
  churn: { value: '2.1%', delta: '-0.3 pt', trend: 'down' },
}

/** monthly revenue ($k), the last 12 months */
export const REVENUE = [31.0, 33.4, 32.1, 35.8, 37.2, 36.5, 39.9, 41.3, 40.2, 43.7, 43.0, 48.2]
export const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']
/** daily revenue ($k), the last 30 days */
export const DAILY = [1.4, 1.6, 1.5, 1.2, 1.1, 1.7, 1.8, 1.6, 1.5, 1.9, 1.4, 1.3, 1.6, 1.7, 1.8, 1.5, 1.4, 1.9, 2.0, 1.6, 1.5, 1.4, 1.8, 1.9, 1.7, 1.6, 1.5, 1.8, 1.9, 2.1]

export const ORDERS = [
  { id: 'A-1042', customer: 'Northwind', amount: '$1,240', status: 'paid' },
  { id: 'A-1041', customer: 'Globex', amount: '$860', status: 'pending' },
  { id: 'A-1040', customer: 'Initech', amount: '$2,315', status: 'paid' },
  { id: 'A-1039', customer: 'Umbrella', amount: '$410', status: 'refunded' },
  { id: 'A-1038', customer: 'Hooli', amount: '$1,975', status: 'paid' },
  { id: 'A-1037', customer: 'Stark', amount: '$3,100', status: 'pending' },
  { id: 'A-1036', customer: 'Wayne', amount: '$720', status: 'paid' },
  { id: 'A-1035', customer: 'Acme', amount: '$95', status: 'refunded' },
]

export const TICKETS = [
  { id: 381, priority: 'high', subject: 'Checkout fails on Safari' },
  { id: 377, priority: 'high', subject: 'Invoices missing VAT number' },
  { id: 384, priority: 'normal', subject: 'Export to CSV drops the last row' },
  { id: 385, priority: 'low', subject: 'Typo on the pricing page' },
]

export const WEATHER = { city: 'Honolulu', now: '27°C', summary: 'Trade winds, passing showers', high: '29°', low: '22°' }

export const TASKS = [
  { id: 1, text: 'Reply to Globex about their pending order', done: false },
  { id: 2, text: 'Triage the Safari checkout ticket', done: false },
  { id: 3, text: 'Review the October revenue report', done: true },
]

/** prompts to try (the chips under the prompt box) */
export const EXAMPLES = [
  'Sales overview: revenue, signups and churn side by side, then the revenue chart for the quarter',
  'My morning: the weather and my tasks for today',
  'Support desk: urgent tickets first, then the pending orders',
  'A feedback form at the top, and the open tickets below it',
  'Show me the stock price of Apple',
]
