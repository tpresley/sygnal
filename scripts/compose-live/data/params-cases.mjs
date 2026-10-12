// Labelled cases. Expected layouts are written as blocks (layoutOf): 'part', { part, params }, [row members].
import { OPS, SHOP, pm, PM } from './params-catalogs.mjs'

const P = (part, params) => ({ part, params })

// ---- 1. params: a fresh composition; scored on the parts + params (and the full layout) ----
export const PARAM_CASES = [
  [OPS, 'Show the revenue chart for last quarter', [P('revenueChart', { range: 'quarter' })]],
  [OPS, 'Revenue trend this year', [P('revenueChart', { range: 'year' })]],
  [OPS, 'The revenue chart', ['revenueChart']],
  [OPS, 'Pending orders', [P('orders', { status: 'pending' })]],
  [OPS, 'Top 5 refunded orders', [P('orders', { status: 'refunded', limit: '5' })]],
  [OPS, 'A long list of all recent orders', [P('orders', { limit: '25' })]],
  [OPS, 'Urgent tickets and the weather', [P('tickets', { priority: 'high' }), 'weather']],
  [OPS, 'Closed support tickets, then the weekly revenue chart', [P('tickets', { status: 'closed' }), P('revenueChart', { range: 'week' })]],
  [OPS, 'Revenue, signups and the revenue chart', ['revenue', 'signups', 'revenueChart']],
  [OPS, 'Show every support ticket, resolved or not', [P('tickets', { status: 'all' })]],
  [SHOP, 'Show our newest jackets', [P('products', { category: 'jackets', sort: 'newest' })]],
  [SHOP, 'Cheapest shoes', [P('products', { category: 'shoes', sort: 'priceLow' })]],
  [SHOP, 'Units sold over the last 12 months', [P('salesChart', { range: 'year', metric: 'units' })]],
  [SHOP, 'Negative reviews and the returns table', [P('reviews', { rating: 'negative' }), 'returns']],
  [SHOP, 'Best-selling bags, and our top 3 customers', [P('products', { category: 'bags' }), P('topCustomers', { limit: '5' })]],
  [SHOP, 'Sales this week', [P('salesChart', { range: 'week' })]],
  [SHOP, 'Product grid and customer reviews', ['products', 'reviews']],
  [SHOP, 'What are people complaining about?', [P('reviews', { rating: 'negative' })]],
  [SHOP, 'Our most expensive products', [P('products', { sort: 'priceHigh' })]],
  [SHOP, 'The promo banner above the full list of top customers', ['promo', P('topCustomers', { limit: '25' })]],
]

// ---- 2. records: scored on the node multiset (order is the pairwise step's job, not scored) ----
// `want` is a function of the catalog so the same cases label the 40- and 200-project catalogs.
const named = (...keys) => () => keys.map((k) => P('project', { project: k }))
export const RECORD_CASES = [
  ['Show the Atlas and Borealis projects', named('atlas', 'borealis')],
  ['How is Cedar doing?', named('cedar')],
  ['The Meridian project and the burndown chart', () => [P('project', { project: 'meridian' }), 'burndown']],
  ["Show Maya's workload", () => [P('member', { member: 'maya' })]],
  ["Jun and Ravi's tasks", () => [P('member', { member: 'jun' }), P('member', { member: 'ravi' })]],
  ['Open the Infra costs #2 report', () => [P('report', { report: 'r14' })]],
  ['My three most recent reports', () => [P('reportList', { limit: '3' })]],
  ['All my saved reports, alphabetical', () => [P('reportList', { sort: 'name', limit: '30' })]],
  ['Projects that are blocked', () => [P('projectList', { status: 'blocked' })]],
  ['Every project Maya Chen owns', () => [P('projectList', { owner: 'maya' })]],
  ['The Polaris and Nova projects side by side', named('polaris', 'nova')],
  ['The activity feed and the Harbor project', () => ['activity', P('project', { project: 'harbor' })]],
  ["Lena's card and the calendar", () => [P('member', { member: 'lena' }), 'calendar']],
  ["What's the status of Iris, Jade and Lotus?", named('iris', 'jade', 'lotus')],
  ['Show me the Phoenix project', () => []],
  ['Burndown for the last sprint', () => [P('burndown', { sprint: 'previous' })]],
  ['The designers on the team', () => [P('team', { role: 'designer' })]],
  ['Security audit projects', () => [P('projectList', { kind: 'securityAudit' })]],
  ["Jun's card and the Sequoia project", () => [P('member', { member: 'jun' }), P('project', { project: 'sequoia' })]],
  ['Atlas, Borealis, Cedar and Dune, side by side', named('atlas', 'borealis', 'cedar', 'dune')],
]
export const PM40 = pm({ nProjects: 40 })
export const PM200 = pm({ nProjects: 200 })

