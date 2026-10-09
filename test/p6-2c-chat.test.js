// PLAN-6 L-3: the chat behavior. An assistant in a todo app (the samples' §3/§4 shape) streams
// through renderComponent's LLM fake (the real chat driver), runs the model's tool calls on the
// host's and its Collection items' `agent` tools (A-1), asks before consequential ones
// (APPROVE / DENY), stops mid-stream, stops at maxSteps, reports failures, and replays a turn.
import { it, expect, afterEach, describe } from 'vitest'
import { z } from 'zod'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { Collection } from '../src/collection.ts'
import { chat } from '../src/extra/ai/chat/behavior.ts'
import { messageText } from '../src/extra/ai/messages.ts'

// ------------------------------------------------------------------ the app

function TodoItem({ state }) {
  return h('li', { className: state.done ? 'done' : '' },
    h('label', null, h('input', { type: 'checkbox', className: 'toggle', checked: state.done }), ' ', state.text),
    h('button', { type: 'button', className: 'remove', 'aria-label': `Remove ${state.text}` }, '×'))
}
TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.toggle'), REMOVE: DOM.click('.remove') })
TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  REMOVE: () => undefined,
}
TodoItem.agent = {
  name: 'todo',
  description: 'A todo',
  label: (state) => state.text,
  actions: {
    TOGGLE: { description: 'Mark the todo done, or not done again' },
    REMOVE: { description: 'Delete the todo', consequential: true },
  },
}

// the assistant's markup: part of the host's view (its selectors are the host's, SYG104)
function assistantPanel(a) {
  return h('aside', { className: 'assistant' },
    h('ol', { className: 'conversation' },
      ...a.messages.map((m, i) => h('li', { key: i, className: m.role }, messageText(m))),
      a.draft ? h('li', { className: 'assistant streaming' }, a.draft) : null),
    a.pending ? h('div', { role: 'alertdialog', 'aria-label': 'Confirm' },
      h('p', null, `The assistant wants to: ${a.pending.description}`),
      h('button', { type: 'button', className: 'approve' }, 'Allow'),
      h('button', { type: 'button', className: 'deny' }, 'Deny')) : null,
    a.error ? h('p', { role: 'alert' }, a.error) : null,
    h('form', { className: 'ask' },
      h('label', null, 'Ask ', h('input', { className: 'prompt', value: a.prompt })),
      h('button', { type: 'submit', disabled: a.status !== 'ready' && a.status !== 'error' }, 'Send'),
      h('button', { type: 'button', className: 'stop', hidden: a.status === 'ready' || a.status === 'error' }, 'Stop'),
      h('button', { type: 'button', className: 'again' }, 'Regenerate')))
}

function TodoApp({ state }) {
  return h('main', null,
    h('form', { className: 'new' }, h('label', null, 'New todo ', h('input', { className: 'text', value: state.text }))),
    h('ul', { className: 'todos' }, h(Collection, { of: TodoItem, from: 'todos' })),
    h('p', { className: 'filter' }, state.filter),
    h('button', { type: 'button', className: 'clear', disabled: !state.todos.some((t) => t.done) }, 'Clear done'),
    assistantPanel(state.assistant))
}
const addTodo = (state, text) => ({ todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 })
TodoApp.initialState = { todos: [{ id: 1, text: 'water plants', done: false }], text: '', filter: 'all', nextId: 2, finished: 0 }
TodoApp.intent = ({ DOM }) => ({
  TYPE: DOM.input('.text').value(),
  SUBMIT: DOM.select('.new').events('submit', { preventDefault: true }),
  CLEAR_DONE: DOM.click('.clear'),
})
TodoApp.model = {
  TYPE: (state, text) => ({ ...state, text }),
  SUBMIT: (state) => ({ ...state, ...addTodo(state, state.text), text: '' }),
  ADD: (state, text) => ({ ...state, ...addTodo(state, text) }),
  SET_FILTER: (state, filter) => ({ ...state, filter }),
  CLEAR_DONE: (state) => ({ ...state, todos: state.todos.filter((t) => !t.done) }),
  // runs after the behavior's DONE
  'assistant.DONE': (state) => ({ ...state, finished: state.finished + 1 }),
}
TodoApp.agent = {
  name: 'todos',
  description: 'The todo list',
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })), filter: state.filter }),
  actions: {
    ADD: { description: 'Add a todo', input: z.string().min(1).describe('The todo text') },
    SET_FILTER: { description: 'Which todos to show', input: z.enum(['all', 'active', 'done']), idempotent: true },
    CLEAR_DONE: { description: 'Delete every todo that is done', consequential: true, when: (state) => state.todos.some((t) => t.done) },
  },
}
TodoApp.uses = {
  assistant: chat({
    sink: 'LLM',
    form: '.ask', prompt: '.prompt', stop: '.stop', approve: '.approve', deny: '.deny', regenerate: '.again',
    instructions: 'You help the user manage this todo list. Use the tools; keep replies short.',
  }),
}

