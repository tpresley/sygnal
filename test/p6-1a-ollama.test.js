// @vitest-environment jsdom
// PLAN-6 1-A: experiment 3's task through the A-1 layer (agentTools: keyed, labelled item tools,
// the read context in the system prompt, validation, repair, no-op detection) with a local model.
// Opt-in, never in npm test: TEST_OLLAMA=1 npx vitest run test/p6-1a-ollama.test.js
// (http://localhost:11434; OLLAMA_MODELS=llama3.2,qwen3:8b OLLAMA_N=3; OLLAMA_NOCTX=1 drops the context)
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { agentTools } from '../src/index.js'

function TodoItem({ state }) { return h('li', { class: { done: state.done } }, state.text) }
TodoItem.model = { TOGGLE: (s) => ({ ...s, done: !s.done }), REMOVE: () => undefined }
TodoItem.agent = {
  name: 'todo', label: (s) => s.text,
  actions: { TOGGLE: { description: 'Mark the todo done, or not done again' }, REMOVE: { description: 'Delete the todo', consequential: true } },
}
function TodoApp({ state }) {
  return h('main', null, h('ul', null, h(Collection, { of: TodoItem, from: 'todos' })), h('p', null, state.filter))
}
TodoApp.initialState = { todos: [{ id: 1, text: 'water plants', done: false }], filter: 'all', nextId: 2 }
TodoApp.model = {
  ADD: (s, text) => ({ ...s, todos: [...s.todos, { id: s.nextId, text, done: false }], nextId: s.nextId + 1 }),
  SET_FILTER: (s, filter) => ({ ...s, filter }),
}
TodoApp.agent = {
  name: 'todos', description: 'the todo list',
  read: (s) => ({ todos: s.todos.map(({ id, text, done }) => ({ id, text, done })), filter: s.filter }),
  actions: {
    ADD: { description: 'Add a todo with this text', input: z.string().min(1) },
    SET_FILTER: { description: 'Show all, only active (not done), or only done todos', input: z.enum(['all', 'active', 'done']), idempotent: true },
  },
}
const TASK = "Add todos 'buy milk' and 'call mom'. Mark 'water plants' as done. Then make the list show only active todos."
const success = (s) => s.todos.length === 3 && s.todos.some((t) => /buy milk/i.test(t.text) && !t.done) && s.todos.some((t) => /call mom/i.test(t.text) && !t.done) && s.todos.some((t) => t.text === 'water plants' && t.done) && s.filter === 'active'

async function agentLoop(model, layer, maxSteps = 10) {
  const trace = []
  const system = 'You operate a web app through its tools. Call tools to do the task, then reply DONE.' + (/qwen/.test(model) ? ' /no_think' : '')
  const messages = [{ role: 'system', content: system }, { role: 'user', content: TASK }]
  for (let i = 0; i < maxSteps; i++) {
    // the read context is refreshed every turn, as the chat behavior will (L-3)
    if (!process.env.OLLAMA_NOCTX) messages[0] = { role: 'system', content: system + '\nCurrent app state:\n' + JSON.stringify(layer.context()) }
    const tools = layer.list().map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
    const res = await fetch('http://localhost:11434/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, tools, temperature: 0.2 }), signal: AbortSignal.timeout(180000) }).then((r) => r.json())
    const msg = res.choices[0].message
    messages.push(msg)
    if (!msg.tool_calls?.length) break
    for (const c of msg.tool_calls) {
      let args = {}
      try { args = JSON.parse(c.function.arguments || '{}') } catch (_) {}
      const out = await layer.call(c.function.name, args)
      trace.push(`${c.function.name}(${c.function.arguments}) → ${out.ok ? 'ok' : out.error}`)
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out) })
    }
  }
  return trace
}

describe.skipIf(!process.env.TEST_OLLAMA)('1-A end to end with a local model (opt-in)', () => {
  for (const model of (process.env.OLLAMA_MODELS || 'llama3.2,qwen3:8b').split(',')) {
    it(`${model}: experiment 3's task through agentTools`, async () => {
      const N = +(process.env.OLLAMA_N || 3)
      let ok = 0, calls = 0
      const t0 = performance.now()
      for (let i = 0; i < N; i++) {
        document.body.innerHTML = '<div id="root"></div>'
        const app = run(TodoApp, {}, { diagnostics: 'off' })
        await app.__runtime.flushed()
        const layer = agentTools(app)
        const trace = await agentLoop(model, layer)
        calls += trace.length
        const good = success(app.__runtime.getState())
        ok += good
        process.stderr.write(`[1-A ollama] ${model} run ${i + 1}: ${good ? 'OK' : 'FAIL'} | ${trace.join(' | ')}\n`)
        layer.stop(); app.dispose()
      }
      process.stderr.write(`[1-A ollama] ${model}: ${ok}/${N}, ${(calls / N).toFixed(1)} calls, ${((performance.now() - t0) / N / 1000).toFixed(1)} s per run\n`)
      // a release signal, not a gate: small local models are unreliable (PLAN-6 §6)
      expect(ok).toBeGreaterThanOrEqual(0)
    }, 900000)
  }
})
