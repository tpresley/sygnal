// PLAN-6 L-1 (§3 gates): the chat driver under run() with a real requestAnimationFrame, over a
// real SSE stream from the dev server (test/helpers/p6-mock-sse.js mounted at /__p6; server-side
// timers, not page timers). The render budget (300 tokens at 1 token / 2 ms renders at most
// ceil(duration / 16) + 2 times; Chromium is the gate, Firefox's 120 Hz headless rAF the canary
// for the 15 ms floor), STOP mid-stream and app.dispose() mid-stream (the fetch is aborted, the
// server sees the socket close, nothing arrives after it). About 1.5 s per engine.
import { run } from 'sygnal'
import { makeChatDriver } from 'sygnal/ai'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'AI chat driver (PLAN-6 L-1)'

// a minimal Open Responses SSE transport (test code; the real transports are L-2)
const sse = (tokens, ms = 2) => ({
  async *stream(req, signal) {
    const res = await fetch(`/__p6/openai/v1/responses?tokens=${tokens}&ms=${ms}`, { method: 'POST', signal, body: JSON.stringify({ input: req.messages }) })
    const reader = res.body.getReader(), dec = new TextDecoder()
    let buf = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const data = buf.slice(0, i).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
          buf = buf.slice(i + 2)
          const e = data ? JSON.parse(data) : {}
          if (e.type == 'response.output_text.delta') yield { type: 'text', delta: e.delta }
          else if (e.type == 'response.completed') yield { type: 'finish', reason: 'stop', usage: e.response.usage }
        }
      }
    } finally {
      try { reader.releaseLock() } catch (_) {}
    }
  },
})
const serverLog = async () => (await fetch('/__p6/log')).json()

let renders = 0, deltas = 0
function Chat({ state }) {
  renders++
  return <div><p className="draft">{state.draft}</p><p className="status">{state.status}</p><p className="n">{state.messages.length}</p></div>
}
Chat.initialState = { messages: [], draft: '', status: 'ready' }
Chat.model = {
  SEND: {
    STATE: (state) => ({ ...state, status: 'streaming' }),
    LLM: () => ({ messages: [{ role: 'user', content: 'hi' }], key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED' }),
  },
  STOP: {
    STATE: (state) => ({ ...state, status: 'stopped' }),
    LLM: () => ({ abort: 'reply' }),
  },
  DELTA: (state, { text }) => { deltas++; return { ...state, draft: text } },
  DONE: (state, { message, text }) => ({ ...state, messages: [...state.messages, message], draft: '', status: 'ready', chars: text.length, at: performance.now() }),
  FAILED: (state, { error }) => ({ ...state, status: 'error: ' + error.message }),
}

const start = async (transport) => {
  const { id, el } = mount()
  const app = run(Chat, { LLM: makeChatDriver({ transport }) }, { mountPoint: id })
  await waitFor(() => el.querySelector('.status'), 2000, 5)
  return { app, el }
}

export async function aiChatTestsP6_1L() {
  await runTest(CAT, 'render budget: 300 tokens / 2 ms over SSE renders at most ceil(duration/16)+2 times, one DOM patch each', async () => {
    const { app, el } = await start(sse(300))
    try {
      let patches = 0
      const mo = new MutationObserver(() => { patches++ })
      mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true })
      renders = 0; deltas = 0
      const t0 = performance.now()
      app.__runtime.dispatch('root', 'SEND')
      await waitFor(() => el.querySelector('.n')?.textContent === '1', 5000, 5)
      const { at, chars } = app.__runtime.getState()
      const ms = at - t0, budget = Math.ceil(ms / 16) + 2
      await wait(20)
      mo.disconnect()
      const engine = await window.__pwBrowser?.('engine')
      console.log('[p6-1l] ' + JSON.stringify({ engine, renders, deltas, patches, ms: Math.round(ms), budget }))
      assert(chars === 1390, `the whole reply arrived (${chars} chars)`)
      assert(renders <= budget, `renders ${renders} <= ceil(${Math.round(ms)}/16)+2 = ${budget}`)
      assert(deltas < 300 / 3, `coalesced: ${deltas} deltas for 300 tokens`)
      assert(patches <= renders + 1, `one DOM patch per render (${patches} patches, ${renders} renders)`)
    } finally { app.dispose() }
  }, 8000)

  await runTest(CAT, 'STOP mid-stream: the fetch is aborted (the server sees it), nothing arrives after it', async () => {
    const { app, el } = await start(sse(2000))
    try {
      const before = (await serverLog()).length
      app.__runtime.dispatch('root', 'SEND')
      await waitFor(() => el.querySelector('.draft').textContent.length > 100, 3000, 5)
      app.__runtime.dispatch('root', 'STOP')
      await wait(30)
      const at = el.querySelector('.draft').textContent
      deltas = 0
      await wait(150)
      assert(el.querySelector('.draft').textContent === at && deltas === 0, `no delta after STOP (${deltas})`)
      assert(el.querySelector('.status').textContent === 'stopped', `status ${el.querySelector('.status').textContent}`)
      const mine = (await serverLog())[before]
      assert(mine && mine.closedEarly, `the server saw the request closed early (${JSON.stringify(mine)})`)
      assert(mine.sent < 2000, `the server stopped sending (${mine.sent} of 2000)`)
    } finally { app.dispose() }
  }, 5000)

  await runTest(CAT, 'app.dispose() mid-stream: aborted, nothing delivered, no errors', async () => {
    const { app, el } = await start(sse(2000))
    const before = (await serverLog()).length
    app.__runtime.dispatch('root', 'SEND')
    await waitFor(() => el.querySelector('.draft').textContent.length > 50, 3000, 5)
    deltas = 0
    app.dispose()
    await wait(150)
    assert(deltas === 0, `no delta after dispose (${deltas})`)
    const mine = (await serverLog())[before]
    assert(mine && mine.closedEarly, `the server saw the request closed early (${JSON.stringify(mine)})`)
  }, 5000)
}
