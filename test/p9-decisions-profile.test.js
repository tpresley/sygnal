// PLAN-9 G-755: compose.decisions({ profile: 'small' }) for a local ~9B decision model (Ollama's
// nimble), which answers a two-option question by position (left_a_vs_b → a at ~0.9, left_b_vs_a →
// b at ~0.9): the pairwise order questions go in both option orders (their mean is read), and
// near-ties follow the order in which the request names the parts. The default stays the measured
// encoding (Jev). No network.
import { describe, it, expect } from 'vitest'
import { decisions, mentions } from '../src/extra/ai/compose/decisions.js'
import { defineCatalog } from '../src/extra/ai/compose/catalog'
import { toTree, fromTree, finish } from '../src/extra/ai/compose/layout'
import { answers } from '../src/extra/ai/answers'
import { STRUCTURE } from './p9-decisions-catalogs.js'
import { formatTree } from './p9-decisions-helpers.js'

const names = { ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA', key: 'compose' }
const Stub = () => null
/** start → (fake → reply)*: the result, and the target as finish() normalizes it */
function roundTrip(backend, c, prompt, target) {
  let r = backend.start({ catalog: c, state: {}, prompt, previous: null, names })
  let pending = JSON.parse(JSON.stringify(r.pending)), out
  for (;;) {
    out = backend.reply({ catalog: c, state: {}, pending, reply: backend.fake({ catalog: c, state: {}, pending, target }), names })
    if (!out.request) return { out, want: finish(c, fromTree(c, target), {}) }
    pending = JSON.parse(JSON.stringify(out.pending))
  }
}
const catalog = defineCatalog({
  parts: {
    revenue: { component: Stub, description: "Revenue (KPI card: this month's revenue total as one number, $48.2k)" },
    signups: { component: Stub, description: 'Signups (KPI card: new signups this week, 312)' },
    churn: { component: Stub, description: 'Churn (KPI card: the customer churn rate this month, 2.1%)' },
    revenueChart: { component: Stub, description: 'Revenue chart (line chart of the revenue trend over time)' },
    orders: { component: Stub, description: 'Orders (table of the most recent orders: customer, amount, status)' },
    feedback: { component: Stub, description: 'Feedback form (a form to send product feedback: a message and a send button)' },
  },
})

/** a position-biased model: every two-option order question answers its first option at 0.9 */
const biased = (q) => Object.fromEntries(Object.keys(q).filter((k) => /^(first|left)_/.test(k)).map((k) => [k, { choice: Object.keys(q[k].criteria)[0], confidence: 0.6 }]))

function compose(backend, prompt, select) {
  const s = backend.start({ catalog, state: {}, prompt, previous: null, names })
  const sel = backend.reply({ catalog, state: {}, pending: s.pending, names, reply: answers(s.request.json.questions, select) })
  const q = sel.request.json.questions
  const out = backend.reply({ catalog, state: {}, pending: JSON.parse(JSON.stringify(sel.pending)), names, reply: answers(q, { ...biased(q), ...(select.row && { beside_churn: 'signups', beside_signups: 'churn' }) }) })
  return { q, layout: toTree(out.layout) }
}

describe("compose.decisions({ profile: 'small' })", () => {
  it('mentions(): where the request names each part, longer names first ("the revenue chart" is not the revenue KPI)', () => {
    const items = Object.keys(catalog.parts).map((k) => ({ key: k, part: k }))
    expect(mentions(catalog, items, 'Recent orders, the revenue chart, and below that a feedback form')).toEqual({ revenue: Infinity, signups: Infinity, churn: Infinity, revenueChart: 19, orders: 7, feedback: 51 })
    expect(mentions(catalog, items, 'Churn and signups next to each other, revenue too')).toMatchObject({ churn: 0, signups: 10, revenue: 38 })
  })

  it('asks each pair in both orders and reads their mean; a position-biased answer ties, and the mention order decides', () => {
    const small = decisions({ model: 'nimble', profile: 'small' })
    const plain = decisions({ model: 'nimble' })
    const prompt = 'Recent orders, the revenue chart, and below that a feedback form'
    const select = { use_orders: 'use', use_revenueChart: 'use', use_feedback: 'use' }
    const a = compose(small, prompt, select)
    expect(Object.keys(a.q).filter((k) => k.startsWith('first_')).sort()).toEqual(['first_feedback_vs_orders', 'first_feedback_vs_revenueChart', 'first_orders_vs_feedback', 'first_orders_vs_revenueChart', 'first_revenueChart_vs_feedback', 'first_revenueChart_vs_orders'])
    expect(a.layout.map((n) => n.part)).toEqual(['orders', 'revenueChart', 'feedback'])
    // the default encoding asks once, in catalog order, and follows the bias
    const b = compose(plain, prompt, select)
    expect(Object.keys(b.q).filter((k) => k.startsWith('first_'))).toHaveLength(3)
    expect(b.layout.map((n) => n.part)).toEqual(['revenueChart', 'orders', 'feedback'])
  })

  it('rows: left/right from both orders, then the mention order', () => {
    const small = decisions({ model: 'nimble', profile: 'small' })
    const { q, layout } = compose(small, 'Churn and signups next to each other', { use_churn: 'use', use_signups: 'use', row: true })
    expect(Object.keys(q).filter((k) => k.startsWith('left_')).sort()).toEqual(['left_churn_vs_signups', 'left_signups_vs_churn'])
    expect(layout).toEqual([{ part: 'row', children: [{ part: 'churn' }, { part: 'signups' }] }])
  })

  it('a clear answer still wins over the mention order', () => {
    const small = decisions({ model: 'nimble', profile: 'small' })
    const prompt = 'The revenue chart, with the orders table above it'
    const s = small.start({ catalog, state: {}, prompt, previous: null, names })
    const sel = small.reply({ catalog, state: {}, pending: s.pending, names, reply: answers(s.request.json.questions, { use_orders: 'use', use_revenueChart: 'use' }) })
    const q = sel.request.json.questions
    const out = small.reply({ catalog, state: {}, pending: sel.pending, names, reply: answers(q, { first_revenueChart_vs_orders: 'orders', first_orders_vs_revenueChart: 'orders' }) })
    expect(toTree(out.layout).map((n) => n.part)).toEqual(['orders', 'revenueChart'])
  })

  it('the structure cases round-trip through fake() under the profile too', () => {
    const backend = decisions({ model: 'nimble', profile: 'small' })
    for (const { catalog: c, cases } of Object.values(STRUCTURE)) {
      for (const { prompt, want } of cases) {
        const r = roundTrip(backend, c, prompt, want)
        if (!r.out.layout) continue
        expect(formatTree(toTree(r.out.layout)), prompt).toBe(formatTree(toTree(r.want)))
      }
    }
  })
})
