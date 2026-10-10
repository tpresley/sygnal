// PLAN-6 L-3: the chat behavior under the dev checks and strict mode (sygnal/diagnostics
// installed): an assistant operating a todo app reports nothing above info. And SYG442: a host in
// an app started before the first chat() call runs without tools, reported once.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { Collection } from '../src/collection.ts'
import { chat } from '../src/extra/ai/chat/behavior.ts'
import { messageText } from '../src/extra/ai/messages.ts'

function TodoItem({ state }) {
  return h('li', null, h('input', { type: 'checkbox', className: 'toggle', checked: state.done }), state.text)
}
TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.toggle') })
TodoItem.model = { TOGGLE: (state) => ({ ...state, done: !state.done }) }
TodoItem.agent = { name: 'todo', label: (state) => state.text, actions: { TOGGLE: { description: 'Mark the todo done, or not done again' } } }

function TodoApp({ state }) {
  const a = state.assistant
  return h('main', null,
    h('form', { className: 'new' }, h('input', { className: 'text', value: state.text })),
    h('ul', null, h(Collection, { of: TodoItem, from: 'todos' })),
    h('aside', null,
      h('ol', null, ...a.messages.map((m, i) => h('li', { key: i }, messageText(m)))),
      a.pending ? h('p', null, h('button', { className: 'approve' }, 'Allow'), h('button', { className: 'deny' }, 'Deny')) : null,
      h('form', { className: 'ask' },
        h('input', { className: 'prompt', value: a.prompt }),
        h('button', { type: 'button', className: 'stop' }, 'Stop'))))
}
TodoApp.initialState = { todos: [{ id: 1, text: 'water plants', done: false }], text: '', nextId: 2 }
TodoApp.intent = ({ DOM }) => ({
  TYPE: DOM.input('.text').value(),
  ADD: DOM.select('.new').events('submit', { preventDefault: true }).map(() => null),
})
TodoApp.model = {
  TYPE: (state, text) => ({ ...state, text }),
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text: text ?? state.text, done: false }], nextId: state.nextId + 1, text: '' }),
}
TodoApp.agent = {
  name: 'todos',
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })) }),
  actions: { ADD: { description: 'Add a todo', input: z.string().min(1) } },
}
TodoApp.uses = { assistant: chat({ form: '.ask', prompt: '.prompt', stop: '.stop', approve: '.approve', deny: '.deny', instructions: 'Manage the todos.' }) }

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null; vi.restoreAllMocks() })

describe('chat behavior: dev checks', () => {
  it('strict mode is clean through a tool loop', async () => {
    t = renderComponent(TodoApp, { strict: true })
    t.simulateEvent('.prompt', 'input', { value: 'Add milk, check water plants' })
    t.simulateEvent('.ask', 'submit')
    await t.settle()
    await t.stream('LLM', [{ toolCall: { name: 'todos_add', input: { value: 'milk' } } }, { toolCall: { name: 'todo_toggle', input: { id: 1 } } }])
    for (let i = 0; i < 20 && t.requests('LLM').length < 2; i++) await t.settle()
    await t.respond('LLM', 'Done.')
    await t.settle()
    expect(t.state.todos).toMatchObject([{ text: 'water plants', done: true }, { text: 'milk' }])
    expect(t.state.assistant.status).toBe('ready')
    t.expectNoDiagnostics()
    expect(diagnostics().filter((d) => d.severity !== 'info')).toEqual([])
  })

  it('SYG442: an app started before the first chat() call runs the assistant without tools', async () => {
    const L = globalThis.__SYGNAL_DIAGNOSTICS__.layers
    const kept = [...L]
    L.clear()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      t = renderComponent(TodoApp)
    } finally { for (const f of kept) L.add(f) }
    expect(diagnostics('SYG442').length).toBe(1)
    expect(err.mock.calls.some((c) => String(c[0]).includes('SYG442'))).toBe(true)
    t.simulateAction('assistant.SEND', 'hi')
    await t.settle()
    const req = t.requests('LLM')[0]
    expect(req.tools).toBeUndefined()
    expect(req.instructions).toBe('Manage the todos.')
    await t.respond('LLM', 'Hello')
    await t.settle()
    expect(t.state.assistant.status).toBe('ready')
    expect(t.actions.filter((a) => a.type === 'assistant.DONE').length).toBe(1)
  })
})
