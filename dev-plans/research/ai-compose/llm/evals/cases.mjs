// Labelled cases for the LLM path. Notation (llm-composer stringToLayout): page children top to
// bottom, separated by spaces; `row(a,b)` a container; `a{range=quarter}` enum params ('' = nothing fits).
// `text`: free-text params checked by "contains" (case-insensitive), e.g. { 'tickets.search': 'safari' }.

const DESCRIPTIONS = {
  revenue: "KPI card: this month's revenue total as one number ($48.2k, +12% on last month)",
  signups: 'KPI card: new signups this week (312)',
  churn: 'KPI card: customer churn rate this month (2.1%)',
  revenueChart: 'Line chart: the revenue trend over the last 12 months',
  orders: 'Table of the most recent orders (customer, amount, status)',
  tickets: 'List of open support tickets, by priority',
  tasks: "Checklist of the user's tasks for today",
  weather: "Today's weather forecast for the office city",
  feedback: 'Form to send product feedback (a message and a send button)',
}

const ROW = { id: 'row', description: 'Row: shows its parts side by side, left to right', container: { direction: 'row', slots: { default: { min: 2, max: 4, accepts: 'leaves' } } } }

/** the example's catalog (examples/ai-compose/src/parts.js) + a row container */
export const BASE = {
  root: 'page',
  maxDepth: 2,
  parts: [...Object.entries(DESCRIPTIONS).map(([id, description]) => ({ id, description })), ROW],
}

/** the same parts with enum params, free-text params and a titled section container */
export const EXT = {
  root: 'page',
  maxDepth: 2,
  parts: [
    ...BASE.parts.filter((p) => !['revenueChart', 'orders', 'tickets', 'row'].includes(p.id)),
    { id: 'revenueChart', description: 'Line chart: the revenue trend', params: { range: { description: 'time span shown', options: { month: 'the last 30 days', quarter: 'the last 3 months', year: 'the last 12 months' }, default: 'year' } } },
    { id: 'orders', description: 'Table of the most recent orders (customer, amount, status)', params: { status: { description: 'which orders', options: { all: 'every order', paid: 'paid orders only', pending: 'pending orders only', refunded: 'refunded orders only' }, default: 'all' } } },
    { id: 'tickets', description: 'List of open support tickets', params: {
      priority: { description: 'which tickets', options: { all: 'every priority', high: 'high priority (urgent) only' }, default: 'all' },
      search: { description: 'words a ticket must contain, from the request (e.g. "safari"); empty for no filter', text: { maxLength: 40 }, default: '', fallback: { default: '' } },
    } },
    ROW,
    { id: 'section', description: 'Section: a titled box around its parts, stacked', container: { direction: 'column', slots: { default: { min: 1, max: 4, accepts: 'leaves' } } },
      params: { title: { description: 'the section heading, from the request', text: { maxLength: 30 }, default: '', fallback: { options: ['Overview', 'Sales', 'Support', 'My day'] } } } },
  ],
}

/** the example's 11 labelled prompts (scripts/try-prompts.mjs), same expected layouts */
export const BASE_CASES = [
  ['Sales overview: revenue, signups and churn side by side, then the revenue chart', 'row(revenue,signups,churn) revenueChart'],
  ['My morning: the weather and my tasks for today', 'weather tasks'],
  ['Support desk: open tickets first, then recent orders', 'tickets orders'],
  ['A feedback form at the top, and the open tickets below it', 'feedback tickets'],
  ['Show me the stock price of Apple', ''],
  ['Put my tasks beside the weather, and a feedback form under them', 'row(tasks,weather) feedback'],
  ['Recent orders, the revenue chart, and below that a feedback form', 'orders revenueChart feedback'],
  ['The revenue chart, with the orders table above it and the tickets at the very bottom', 'orders revenueChart tickets'],
  ['How are sales doing?', 'revenue revenueChart'],
  ['What is on my plate today?', 'tasks'],
  ['Churn and signups next to each other', 'row(churn,signups)'],
].map(([prompt, want], i) => ({ id: `base-${i + 1}`, prompt, want }))

