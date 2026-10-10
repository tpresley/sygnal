// PLAN-6 M-3: the commandBar behavior. A todo app (the samples' §3 shape) with a command field:
// one decision request per command (through the HTTP fake, answered with answers() fixtures)
// picks the action and the Collection item; the call runs through the agent layer (A-1:
// validation, no-op detection, cause 'agent', confirm → pending); unsure commands set `unsure`, or
// go to the chat behavior named by `escalate`.
import { it, expect, afterEach, describe, vi } from 'vitest'
import { z } from 'zod'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { Collection } from '../src/collection.ts'
import { commandBar, chat, answers, decide } from '../src/extra/ai/index.ts'
import { freeText } from '../src/extra/ai/commandBar.ts'

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
    TOGGLE: { description: 'Mark an existing todo done or not done' },
    REMOVE: { description: 'Delete an existing todo', consequential: true },
  },
}

function commandField(cmd) {
  return h('section', { className: 'cmd' },
    h('label', null, 'Command ', h('input', { className: 'command', value: cmd.text })),
    cmd.pending ? h('div', { role: 'alertdialog', 'aria-label': 'Confirm' },
      h('p', null, `Run: ${cmd.pending.description} (${cmd.pending.label})?`),
      h('button', { type: 'button', className: 'yes' }, 'Run'),
      h('button', { type: 'button', className: 'no' }, 'Cancel')) : null,
    cmd.unsure ? h('p', { className: 'unsure' }, `Not sure what "${cmd.unsure.command}" means`) : null,
    cmd.error ? h('p', { role: 'alert' }, cmd.error) : null)
}

function TodoApp({ state }) {
  return h('main', null,
    commandField(state.cmd),
    h('ul', { className: 'todos' }, h(Collection, { of: TodoItem, from: 'todos' })),
    h('p', { className: 'filter' }, state.filter))
}
TodoApp.initialState = { todos: [{ id: 1, text: 'water plants', done: false }, { id: 2, text: 'buy milk', done: false }, { id: 3, text: 'call mom', done: false }], filter: 'all', nextId: 4, ran: 0 }
TodoApp.model = {
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 }),
  SET_FILTER: (state, filter) => ({ ...state, filter }),
  'cmd.DONE': (state) => ({ ...state, ran: state.ran + 1 }),
}
TodoApp.agent = {
  name: 'todos',
  description: 'The todo list',
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })), filter: state.filter }),
  actions: {
    ADD: { description: 'Add a new todo', input: z.string().min(1).describe('The todo text') },
    SET_FILTER: { description: 'Which todos to show', input: z.enum(['all', 'active', 'done']), idempotent: true },
  },
}
TodoApp.uses = {
  cmd: commandBar({ input: '.command', decide: { url: '/api/decide', model: 'jev-latest' }, approve: '.yes', deny: '.no' }),
}

// ------------------------------------------------------------------ helpers

let t
afterEach(() => { t?.dispose(); t = null })

const run = async (command) => {
  t.simulateEvent('.command', 'input', { value: command })
  t.simulateEvent('.command', 'keydown', { key: 'Enter', value: command })
  await t.settle()
}
const lastRequest = () => t.requests('HTTP').at(-1)
const questionsOf = () => lastRequest().json.questions
async function waitUntil(f, tries = 50) {
  for (let i = 0; i < tries && !f(); i++) await t.settle()
  if (!f()) throw new Error('timed out')
}
const decideWith = async (picks) => {
  await t.respond('HTTP', answers(questionsOf(), picks), 'cmd.DECIDED')
  await waitUntil(() => t.state.cmd.status !== 'deciding' && t.state.cmd.status !== 'running' || !!t.state.cmd.pending)
}

// ------------------------------------------------------------------ tests

