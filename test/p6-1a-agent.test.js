// @vitest-environment jsdom
// PLAN-6 1-A: the A-1 agent layer (src/extra/ai/agent) and A-4's t.tools / t.callTool /
// t.agentContext. Spike 0-S2's cases (exp/p6-s2 test/p6-s2-agent.test.js) on the real layer, plus
// D256-D265 and the diagnostics. No network.
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import run from '../src/extra/run.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { Switchable } from '../src/switchable.js'
import { ABORT, abort, agentTools, jsonSchema } from '../src/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let t, app, layer
afterEach(() => { try { layer?.stop() } catch (_) {} try { t?.dispose() } catch (_) {} try { app?.dispose() } catch (_) {} t = app = layer = null; document.body.innerHTML = '' })
const mount = (C, o = {}) => { document.body.innerHTML = '<div id="root"></div>'; return (app = run(C, {}, { diagnostics: 'off', ...o })) }
const names = (tools) => tools.map((x) => x.name)

// ------------------------------------------------------------------------------ the todo app
function TodoItem({ state }) { return h('li', { class: { done: state.done } }, state.text) }
TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.click('li') })
TodoItem.model = {
  TOGGLE: (s) => ({ ...s, done: !s.done }),
  RENAME: (s, text) => (text === s.text ? abort('the todo already has that text') : { ...s, text }),
  REMOVE: () => undefined,
}
TodoItem.agent = {
  name: 'todo', description: 'A todo',
  label: (s) => s.text,
  actions: {
    TOGGLE: { description: 'Mark the todo done, or not done again' },
    RENAME: { description: 'Change its text', input: z.string().min(1) },
    REMOVE: { description: 'Delete the todo', consequential: true },
  },
}

const filters = { active: (t) => !t.done, done: (t) => t.done }
function TodoApp({ state }) {
  return h('main', null, h('ul', null, h(Collection, { of: TodoItem, from: 'todos', filter: filters[state.filter], sort: state.sort })))
}
TodoApp.initialState = { todos: [{ id: 1, text: 'water plants', done: false }, { id: 2, text: 'buy milk', done: true }], filter: 'all', nextId: 3, sort: undefined }
TodoApp.model = {
  ADD: (s, text) => ({ ...s, todos: [...s.todos, { id: s.nextId, text, done: false }], nextId: s.nextId + 1 }),
  // experiment 3's no-op: a wrong id matches nothing, and the reducer still returns a NEW object
  TOGGLE_BY_ID: (s, id) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }),
  SET_FILTER: (s, filter) => ({ ...s, filter }),
  SORT: (s, sort) => ({ ...s, sort }),
  CLEAR_DONE: (s) => ({ ...s, todos: s.todos.filter((t) => !t.done) }),
  BROKEN: () => { throw new Error('kaboom') },
  SAME: (s) => s,
  NOPE: () => ABORT,
}
TodoApp.agent = {
  name: 'todos', description: 'the todo list',
  read: (s) => ({ todos: s.todos.map(({ id, text, done }) => ({ id, text, done })), filter: s.filter }),
  actions: {
    ADD: { description: 'Add a todo', input: z.string().min(1).describe('the text') },
    TOGGLE_BY_ID: { description: 'Toggle a todo by id', input: jsonSchema({ type: 'integer' }) },
    SET_FILTER: { description: 'Which todos to show', input: z.enum(['all', 'active', 'done']), idempotent: true },
    SORT: { description: 'Sort by a field', input: jsonSchema({ type: 'string' }) },
    CLEAR_DONE: { description: 'Delete every done todo', consequential: true, when: (s) => s.todos.some((t) => t.done) },
    BROKEN: { description: 'throws' },
    SAME: { description: 'returns the same state' },
    NOPE: { description: 'returns ABORT' },
  },
}
const TOOLS = ['todos_read', 'todos_add', 'todos_toggle_by_id', 'todos_set_filter', 'todos_sort', 'todos_clear_done', 'todos_broken', 'todos_same', 'todos_nope', 'todo_toggle', 'todo_rename', 'todo_remove']

