// The parts the decision model may use. Each one is a working component with the app's own data;
// `description` is all the model sees of it, so it names what the part shows, with its numbers.
export const PARTS = [
  { id: 'revenue', title: 'Revenue', description: "KPI card: this month's revenue total as one number ($48.2k, +12% on last month)" },
  { id: 'signups', title: 'Signups', description: 'KPI card: new signups this week (312)' },
  { id: 'churn', title: 'Churn', description: 'KPI card: customer churn rate this month (2.1%)' },
  { id: 'revenueChart', title: 'Revenue, last 12 months', description: 'Line chart: the revenue trend over the last 12 months' },
  { id: 'orders', title: 'Recent orders', description: 'Table of the most recent orders (customer, amount, status)' },
  { id: 'tickets', title: 'Open tickets', description: 'List of open support tickets, by priority' },
  { id: 'tasks', title: 'Today', description: "Checklist of the user's tasks for today" },
  { id: 'weather', title: 'Weather', description: "Today's weather forecast for the office city" },
  { id: 'feedback', title: 'Send feedback', description: 'Form to send product feedback (a message and a send button)' },
]

export const KPIS = {
  revenue: { value: '$48.2k', delta: '+12%', trend: 'up' },
  signups: { value: '312', delta: '+4%', trend: 'up' },
  churn: { value: '2.1%', delta: '-0.3 pt', trend: 'down' },
}

export const REVENUE = [31.0, 33.4, 32.1, 35.8, 37.2, 36.5, 39.9, 41.3, 40.2, 43.7, 43.0, 48.2]
export const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']

export const ORDERS = [
  { id: 'A-1042', customer: 'Northwind', amount: '$1,240', status: 'paid' },
  { id: 'A-1041', customer: 'Globex', amount: '$860', status: 'pending' },
  { id: 'A-1040', customer: 'Initech', amount: '$2,315', status: 'paid' },
  { id: 'A-1039', customer: 'Umbrella', amount: '$410', status: 'refunded' },
  { id: 'A-1038', customer: 'Hooli', amount: '$1,975', status: 'paid' },
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
  'Sales overview: revenue, signups and churn side by side, then the revenue chart',
  'My morning: the weather and my tasks for today',
  'Support desk: open tickets first, then recent orders',
  'A feedback form at the top, and the open tickets below it',
  'Show me the stock price of Apple',
]
