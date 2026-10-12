// PLAN-9 worker B: test fixtures ported verbatim from the research (dev-plans/research/ai-compose/):
//   - structure/evals/catalogs.mjs: the five labelled structure catalogs and their cases (the
//     research's `OPS` part table is renamed OPS_BY_CATEGORY here: params-edits has an `OPS` catalog);
//   - params-edits/evals/catalogs.mjs + cases.mjs (PARAM_CASES, RECORD_CASES): the params and
//     records catalogs.
// Research catalog format (plain data); test/p9-decisions-catalogs.js converts it to the PLAN-9
// declaration (defineCatalog) format. Don't edit the data: it is what the research numbers were
// measured on.

// ======================= structure/evals/catalogs.mjs =======================
// The five labelled catalogs, as plain, backend-neutral data (no questions, no model wording).
//
// Catalog shape:
//   { id, root: { id, description }, rows: bool, guidance?: string, limits?: { maxParts, maxDepth },
//     parts: [Part] }
// Part:
//   id, description             what the model sees of it (all it sees)
//   category?                   for the scale pre-filter (ops console)
//   in?: [dest]                 allowed parents: 'page' (the root), a container id (any slot of it) or
//                               'container:slot'. Default ['page'].
//   slots?: { name: description|null }   makes it a container ('default' = unnamed slot)
//   auto?: true                 container: never selected itself; present when something lands in it
//   arranged?: true             container lays its children out itself (grid, tabs): no rows inside
//   minSlots?: n                container: unwrapped when fewer than n slots are non-empty (tabs: 2)
//   resource?: string           mutually exclusive variants share a resource (one choice for the group)
//   maxUses?: n                 the part may appear up to n times
//   required?: true             always on the page (does not count as "something fits")
//   pin?: 'start'|'end'          always first / last among its siblings (no order questions)
//   companions?: [ids]          included whenever this part is (e.g. a field brings Save / Cancel)
//
// Cases: [prompt, expected] in the compact notation of composer.mjs `format()`:
//   page(a row(b c) tabs[overview: d e | billing: f])   ''  = nothing in the catalog fits

export const dashboard = {
  id: 'dashboard',
  root: { id: 'page', description: 'A dashboard page' },
  rows: true,
  parts: [
    { id: 'revenue', description: "KPI card: this month's revenue total as one number ($48.2k, +12% on last month)" },
    { id: 'signups', description: 'KPI card: new signups this week (312)' },
    { id: 'churn', description: 'KPI card: customer churn rate this month (2.1%)' },
    { id: 'revenueChart', description: 'Line chart: the revenue trend over the last 12 months' },
    { id: 'orders', description: 'Table of the most recent orders (customer, amount, status)' },
    { id: 'tickets', description: 'List of open support tickets, by priority' },
    { id: 'tasks', description: "Checklist of the user's tasks for today" },
    { id: 'weather', description: "Today's weather forecast for the office city" },
    { id: 'feedback', description: 'Form to send product feedback (a message and a send button)' },
  ],
  cases: [
    ['KPIs in a row (revenue, signups and churn), then the revenue chart and the orders table side by side', 'page(row(revenue signups churn) row(revenueChart orders))'],
    ['Sales overview: revenue, signups and churn side by side, then the revenue chart', 'page(row(revenue signups churn) revenueChart)'],
    ['Open tickets and recent orders next to each other, and below them my tasks beside the weather', 'page(row(tickets orders) row(tasks weather))'],
    ['How are sales doing?', 'page(revenue revenueChart)'],
    ['Show me the stock price of Apple', ''],
    ['The revenue chart on top, then churn and signups side by side, then a feedback form', 'page(revenueChart row(churn signups) feedback)'],
    ['Support desk: open tickets first, then recent orders', 'page(tickets orders)'],
    ['Weather and tasks in a row at the top; the revenue chart under them', 'page(row(weather tasks) revenueChart)'],
    ['Open tickets on the left and the feedback form on the right, with the three KPIs in a row above them', 'page(row(revenue signups churn) row(tickets feedback))'],
    ['What is on my plate today?', 'page(tasks)'],
    ['Revenue: the number and the chart side by side, then the recent orders', 'page(row(revenue revenueChart) orders)'],
    ['Churn and signups next to each other', 'page(row(churn signups))'],
    ['Three rows: revenue and signups; then churn and the revenue chart; then the recent orders and the open tickets', 'page(row(revenue signups) row(churn revenueChart) row(orders tickets))'],
    ['The weather on its own at the top, then my tasks and the feedback form side by side', 'page(weather row(tasks feedback))'],
    ['Revenue chart full width, recent orders and open tickets side by side under it, then the three KPI cards (revenue, signups, churn) in a row at the bottom', 'page(revenueChart row(orders tickets) row(revenue signups churn))'],
  ],
}

