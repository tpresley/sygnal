// PLAN-9 B-3 compose.llm() at the chat-driver level: a minimal host component (standing in for
// worker A's `compose` behavior) sends the backend's request on the 'LLM' sink of renderComponent's
// LLM fake (the real makeChatDriver over an in-memory transport); DELTA → backend.delta → preview,
// REPLY → backend.reply → layout. No network.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { llm } from '../src/extra/ai/compose/llm.ts'
import { catalog, str } from './p9-llm-helpers.js'

const CAT = catalog({
  parts: {
    revenue: { description: 'KPI card: revenue' },
    chart: { description: 'Line chart: revenue trend', params: { range: { label: 'time span', default: 'year', options: { month: 'the last 30 days', year: 'the last 12 months' } } } },
    tasks: { description: 'Checklist of tasks' },
  },
})
const N = { ok: 'REPLY', error: 'FAILED', delta: 'DELTA', key: 'compose' }

function makeHost(backend) {
  function Host({ state }) { return h('div', { className: state.status }, state.status) }
  Host.initialState = { status: 'idle', layout: null, preview: null, pending: null, decisions: null, error: null, previews: [] }
  const start = (state, prompt) => backend.start({ catalog: CAT, state, prompt, previous: state.layout, names: N })
  Host.model = {
    COMPOSE: {
      STATE: (state, prompt) => ({ ...state, status: 'composing', pending: start(state, prompt).pending, error: null }),
      LLM: (state, prompt) => start(state, prompt).request,
    },
    DELTA: (state, delta) => {
      const { preview } = backend.delta({ catalog: CAT, state, pending: state.pending, delta })
      return preview ? { ...state, status: 'preview', preview, previews: [...state.previews, str(CAT, preview)] } : state
    },
    REPLY: (state, reply) => {
      const r = backend.reply({ catalog: CAT, state, pending: state.pending, reply })
      if (r.error) return { ...state, status: 'error', error: r.error, preview: null }
      return { ...state, status: r.unavailable ? 'unavailable' : 'done', layout: r.layout ?? null, preview: null, decisions: r.decisions }
    },
    FAILED: (state, { error }) => ({ ...state, status: 'error', error: error.message }),
  }
  return Host
}

let t
afterEach(() => { t?.dispose(); t = null })

describe('compose.llm() over the LLM fake (makeChatDriver)', () => {
  it('sends one structured-output request and reads the reply into a layout', async () => {
    const b = llm()
    t = renderComponent(makeHost(b))
    t.simulateAction('COMPOSE', 'Revenue, then the monthly chart')
    await t.settle()
    const [req] = t.requests('LLM')
    expect(req).toMatchObject({ key: 'compose', ok: 'REPLY', error: 'FAILED', delta: 'DELTA', latest: true })
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: 'Revenue, then the monthly chart' })
    await t.respond('LLM', b.fake({ catalog: CAT, state: t.state, pending: t.state.pending, target: [{ part: 'revenue' }, { part: 'chart', params: { range: 'month' } }] }))
    expect(t.state.status).toBe('done')
    expect(str(CAT, t.state.layout)).toBe('revenue chart{range=month}')
    expect(t.state.decisions.asked_for).toEqual(['revenue', 'chart'])
  })

  it('streams: previews grow part by part, then the final layout', async () => {
    t = renderComponent(makeHost(llm()))
    t.simulateAction('COMPOSE', 'Revenue and tasks side by side, then the chart')
    await t.settle()
    const text = '{"asked_for": ["revenue", "tasks", "chart"], "children": [{"part": "row", "children": [{"part": "revenue"}, {"part": "tasks"}]}, {"part": "chart", "params": {"range": "year"}}]}'
    const a = text.indexOf('"revenue"}') + 10, b = text.indexOf('"tasks"}') + 8
    const chunks = (s) => s.match(/.{1,12}/gs)
    await t.stream('LLM', chunks(text.slice(0, a)), { end: false })
    expect(t.state.status).toBe('preview')
    expect(str(CAT, t.state.preview)).toBe('row(revenue)')
    await t.stream('LLM', chunks(text.slice(a, b)), undefined, { end: false })
    expect(str(CAT, t.state.preview)).toBe('row(revenue,tasks)')
    await t.stream('LLM', chunks(text.slice(b)))
    expect(t.state.status).toBe('done')
    expect(t.state.preview).toBeNull()
    expect(str(CAT, t.state.layout)).toBe('row(revenue,tasks) chart')
  })

  it('an empty list → unavailable; a reply that is no layout → error (SYG683), never a layout', async () => {
    t = renderComponent(makeHost(llm()), { diagnostics: 'collect' })
    t.simulateAction('COMPOSE', 'Book a table')
    await t.settle()
    await t.respond('LLM', '{"asked_for": [], "children": []}')
    expect(t.state).toMatchObject({ status: 'unavailable', layout: null })
    t.simulateAction('COMPOSE', 'Show the stock ticker')
    await t.settle()
    await t.respond('LLM', '{"asked_for": ["stocks"], "children": [{"part": "stockTicker"}]}')
    expect(t.state.status).toBe('error')
    expect(t.state.layout).toBeNull()
  })

  it('a reply that is not JSON fails in the driver (FAILED)', async () => {
    t = renderComponent(makeHost(llm()))
    t.simulateAction('COMPOSE', 'x')
    await t.settle()
    await t.respond('LLM', 'Sorry, I cannot do that.')
    expect(t.state.status).toBe('error')
    expect(t.state.error).toMatch(/not JSON/)
  })
})
