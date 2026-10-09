// @vitest-environment jsdom
// PLAN-6 L-1 coalescing with requestAnimationFrame (G-582, G-588), under fake timers so every
// count is exact: jsdom's rAF (16 ms frames); a 120 Hz display (rAF every 8 ms: the 15 ms floor
// keeps deltas at ≤ 60/s); a hidden tab (rAF never fires: the 100 ms timer keeps deltas flowing,
// and `ok` never waits). Playwright can't hide a page headless (0-S1), so the hidden tab is a stub.
import { it, expect, afterEach, vi, describe } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { makeChatDriver } from '../src/extra/ai/chat/driver.ts'

const timed = (n = 300, ms = 2) => ({
  async *stream(req, signal) {
    for (let i = 0; i < n; i++) {
      await new Promise(r => setTimeout(r, ms))
      if (signal.aborted) return
      yield { type: 'text', delta: `w${i} ` }
    }
  },
})
let renders = 0, deltas = 0
function Chat({ state }) { renders++; return h('p', null, state.draft) }
Chat.initialState = { draft: '', done: false }
Chat.model = {
  SEND: { LLM: () => ({ messages: [], delta: 'DELTA', ok: 'DONE' }) },
  DELTA: (s, d) => { deltas++; return { ...s, draft: d.text } },
  DONE: (s, d) => ({ ...s, draft: d.text, done: true, at: Date.now() }),
}
let t, raf, caf
afterEach(() => {
  t?.dispose(); t = null
  vi.useRealTimers()
  if (raf) { globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = caf; raf = null }
})
const stubRaf = (fn) => {
  raf = globalThis.requestAnimationFrame; caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = fn
  globalThis.cancelAnimationFrame = id => clearTimeout(id)
}

const go = async () => {
  t = renderComponent(Chat, { drivers: { LLM: makeChatDriver({ transport: timed() }) }, timeoutMs: 20000 })
  await t.ready()
  renders = 0; deltas = 0
  const c0 = Date.now()
  t.simulateAction('SEND')
  const s = await t.waitForState(s => s.done, 20000)
  const ms = s.at - c0
  return { renders, deltas, ms, budget: Math.ceil(ms / 16) + 2, chars: s.draft.length }
}

describe('with rAF (fake timers)', () => {
  it("jsdom's rAF: inside ceil(duration/16)+2", async () => {
    vi.useFakeTimers()
    expect(typeof requestAnimationFrame).toBe('function')
    const r = await go()
    expect(r.chars).toBe(1390)
    expect(r.renders).toBeLessThanOrEqual(r.budget)
  })

  it('a 120 Hz display (rAF every 8 ms): the 15 ms floor keeps one delta per 16 ms at most', async () => {
    vi.useFakeTimers()
    stubRaf(cb => setTimeout(() => cb(performance.now()), 8))
    const r = await go()
    expect(r.chars).toBe(1390)
    expect(r.renders).toBeLessThanOrEqual(r.budget)
    expect(r.deltas).toBeLessThanOrEqual(Math.ceil(r.ms / 15) + 1)
  })

  it('a hidden tab (rAF never fires): the 100 ms timer still delivers a delta about every 100 ms; ok is on time', async () => {
    vi.useFakeTimers()
    stubRaf(() => 1)
    const r = await go()
    expect(r.chars).toBe(1390)
    expect(r.ms).toBeLessThan(620)                       // ok doesn't wait for a frame
    expect(r.deltas).toBeGreaterThanOrEqual(Math.floor(r.ms / 100) - 1)
    expect(r.deltas).toBeLessThanOrEqual(Math.ceil(r.ms / 100) + 1)
  })
})