const ACT = ['save', 'cancel']
export const settings = {
  id: 'settings',
  root: { id: 'page', description: 'An account settings page' },
  rows: false,
  parts: [
    { id: 'profile', description: 'Section titled "Profile": who the user is (name, photo, bio)', slots: { default: null }, auto: true },
    { id: 'security', description: 'Section titled "Security": signing in and protecting the account', slots: { default: null }, auto: true },
    { id: 'notifications', description: 'Section titled "Notifications": which emails and alerts the user gets', slots: { default: null }, auto: true },
    { id: 'preferences', description: 'Section titled "Preferences": language, time zone and appearance', slots: { default: null }, auto: true },
    { id: 'billing', description: 'Section titled "Billing": plan, payment card and invoices', slots: { default: null }, auto: true },
    { id: 'actions', description: 'Bar of form buttons at the end of the form', slots: { default: null }, auto: true, arranged: true },
    { id: 'displayName', description: 'Text field: the user\'s name, as other people see it', in: ['profile'], companions: ACT },
    { id: 'avatar', description: 'Photo upload: profile picture', in: ['profile'], companions: ACT },
    { id: 'bio', description: 'Text area: short bio', in: ['profile'], companions: ACT },
    { id: 'email', description: 'Text field: the email address used to sign in', in: ['profile', 'security'], companions: ACT },
    { id: 'password', description: 'Password (change it: current and new password fields)', in: ['security'], companions: ACT },
    { id: 'twoFactor', description: 'Toggle: two-factor authentication', in: ['security'], companions: ACT },
    { id: 'sessions', description: 'List of signed-in devices, each with a sign-out button', in: ['security'] },
    { id: 'emailNotifs', description: 'Toggles: which notification emails to receive (mentions, replies, product news)', in: ['notifications'], companions: ACT },
    { id: 'pushNotifs', description: 'Toggle: push notifications on this device', in: ['notifications'], companions: ACT },
    { id: 'digest', description: 'Select: how often to get the summary email (daily, weekly, never)', in: ['notifications'], companions: ACT },
    { id: 'language', description: 'Select: interface language', in: ['preferences', 'profile'], companions: ACT },
    { id: 'timezone', description: 'Select: time zone', in: ['preferences', 'profile'], companions: ACT },
    { id: 'theme', description: 'Choice: light, dark or system color theme', in: ['preferences'], companions: ACT },
    { id: 'plan', description: 'Current plan (Pro, $20/month) with a change-plan button', in: ['billing'] },
    { id: 'card', description: 'Payment card on file (Visa ending 4242) with an update button', in: ['billing'] },
    { id: 'invoices', description: 'Table of past invoices with download links', in: ['billing'] },
    { id: 'save', description: 'Button: Save changes', in: ['actions'] },
    { id: 'cancel', description: 'Button: Cancel (discard changes)', in: ['actions'] },
    { id: 'deleteAccount', description: 'Button: Delete account (permanent, danger)', in: ['security', 'page'] },
  ],
  guidance: 'Conventional order: form fields before the form buttons; Save before Cancel.',
  cases: [
    ['Let me change my password and turn on two-factor', 'page(security(password twoFactor) actions(save cancel))'],
    ['Profile settings: name, photo and bio', 'page(profile(displayName avatar bio) actions(save cancel))'],
    ['Notification settings', 'page(notifications(emailNotifs pushNotifs digest) actions(save cancel))'],
    ['Billing: show my plan and past invoices', 'page(billing(plan invoices))'],
    ['My name, then language and time zone, all in the Profile section', 'page(profile(displayName language timezone) actions(save cancel))'],
    ['Language, time zone and theme', 'page(preferences(language timezone theme) actions(save cancel))'],
    ['Signed-in devices, and a delete account button at the very bottom of the page, outside any section', 'page(security(sessions) deleteAccount)'],
    ['Sign-in security: my email address and password', 'page(security(email password) actions(save cancel))'],
    ['Update my credit card', 'page(billing(card))'],
    ['Order a pizza', ''],
    ['Push notifications first, then my display name and photo', 'page(notifications(pushNotifs) profile(displayName avatar) actions(save cancel))'],
    ['Dark mode setting', 'page(preferences(theme) actions(save cancel))'],
  ],
}