describe('commandBar', () => {
  it('one decision request: the actions (enum inputs as one option per value) and the live items', async () => {
    t = renderComponent(TodoApp)
    expect(t.state.cmd).toEqual({ text: '', status: 'ready', command: null, pending: null, unsure: null, result: null, error: null })
    await run('I bought the milk')
    expect(t.state.cmd).toMatchObject({ status: 'deciding', command: 'I bought the milk', text: 'I bought the milk' })
    const req = lastRequest()
    expect(req).toMatchObject({ url: '/api/decide', method: 'POST', ok: 'cmd.DECIDED', error: 'cmd.FAILED' })
    expect(req.json.model).toBe('jev-latest')
    // G-644: the labels (user text) are data, in the decision's state; the criteria name ids only
    expect(req.json.state).toEqual({
      command: 'I bought the milk',
      app: { todos: { todos: TodoApp.initialState.todos.map(({ id, text, done }) => ({ id, text, done })), filter: 'all' } },
      labels: { 1: 'water plants', 2: 'buy milk', 3: 'call mom' },
    })
    expect(req.json.questions.action).toEqual({
      type: 'choice',
      instructions: 'Which app action does the command ask for?',
      criteria: {
        todos_add: 'Add a new todo',
        'todos_set_filter=all': 'Which todos to show: all',
        'todos_set_filter=active': 'Which todos to show: active',
        'todos_set_filter=done': 'Which todos to show: done',
        todo_toggle: 'Mark an existing todo done or not done',
        todo_remove: 'Delete an existing todo',
        none: 'None of these actions',
      },
    })
    expect(req.json.questions.target).toEqual({
      type: 'choice',
      instructions: "Which existing todo does the command refer to (none if it names no existing todo)? Each option's label is in state.labels.",
      criteria: {
        none: 'No existing todo',
        1: 'The todo with id 1 (its label: state.labels["1"])',
        2: 'The todo with id 2 (its label: state.labels["2"])',
        3: 'The todo with id 3 (its label: state.labels["3"])',
      },
    })
    expect(JSON.stringify(req.json.questions)).not.toContain('buy milk')
    // a second RUN while deciding is ignored
    t.simulateAction('cmd.RUN', 'add eggs')
    await t.settle()
    expect(t.requests('HTTP')).toHaveLength(1)
  })

  it('an item action: the target goes in as the key; cause agent; DONE and the host entry; the field is cleared', async () => {
    t = renderComponent(TodoApp)
    await run('I bought the milk')
    await decideWith({ action: { choice: 'todo_toggle', confidence: 0.95 }, target: { choice: '2', confidence: 0.99 } })
    expect(t.state.todos[1]).toEqual({ id: 2, text: 'buy milk', done: true })
    expect(t.actions.filter((a) => a.cause === 'agent').map((a) => a.type)).toEqual(['TOGGLE'])
    expect(t.state.cmd).toMatchObject({ status: 'ready', command: null, text: '', unsure: null })
    expect(t.state.cmd.result).toMatchObject({ command: 'I bought the milk', tool: 'todo_toggle', input: { id: 2 }, ok: true })
    expect(t.state.ran).toBe(1)
  })

  it('an enum value picked as an option; free text from the command (quoted part, else minus the first word)', async () => {
    t = renderComponent(TodoApp)
    await run('only show what is left to do')
    await decideWith({ action: 'todos_set_filter=active', target: 'none' })
    expect(t.state.filter).toBe('active')
    expect(t.state.cmd.result).toMatchObject({ tool: 'todos_set_filter', input: { value: 'active' }, ok: true })

    await run('add walk the dog')
    await decideWith({ action: 'todos_add', target: 'none' })
    expect(t.state.todos.at(-1)).toEqual({ id: 4, text: 'walk the dog', done: false })

    await run('please put "renew passport" on the list')
    await decideWith({ action: 'todos_add' })
    expect(t.state.todos.at(-1).text).toBe('renew passport')
    expect(freeText('add')).toBeUndefined()
    expect(freeText('remember ‘x’ “call the bank”')).toBe('call the bank')
  })

  it('A-1 rules: a no-op is an error result (idempotent: unchanged), an invalid input is refused', async () => {
    t = renderComponent(TodoApp)
    await run('show me everything')
    await decideWith({ action: 'todos_set_filter=all' })
    expect(t.state.cmd.result).toMatchObject({ ok: true, unchanged: true })
    // an item action needs its item: 'none' as the target is unsure, nothing runs
    await run('toggle it')
    await decideWith({ action: 'todo_toggle', target: 'none' })
    expect(t.state.cmd.unsure).toMatchObject({ command: 'toggle it', reason: 'target', tool: 'todo_toggle', target: null })
    expect(t.actions.filter((a) => a.cause === 'agent').map((a) => a.type)).toEqual(['SET_FILTER'])
  })

  it('a consequential action: pending until APPROVE (or DENY: declined, nothing runs)', async () => {
    t = renderComponent(TodoApp)
    await run('get rid of the call mom item')
    await decideWith({ action: 'todo_remove', target: '3' })
    expect(t.state.cmd.status).toBe('running')
    expect(t.state.cmd.pending).toMatchObject({ tool: 'todo_remove', action: 'REMOVE', key: 3, label: 'call mom', description: 'Delete an existing todo' })
    expect(t.html()).toContain('Run: Delete an existing todo (call mom)?')
    t.simulateEvent('.no', 'click')
    await waitUntil(() => t.state.cmd.status === 'ready')
    expect(t.state.cmd.result).toMatchObject({ ok: false, error: 'the user declined' })
    expect(t.state.todos).toHaveLength(3)
    // the field keeps a command that didn't run
    expect(t.state.cmd.text).toBe('get rid of the call mom item')

    await run('delete buy milk')
    await decideWith({ action: 'todo_remove', target: '2' })
    t.simulateEvent('.yes', 'click')
    await waitUntil(() => t.state.cmd.status === 'ready')
    expect(t.state.cmd.result).toMatchObject({ ok: true, removed: true })
    expect(t.state.todos.map((x) => x.id)).toEqual([1, 3])
  })

  it('below `below`: unsure for the view (action or target confidence; "none of these")', async () => {
    t = renderComponent(TodoApp)
    await run('what have I finished?')
    await decideWith({ action: { choice: 'todos_set_filter=done', confidence: 0.43 } })
    expect(t.state.cmd.unsure).toEqual({ command: 'what have I finished?', reason: 'confidence', tool: 'todos_set_filter', description: 'Which todos to show: done', target: null, label: null, confidence: 0.43 })
    expect(t.state.filter).toBe('all')
    expect(t.html()).toContain('Not sure what "what have I finished?" means')

    await run('mark plants')
    await decideWith({ action: 'todo_toggle', target: { choice: '1', confidence: 0.3 } })
    expect(t.state.cmd.unsure).toMatchObject({ reason: 'target', target: 1, label: 'water plants', confidence: 0.3 })

    await run('what is the weather')
    await decideWith({ action: 'none' })
    expect(t.state.cmd.unsure).toMatchObject({ reason: 'no-action', tool: null })
    // a new command clears it
    await run('show all')
    expect(t.state.cmd.unsure).toBe(null)
  })

  it('a failed decision request: status error, then a new command works', async () => {
    t = renderComponent(TodoApp)
    await run('add x')
    await t.fail('HTTP', new Error('offline'), 'cmd.FAILED')
    await t.settle()
    expect(t.state.cmd).toMatchObject({ status: 'error', error: 'offline', command: null })
    await run('add y')
    expect(t.state.cmd.status).toBe('deciding')
  })

  it('decide as a function (e.g. decide.openai), a form submit, below and freeText options, agent: [Comp]', async () => {
    function App({ state }) {
      return h('main', null,
        h('form', { className: 'bar' }, h('input', { className: 'command', value: state.cmd.text })),
        h('ul', null, h(Collection, { of: TodoItem, from: 'todos' })))
    }
    App.initialState = { todos: [{ id: 'a', text: 'water plants', done: false }] }
    App.model = { ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: text, text, done: false }] }) }
    App.agent = { name: 'list', actions: { ADD: { description: 'Add a todo', input: z.string() } } }
    const seen = []
    App.uses = {
      cmd: commandBar({
        input: '.command', form: '.bar', below: 0.9, agent: [TodoItem],
        decide: (q) => ({ ...decide.openai({ url: '/api/openai-decide', model: 'gpt-6-luna', ...q }) }),
        freeText: (command, tool) => { seen.push([command, tool]) },
      }),
    }
    t = renderComponent(App)
    t.simulateEvent('.command', 'input', { value: 'water the plants' })
    t.simulateEvent('.bar', 'submit')
    await t.settle()
    const req = lastRequest()
    expect(req.url).toBe('/api/openai-decide')
    expect(req.json.questions.map((q) => q.name)).toEqual(['action', 'target'])
    // only TodoItem's actions
    expect(req.json.questions[0].choices.map((c) => c.value)).toEqual(['todo_toggle', 'todo_remove', 'none'])
    const qs = { action: { type: 'choice', criteria: { todo_toggle: null, todo_remove: null, none: null } }, target: { type: 'choice', criteria: { none: null, a: null } } }
    await t.respond('HTTP', answers.openai(qs, { action: { choice: 'todo_toggle', confidence: 0.95 }, target: { choice: 'a', confidence: 0.95 } }), 'cmd.DECIDED')
    await waitUntil(() => t.state.cmd.status === 'ready')
    expect(t.state.todos[0].done).toBe(true)
    // below 0.9: 0.85 is unsure
    t.simulateAction('cmd.RUN', 'toggle it again')
    await t.settle()
    await t.respond('HTTP', answers.openai(qs, { action: { choice: 'todo_toggle', confidence: 0.85 }, target: 'a' }), 'cmd.DECIDED')
    await t.settle()
    expect(t.state.cmd.unsure).toMatchObject({ reason: 'confidence', confidence: 0.85 })
    expect(seen).toEqual([])
  })

  it('freeText returning undefined: unsure (reason input); an action with a number input is never guessed', async () => {
    function App({ state }) { return h('input', { className: 'command', value: state.cmd.text }) }
    App.initialState = { n: 0, items: [] }
    App.model = { ADD: (state, text) => ({ ...state, items: [...state.items, text] }), SET_N: (state, n) => ({ ...state, n }) }
    App.agent = { name: 'app', actions: { ADD: { description: 'Add an item', input: z.string() }, SET_N: { description: 'Set the count', input: z.number() } } }
    App.uses = { cmd: commandBar({ input: '.command', decide: { model: 'nimble' }, freeText: () => undefined }) }
    t = renderComponent(App)
    await run('add apples')
    expect(Object.keys(questionsOf().action.criteria)).toEqual(['app_add', 'app_set_n', 'none'])
    expect(questionsOf().target).toBeUndefined()
    await decideWith({ action: 'app_add' })
    expect(t.state.cmd.unsure).toMatchObject({ reason: 'input', tool: 'app_add' })
    await run('set the count to 5')
    await decideWith({ action: 'app_set_n' })
    expect(t.state.cmd.unsure).toMatchObject({ reason: 'input', tool: 'app_set_n' })
    expect(t.state.items).toEqual([])
  })

  it('D288: a click of the `run` selector (a Go button) runs the field\'s command; Enter still does', async () => {
    function App({ state }) {
      return h('main', null,
        h('input', { className: 'command', value: state.cmd.text }), h('button', { type: 'button', className: 'go' }, 'Go'),
        h('ul', null, h(Collection, { of: TodoItem, from: 'todos' })))
    }
    App.initialState = { todos: [{ id: 1, text: 'water plants', done: false }] }
    App.uses = { cmd: commandBar({ input: '.command', run: '.go', decide: { model: 'nimble' } }) }
    t = renderComponent(App)
    t.simulateEvent('.go', 'click')
    await t.settle()
    expect(t.requests('HTTP').length).toBe(0)
    t.simulateEvent('.command', 'input', { value: 'water plants done' })
    t.simulateEvent('.go', 'click')
    await t.settle()
    expect(t.state.cmd).toMatchObject({ status: 'deciding', command: 'water plants done' })
    await decideWith({ action: 'todo_toggle', target: '1' })
    expect(t.state.todos[0].done).toBe(true)
    expect(t.state.cmd.text).toBe('')
    await run('water plants undone')
    expect(t.state.cmd.status).toBe('deciding')
  })

  it('escalate: an unsure command goes to the chat behavior (its SEND), with the reason in result', async () => {
    function App({ state }) {
      return h('main', null,
        h('input', { className: 'command', value: state.cmd.text }),
        h('ul', null, h(Collection, { of: TodoItem, from: 'todos' })),
        h('ol', null, ...state.assistant.messages.map((m, i) => h('li', { key: i }, m.parts.map((p) => p.text).join('')))))
    }
    App.initialState = { todos: [{ id: 1, text: 'water plants', done: false }] }
    App.uses = {
      cmd: commandBar({ input: '.command', decide: { model: 'nimble' }, below: 0.6, escalate: 'assistant' }),
      assistant: chat({ instructions: 'Help with the todos.' }),
    }
    t = renderComponent(App)
    await run('what have I finished?')
    await decideWith({ action: { choice: 'todo_toggle', confidence: 0.43 }, target: '1' })
    expect(t.state.cmd.unsure).toBe(null)
    expect(t.state.cmd.result).toMatchObject({ command: 'what have I finished?', escalated: 'assistant', reason: 'confidence', confidence: 0.43 })
    expect(t.state.assistant.status).toBe('submitted')
    const llm = t.requests('LLM')[0]
    // (the app-state block before it carries the item labels, G-644)
    expect(llm.messages.map((m) => m.id ?? m.parts[0].text)).toEqual(['sygnal-app-state', 'what have I finished?'])
    // the chat model gets the same tools
    expect(Object.keys(llm.tools)).toEqual(['todo_toggle', 'todo_remove'])
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'todo_toggle', input: { id: 1 } } }])
    await waitUntil(() => t.requests('LLM').length === 2)
    await t.respond('LLM', 'Done: water plants is checked.')
    await t.settle()
    expect(t.state.todos[0].done).toBe(true)
    expect(t.state.assistant.status).toBe('ready')
  })

  it('G-644: untrusted: false on the item declaration keeps its labels as the criteria (no state.labels)', async () => {
    const decl = TodoItem.agent
    try {
      TodoItem.agent = { ...decl, untrusted: false }
      t = renderComponent(TodoApp)
      await run('I bought the milk')
      expect(questionsOf().target).toEqual({
        type: 'choice',
        instructions: 'Which existing todo does the command refer to (none if it names no existing todo)?',
        criteria: { none: 'No existing todo', 1: 'water plants', 2: 'buy milk', 3: 'call mom' },
      })
      expect(lastRequest().json.state.labels).toBeUndefined()
    } finally { TodoItem.agent = decl }
  })

  it('the targets are the live items: a removed one is gone from the next decision', async () => {
    t = renderComponent(TodoApp)
    await run('delete buy milk')
    await decideWith({ action: 'todo_remove', target: '2' })
    t.simulateEvent('.yes', 'click')
    await waitUntil(() => t.state.cmd.status === 'ready')
    await run('mark call mom done')
    expect(Object.keys(questionsOf().target.criteria)).toEqual(['1', '3', 'none'])
    expect(lastRequest().json.state.labels).toEqual({ 1: 'water plants', 3: 'call mom' })
  })

  it('SYG442: an app started before the first commandBar() call runs no commands', async () => {
    const L = globalThis.__SYGNAL_DIAGNOSTICS__.layers
    const kept = [...L]
    L.clear()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      t = renderComponent(TodoApp)
    } finally { for (const f of kept) L.add(f) }
    expect(err.mock.calls.some((c) => String(c[0]).includes('SYG442') && String(c[0]).includes('commandBar'))).toBe(true)
    err.mockRestore()
    t.simulateAction('cmd.RUN', 'add milk')
    await t.settle()
    expect(t.requests('HTTP')).toHaveLength(0)
    expect(t.state.cmd).toMatchObject({ status: 'error', error: expect.stringContaining('SYG442') })
  })
})
