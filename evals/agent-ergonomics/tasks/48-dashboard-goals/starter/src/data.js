// The app's data (seed values).

export const GOALS = [
  { id: 1, text: 'Ship the billing page', period: 'week', done: false },
  { id: 2, text: 'Answer every open support ticket', period: 'week', done: true },
  { id: 3, text: 'Hire a product designer', period: 'month', done: false },
  { id: 4, text: 'Launch the mobile beta', period: 'month', done: false },
  { id: 5, text: 'Close the Q3 books', period: 'month', done: false },
]

export const ORDERS = [
  { id: 'A-1041', customer: 'Northwind', amount: 1200, status: 'paid' },
  { id: 'A-1042', customer: 'Globex', amount: 340, status: 'pending' },
  { id: 'A-1043', customer: 'Initech', amount: 980, status: 'paid' },
  { id: 'A-1044', customer: 'Umbrella', amount: 150, status: 'refunded' },
  { id: 'A-1045', customer: 'Hooli', amount: 2210, status: 'pending' },
]

export const METRICS = {
  revenue: { label: 'Revenue this month', value: '$48.2k' },
  signups: { label: 'Signups this week', value: '312' },
}