const ANY = ['page', 'tabs']
export const crm = {
  id: 'crm',
  root: { id: 'page', description: 'A customer record page in a CRM' },
  rows: true,
  parts: [
    { id: 'header', description: 'Record header: customer name, company, status badge and owner', required: true, pin: 'start' },
    {
      id: 'tabs', description: 'Tabs', auto: true, minSlots: 2,
      slots: {
        overview: 'Overview tab: who the customer is (contact, company, deals, notes)',
        activity: 'Activity tab: what happened and what is next (timeline, emails, meetings, tasks)',
        billing: 'Billing tab: money (subscription, invoices, payments)',
      },
    },
    { id: 'keyFacts', description: 'Card titled "Key facts": a boxed summary', slots: { default: null }, auto: true, in: ['tabs:overview', 'page'] },
    { id: 'contact', description: 'Contact details: email, phone, address', in: [...ANY, 'keyFacts'] },
    { id: 'company', description: 'Company profile: industry, size, website', in: [...ANY, 'keyFacts'] },
    { id: 'deals', description: 'Deals (open, with stage and amount)', in: ANY },
    { id: 'notes', description: 'Notes the team wrote about this customer', in: ANY },
    { id: 'timeline', description: 'Activity timeline: one chronological feed of everything logged on the record, newest first', in: ANY },
    { id: 'emails', description: 'Email threads with this customer', in: ANY },
    { id: 'meetings', description: 'Upcoming and past meetings', in: ANY },
    { id: 'tasks', description: 'Follow-up tasks for this customer', in: ANY },
    { id: 'subscription', description: 'Current subscription: plan, seats, renewal date', in: ANY },
    { id: 'invoices', description: 'Invoices: each bill sent to the customer, with its amount and due date', in: ANY },
    { id: 'payments', description: 'Payment history and the card on file', in: ANY },
  ],
  cases: [
    ['Contact details and deals on the overview, the activity timeline on the activity tab, and invoices under billing', 'page(header tabs[overview: contact deals | activity: timeline | billing: invoices])'],
    ["Show me the customer's contact info and their invoices", 'page(header tabs[overview: contact | billing: invoices])'],
    ['Just the contact details', 'page(header contact)'],
    ['Contact details on the overview; subscription and invoices in the billing tab, and put the notes in the billing tab too', 'page(header tabs[overview: contact | billing: subscription invoices notes])'],
    ['Everything about billing for this customer', 'page(header subscription invoices payments)'],
    ['Recent emails and meetings, plus the open deals', 'page(header tabs[overview: deals | activity: emails meetings])'],
    ['Notes above the tabs, and tabs with the timeline and the subscription', 'page(header notes tabs[activity: timeline | billing: subscription])'],
    ["Show this customer's Twitter followers", ''],
    ['Follow-up tasks and the company profile', 'page(header tabs[overview: company | activity: tasks])'],
    ['Deals and meetings side by side on the overview tab, invoices on the billing tab', 'page(header tabs[overview: row(deals meetings) | billing: invoices])'],
    ['Company profile, contact details, payment history', 'page(header tabs[overview: company contact | billing: payments])'],
    ['Contact details and the company profile in the Key facts card on the overview tab, and the invoices on the billing tab', 'page(header tabs[overview: keyFacts(contact company) | billing: invoices])'],
    ['A Key facts card with the contact details, then the open deals and the notes', 'page(header keyFacts(contact) deals notes)'],
    ['An overview tab with the contact details beside the company profile and the notes under them, and a billing tab with the subscription', 'page(header tabs[overview: row(contact company) notes | billing: subscription])'],
  ],
}