describe('discovery: shown instances, Switchable, HMR', () => {
  it('lists the declared actions of the live instances only; items become one keyed, labelled tool', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    const tools = t.tools()
    expect(names(tools)).toEqual(TOOLS)
    expect(tools[0]).toEqual({ name: 'todos_read', description: 'Read todos: the todo list', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } })
    expect(tools.find((x) => x.name === 'todos_add').inputSchema).toEqual({ type: 'object', properties: { value: { type: 'string', minLength: 1, description: 'the text' } }, required: ['value'], additionalProperties: false })
    expect(tools.find((x) => x.name === 'todo_rename').inputSchema).toEqual({
      type: 'object', additionalProperties: false, required: ['id', 'value'],
      properties: { id: { enum: [1, 2], description: 'Which todo (1: water plants; 2: buy milk)' }, value: { type: 'string', minLength: 1 } },
    })
    expect(tools.find((x) => x.name === 'todo_remove').annotations).toEqual({ consequentialHint: true })
    // a new item is in the enum after the flush that made it
    await t.callTool('todos_add', { value: 'call mom' })
    expect(t.tools().find((x) => x.name === 'todo_toggle').inputSchema.properties.id.enum).toEqual([1, 2, 3])
  })

  it('a hidden Switchable page has no tools (pages stay alive while hidden: filtered by iv.shown)', async () => {
    function A() { return h('p', null, 'a') }
    A.model = { HELLO: (s) => s }
    A.agent = { name: 'pageA', actions: { HELLO: { description: 'hi' } } }
    function B({ state }) { return h('p', null, String(state.n)) }
    B.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    B.agent = { name: 'pageB', read: (s) => ({ n: s.n }), actions: { INC: { description: 'add one' } } }
    function Shell({ state }) { return h('div', null, h(Switchable, { of: { a: A, b: B }, current: state.page, state: 'pages' })) }
    Shell.initialState = { page: 'a', pages: { n: 0 } }
    Shell.model = { GO: (s, page) => ({ ...s, page }) }
    Shell.agent = { name: 'shell', actions: { GO: { description: 'go to a page', input: jsonSchema({ type: 'string', enum: ['a', 'b'] }) } } }
    mount(Shell)
    await app.__runtime.flushed()
    layer = agentTools(app)
    expect(names(layer.list())).toEqual(['shell_go', 'page_a_hello'])
    expect(await layer.call('shell_go', { value: 'b' })).toMatchObject({ ok: true })
    expect(names(layer.list())).toEqual(['shell_go', 'page_b_read', 'page_b_inc'])
    expect(await layer.call('page_b_inc')).toEqual({ ok: true, state: { n: 1 } })
    expect(await layer.call('page_a_hello')).toMatchObject({ ok: false, error: expect.stringMatching(/^no tool page_a_hello; tools: shell_go/) })
  })

  it('an HMR swap (app.hmr) re-binds the layer to the successor runtime; state and tools carry over', async () => {
    mount(TodoApp)
    await app.__runtime.flushed()
    layer = agentTools(app)
    const seen = []
    layer.subscribe((c) => seen.push(c.context.todos.todos.length))
    await layer.call('todos_add', { value: 'x' })
    const before = app.__runtime
    function TodoApp2(p) { return TodoApp(p) }
    Object.assign(TodoApp2, { initialState: TodoApp.initialState, model: TodoApp.model, agent: { ...TodoApp.agent, actions: { ...TodoApp.agent.actions, ADD: { ...TodoApp.agent.actions.ADD, description: 'Add a todo (v2)' } } } })
    app.hmr(TodoApp2)
    await sleep(0)
    expect(app.__runtime).not.toBe(before)
    expect(layer.list().find((x) => x.name === 'todos_add').description).toBe('Add a todo (v2)')
    expect(await layer.call('todos_add', { value: 'y' })).toMatchObject({ ok: true })
    expect(app.__runtime.getState().todos.map((x) => x.text)).toEqual(['water plants', 'buy milk', 'x', 'y'])
    await sleep(0)
    expect(seen.at(-1)).toBe(4)
  })

  it('from / components narrow the tool set to a subtree or to some components', async () => {
    mount(TodoApp)
    await app.__runtime.flushed()
    const item = app.__runtime.root.children().find((c) => c.kind === 'item')
    layer = agentTools(app, { from: item })
    expect(names(layer.list())).toEqual(['todo_toggle', 'todo_rename', 'todo_remove'])
    expect(layer.list()[0].inputSchema.properties.id.enum).toEqual([1])
    layer.stop()
    layer = agentTools(app.__runtime, { components: [TodoApp] })
    expect(names(layer.list())).toEqual(TOOLS.slice(0, 9))
  })
})

