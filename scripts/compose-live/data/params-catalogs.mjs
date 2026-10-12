// Three app catalogs as plain data (the declaration format proposed in REPORT.md).
// A part: { id, description, params?: { name: { label, default, options: { value: description } } },
//           records?: { param, label, items: [{ key, description }] } }
// `description` is all the model sees of a part; option descriptions say what each value means.

const RANGE = {
  label: 'time range', default: 'month',
  options: { week: 'the last 7 days (this week)', month: 'the last 30 days (this month)', quarter: 'the last 3 months (this quarter)', year: 'the last 12 months (this year)' },
}

// a count mapped to an enum: the question names the vague words, each option the words it covers
const LIMIT = {
  label: 'number of rows', default: '10',
  ask: 'How long a list does user_request ask for, by a number or by words like few, short, long, full or all?',
  options: { 5: 'short: up to 5 rows (a few, a handful, top 3, top 5)', 10: 'medium: about 10 rows', 25: 'long: 25 rows (a long list, a full list, all of them, 20+)' },
}

export const OPS = {
  id: 'ops',
  parts: [
    { id: 'revenue', description: 'KPI card: revenue total as one number' },
    { id: 'signups', description: 'KPI card: number of new signups' },
    { id: 'churn', description: 'KPI card: customer churn rate' },
    { id: 'revenueChart', description: 'Line chart: the revenue trend over time', params: { range: RANGE } },
    {
      id: 'orders', description: 'Table of recent orders (customer, amount, status)',
      params: {
        status: { label: 'order status', default: 'all', options: { all: 'every order, any status', paid: 'paid orders only', pending: 'pending (unpaid) orders only', refunded: 'refunded orders only' } },
        limit: LIMIT,
      },
    },
    {
      id: 'tickets', description: 'List of support tickets',
      params: {
        status: { label: 'ticket status', default: 'open', options: { open: 'open tickets', closed: 'closed (resolved) tickets', all: 'all tickets, open and closed' } },
        priority: { label: 'priority', default: 'any', options: { any: 'tickets of any priority', high: 'high-priority (urgent) tickets only' } },
      },
    },
    { id: 'tasks', description: "Checklist of the user's tasks for today" },
    { id: 'weather', description: "Today's weather forecast for the office city" },
    { id: 'feedback', description: 'Form to send product feedback (a message and a send button)' },
  ],
}

const CATEGORIES = { all: 'every category', shoes: 'shoes, sneakers and boots', jackets: 'jackets and coats', bags: 'bags and backpacks', hats: 'hats and caps', socks: 'socks' }

export const SHOP = {
  id: 'shop',
  parts: [
    {
      id: 'salesChart', description: 'Bar chart of sales over time',
      params: { range: RANGE, metric: { label: 'measure', default: 'revenue', options: { revenue: 'sales in money (revenue)', units: 'number of items sold (units)' } } },
    },
    {
      id: 'products', description: 'Grid of products from the store catalog',
      params: {
        category: { label: 'product category', default: 'all', options: CATEGORIES },
        sort: { label: 'sort order', default: 'bestselling', options: { bestselling: 'best sellers first (most popular)', newest: 'newest arrivals first', priceLow: 'cheapest first (price low to high)', priceHigh: 'most expensive first (price high to low)' } },
      },
    },
    { id: 'lowStock', description: 'Alerts for products that are low on stock' },
    {
      id: 'reviews', description: 'List of customer product reviews',
      params: { rating: { label: 'rating', default: 'all', options: { all: 'all reviews', positive: 'positive reviews (4-5 stars)', negative: 'negative reviews (1-2 stars, complaints)' } } },
    },
    { id: 'cartAbandon', description: 'KPI card: abandoned cart rate' },
    {
      id: 'topCustomers', description: 'Table of top customers by spend',
      params: { limit: LIMIT },
    },
    { id: 'promo', description: 'Banner announcing the current promotion' },
    { id: 'returns', description: 'Table of recent returns and refund requests' },
  ],
}