// ---- 3. edits: previous layout + prompt → expected layout (or `accept`: a predicate) ----
const A = ['revenue', 'revenueChart', 'orders', 'tickets']
const B = [['revenue', 'signups', 'churn'], P('revenueChart', { range: 'year' }), 'tasks']
const C = ['promo', P('products', { category: 'shoes' }), 'reviews']
const shoes = P('products', { category: 'shoes' })
const year = P('revenueChart', { range: 'year' })
export const EDIT_CASES = [
  [OPS, A, 'Add the weather', [...A, 'weather']],
  [OPS, A, 'Remove the chart', ['revenue', 'orders', 'tickets']],
  [OPS, A, 'Move the tickets to the top', ['tickets', 'revenue', 'revenueChart', 'orders']],
  [OPS, A, 'Put the orders next to the revenue', [['revenue', 'orders'], 'revenueChart', 'tickets']],
  [OPS, A, 'Swap the line chart for my task checklist', ['revenue', 'tasks', 'orders', 'tickets']],
  [OPS, A, 'Show last quarter instead', ['revenue', P('revenueChart', { range: 'quarter' }), 'orders', 'tickets']],
  [OPS, A, 'Make it simpler', null, 'simpler'],
  [OPS, A, 'Drop the tickets and add a feedback form at the top', ['feedback', 'revenue', 'revenueChart', 'orders']],
  [OPS, A, 'Only pending orders, and remove the revenue card', ['revenueChart', P('orders', { status: 'pending' }), 'tickets']],
  [OPS, A, 'Add signups and churn', [...A, 'signups', 'churn']],
  [OPS, A, 'Put the weather at the top', ['weather', ...A]],
  [OPS, A, 'Move the revenue chart below the orders', ['revenue', 'orders', 'revenueChart', 'tickets']],
  [OPS, B, 'Remove churn', [['revenue', 'signups'], year, 'tasks']],
  [OPS, B, 'Show the chart for this week and move my tasks to the top', ['tasks', ['revenue', 'signups', 'churn'], P('revenueChart', { range: 'week' })]],
  [OPS, B, 'Replace the tasks with the weather', [['revenue', 'signups', 'churn'], year, 'weather']],
  [SHOP, C, 'Show jackets instead', ['promo', P('products', { category: 'jackets' }), 'reviews']],
  [SHOP, C, 'Only the negative reviews', ['promo', shoes, P('reviews', { rating: 'negative' })]],
  [SHOP, C, 'Get rid of the banner', [shoes, 'reviews']],
  [SHOP, C, 'Add the sales chart between the banner and the products', ['promo', 'salesChart', shoes, 'reviews']],
  [SHOP, C, 'Sort the products by price, cheapest first, and add low stock alerts below them', ['promo', P('products', { category: 'shoes', sort: 'priceLow' }), 'lowStock', 'reviews']],
  [SHOP, C, 'Swap the reviews for the returns table', ['promo', shoes, 'returns']],
  [SHOP, C, 'Thanks, looks good', C],
]

// ---- 3b. held-out edit cases: written after the encoding was tuned on EDIT_CASES, never tuned on ----
const D = [P('tickets', { priority: 'high' }), P('orders', { status: 'pending' }), 'weather']
const E = [P('salesChart', { range: 'week' }), 'topCustomers', 'lowStock']
const F = [P('project', { project: 'atlas' }), P('project', { project: 'borealis' }), 'burndown']
const week = P('salesChart', { range: 'week' })
const atlas = P('project', { project: 'atlas' })
const borealis = P('project', { project: 'borealis' })
export const EDIT_HELDOUT = [
  [OPS, D, 'Show all tickets, not just the urgent ones', ['tickets', D[1], 'weather']],
  [OPS, D, 'Get rid of the weather and put the revenue chart first', ['revenueChart', D[0], D[1]]],
  [OPS, D, 'Put the weather beside the tickets', [[D[0], 'weather'], D[1]]],
  [OPS, D, 'I also need the churn rate', [...D, 'churn']],
  [OPS, D, 'Replace the orders with the signups card', [D[0], 'signups', 'weather']],
  [OPS, D, 'Show 25 orders', [D[0], P('orders', { status: 'pending', limit: '25' }), 'weather']],
  [SHOP, E, 'Switch the chart to units', [P('salesChart', { range: 'week', metric: 'units' }), 'topCustomers', 'lowStock']],
  [SHOP, E, 'Low stock alerts first please', ['lowStock', week, 'topCustomers']],
  [SHOP, E, 'Remove the customers table and the stock alerts', [week]],
  [SHOP, E, 'Add the promo banner on top and the reviews at the bottom', ['promo', ...E, 'reviews']],
  [SHOP, E, 'Show the whole year', [P('salesChart', { range: 'year' }), 'topCustomers', 'lowStock']],
  [SHOP, E, 'Clean this up, too much going on', null, 'simpler'],
  [PM, F, 'Add the Cedar project', [...F, P('project', { project: 'cedar' })]],
  [PM, F, 'Remove Atlas', [borealis, 'burndown']],
  [PM, F, "Show the previous sprint's burndown at the top", [P('burndown', { sprint: 'previous' }), atlas, borealis]],
  [PM, F, 'Swap Borealis for Juniper', [atlas, P('project', { project: 'juniper' }), 'burndown']],
]