describe('Collection items: routing, labels, sort / filter, removal', () => {
  it('routes by key to the item instance; a missing key lists the live keys with labels', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    expect(await t.callTool('todo_toggle', { id: 1 })).toMatchObject({ ok: true, state: { todos: [{ id: 1, done: true }, { id: 2, done: true }] } })
    expect(await t.callTool('todo_toggle', { id: 7 })).toEqual({ ok: false, error: 'no todo with id 7; ids: 1 (water plants), 2 (buy milk)', keys: [1, 2] })
    expect(await t.callTool('todo_toggle', {})).toMatchObject({ ok: false, error: 'todo_toggle needs id: one of 1 (water plants), 2 (buy milk)' })
    // keys compared as strings: '2' (a model sending a string) reaches item 2
    expect(await t.callTool('todo_toggle', { id: '2' })).toMatchObject({ ok: true })
    expect(t.state.todos.map((x) => x.done)).toEqual([true, false])
  })

  it('sort reorders the enum; an item a filter hides has no tool, and the error says so (D257)', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    await t.callTool('todos_sort', { value: 'text' })
    expect(t.tools().find((x) => x.name === 'todo_toggle').inputSchema.properties.id.enum).toEqual([2, 1])
    await t.callTool('todos_set_filter', { value: 'active' })
    expect(t.tools().find((x) => x.name === 'todo_toggle').inputSchema.properties.id.enum).toEqual([1])
    expect(t.agentContext().todos.todos).toHaveLength(2)
    expect(await t.callTool('todo_toggle', { id: 2 })).toEqual({ ok: false, error: 'the todo with id 2 is hidden by the current filter', keys: [1] })
    expect(await t.callTool('todo_toggle', { id: 9 })).toMatchObject({ ok: false, error: 'no todo with id 9; ids: 1 (water plants)' })
    // every item hidden: the tool is gone, and a call still explains why
    await t.callTool('todo_toggle', { id: 1 })
    expect(t.tools().map((x) => x.name)).not.toContain('todo_toggle')
    expect(await t.callTool('todo_toggle', { id: 1 })).toMatchObject({ ok: false, error: 'the todo with id 1 is hidden by the current filter' })
  })

  it('an item removing itself reports removed: true with the list as the result state', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    expect(await t.callTool('todo_remove', { id: 1 }, { confirm: true })).toEqual({ ok: true, removed: true, state: { todos: [{ id: 2, text: 'buy milk', done: true }], filter: 'all' } })
  })

  it('removed while the user confirms: the call is re-resolved and fails', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    const r = await t.callTool('todo_remove', { id: 2 }, { confirm: async () => { t.simulateAction('CLEAR_DONE'); await t.settle(); return true } })
    expect(r).toEqual({ ok: false, error: 'the todo with id 2 is gone', keys: [1] })
  })

  it('removed between dispatch and processing: the action never runs (never a false success)', async () => {
    mount(TodoApp)
    await app.__runtime.flushed()
    layer = agentTools(app, { serial: false })
    const api = app.__runtime
    let go = true
    const off = api.addHooks({ onAction: (iv, a) => { if (go && a.type === 'SAME') { go = false; api.dispatch('root', 'CLEAR_DONE') } } })
    const p1 = layer.call('todos_same')
    await Promise.resolve()
    const p2 = layer.call('todo_toggle', { id: 2 })
    const [r1, r2] = await Promise.all([p1, p2])
    off()
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    expect(r2.error).toMatch(/no todo with id 2|removed first/)
  })

  it('the key parameter is `item` when the input has its own id (D265)', async () => {
    function Card({ state }) { return h('li', null, state.title) }
    Card.model = { MOVE: (s, { id, to }) => ({ ...s, moved: `${id}->${to}` }) }
    Card.agent = { name: 'card', actions: { MOVE: { description: 'move', input: z.object({ id: z.string(), to: z.number() }) } } }
    function Board() { return h('ul', null, h(Collection, { of: Card, from: 'cards' })) }
    Board.initialState = { cards: [{ id: 'c1', title: 'one' }] }
    t = renderComponent(Board)
    await t.ready()
    const s = t.tools()[0].inputSchema
    expect(Object.keys(s.properties)).toEqual(['item', 'id', 'to'])
    expect(s.required).toEqual(['item', 'id', 'to'])
    expect(await t.callTool('card_move', { item: 'c1', id: 'x', to: '2' })).toMatchObject({ ok: true })
    expect(t.state.cards[0].moved).toBe('x->2')
  })

  it('nested Collections: one tool per item component across every Collection; a key in two lanes is SYG441 (first wins)', async () => {
    function Card({ state }) { return h('li', null, state.title) }
    Card.model = { STAR: (s) => ({ ...s, starred: !s.starred }) }
    Card.agent = { name: 'card', description: 'a card', actions: { STAR: { description: 'star it' } } }
    function Lane({ state }) { return h('section', null, h('ul', null, h(Collection, { of: Card, from: 'cards' }))) }
    Lane.model = { RENAME: (s, name) => ({ ...s, name }) }
    Lane.agent = { name: 'lane', description: 'a lane', read: (s) => ({ name: s.name, cards: s.cards.map((c) => c.id) }), actions: { RENAME: { description: 'rename', input: z.string() } } }
    function Board() { return h('main', null, h(Collection, { of: Lane, from: 'lanes' })) }
    Board.initialState = { lanes: [{ id: 'todo', name: 'To do', cards: [{ id: 'c1', title: 'one' }, { id: 'c2', title: 'two' }] }, { id: 'done', name: 'Done', cards: [{ id: 'c3', title: 'three' }, { id: 'c1', title: 'dup id' }] }] }
    t = renderComponent(Board)
    await t.ready()
    expect(names(t.tools())).toEqual(['lane_read', 'lane_rename', 'card_star'])
    expect(t.tools().find((x) => x.name === 'card_star').inputSchema.properties.id.enum).toEqual(['c1', 'c2', 'c3', 'c1'])
    expect(t.diagnostics.map((d) => d.code)).toContain('SYG441')
    expect(await t.callTool('card_star', { id: 'c3' })).toMatchObject({ ok: true, state: { name: 'Done' } })
    expect(t.state.lanes[1].cards[0].starred).toBe(true)
    expect(t.agentContext()).toEqual({ lane: [{ id: 'todo', name: 'To do', cards: ['c1', 'c2'] }, { id: 'done', name: 'Done', cards: ['c3', 'c1'] }] })
  })
})

