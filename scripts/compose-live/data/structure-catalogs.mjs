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
const OPS = {
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
  parts: Object.entries(OPS).flatMap(([category, list]) => list.map(([id, description]) => ({ id, description, category }))),
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
