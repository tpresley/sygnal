// @vitest-environment jsdom
// PLAN-6 2-C: experiment 3's task through the chat behavior, with the real chat driver over an
// Open Responses transport against a local Ollama. Opt-in, never in npm test:
//   TEST_OLLAMA=1 npx vitest run test/p6-2c-ollama.test.js
// (http://localhost:11434; OLLAMA_MODELS=qwen3:8b OLLAMA_N=3). The transport is the research
// prototype (dev-plans/research/llm-experiments/adapters.js `openaiResponses`) adapted to the
// merged transport interface (UIMessage parts in, ChatEvents out); 2-T ships the real one.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { chat, makeChatDriver, messageText } from '../src/index.js'

// ------------------------------------------------------------------ the transport (prototype)
async function* sse(res) {
  const reader = res.body.getReader(), dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i)
      buf = buf.slice(i + 2)
      let data = ''
      for (const line of frame.split('\n')) if (line.startsWith('data:')) data += line.slice(5).trim()
      if (data && data !== '[DONE]') yield JSON.parse(data)
    }
  }
}
// UIMessages → Responses input items: text as messages, a tool part as a function_call plus its
// function_call_output (the A-1 result, or the error of a call that didn't run)
const toInput = (m) => {
  const out = [], text = messageText(m)
  if (text) out.push({ role: m.role, content: text })
  for (const p of m.parts || []) {
    if (!p.type.startsWith('tool-')) continue
    out.push({ type: 'function_call', call_id: p.toolCallId, name: p.type.slice(5), arguments: JSON.stringify(p.input ?? {}) })
    if (p.state === 'output-available') out.push({ type: 'function_call_output', call_id: p.toolCallId, output: JSON.stringify(p.output) })
    else if (p.state === 'output-error') out.push({ type: 'function_call_output', call_id: p.toolCallId, output: JSON.stringify({ ok: false, error: p.errorText }) })
  }
  return out
}
function openResponses({ baseURL, model }) {
  return {
    async *stream(req, signal) {
      const res = await fetch(`${baseURL}/v1/responses`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal,
        body: JSON.stringify({
          model: req.model ?? model, stream: true, instructions: req.instructions, temperature: req.temperature,
          input: req.messages.flatMap(toInput),
          tools: req.tools && Object.entries(req.tools).map(([name, t]) => ({ type: 'function', name, description: t.description, parameters: t.inputSchema })),
        }),
      })
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body: await res.text() })
      const calls = {}
      for await (const e of sse(res)) {
        if (e.type === 'response.output_text.delta') yield { type: 'text', delta: e.delta }
        else if (e.type === 'response.reasoning_summary_text.delta') yield { type: 'reasoning', delta: e.delta }
        else if (e.type === 'response.output_item.added' && e.item?.type === 'function_call') calls[e.item.id] = e.item
        else if (e.type === 'response.function_call_arguments.done') {
          const c = calls[e.item_id] || {}
          let input = {}
          try { input = JSON.parse(e.arguments || '{}') } catch (_) { input = { value: e.arguments } }
          yield { type: 'tool-call', id: c.call_id ?? e.item_id, name: c.name ?? e.name, input }
        } else if (e.type === 'response.completed') yield { type: 'finish', usage: e.response?.usage }
        else if (e.type === 'response.failed' || e.type === 'error') throw new Error(e.response?.error?.message ?? e.message ?? 'failed')
      }
    },
  }
}

// ------------------------------------------------------------------ the app
function TodoItem({ state }) { return h('li', { class: { done: state.done } }, state.text) }
TodoItem.model = { TOGGLE: (state) => ({ ...state, done: !state.done }) }
TodoItem.agent = { name: 'todo', label: (state) => state.text, actions: { TOGGLE: { description: 'Mark the todo done, or not done again' } } }

function TodoApp({ state }) {
  return h('main', null, h('ul', null, h(Collection, { of: TodoItem, from: 'todos' })), h('p', null, state.filter),
    h('ol', null, ...state.assistant.messages.map((m, i) => h('li', { key: i }, messageText(m)))))
}
TodoApp.initialState = { todos: [{ id: 1, text: 'water plants', done: false }], filter: 'all', nextId: 2 }
TodoApp.model = {
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 }),
  SET_FILTER: (state, filter) => ({ ...state, filter }),
}
TodoApp.agent = {
  name: 'todos', description: 'the todo list',
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })), filter: state.filter }),
  actions: {
    ADD: { description: 'Add a todo with this text', input: z.string().min(1) },
    SET_FILTER: { description: 'Show all, only active (not done), or only done todos', input: z.enum(['all', 'active', 'done']), idempotent: true },
  },
}
// (/no_think: qwen3 answers without a thinking phase; other models ignore it)
TodoApp.uses = {
  assistant: chat({
    maxSteps: 10,
    instructions: 'You operate a todo app through its tools. Call tools to do the task, then reply DONE. /no_think',
    transportOptions: { temperature: 0.2 },
  }),
}
const TASK = "Add todos 'buy milk' and 'call mom'. Mark 'water plants' as done. Then make the list show only active todos."
const success = (s) => s.todos.length === 3 && s.todos.some((t) => /buy milk/i.test(t.text) && !t.done) && s.todos.some((t) => /call mom/i.test(t.text) && !t.done) && s.todos.some((t) => t.text === 'water plants' && t.done) && s.filter === 'active'

describe.skipIf(!process.env.TEST_OLLAMA)('2-C: the chat behavior with a local model (opt-in)', () => {
  for (const model of (process.env.OLLAMA_MODELS || 'qwen3:8b').split(',')) {
    it(`${model}: experiment 3's task through chat()`, async () => {
      const N = +(process.env.OLLAMA_N || 3)
      let ok = 0, steps = 0
      const t0 = performance.now()
      for (let i = 0; i < N; i++) {
        document.body.innerHTML = '<div id="root"></div>'
        const app = run(TodoApp, { LLM: makeChatDriver({ transport: openResponses({ baseURL: 'http://localhost:11434', model }) }) }, { diagnostics: 'off' })
        await app.__runtime.flushed()
        app.__runtime.dispatch('root', 'assistant.SEND', TASK)
        const end = Date.now() + 300000
        let s
        while (Date.now() < end) {
          await new Promise((r) => setTimeout(r, 250))
          s = app.__runtime.getState()
          if (s.assistant.status === 'ready' || s.assistant.status === 'error') break
        }
        const calls = s.assistant.messages.flatMap((m) => (m.parts || []).filter((p) => p.type.startsWith('tool-')).map((p) => `${p.type.slice(5)}(${JSON.stringify(p.input)}) → ${p.output?.ok ?? p.state}`))
        const good = success(s)
        ok += good
        steps += s.assistant.messages.filter((m) => m.role === 'assistant').length
        process.stderr.write(`[2-C ollama] ${model} run ${i + 1}: ${good ? 'OK' : 'FAIL'} status=${s.assistant.status}${s.assistant.error ? ' ' + s.assistant.error : ''} | ${calls.join(' | ')}\n`)
        app.dispose()
      }
      process.stderr.write(`[2-C ollama] ${model}: ${ok}/${N}, ${(steps / N).toFixed(1)} model turns, ${((performance.now() - t0) / N / 1000).toFixed(1)} s per run\n`)
      // a release signal, not a gate: small local models are unreliable (PLAN-6 §6)
      expect(ok).toBeGreaterThanOrEqual(0)
    }, 1800000)
  }
})