describe('cause: agent', () => {
  it('the action runs with cause agent; t.actions (the action log, G-597) shows it', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    await t.callTool('todos_add', { value: 'z' })
    expect(t.actions.find((x) => x.type === 'ADD')).toMatchObject({ type: 'ADD', data: 'z', cause: 'agent' })
  })
})

describe('outcomes: no-op, idempotent, ABORT, abort(reason), throw, non-STATE sinks', () => {
  it('experiment 3: a wrong id with a map() reducer returns a new but deep-equal state: changed nothing', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    expect(await t.callTool('todos_toggle_by_id', { value: 99 })).toEqual({ ok: false, error: 'TOGGLE_BY_ID changed nothing (already so, or the input matched nothing)', state: expect.any(Object) })
    expect(await t.callTool('todos_toggle_by_id', { value: 1 })).toMatchObject({ ok: true })
  })
  it('idempotent: true makes "already so" a success (D256)', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    expect(await t.callTool('todos_set_filter', { value: 'all' })).toMatchObject({ ok: true, unchanged: true, state: { filter: 'all' } })
    expect(await t.callTool('todos_set_filter', { value: 'done' })).toMatchObject({ ok: true, state: { filter: 'done' } })
  })
  it('same object, ABORT, abort(reason), a throwing reducer', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    expect(await t.callTool('todos_same')).toMatchObject({ ok: false, error: /changed nothing/ })
    expect(await t.callTool('todos_nope')).toMatchObject({ ok: false, error: /^NOPE changed nothing/ })
    expect(await t.callTool('todo_rename', { id: 1, value: 'water plants' })).toMatchObject({ ok: false, error: 'RENAME was refused: the todo already has that text' })
    expect(await t.callTool('todo_rename', { id: 1, value: 'water the plants' })).toMatchObject({ ok: true })
    expect(await t.callTool('todos_broken')).toMatchObject({ ok: false, error: 'BROKEN failed: kaboom' })
    // abort() outside an agent call is plain ABORT
    expect(abort('x')).toBe(ABORT)
  })
  it('invalid input never reaches the reducer; repair coerces numeric strings', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    const r = await t.callTool('todos_add', { value: 42 })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid input for todos_add: .*string/), issues: [expect.objectContaining({ message: expect.any(String) })] })
    expect(await t.callTool('todos_set_filter', { value: 'later' })).toMatchObject({ ok: false })
    expect(t.state.todos).toHaveLength(2)
    expect(await t.callTool('todos_toggle_by_id', { value: '1' })).toMatchObject({ ok: true })
    // bare arguments for a wrapped input (lenient unwrap)
    expect(await t.callTool('todos_add', 'bare')).toMatchObject({ ok: true })
    expect(t.state.todos.at(-1).text).toBe('bare')
  })
  it('an action whose only effect is a driver sink, an EFFECT or PARENT is a success; an HTTP ABORT is a no-op', async () => {
    let pinged = 0
    function Sync({ state }) { return h('p', null, String(state.saved)) }
    Sync.initialState = { saved: 0 }
    Sync.model = {
      SAVE: { HTTP: (s) => ({ url: '/save', method: 'POST', body: s, ok: 'SAVED' }) },
      MAYBE_SAVE: { HTTP: (s) => (s.saved > 5 ? { url: '/save' } : ABORT) },
      PING: { EFFECT: () => { pinged++ } },
      TELL: { PARENT: () => 'hello' },
      SAVED: (s) => ({ ...s, saved: s.saved + 1 }),
    }
    Sync.agent = { name: 'sync', actions: { SAVE: { description: 'save' }, MAYBE_SAVE: { description: 'maybe' }, PING: { description: 'ping' }, TELL: { description: 'tell' } } }
    t = renderComponent(Sync)
    await t.ready()
    expect(await t.callTool('sync_save')).toEqual({ ok: true })
    expect(t.requests('HTTP')).toHaveLength(1)
    expect(await t.callTool('sync_maybe_save')).toMatchObject({ ok: false, error: /^MAYBE_SAVE changed nothing/ })
    expect(await t.callTool('sync_ping')).toEqual({ ok: true })
    expect(pinged).toBe(1)
    expect(await t.callTool('sync_tell')).toEqual({ ok: true })
  })
  it('constant model entries keep the core semantics (G-596): true / undefined send the data, a value is sent as is', async () => {
    function C({ state }) { return h('p', null, String(state.v)) }
    C.initialState = { v: 1 }
    C.model = { SET: { STATE: true }, KEEP: { STATE: undefined }, FIXED: { STATE: { v: 9 } }, SEND: { LOG: 'hi' } }
    C.agent = { name: 'c', read: (s) => s, actions: { SET: { description: 'set', input: z.object({ v: z.number() }) }, KEEP: { description: 'keep', input: z.object({ v: z.number() }) }, FIXED: { description: 'fixed' }, SEND: { description: 'send' } } }
    t = renderComponent(C)
    await t.ready()
    expect(await t.callTool('c_set', { v: 2 })).toEqual({ ok: true, state: { v: 2 } })
    expect(await t.callTool('c_keep', { v: 2 })).toMatchObject({ ok: false, error: /changed nothing/ })
    expect(await t.callTool('c_keep', { v: 3 })).toEqual({ ok: true, state: { v: 3 } })
    expect(await t.callTool('c_fixed')).toEqual({ ok: true, state: { v: 9 } })
    expect(await t.callTool('c_fixed')).toMatchObject({ ok: false })
    expect(await t.callTool('c_send')).toMatchObject({ ok: true })
    expect(t.sinkValues('LOG')).toContain('hi')
  })
})