// ------------------------------------------------------------------ helpers

let t
afterEach(() => { t?.dispose(); t = null })

const ask = (text) => {
  t.simulateEvent('.prompt', 'input', { value: text })
  t.simulateEvent('.ask', 'submit')
}
const last = () => t.requests('LLM').at(-1)
const toolParts = (m) => m.parts.filter((p) => p.type.startsWith('tool-'))
// the tool loop runs asynchronously (A-1's call awaits the flush): wait for the next request
async function waitUntil(f, tries = 50) {
  for (let i = 0; i < tries && !f(); i++) await t.settle()
  if (!f()) throw new Error('timed out')
}

// ------------------------------------------------------------------ tests

describe('chat behavior', () => {
  it('a plain reply: submitted → streaming → ready, then DONE (and the host entry after it)', async () => {
    t = renderComponent(TodoApp)
    expect(t.state.assistant).toEqual({ messages: [], prompt: '', draft: '', status: 'ready', pending: null, error: null })
    ask('Hi')
    await t.settle()
    expect(t.state.assistant).toMatchObject({ status: 'submitted', prompt: '' })
    const req = last()
    expect(req.messages).toEqual([{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }])
    expect(req).toMatchObject({ key: 'assistant', ok: 'assistant.REPLY', delta: 'assistant.DELTA', error: 'assistant.FAILED' })
    // the read projections go in the instructions; the tools by name, with their input schemas
    expect(req.instructions).toContain('You help the user manage this todo list.')
    expect(req.instructions).toContain('"text":"water plants"')
    expect(Object.keys(req.tools).sort()).toEqual(['todo_remove', 'todo_toggle', 'todos_add', 'todos_read', 'todos_set_filter'])
    expect(req.tools.todo_toggle.inputSchema.properties.id.enum).toEqual([1])
    await t.stream('LLM', ['Hello'], { end: false })
    expect(t.state.assistant).toMatchObject({ status: 'streaming', draft: 'Hello' })
    await t.stream('LLM', [' there'])
    await t.settle()
    expect(t.state.assistant.status).toBe('ready')
    expect(t.state.assistant.draft).toBe('')
    expect(t.state.assistant.messages.at(-1)).toEqual({ role: 'assistant', parts: [{ type: 'text', text: 'Hello there' }] })
    expect(t.actions.filter((a) => a.type === 'assistant.DONE').length).toBe(1)
    expect(t.state.finished).toBe(1)
    expect(t.html()).toContain('Hello there')
  })

  it('operates the app: tool calls run as agent actions, results go back, the loop ends on a reply without calls', async () => {
    t = renderComponent(TodoApp)
    ask("Add 'buy milk' and mark water plants done")
    await t.settle()
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'todos_add', input: { value: 'buy milk' } } }, { toolCall: { id: 'c2', name: 'todo_toggle', input: { id: 1 } } }])
    await waitUntil(() => t.requests('LLM').length === 2)
    expect(t.state.todos).toEqual([{ id: 1, text: 'water plants', done: true }, { id: 2, text: 'buy milk', done: false }])
    expect(t.actions.filter((a) => a.cause === 'agent').map((a) => a.type)).toEqual(['ADD', 'TOGGLE'])
    const req = last()
    const reply = req.messages.at(-1)
    expect(reply.role).toBe('assistant')
    expect(toolParts(reply)).toMatchObject([
      { type: 'tool-todos_add', toolCallId: 'c1', state: 'output-available', input: { value: 'buy milk' }, output: { ok: true } },
      { type: 'tool-todo_toggle', toolCallId: 'c2', state: 'output-available', output: { ok: true } },
    ])
    // the second turn sees the new state
    expect(req.instructions).toContain('"text":"buy milk"')
    expect(req.tools.todo_toggle.inputSchema.properties.id.enum).toEqual([1, 2])
    expect(t.state.assistant.status).toBe('submitted')
    await t.stream('LLM', ['Done.'])
    await t.settle()
    expect(t.state.assistant.status).toBe('ready')
    expect(messageText(t.state.assistant.messages.at(-1))).toBe('Done.')
    expect(t.state.finished).toBe(1)
  })

  it('invalid input and no-ops go back to the model as results, not into reducers', async () => {
    t = renderComponent(TodoApp)
    ask('filter')
    await t.settle()
    await t.stream('LLM', [{ toolCall: { id: 'a', name: 'todos_add', input: { value: 42 } } }, { toolCall: { id: 'b', name: 'todo_toggle', input: { id: 9 } } }])
    await waitUntil(() => t.requests('LLM').length === 2)
    const [add, toggle] = toolParts(last().messages.at(-1))
    expect(add.output).toMatchObject({ ok: false, error: expect.stringMatching(/invalid input/) })
    expect(toggle.output).toMatchObject({ ok: false, error: expect.stringMatching(/no todo with id 9/) })
    expect(t.state.todos.length).toBe(1)
  })

  it('a consequential call waits for APPROVE (pending), then runs', async () => {
    t = renderComponent(TodoApp)
    ask('remove water plants')
    await t.settle()
    await t.stream('LLM', [{ toolCall: { id: 'r', name: 'todo_remove', input: { id: 1 } } }])
    await waitUntil(() => t.state.assistant.pending)
    expect(t.state.assistant.pending).toMatchObject({ tool: 'todo_remove', action: 'REMOVE', key: 1, label: 'water plants', description: 'Delete the todo' })
    expect(t.state.assistant.status).toBe('streaming')
    expect(t.html()).toContain('The assistant wants to: Delete the todo')
    expect(t.state.todos.length).toBe(1)
    t.simulateEvent('.approve', 'click')
    await waitUntil(() => t.requests('LLM').length === 2)
    expect(t.state.assistant.pending).toBe(null)
    expect(t.state.todos).toEqual([])
    expect(toolParts(last().messages.at(-1))[0].output).toMatchObject({ ok: true, removed: true })
  })

  it('DENY declines: the model is told, nothing changes', async () => {
    t = renderComponent(TodoApp, { initialState: { ...TodoApp.initialState, todos: [{ id: 1, text: 'water plants', done: true }] } })
    ask('clear the done ones')
    await t.settle()
    await t.stream('LLM', [{ toolCall: { id: 'x', name: 'todos_clear_done', input: {} } }])
    await waitUntil(() => t.state.assistant.pending)
    t.simulateEvent('.deny', 'click')
    await waitUntil(() => t.requests('LLM').length === 2)
    expect(toolParts(last().messages.at(-1))[0].output).toEqual({ ok: false, error: 'the user declined' })
    expect(t.state.todos.length).toBe(1)
    expect(t.state.assistant.pending).toBe(null)
  })

  it('STOP mid-stream aborts the request, keeps the partial text, and closes the turn', async () => {
    t = renderComponent(TodoApp)
    ask('Tell me a story')
    await t.settle()
    await t.stream('LLM', ['Once upon'], { end: false })
    expect(t.state.assistant.status).toBe('streaming')
    t.simulateEvent('.stop', 'click')
    await t.settle()
    expect(t.state.assistant).toMatchObject({ status: 'ready', draft: '' })
    expect(t.state.assistant.messages.at(-1)).toEqual({ role: 'assistant', parts: [{ type: 'text', text: 'Once upon' }] })
    expect(t.sinkValues('LLM').filter((r) => r.abort === 'assistant').length).toBe(1)
    // the stream is gone: nothing more arrives
    expect(() => t.stream('LLM', [' a time'])).toThrow(/no pending LLM request/)
    expect(t.actions.some((a) => a.type === 'assistant.DONE')).toBe(false)
  })

  it('STOP while a consequential call waits declines it and drops the turn', async () => {
    t = renderComponent(TodoApp)
    ask('remove it')
    await t.settle()
    await t.stream('LLM', [{ toolCall: { id: 'r', name: 'todo_remove', input: { id: 1 } } }])
    await waitUntil(() => t.state.assistant.pending)
    t.simulateEvent('.stop', 'click')
    for (let i = 0; i < 5; i++) await t.settle()
    expect(t.state.assistant).toMatchObject({ status: 'ready', pending: null })
    expect(t.requests('LLM').filter((r) => r.messages).length).toBe(1)
    expect(t.state.todos.length).toBe(1)
    expect(toolParts(t.state.assistant.messages.at(-1))[0]).toMatchObject({ state: 'output-error', errorText: 'not run: stopped by the user' })
  })

  it('maxSteps: the calls of a reply past the limit are not run, and the turn ends', async () => {
    function Small({ state }) { return h('div', null, h('p', null, state.count)) }
    Small.initialState = { count: 0 }
    Small.model = { BUMP: (state) => ({ ...state, count: state.count + 1 }) }
    Small.agent = { name: 'counter', read: (state) => ({ count: state.count }), actions: { BUMP: { description: 'Add one' } } }
    Small.uses = { assistant: chat({ maxSteps: 2 }) }
    t = renderComponent(Small)
    t.simulateAction('assistant.SEND', 'count to three')
    await t.settle()
    await t.stream('LLM', [{ toolCall: { name: 'counter_bump' } }])
    await waitUntil(() => t.requests('LLM').length === 2)
    expect(t.state.count).toBe(1)
    await t.stream('LLM', [{ toolCall: { name: 'counter_bump' } }])
    for (let i = 0; i < 5; i++) await t.settle()
    expect(t.requests('LLM').length).toBe(2)
    expect(t.state.count).toBe(1)
    expect(t.state.assistant.status).toBe('ready')
    expect(toolParts(t.state.assistant.messages.at(-1))[0]).toMatchObject({ state: 'output-error', errorText: expect.stringMatching(/maxSteps 2/) })
    expect(t.actions.find((a) => a.type === 'assistant.DONE').data).toMatchObject({ steps: 2 })
  })

  it('an error: status error with the message; a new SEND works after it', async () => {
    t = renderComponent(TodoApp)
    ask('Hi')
    await t.settle()
    await t.fail('LLM', new Error('model overloaded'))
    await t.settle()
    expect(t.state.assistant).toMatchObject({ status: 'error', error: 'model overloaded', draft: '' })
    expect(t.html()).toContain('model overloaded')
    ask('Hi again')
    await t.settle()
    expect(t.state.assistant).toMatchObject({ status: 'submitted', error: null })
    expect(last().messages.map(messageText)).toEqual(['Hi', 'Hi again'])
  })

  it('REGENERATE replays the last user turn', async () => {
    t = renderComponent(TodoApp)
    ask('Name a color')
    await t.settle()
    await t.respond('LLM', 'Red')
    await t.settle()
    expect(t.state.assistant.messages.length).toBe(2)
    t.simulateEvent('.again', 'click')
    await t.settle()
    expect(t.state.assistant.status).toBe('submitted')
    expect(last().messages.map(messageText)).toEqual(['Name a color'])
    await t.respond('LLM', 'Blue')
    await t.settle()
    expect(t.state.assistant.messages.map(messageText)).toEqual(['Name a color', 'Blue'])
  })

  it('SEND is ignored while a turn runs, and for an empty prompt', async () => {
    t = renderComponent(TodoApp)
    t.simulateEvent('.ask', 'submit')
    await t.settle()
    expect(t.requests('LLM').length).toBe(0)
    ask('one')
    await t.settle()
    ask('two')
    await t.settle()
    expect(t.requests('LLM').length).toBe(1)
    expect(t.state.assistant.prompt).toBe('two')
  })

  it('agent: false sends no tools and no context; agent: [Comp] narrows', async () => {
    function A({ state }) { return h('div', null, h(Collection, { of: TodoItem, from: 'todos' })) }
    A.initialState = { todos: [{ id: 1, text: 'x', done: false }] }
    A.agent = TodoApp.agent
    A.model = { ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: 2, text, done: false }] }), SET_FILTER: (s) => s, CLEAR_DONE: (s) => s }
    A.uses = { assistant: chat({ agent: false, instructions: 'Be nice.' }) }
    t = renderComponent(A)
    t.simulateAction('assistant.SEND', 'hi')
    await t.settle()
    expect(last().tools).toBeUndefined()
    expect(last().instructions).toBe('Be nice.')
    t.dispose()
    A.uses = { assistant: chat({ agent: [TodoItem] }) }
    t = renderComponent(A)
    t.simulateAction('assistant.SEND', 'hi')
    await t.settle()
    expect(Object.keys(last().tools)).toEqual(['todo_toggle', 'todo_remove'])
  })

  it('model and transportOptions go on the request', async () => {
    function B() { return h('div') }
    B.uses = { chat: chat({ model: 'qwen3:8b', transportOptions: { temperature: 0.2 } }) }
    t = renderComponent(B)
    t.simulateAction('chat.SEND', { text: 'hello' })
    await t.settle()
    expect(last()).toMatchObject({ model: 'qwen3:8b', temperature: 0.2, key: 'chat', ok: 'chat.REPLY' })
    expect(last().tools).toBeUndefined()
  })

  it('two hosts in two apps at once: each request and tool call stays with its own app', async () => {
    t = renderComponent(TodoApp)
    const u = renderComponent(TodoApp, { initialState: { ...TodoApp.initialState, todos: [{ id: 7, text: 'other', done: false }], nextId: 8 } })
    try {
      ask('first')
      u.simulateAction('assistant.SEND', 'second')
      await t.settle(); await u.settle()
      expect(last().tools.todo_toggle.inputSchema.properties.id.enum).toEqual([1])
      expect(u.requests('LLM')[0].tools.todo_toggle.inputSchema.properties.id.enum).toEqual([7])
      await u.stream('LLM', [{ toolCall: { name: 'todo_toggle', input: { id: 7 } } }])
      for (let i = 0; i < 20 && u.requests('LLM').length < 2; i++) await u.settle()
      expect(u.state.todos[0].done).toBe(true)
      expect(t.state.todos[0].done).toBe(false)
      expect(t.state.assistant.status).toBe('submitted')
    } finally { u.dispose() }
  })

  it('exports: sygnal and the sygnal/ai entry', async () => {
    const index = await import('../src/index.ts')
    expect(index.chat).toBe(chat)
  })
})
