// PLAN-6 M-3: the command bar under the dev checks and strict mode (sygnal/diagnostics installed):
// commands run, a consequential one is approved, an unsure one escalates to the chat behavior,
// and nothing above info is reported.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { Collection } from '../src/collection.ts'
import { commandBar, chat, answers } from '../src/extra/ai/index.ts'
import { messageText } from '../src/extra/ai/messages.ts'

function TodoItem({ state }) {
  return h('li', null, h('input', { type: 'checkbox', className: 'toggle', checked: state.done }), state.text)
}
TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.toggle') })
TodoItem.model = { TOGGLE: (state) => ({ ...state, done: !state.done }) }
TodoItem.agent = { name: 'todo', label: (state) => state.text, actions: { TOGGLE: { description: 'Mark an existing todo done or not done' } } }

function TodoApp({ state }) {
  const { cmd, assistant } = state
  return h('main', null,
    h('label', null, 'Command ', h('input', { className: 'command', value: cmd.text })),
    cmd.pending ? h('p', null, h('button', { type: 'button', className: 'yes' }, 'Run'), h('button', { type: 'button', className: 'no' }, 'Cancel')) : null,
    h('ul', null, h(Collection, { of: TodoItem, from: 'todos' })),
    h('ol', null, ...assistant.messages.map((m, i) => h('li', { key: i }, messageText(m)))))
}
TodoApp.initialState = { todos: [{ id: 1, text: 'water plants', done: false }], nextId: 2 }
TodoApp.model = {
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 }),
  CLEAR: (state) => ({ ...state, todos: [] }),
}
TodoApp.agent = {
  name: 'todos',
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })) }),
  actions: {
    ADD: { description: 'Add a new todo', input: z.string().min(1) },
    CLEAR: { description: 'Delete every todo', consequential: true },
  },
}
TodoApp.uses = {
  cmd: commandBar({ input: '.command', decide: { model: 'nimble' }, approve: '.yes', deny: '.no', escalate: 'assistant' }),
  assistant: chat({ instructions: 'Manage the todos.' }),
}

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null; vi.restoreAllMocks() })

async function waitUntil(f, tries = 50) {
  for (let i = 0; i < tries && !f(); i++) await t.settle()
  if (!f()) throw new Error('timed out')
}
const run = async (command, picks) => {
  t.simulateEvent('.command', 'input', { value: command })
  t.simulateEvent('.command', 'keydown', { key: 'Enter', value: command })
  await t.settle()
  await t.respond('HTTP', answers(t.requests('HTTP').at(-1).json.questions, picks), 'cmd.DECIDED')
  await t.settle()
}

describe('commandBar: dev checks', () => {
  it('strict mode is clean: a command, a confirmed one, an escalated one', async () => {
    t = renderComponent(TodoApp, { strict: true })
    await run('add buy milk', { action: 'todos_add' })
    await waitUntil(() => t.state.cmd.status === 'ready')
    await run('mark water plants done', { action: 'todo_toggle', target: '1' })
    await waitUntil(() => t.state.cmd.status === 'ready')
    expect(t.state.todos).toEqual([{ id: 1, text: 'water plants', done: true }, { id: 2, text: 'buy milk', done: false }])
    await run('clear everything', { action: 'todos_clear' })
    await waitUntil(() => !!t.state.cmd.pending)
    t.simulateEvent('.yes', 'click')
    await waitUntil(() => t.state.cmd.status === 'ready')
    expect(t.state.todos).toEqual([])
    await run('hmm', { action: { choice: 'todos_add', confidence: 0.2 } })
    expect(t.state.cmd.result).toMatchObject({ escalated: 'assistant' })
    await t.respond('LLM', 'What would you like to add?')
    await t.settle()
    expect(t.state.assistant.status).toBe('ready')
    t.expectNoDiagnostics()
    expect(diagnostics().filter((d) => d.severity !== 'info')).toEqual([])
  })
})