// ---- records (project management) ----
const PEOPLE = ['Maya Chen', 'Jun Park', 'Ravi Patel', 'Lena Okafor', 'Tom Becker', 'Sara Lind', 'Diego Ruiz', 'Amira Haddad', 'Ken Ito', 'Olga Ivanova', 'Noah Kim', 'Priya Nair', 'Lucas Moreau', 'Hana Sato', 'Ben Adler', 'Zoe Martin', 'Omar Farouk', 'Ines Costa', 'Felix Wagner', 'Aiko Mori', 'Sam Taylor', 'Nora Berg', 'Ivan Petrov', 'Clara Diaz', 'Eli Cohen']
const ROLES = ['designer', 'backend engineer', 'frontend engineer', 'product manager', 'QA engineer', 'data analyst', 'mobile engineer', 'engineering manager']
const NAMES = ['Atlas', 'Borealis', 'Cedar', 'Dune', 'Ember', 'Fjord', 'Granite', 'Harbor', 'Iris', 'Juniper', 'Kestrel', 'Lumen', 'Meridian', 'Nimbus', 'Orchid', 'Polaris', 'Quartz', 'Raven', 'Sequoia', 'Tundra', 'Umbra', 'Vortex', 'Willow', 'Xenon', 'Yarrow', 'Zephyr', 'Aurora', 'Basalt', 'Comet', 'Delta', 'Echo', 'Falcon', 'Glacier', 'Helix', 'Indigo', 'Jade', 'Krypton', 'Lotus', 'Mosaic', 'Nova']
const KINDS = ['mobile app rewrite', 'billing migration', 'search revamp', 'data warehouse', 'onboarding redesign', 'API v3', 'security audit', 'marketing site', 'checkout optimization', 'internal tools']
const STATUS = ['on track', 'on track', 'at risk', 'on track', 'blocked', 'done']

/** n projects; n > 40 adds variants ("Atlas 2", ...) so names stay unique but confusable */
export function projects(n = 40) {
  return Array.from({ length: n }, (_, i) => {
    const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : '')
    const key = name.toLowerCase().replace(/ /g, '')
    return { key, name, description: `${name}: ${KINDS[(i * 3) % KINDS.length]}, owner ${PEOPLE[(i * 7) % PEOPLE.length]}, ${STATUS[i % STATUS.length]}` }
  })
}
const REPORT_TOPICS = ['Revenue review', 'Churn deep-dive', 'Hiring plan', 'Infra costs', 'Customer NPS', 'Sprint retro', 'Security incidents', 'Marketing funnel', 'Support SLA', 'Roadmap status']
export function reports(n = 30) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 10) - i * 3 * 86400000).toISOString().slice(0, 10)
    const name = `${REPORT_TOPICS[i % REPORT_TOPICS.length]}${i >= REPORT_TOPICS.length ? ` #${Math.floor(i / REPORT_TOPICS.length) + 1}` : ''}`
    return { key: `r${i + 1}`, name, description: `Saved report "${name}", saved ${d}` }
  })
}
export function members(n = 25) {
  return PEOPLE.slice(0, n).map((p, i) => ({ key: p.split(' ')[0].toLowerCase(), name: p, aliases: [p.split(' ')[0]], description: `${p}, ${ROLES[i % ROLES.length]}` }))
}

export function pm({ nProjects = 40 } = {}) {
  return {
    id: 'pm',
    parts: [
      { id: 'project', group: 'projects', description: "Project card: one project's status, owner and next milestone", records: { param: 'project', label: 'project', items: projects(nProjects) } },
      {
        id: 'projectList', group: 'projects', description: 'List of projects filtered by status, owner or kind',
        params: {
          status: { label: 'project status', default: 'any', options: { any: 'any status', onTrack: 'on track', atRisk: 'at risk', blocked: 'blocked', done: 'done (finished)' } },
          owner: { label: 'project owner', default: 'anyone', options: { anyone: 'owned by anyone', ...Object.fromEntries(PEOPLE.map((p) => [p.split(' ')[0].toLowerCase(), `owned by ${p}`])) } },
          kind: { label: 'kind of project', default: 'any', options: { any: 'any kind of project', ...Object.fromEntries(KINDS.map((k) => [k.replace(/ (\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, ''), k])) } },
        },
      },
      { id: 'team', group: 'people', description: 'Team roster: people and their roles', params: { role: { label: 'role', default: 'any', options: { any: 'everyone on the team', ...Object.fromEntries(ROLES.map((r) => [r.split(' ')[0], `${r}s`])) } } } },
      { id: 'report', group: 'reports', description: 'One saved report, opened', records: { param: 'report', label: 'saved report', items: reports(30) } },
      {
        id: 'reportList', group: 'reports', description: "List of the user's saved reports",
        params: {
          sort: { label: 'order', default: 'recent', options: { recent: 'most recently saved first', name: 'alphabetical by name' } },
          limit: { label: 'number of reports', default: '10', ask: 'How many reports does user_request ask for, by a number or by words like few, all or every?', options: { 3: 'short: about 3 reports (a few, top 3)', 10: 'medium: about 10 reports', 30: 'all: every saved report (a full list)' } },
        },
      },
      { id: 'member', group: 'people', description: "Team member card: one person's assigned tasks and workload", records: { param: 'member', label: 'team member', items: members(25) } },
      { id: 'burndown', description: 'Burndown chart of sprint progress', params: { sprint: { label: 'sprint', default: 'current', options: { current: 'the current sprint', previous: 'the previous (last) sprint' } } } },
      { id: 'activity', description: 'Feed of recent activity across all projects' },
      { id: 'calendar', description: 'Calendar of upcoming deadlines and meetings' },
    ],
  }
}
export const PM = pm()
