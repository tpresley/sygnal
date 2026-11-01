// The spike's host app: a dashboard composed by compose.llm() from one prepared part (a revenue
// KPI) and the generated part kind. Generated parts read the app's orders and customers (declared
// `data`, nothing else) and may send OPEN_CUSTOMER / FILTER_STATUS (declared `emits`, zod 4).
// The host turns those into its own actions; the model never names one.
import {createElement as h, compose, defineCatalog} from 'sygnal'
import {z} from 'zod'
import {resolve} from 'node:path'
import {readFileSync} from 'node:fs'
import {createRuntime} from '../src/runtime.js'
import {generated} from '../src/generated.js'
import {compileChecked} from '../src/check.js'
import {nodeWorkerSpawner} from '../../sandbox/src/worker-sandbox.js'

export const kernel = readFileSync(resolve(import.meta.dirname, '../../sandbox/dist/guest.js'), 'utf8')
// a path, not a URL: under jsdom the global URL is jsdom's, which worker_threads refuses
export const spawn = await nodeWorkerSpawner(resolve(import.meta.dirname, '../../sandbox/src/worker-entry.js'))

export const customers = [
  {id: 7, name: 'Northwind', region: 'EU'}, {id: 9, name: 'Globex', region: 'US'},
  {id: 12, name: 'Initech', region: 'US'}, {id: 15, name: 'Umbrella', region: 'APAC'},
]
export const orders = Array.from({length: 40}, (_, i) => ({
  id: 1000 + i, customer: customers[i % 4].id, total: Math.round(((i * 37) % 500 + 20) * 100) / 100,
  status: ['paid', 'pending', 'refunded', 'paid'][i % 4],
}))

export const DATA = {
  orders: {description: 'the recent orders', shape: '[{ id: number, customer: number (a customer id), total: number (EUR), status: "paid" | "pending" | "refunded" }]', from: (s) => s.orders},
  customers: {description: 'the customers', shape: '[{ id: number, name: string, region: "EU" | "US" | "APAC" }]', from: (s) => s.customers},
}
export const EMITS = {
  OPEN_CUSTOMER: {description: 'the user picked a customer (the app opens it)', schema: z.object({id: z.number().int()})},
  FILTER_STATUS: {description: 'the user picked an order status to filter by', schema: z.object({status: z.enum(['paid', 'pending', 'refunded'])})},
}

function Kpi({title, value}) { return h('div', {className: 'kpi'}, h('h3', null, title), h('strong', null, value)) }

/** the app, with its runtime and generated part kind; options: isolation, maxCode, maxAttempts, checks */
export function makeApp(opts = {}) {
  const runtime = createRuntime({kernel, spawn, compile: (code) => compileChecked(code, {checks: opts.checks !== false})})
  const warnings = []
  const gen = generated(runtime, {data: DATA, emits: EMITS, isolation: opts.isolation ?? 'worker', maxCode: opts.maxCode, limits: opts.limits, warn: (m) => warnings.push(m)})
  const catalog = defineCatalog({
    parts: {
      revenue: {render: () => h(Kpi, {title: 'Revenue', value: 'EUR 48.2k'}), description: 'Revenue (KPI card: the total this month)'},
      custom: gen.part,
    },
  })
  function Dashboard({state}) {
    return h('main', null,
      h('p', {className: 'picked'}, `customer:${state.openCustomer ?? '-'} status:${state.statusFilter ?? '-'}`),
      catalog.render(state.page, state))
  }
  Dashboard.initialState = {orders, customers, openCustomer: null, statusFilter: null}
  Dashboard.uses = {
    page: compose(catalog, {backend: compose.llm({instructions: gen.instructions})}),
    fix: gen.repair({maxAttempts: opts.maxAttempts ?? 2}),
  }
  Dashboard.intent = ({CHILD}) => ({
    OPEN_CUSTOMER: gen.events(CHILD, 'OPEN_CUSTOMER'),
    FILTER_STATUS: gen.events(CHILD, 'FILTER_STATUS'),
  })
  Dashboard.model = {
    OPEN_CUSTOMER: (s, d) => ({...s, openCustomer: d.id}),
    FILTER_STATUS: (s, d) => ({...s, statusFilter: d.status}),
  }
  return {Dashboard, catalog, gen, runtime, warnings}
}

/** the JSON text compose.llm() expects for a page of nodes (what a model's structured output is) */
export const replyText = (children, asked) => JSON.stringify({asked_for: asked ?? children.map((c) => c.params?.title ?? c.part), children})
export const custom = (title, reads, code) => ({part: 'custom', params: {title, reads, code}})