/** few-shot examples for BASE (prompts disjoint from the cases) */
export const BASE_SHOTS = [
  ['Show signups, then the weather', 'signups weather', ['signups', 'the weather']],
  ['Revenue and the orders table next to each other, then my tasks', 'row(revenue,orders) tasks', ['revenue', 'the orders table', 'my tasks']],
  ['Play some music', '', []],
]

/** params + generated text (EXT) */
export const EXT_CASES = [
  { prompt: 'Paid orders, and the revenue chart for this quarter', want: 'orders{status=paid} revenueChart{range=quarter}' },
  { prompt: 'Revenue over the past month, then the refunded orders', want: 'revenueChart{range=month} orders{status=refunded}' },
  { prompt: 'Urgent tickets only', want: 'tickets{priority=high}' },
  { prompt: 'The yearly revenue trend and all recent orders', want: 'revenueChart{range=year} orders{status=all}' },
  { prompt: 'Pending orders next to the high priority tickets', want: 'row(orders{status=pending},tickets{priority=high})' },
  { prompt: 'Tickets about the Safari checkout bug', want: 'tickets', text: { 'tickets.search': 'safari' } },
  { prompt: 'High priority tickets that mention invoices, and the weather', want: 'tickets{priority=high} weather', text: { 'tickets.search': 'invoice' } },
  { prompt: 'A section called "Money" with the revenue number and the revenue chart', want: 'section(revenue,revenueChart)', text: { 'section.title': 'money' } },
  { prompt: 'Group the weather and my tasks in a box titled My day, then the feedback form', want: 'section(weather,tasks) feedback', text: { 'section.title': 'my day' } },
  { prompt: 'Show me churn', want: 'churn' },
].map((c, i) => ({ id: `ext-${i + 1}`, ...c }))

/** follow-up edits on a previous layout (EXT) */
export const EDIT_CASES = [
  { prev: 'tickets orders', prompt: 'Put the orders first', want: 'orders tickets' },
  { prev: 'row(revenue,signups,churn) revenueChart', prompt: 'Drop churn', want: 'row(revenue,signups) revenueChart' },
  { prev: 'weather tasks', prompt: 'Add a feedback form at the bottom', want: 'weather tasks feedback' },
  { prev: 'revenue revenueChart', prompt: 'Show only the last quarter on the chart', want: 'revenue revenueChart{range=quarter}' },
  { prev: 'tasks weather', prompt: 'Put them side by side', want: 'row(tasks,weather)' },
  { prev: 'orders tickets', prompt: 'Replace the orders with the revenue chart', want: 'revenueChart tickets' },
  { prev: 'row(churn,signups)', prompt: 'Add the revenue KPI to the row, at the end', want: 'row(churn,signups,revenue)' },
  { prev: 'orders weather', prompt: 'Only the refunded orders', want: 'orders{status=refunded} weather' },
  { prev: 'row(tasks,weather) feedback', prompt: 'Move the feedback form to the top', want: 'feedback row(tasks,weather)' },
  { prev: 'revenue revenueChart', prompt: 'Also show urgent tickets, under the chart', want: 'revenue revenueChart tickets{priority=high}' },
].map((c, i) => ({ id: `edit-${i + 1}`, ...c }))

/** few-shot examples for a1's ops console catalog (prompts disjoint from its cases) */
export const OPS_SHOTS = [
  ['Show the on-call schedule, then recent postmortems', 'oncall postmortems', ['the on-call schedule', 'recent postmortems']],
  ['Backups and replication lag side by side, with the cron jobs under them', 'row(backups,replicationLag) cronJobs', ['backups', 'replication lag', 'the cron jobs']],
  ['Order lunch for the team', '', []],
]
