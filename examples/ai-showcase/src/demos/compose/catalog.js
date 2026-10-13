// The catalog: the parts a model may place, one declaration for both kinds of model.
//
// `description` is all a model sees of a part: "Noun (what it shows)", leading with the word a user
// says, never naming another part's content. Params are the only inputs a model gives, each from a
// fixed list: an option, or a number a decision model picks as a bin. Side by side is the built-in
// `row` container: it appears when the request asks for it.
import { defineCatalog } from 'sygnal/ai'
import { Kpi, TrafficChart, Funnel, TopPages, Countries, Incidents, Releases, LaunchChecklist } from './parts.jsx'

export const catalog = defineCatalog({
  description: 'A product analytics workspace',
  guidance: 'Headline numbers first, then charts, then tables and lists.',
  parts: {
    activeUsers: { component: Kpi, props: { metric: 'activeUsers' }, description: 'Active users (KPI card: daily active users today, 18.4k)' },
    revenue: { component: Kpi, props: { metric: 'revenue' }, description: 'Revenue (KPI card: monthly recurring revenue, $284k)' },
    conversion: { component: Kpi, props: { metric: 'conversion' }, description: 'Conversion rate (KPI card: the share of trials that become paid, 4.6%)' },
    traffic: {
      component: TrafficChart,
      description: 'Traffic chart (area chart of active users over time)',
      params: {
        range: {
          label: 'time range', default: 'month',
          options: { week: 'the last 7 days (this week)', month: 'the last 30 days (this month)', quarter: 'the last 3 months (this quarter)', year: 'the last 12 months (this year)' },
        },
      },
    },
    funnel: { component: Funnel, description: 'Signup funnel (the steps from first visit to paying customer, with the drop-off at each step)' },
    pages: {
      component: TopPages,
      description: 'Top pages (table of the most viewed URLs of the website: views and bounce rate per URL)',
      params: {
        limit: { type: 'number', label: 'how many pages', default: 5, min: 1, max: 10, bins: { 3: 'a few (top 3)', 5: 'five (the default)', 10: 'all ten' } },
      },
    },
    countries: { component: Countries, description: 'Countries (bar list of where visitors come from, by country)' },
    incidents: {
      component: Incidents,
      description: 'Incidents (open production alerts and errors, by severity)',
      params: { severity: { label: 'severity', default: 'any', options: { any: 'every open incident', critical: 'only critical (urgent) incidents' } } },
    },
    releases: { component: Releases, description: 'Release notes (changelog of the latest product releases)' },
    launch: { component: LaunchChecklist, state: 'launch', description: "Launch checklist (the team's to-do list for the next release)" },
  },
})