export const landing = {
  id: 'landing',
  root: { id: 'page', description: 'A marketing landing page' },
  rows: true,
  guidance: 'Conventional order: navigation bar first, then the hero, the content sections, and the footer last.',
  parts: [
    { id: 'nav', description: 'Top navigation bar with the logo and links' },
    { id: 'heroImage', resource: 'hero', description: 'Hero banner: headline, subheading and a large product screenshot' },
    { id: 'heroPlain', resource: 'hero', description: 'Hero banner: headline and subheading only, text without any image' },
    { id: 'logos', description: 'Strip of customer logos' },
    { id: 'features', description: 'Grid of feature cards', slots: { default: null }, auto: true, arranged: true },
    { id: 'featSpeed', description: 'Feature card: speed (pages load in under 100 ms)', in: ['features'] },
    { id: 'featSecurity', description: 'Feature card: security (SOC 2, encryption at rest)', in: ['features'] },
    { id: 'featIntegrations', description: 'Feature card: integrations (Slack, GitHub, Jira)', in: ['features'] },
    { id: 'featAnalytics', description: 'Feature card: analytics (live usage dashboards)', in: ['features'] },
    { id: 'testimonials', description: 'Customer quotes (testimonials)' },
    { id: 'pricingTable', resource: 'pricing', description: 'Pricing as a comparison table of plans and their features' },
    { id: 'pricingCards', resource: 'pricing', description: 'Pricing as three plan cards' },
    { id: 'faq', description: 'Frequently asked questions' },
    { id: 'cta', maxUses: 2, description: 'Call-to-action banner with a "Start your free trial" button' },
    { id: 'newsletter', description: 'Newsletter signup form' },
    { id: 'footer', description: 'Footer with links and copyright' },
  ],
  cases: [
    ['A landing page: hero with a product screenshot, three features (speed, security, integrations), pricing cards, and a free-trial call to action at the end', 'page(heroImage features(featSpeed featSecurity featIntegrations) pricingCards cta)'],
    ['Simple text hero, FAQ, footer', 'page(heroPlain faq footer)'],
    ['Pricing comparison table and FAQ', 'page(pricingTable faq)'],
    ['A free-trial call to action at the top and again at the bottom, with testimonials in between', 'page(cta testimonials cta)'],
    ['Navigation, a hero with a screenshot, customer logos, testimonials, footer', 'page(nav heroImage logos testimonials footer)'],
    ['Tell visitors why we are fast and secure', 'page(features(featSpeed featSecurity))'],
    ['The security and analytics features, then pricing as plan cards', 'page(features(featSecurity featAnalytics) pricingCards)'],
    ['A video of our CEO', ''],
    ['Hero without an image, then pricing as cards, then a newsletter signup, then the footer', 'page(heroPlain pricingCards newsletter footer)'],
    ['FAQ first, then testimonials, and a trial call to action', 'page(faq testimonials cta)'],
    ['A screenshot hero, then testimonials beside the customer logos, and a footer', 'page(heroImage row(testimonials logos) footer)'],
    ['Footer, FAQ and navigation', 'page(nav faq footer)'],
    ['Text hero, a trial call to action right under it, the FAQ, and another call to action before the footer', 'page(heroPlain cta faq cta footer)'],
    ['Testimonials and a free-trial call to action', 'page(testimonials cta)'],
  ],
}

