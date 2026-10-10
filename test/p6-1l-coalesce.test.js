// PLAN-6 L-1 §3 render budget: delta coalescing without requestAnimationFrame (Node, the mock
// DOM of renderComponent). A 300-token stream at 1 token / 2 ms renders at most
// ceil(duration / 16) + 2 times, duration from the sending action to `ok`; under fake timers the
// count is exact: 39 renders (budget 40). Also over a real SSE stream (the mock server + fetch),
// and an abort that closes the server's socket. No network but 127.0.0.1.
import { it, expect, describe, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { makeChatDriver } from '../src/extra/ai/chat/driver.ts'
import { startMock } from './helpers/p6-mock-sse.js'
import { sseTransport } from './helpers/p6-sse-transport.js'

const TOKENS = 300, EVERY = 2
// yields `n` tokens, one per `ms` (setTimeout: faked under fake timers)
const timed = (n = TOKENS, ms = EVERY) => ({
  async *stream(req, signal) {
    for (let i = 0; i < n; i++) {
      await new Promise(r => setTimeout(r, ms))
      if (signal.aborted) return
      yield { type: 'text', delta: `w${i} ` }
    }
    yield { type: 'finish', reason: 'stop' }
  },
})

let renders = 0, deltas = 0
function Chat({ state }) { renders++; return h('div', null, h('p', { className: 'draft' }, state.draft), h('p', { className: 'n' }, String(state.messages.length))) }
Chat.initialState = { messages: [], draft: '', status: 'ready' }
const model = (extra = {}) => ({
  SEND: { STATE: s => ({ ...s, status: 'streaming' }), LLM: () => ({ messages: [{ role: 'user', content: 'hi' }], key: 'r', delta: 'DELTA', ok: 'DONE', ...extra }) },
  STOP: { LLM: () => ({ abort: 'r' }) },
  DELTA: (s, d) => { deltas++; return { ...s, draft: d.text } },
  DONE: (s, d) => ({ ...s, messages: [...s.messages, d.message], draft: '', status: 'ready', t: d.text, at: Date.now() }),
})

let t
afterEach(() => { t?.dispose(); t = null; vi.useRealTimers() })

const budget = ms => Math.ceil(ms / 16) + 2
const measure = async (transport, extra) => {
  Chat.model = model(extra)
  t = renderComponent(Chat, { drivers: { LLM: makeChatDriver({ transport }) }, timeoutMs: 20000 })
  await t.ready()
  renders = 0; deltas = 0
  const c0 = Date.now()
  t.simulateAction('SEND')
  const s = await t.waitForState(s => s.status === 'ready' && s.messages.length === 1, 20000)
  // from the sending action to ok (the clock when DONE reduced; waitForState's quiet window isn't counted)
  const ms = s.at - c0
  return { renders, deltas, ms, budget: budget(ms), chars: s.t.length }
}

describe('Node (no rAF): a frame is a 16 ms timer', () => {
  it('the render-budget gate, under fake timers: exactly 39 renders (budget 40), deterministic', async () => {
    vi.useFakeTimers()
    const a = await measure(timed(), {})
    t.dispose(); t = null
    const b = await measure(timed(), {})
    expect(a.chars).toBe(1390)   // the whole text arrived ('w0 ' … 'w299 ')
    expect(a.ms).toBeGreaterThanOrEqual(TOKENS * EVERY)
    expect(a.renders).toBe(39)
    expect(a.budget).toBe(40)
    expect([b.renders, b.deltas, b.ms]).toEqual([a.renders, a.deltas, a.ms])
    expect(a.renders).toBeLessThanOrEqual(a.budget)
  })

  it("coalesce: 'none' renders once per token", async () => {
    vi.useFakeTimers()
    const r = await measure(timed(), { coalesce: 'none' })
    expect(r.deltas).toBe(TOKENS)
    expect(r.renders).toBeGreaterThanOrEqual(TOKENS)
  })

  it("coalesce: 'frame' with real timers stays inside ceil(duration/16)+2", async () => {
    const r = await measure(timed(), {})
    expect(r.chars).toBeGreaterThan(1000)
    expect(r.renders).toBeLessThanOrEqual(r.budget)
  })

  it('coalesce: 50 (ms), under fake timers', async () => {
    vi.useFakeTimers()
    const r = await measure(timed(), { coalesce: 50 })
    expect(r.renders).toBeLessThanOrEqual(Math.ceil(r.ms / 50) + 2)
    expect(r.deltas).toBeGreaterThan(5)
  })

  it('the driver option sets the default coalesce', async () => {
    vi.useFakeTimers()
    Chat.model = model()
    t = renderComponent(Chat, { drivers: { LLM: makeChatDriver({ transport: timed(20), coalesce: 'none' }) } })
    await t.ready()
    deltas = 0
    t.simulateAction('SEND')
    await t.waitForState(s => s.messages.length === 1)
    expect(deltas).toBe(20)
  })
})

describe('a real SSE stream (mock server on 127.0.0.1, fetch)', () => {
  it('300 tokens / 2 ms: frame coalescing inside the budget, same text as per-token', async () => {
    const mock = await startMock({ tokens: TOKENS, delayMs: EVERY })
    try {
      const tr = sseTransport({ url: `${mock.url}/openai/v1/responses` })
      const none = await measure(tr, { coalesce: 'none' })
      t.dispose(); t = null
      const frame = await measure(tr, {})
      expect(none.chars).toBe(frame.chars)
      expect(none.deltas).toBe(TOKENS)
      expect(frame.renders).toBeLessThanOrEqual(frame.budget)
      expect(frame.renders * 4).toBeLessThan(none.renders)
    } finally { mock.close() }
  })

  it('STOP mid-stream aborts the fetch: the server sees the socket close early; nothing arrives after it', async () => {
    const mock = await startMock({ tokens: 2000, delayMs: 2 })
    try {
      Chat.model = model()
      t = renderComponent(Chat, { drivers: { LLM: makeChatDriver({ transport: sseTransport({ url: `${mock.url}/openai/v1/responses` }) }) } })
      await t.ready()
      t.simulateAction('SEND')
      await t.waitForState(s => s.draft.length > 50)
      t.simulateAction('STOP')
      await t.settle()
      const at = t.state.draft.length
      await new Promise(r => setTimeout(r, 100))
      expect(t.state.draft.length).toBe(at)
      expect(t.state.messages.length).toBe(0)
      expect(mock.log.length).toBe(1)
      expect(mock.log[0].closedEarly).toBe(true)
      expect(mock.log[0].sent).toBeLessThan(2000)
    } finally { mock.close() }
  })
})