describe('when() and read projections', () => {
  it('when() hides a tool until it holds; a call meanwhile says it is not available', async () => {
    t = renderComponent(TodoApp, { initialState: { ...TodoApp.initialState, todos: [{ id: 1, text: 'a', done: false }] } })
    await t.ready()
    expect(names(t.tools())).not.toContain('todos_clear_done')
    expect(await t.callTool('todos_clear_done', {}, { confirm: true })).toMatchObject({ ok: false, error: 'todos_clear_done is not available now' })
    await t.callTool('todo_toggle', { id: 1 })
    expect(names(t.tools())).toContain('todos_clear_done')
  })

  it('cost: 100 items, one item changes per flush: 1 read() and 1 when() call per flush; one publish per flush', async () => {
    let reads = 0, whens = 0
    function Row({ state }) { return h('li', null, `${state.text} ${state.n}`) }
    Row.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }
    Row.agent = { name: 'row', read: (s) => (reads++, { text: s.text, n: s.n }), actions: { BUMP: { description: 'bump', when: (s) => (whens++, s.n < 1e9) } } }
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: Array.from({ length: 100 }, (_, i) => ({ id: i, text: 'row ' + i, n: 0 })) }
    List.model = { BUMP_ONE: (s, i) => ({ ...s, rows: s.rows.map((r) => (r.id === i ? { ...r, n: r.n + 1 } : r)) }) }
    mount(List)
    await app.__runtime.flushed()
    layer = agentTools(app)
    let published = 0
    layer.subscribe(() => { published++ })
    await app.__runtime.flushed(); await sleep(0)
    expect(reads).toBe(100)
    expect(layer.list().find((x) => x.name === 'row_bump').inputSchema.properties.id.enum).toHaveLength(100)
    const w0 = whens, N = 50
    for (let k = 0; k < N; k++) {
      app.__runtime.dispatch('root', 'BUMP_ONE', k % 100)
      await app.__runtime.flushed(); await sleep(0)
      layer.list()
    }
    expect(reads).toBe(100 + N)
    expect(whens - w0).toBe(N)
    expect(published).toBe(N + 1)
  })

  it('subscribe hears the tools and the context once per flush that changed them; unsubscribe and stop', async () => {
    mount(TodoApp)
    await app.__runtime.flushed()
    layer = agentTools(app)
    const seen = []
    const off = layer.subscribe((c) => seen.push(c))
    await sleep(0)
    expect(seen).toHaveLength(1)
    expect(names(seen[0].tools)).toEqual(TOOLS)
    await layer.call('todos_add', { value: 'n' })
    await sleep(0)
    expect(seen).toHaveLength(2)
    expect(seen[1].context.todos.todos).toHaveLength(3)
    off()
    await layer.call('todos_add', { value: 'm' })
    await sleep(0)
    expect(seen).toHaveLength(2)
    layer.stop()
    expect(await layer.call('todos_add', { value: 'o' })).toEqual({ ok: false, error: 'the agent tools were stopped' })
  })
})

