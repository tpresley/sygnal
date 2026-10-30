// compose.generated's host app for test/compose-generated-*.test.js (from the compose-sandbox
// spike, dev-plans/research/compose-sandbox/fixtures/app.js, on src/): a dashboard composed by
// compose.llm() from one prepared part (a revenue KPI) and the generated part kind. Generated parts
// read the app's orders and customers (declared `data`, nothing else) and may send OPEN_CUSTOMER /
// FILTER_STATUS (declared `emits`, zod 4); the host turns those into its own actions. The model is
// scripted (t.respond / t.stream on the LLM sink): no API calls. Not a test file.
import * as sucrase from 'sucrase'
import { z } from 'zod'
import { createElement as h } from '../../src/pragma/index.ts'
import { renderComponent } from '../../src/extra/testing.ts'
import { compose, defineCatalog } from '../../src/extra/ai/compose/index.ts'
import { generatedRuntime, sucraseCompiler } from '../../src/sandbox.ts'
import { kernel, nodeWorker } from './sandbox-helpers.js'

export const customers = [
  { id: 7, name: 'Northwind', region: 'EU' }, { id: 9, name: 'Globex', region: 'US' },
  { id: 12, name: 'Initech', region: 'US' }, { id: 15, name: 'Umbrella', region: 'APAC' },
]
export const orders = Array.from({ length: 40 }, (_, i) => ({
  id: 1000 + i, customer: customers[i % 4].id, total: Math.round(((i * 37) % 500 + 20) * 100) / 100,
  status: ['paid', 'pending', 'refunded', 'paid'][i % 4],
}))

export const DATA = {
  orders: { description: 'the recent orders', shape: '[{ id: number, customer: number (a customer id), total: number (EUR), status: "paid" | "pending" | "refunded" }]', from: (s) => s.orders },
  customers: { description: 'the customers', shape: '[{ id: number, name: string, region: "EU" | "US" | "APAC" }]', from: (s) => s.customers },
}
export const EMITS = {
  OPEN_CUSTOMER: { description: 'the user picked a customer (the app opens it)', schema: z.object({ id: z.number().int() }) },
  FILTER_STATUS: { description: 'the user picked an order status to filter by', schema: z.object({ status: z.enum(['paid', 'pending', 'refunded']) }) },
}

// the compiler the docs recommend for the browser (the app's dependency, loaded with the first part)
export const compile = sucraseCompiler(sucrase)

function Kpi({ title, value }) { return h('div', { className: 'kpi' }, h('h3', null, title), h('strong', null, value)) }

/** the app, its runtime and generated part kind; options: isolation, maxCode, maxAttempts, checks, limits, check */
export function makeApp(opts = {}) {
  const logs = []
  const runtime = generatedRuntime({ kernel, compile, worker: nodeWorker, check: opts.check, log: (l, x) => logs.push([l, x]) })
  const gen = compose.generated(runtime, { data: DATA, emits: EMITS, isolation: opts.isolation, maxCode: opts.maxCode, limits: opts.limits, check: opts.checks })
  const catalog = defineCatalog({
    parts: {
      revenue: { render: () => h(Kpi, { title: 'Revenue', value: 'EUR 48.2k' }), description: 'Revenue (KPI card: the total this month)' },
      custom: gen.part,
    },
  })
  function Dashboard({ state }) {
    return h('main', null,
      h('p', { className: 'picked' }, `customer:${state.openCustomer ?? '-'} status:${state.statusFilter ?? '-'}`),
      catalog.render(state.page, state))
  }
  Dashboard.initialState = { orders, customers, openCustomer: null, statusFilter: null }
  Dashboard.uses = {
    page: compose(catalog, { backend: compose.llm({ instructions: gen.instructions }) }),
    fix: gen.repair({ maxAttempts: opts.maxAttempts ?? 2 }),
  }
  Dashboard.intent = ({ CHILD }) => ({
    OPEN_CUSTOMER: gen.events(CHILD, 'OPEN_CUSTOMER'),
    FILTER_STATUS: gen.events(CHILD, 'FILTER_STATUS'),
  })
  Dashboard.model = {
    OPEN_CUSTOMER: (s, d) => ({ ...s, openCustomer: d.id }),
    FILTER_STATUS: (s, d) => ({ ...s, statusFilter: d.status }),
  }
  return { Dashboard, catalog, gen, runtime, logs }
}

/** the JSON text compose.llm() expects for a page of nodes (what a model's structured output is) */
export const replyText = (children, asked) => JSON.stringify({ asked_for: asked ?? children.map((c) => c.params?.title ?? c.part), children })
export const custom = (title, reads, code) => ({ part: 'custom', params: { title, reads, code } })

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function until(f, ms = 5000, what = 'condition') {
  const t0 = Date.now()
  for (;;) {
    const v = f()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(3)
  }
}

/** the dashboard in the real DOM (jsdom), composed from `children` (compose.llm's reply) */
export async function start(children, opts = {}) {
  const app = makeApp(opts)
  const t = renderComponent(app.Dashboard, { dom: 'real' })
  await t.ready()
  if (children) await composePage(t, children, opts)
  return { t, ...app }
}

export async function composePage(t, children, { stream, prompt = 'a page' } = {}) {
  t.simulateAction('page.COMPOSE', prompt)
  await t.next((s) => s.page.status === 'composing')
  const text = replyText(children)
  if (stream) {
    const size = Math.ceil(text.length / stream)
    for (let i = 0; i < stream; i++) await t.stream('LLM', [text.slice(i * size, (i + 1) * size)], 'page.REPLY', { end: i == stream - 1 })
  } else await t.respond('LLM', text, 'page.REPLY')
  await t.waitForState((s) => s.page.status === 'done' || s.page.status === 'error')
  return text
}

/** the generated parts on the page: [{ node, status, el }] */
export const parts = (t) => [...t.container.querySelectorAll('.gen-part')].map((el) => ({ node: el.dataset.node, status: el.dataset.status, el }))
export const allReady = (t, n) => { const p = parts(t); return p.length === n && p.every((x) => x.status === 'ok') }
/** the repair requests the app sent (LLM requests keyed fix:<hash>) */
export const fixRequests = (t) => t.requests('LLM').filter((r) => String(r.key).startsWith('fix:'))
