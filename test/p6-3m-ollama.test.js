// PLAN-6 M-3, opt-in (not in npm test's default run): Experiment 5 (research/llm-experiments/exp5.js)
// through the commandBar behavior, against a real local Ollama (≥ 0.35) with the `nimble`
// decision model and the real fetch driver. TEST_OLLAMA=1 npm run test:ai-local (OLLAMA_URL
// overrides http://localhost:11434). Each command is judged on the app's state afterwards; the
// ambiguous one may also come back unsure (the escalation signal), which counts as handled.
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { createElement as h } from '../src/pragma/index.ts'
import { Collection } from '../src/collection.ts'
import { makeFetchDriver } from '../src/extra/fetchDriver.ts'
import { renderComponent } from '../src/extra/testing.ts'
import { commandBar } from '../src/extra/ai/index.ts'

const BASE = process.env.OLLAMA_URL || 'http://localhost:11434'
let t
afterEach(() => { t?.dispose(); t = undefined })

function TodoItem({ state }) { return h('li', null, state.text) }
TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  REMOVE: () => undefined,
}
TodoItem.agent = {
  name: 'todo',
  label: (state) => state.text,
  actions: {
    TOGGLE: { description: 'Mark an existing todo done or not done' },
    REMOVE: { description: 'Delete an existing todo' },
  },
}
function TodoApp({ state }) {
  return h('main', null, h('input', { className: 'command', value: state.cmd.text }), h('ul', null, h(Collection, { of: TodoItem, from: 'todos' })))
}
TodoApp.initialState = { todos: [{ id: 1, text: 'water plants', done: false }, { id: 2, text: 'buy milk', done: false }, { id: 3, text: 'call mom', done: false }], filter: 'all', nextId: 4 }
TodoApp.model = {
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 }),
  SET_FILTER: (state, filter) => ({ ...state, filter }),
}
TodoApp.agent = {
  name: 'todos',
  // the decision's state is { command, app: <read projections> } (exp5 sent { command, todos })
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })), filter: state.filter }),
  actions: {
    ADD: { description: 'Add a new todo', input: z.string().min(1) },
    // described literals: one decision option per value, with its own description
    SET_FILTER: {
      description: 'Which todos to show',
      input: z.union([
        z.literal('active').describe('Show only todos that are not done'),
        z.literal('done').describe('Show only completed todos'),
        z.literal('all').describe('Show every todo'),
      ]),
    },
  },
}
TodoApp.uses = { cmd: commandBar({ input: '.command', decide: { url: `${BASE}/v1/systemone`, model: 'nimble' }, below: 0.6 }) }

const fresh = TodoApp.initialState
// [command, the check on the state afterwards]
const CASES = [
  ['add walk the dog', (s) => s.todos.length === 4 && s.todos[3].text === 'walk the dog'],
  ['mark water plants as done', (s) => s.todos[0].done && !s.todos[1].done],
  ['I bought the milk', (s) => s.todos[1].done && !s.todos[0].done],
  ['get rid of the call mom item', (s) => s.todos.map((x) => x.id).join() === '1,2'],
  ['only show what is left to do', (s) => s.filter === 'active'],
  ['show me everything', (s, cmd) => s.filter === 'all' && cmd.result?.ok],
  ['what have I finished?', (s, cmd) => s.filter === 'done' || cmd.unsure?.reason === 'confidence'],
  ['delete buy milk', (s) => s.todos.map((x) => x.id).join() === '1,3'],
]

describe.skipIf(!process.env.TEST_OLLAMA)('commandBar against local Ollama nimble (Experiment 5)', () => {
  it('8 commands: action and target picked, run through the agent layer', async () => {
    const rows = []
    let ok = 0
    for (const [command, check] of CASES) {
      // the start state for each command, as exp5 (filter 'all' for "show me everything": idempotent no-op otherwise)
      const initialState = { ...fresh, cmd: undefined, filter: command === 'show me everything' ? 'done' : 'all' }
      delete initialState.cmd
      t = renderComponent(TodoApp, { initialState, drivers: { HTTP: makeFetchDriver() } })
      const t0 = performance.now()
      t.simulateAction('cmd.RUN', command)
      await t.settle()
      expect(t.state.cmd.status).toBe('deciding')
      const s = await t.next((s) => s.cmd.status === 'ready' || s.cmd.status === 'error', 60000)
      const cmd = s.cmd
      const good = !!check(s, cmd)
      ok += good
      rows.push({ command, tool: cmd.result?.tool ?? cmd.unsure?.tool, input: JSON.stringify(cmd.result?.input ?? null), ok: cmd.result?.ok ?? null, unsure: cmd.unsure?.reason ?? null, confidence: cmd.unsure?.confidence?.toFixed(2) ?? '', error: cmd.error ?? cmd.result?.error ?? '', good, ms: Math.round(performance.now() - t0) })
      t.dispose()
      t = undefined
    }
    console.table(rows)
    console.log(`commandBar + nimble: ${ok}/${CASES.length}`)
    expect(ok).toBeGreaterThanOrEqual(7)
  }, 600000)
})