describe('consequential: confirm before dispatch, ordering, serial calls', () => {
  it('the action is queued only after the confirmation: a user action meanwhile runs first', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    let release, info
    const p = t.callTool('todos_clear_done', {}, { confirm: (i) => { info = i; return new Promise((r) => { release = r }) } })
    await Promise.resolve(); await Promise.resolve()
    t.simulateAction('ADD', 'meanwhile')
    await t.settle()
    release(true)
    expect(await p).toMatchObject({ ok: true })
    expect(info).toEqual({ tool: 'todos_clear_done', component: 'TodoApp', action: 'CLEAR_DONE', description: 'Delete every done todo', input: undefined })
    const order = t.actions.filter((a) => a.type === 'ADD' || a.type === 'CLEAR_DONE').map((a) => `${a.type}:${a.cause}`)
    expect(order).toEqual(['ADD:simulateAction', 'CLEAR_DONE:agent'])
  })
  it('declined; when() re-checked after the confirmation; a test must say confirm true or false (D261)', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    expect(await t.callTool('todo_remove', { id: 1 }, { confirm: false })).toEqual({ ok: false, error: 'the user declined' })
    const r = await t.callTool('todos_clear_done', {}, { confirm: async () => { t.simulateAction('TOGGLE_BY_ID', 2); await t.settle(); return true } })
    expect(r).toMatchObject({ ok: false, error: 'todos_clear_done is not available any more' })
    await expect(t.callTool('todo_remove', { id: 1 })).rejects.toThrow(/is consequential: pass \{ confirm: true \}/)
    // the item's confirm info carries the key and its label
    let info
    await t.callTool('todo_remove', { id: 1 }, { confirm: (i) => { info = i; return false } })
    expect(info).toMatchObject({ key: 1, label: 'water plants', tool: 'todo_remove' })
  })
  it('the layer default declines; parallel calls (a small model sends a batch) run serially, in call order (D260)', async () => {
    mount(TodoApp)
    await app.__runtime.flushed()
    layer = agentTools(app)
    expect(await layer.call('todo_remove', { id: 1 })).toEqual({ ok: false, error: 'the user declined' })
    const rs = await Promise.all([layer.call('todos_add', { value: 'a' }), layer.call('todos_add', { value: 'b' }), layer.call('todos_set_filter', { value: 'active' })])
    expect(rs.map((r) => r.ok)).toEqual([true, true, true])
    expect(rs[1].state.todos.map((x) => x.text)).toEqual(['water plants', 'buy milk', 'a', 'b'])
  })
})