// ops console: 50 parts in 10 categories
const OPS_BY_CATEGORY = {
  incidents: [
    ['incidentList', 'Table of open incidents with severity and owner'],
    ['incidentTimeline', 'Timeline of the current major incident'],
    ['oncall', 'Who is on call now, per team'],
    ['postmortems', 'List of recent postmortems'],
    ['mttr', 'KPI card: mean time to resolve incidents this month'],
  ],
  deploys: [
    ['deployList', 'Table of recent deployments with status'],
    ['deployFreq', 'KPI card: deployments per day'],
    ['pipeline', 'CI pipeline status for the main branch'],
    ['rollback', 'Button: roll back the last deployment'],
    ['releaseNotes', 'Release notes of the latest version'],
  ],
  compute: [
    ['cpuChart', 'Line chart: CPU usage of the server fleet'],
    ['memChart', 'Line chart: memory usage of the server fleet'],
    ['hostMap', 'Heat map of hosts by load'],
    ['autoscale', 'Autoscaling events in the last 24 hours'],
    ['podStatus', 'Kubernetes pods by status (running, pending, crashing)'],
  ],
  database: [
    ['dbLatency', 'Line chart: database query latency (p50, p95)'],
    ['slowQueries', 'Table of the slowest database queries'],
    ['dbConnections', 'KPI card: open database connections'],
    ['replicationLag', 'KPI card: database replication lag'],
    ['backups', 'List of database backups and their status'],
  ],
  queues: [
    ['queueDepth', 'Line chart: message queue depth'],
    ['deadLetters', 'Table of dead-lettered messages'],
    ['consumers', 'Queue consumers and their throughput'],
    ['jobFailures', 'KPI card: background job failures today'],
    ['cronJobs', 'Scheduled cron jobs and their last run'],
  ],
  logs: [
    ['logSearch', 'Log search box with results'],
    ['errorRate', 'Line chart: application error rate'],
    ['topErrors', 'Table of the most frequent error messages'],
    ['traces', 'Slowest request traces'],
    ['logVolume', 'Bar chart: log volume per service'],
  ],
  access: [
    ['users', 'Table of admin users and their roles'],
    ['auditLog', 'Audit log of admin actions'],
    ['apiKeys', 'List of API keys with last use'],
    ['ssoStatus', 'Single sign-on configuration status'],
    ['failedLogins', 'KPI card: failed login attempts today'],
  ],
  cost: [
    ['monthlySpend', 'KPI card: cloud spend this month'],
    ['spendChart', 'Bar chart: cloud spend per service over 6 months'],
    ['budgetAlerts', 'Budget alerts and thresholds'],
    ['idleResources', 'List of idle resources that could be shut down'],
    ['spendForecast', 'Forecast of cloud spend to the end of the month'],
  ],
  alerts: [
    ['alertList', 'Table of firing alerts'],
    ['alertRules', 'List of alert rules'],
    ['silences', 'Active alert silences'],
    ['alertHistory', 'Bar chart: alerts fired per day'],
    ['uptime', 'Uptime of public endpoints (last 30 days)'],
  ],
  flags: [
    ['flagList', 'Table of feature flags and their rollout percentage'],
    ['flagChanges', 'Recent feature flag changes'],
    ['experiments', 'Running A/B experiments and their results'],
    ['staleFlags', 'Feature flags not changed in 90 days'],
    ['flagToggle', 'Kill switch: turn a feature flag off for everyone'],
  ],
}
export const OPS_CATEGORIES = {
  incidents: 'Incidents and on-call',
  deploys: 'Deployments and CI',
  compute: 'Servers, hosts and Kubernetes',
  database: 'Databases',
  queues: 'Message queues and background jobs',
  logs: 'Logs, errors and traces',
  access: 'Users, access and security',
  cost: 'Cloud cost and budgets',
  alerts: 'Alerts and uptime',
  flags: 'Feature flags and experiments',
}
export const ops = {
  id: 'ops',
  root: { id: 'page', description: 'An operations console page' },
  rows: true,
  categories: OPS_CATEGORIES,
  parts: Object.entries(OPS_BY_CATEGORY).flatMap(([category, list]) => list.map(([id, description]) => ({ id, description, category }))),
  cases: [
    ['Incident overview: open incidents, who is on call, and the error rate', 'page(incidentList oncall errorRate)'],
    ['Database health: query latency chart, slow queries, replication lag', 'page(dbLatency slowQueries replicationLag)'],
    ['CPU and memory charts side by side, then the pods by status', 'page(row(cpuChart memChart) podStatus)'],
    ['How much are we spending on cloud?', 'page(monthlySpend spendChart)'],
    ['Show the firing alerts first, then uptime, then the active silences', 'page(alertList uptime silences)'],
    ['Recent deploys and the CI pipeline next to each other, with the rollback button below them', 'page(row(deployList pipeline) rollback)'],
    ['Who has admin access, and the audit log', 'page(users auditLog)'],
    ['Feature flags and running experiments', 'page(flagList experiments)'],
    ['Book a meeting room', ''],
    ['Queue depth chart, then dead letters and failed jobs side by side', 'page(queueDepth row(deadLetters jobFailures))'],
    ['Search the logs', 'page(logSearch)'],
    ['Spend this month and the forecast in a row, then idle resources we could shut down', 'page(row(monthlySpend spendForecast) idleResources)'],
    ['Top errors and the slowest traces', 'page(topErrors traces)'],
    ['Firing alerts and uptime side by side, the alerts-per-day chart full width below, then active silences next to the alert rules', 'page(row(alertList uptime) alertHistory row(silences alertRules))'],
    ['CPU chart, memory chart and host heat map in one row, and the autoscaling events and pod status in a second row', 'page(row(cpuChart memChart hostMap) row(autoscale podStatus))'],
  ],
}

export const CATALOGS = { dashboard, settings, crm, landing, ops }

// ======================= params-edits/evals/catalogs.mjs =======================
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

// ======================= params-edits/evals/cases.mjs (params, records) =======================
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