describe('t.agentContext() and diagnostics', () => {
  it('returns the read projections by declaration name', async () => {
    t = renderComponent(TodoApp)
    await t.ready()
    expect(t.agentContext()).toEqual({ todos: { todos: [{ id: 1, text: 'water plants', done: false }, { id: 2, text: 'buy milk', done: true }], filter: 'all' } })
  })

  it('SYG240: an input with no JSON Schema form is left out of the tools; t.tools() lists it with its error', async () => {
    function C() { return h('p', null, 'c') }
    C.initialState = {}
    C.model = { A: (s, x) => ({ ...s, x }), B: (s, x) => ({ ...s, x }) }
    C.agent = { name: 'c', actions: { A: { description: 'a', input: { type: 'string' } }, B: { description: 'b', input: z.string() } } }
    t = renderComponent(C)
    await t.ready()
    expect(t.tools()).toEqual([
      { name: 'c_a', description: 'a', inputSchema: { type: 'object', properties: {} }, annotations: {}, error: 'SYG240 a plain JSON Schema: wrap it with jsonSchema()' },
      expect.objectContaining({ name: 'c_b' }),
    ])
    expect(await t.callTool('c_a', 'x')).toEqual({ ok: false, error: 'SYG240 a plain JSON Schema: wrap it with jsonSchema()' })
    expect(t.diagnostics.filter((d) => d.code === 'SYG240')).toHaveLength(1)
    expect(t.diagnostics[0]).toMatchObject({ code: 'SYG240', severity: 'error', component: 'C' })
    mount(C)
    await app.__runtime.flushed()
    layer = agentTools(app)
    expect(names(layer.list())).toEqual(['c_b'])
  })

  it('SYG241 (read / when threw), SYG243 (lossy input), SYG440 (two declarations, one name)', async () => {
    function Bad({ state }) { return h('p', null, String(state.n)) }
    Bad.model = { A: (s) => s, B: (s, v) => s }
    const decl = { name: 'same', read: () => { throw new Error('nope') }, actions: { A: { description: 'a', when: () => { throw new Error('w') } }, B: { description: 'b', input: z.string().refine((s) => s.length > 1) } } }
    Bad.agent = decl
    function Other() { return h('p', null, 'o') }
    Other.agent = { name: 'same', actions: {} }
    function Root() { return h('div', null, h(Bad, { state: 'bad' }), h(Other)) }
    Root.initialState = { bad: { n: 0 } }
    t = renderComponent(Root)
    await t.ready()
    expect(names(t.tools())).toEqual(['same_read', 'same_b'])
    expect(t.agentContext()).toEqual({ same: undefined })
    const codes = t.diagnostics.map((d) => d.code)
    expect(codes.filter((c) => c === 'SYG241')).toHaveLength(2)
    expect(codes).toContain('SYG440')
    // Zod drops refinements silently (no warning possible); Valibot / ArkType report them: see the schema tests
    expect(codes).not.toContain('SYG243')
  })

  it('SYG243 for a lossy Valibot / ArkType input; SYG441 for Collection items without ids', async () => {
    const { type } = await import('arktype')
    function Row({ state }) { return h('li', null, state.t) }
    Row.model = { SET: (s, t) => ({ ...s, t }) }
    Row.agent = { name: 'row', actions: { SET: { description: 'set', input: type('string').narrow((s) => s.length > 1) } } }
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ t: 'a' }, { t: 'b' }] }
    t = renderComponent(List)
    await t.ready()
    expect(t.tools()[0].inputSchema.properties.id.enum).toEqual([0, 1])
    const codes = t.diagnostics.map((d) => d.code)
    expect(codes).toContain('SYG243')
    expect(codes).toContain('SYG441')
  })
})
