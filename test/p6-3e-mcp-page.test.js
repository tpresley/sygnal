// @vitest-environment jsdom
// PLAN-6 E-1: the page side of the dev MCP endpoint (installMcpBridge from 'sygnal/devtools'),
// driven through a fake HMR channel as the dev server would: hello, request, response. Runs
// against the built package (npm run build), one core shared with sygnal/diagnostics.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import * as core from '../dist/index.esm.js'

const { h, run, agentTools, jsonSchema } = core
const until = (fn) => vi.waitFor(fn, { timeout: 5000, interval: 5 })

function Item({ state }) { return h('li', state.text) }
Item.model = { RENAME: (s, text) => ({ ...s, text }) }

function App({ state }) {
  return h('main', [h('button.inc', '+'), h('span.count', String(state.count)), h('ul', state.todos.map((t) => h('li', { key: t.id }, t.text)))])
}
App.initialState = { count: 0, todos: [{ id: 1, text: 'water plants' }], nextId: 2, deep: { a: [{ b: 'x' }] } }
App.intent = ({ DOM }) => ({ INC: DOM.click('.inc'), RESET: DOM.click('.reset') })
App.model = {
  INC: (s) => ({ ...s, count: s.count + 1 }),
  RESET: (s) => ({ ...s, count: 0 }),
  ADD: (s, text) => ({ ...s, todos: [...s.todos, { id: s.nextId, text }], nextId: s.nextId + 1 }),
  CLEAR: (s) => ({ ...s, todos: [] }),
}
App.agent = {
  name: 'todos', description: 'the todo list',
  read: (s) => ({ count: s.count, todos: s.todos }),
  actions: {
    ADD: { description: 'Add a todo', input: jsonSchema({ type: 'string', minLength: 1 }) },
    CLEAR: { description: 'Delete every todo', consequential: true },
  },
}

let dev, hot, app, nextId = 1
beforeAll(async () => {
  await import('../dist/diagnostics.esm.js')
  dev = await import('../dist/devtools.esm.js')
  // one fake HMR channel for the page (installMcpBridge installs once per channel)
  hot = {
    handlers: {}, sent: [],
    on(e, f) { (this.handlers[e] ||= []).push(f) },
    send(e, d) { this.sent.push([e, d]) },
  }
  document.title = 'Fixture'
  // consequential agent tools are declined (jsdom has no confirm dialog)
  dev.installMcpBridge(hot, { agentTools, confirm: false })
  dev.installMcpBridge(hot, { agentTools }) // once per channel: ignored
})
afterEach(() => { app?.dispose(); app = undefined })

function mount() {
  dev.clearActions()
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
  return app
}
async function ask(tool, args = {}) {
  const id = nextId++
  for (const f of hot.handlers['sygnal:mcp:request']) f({ id, tool, args })
  let reply
  await until(() => { reply = hot.sent.find(([e, d]) => e === 'sygnal:mcp:response' && d.id === id && !d.waiting); expect(reply).toBeTruthy() })
  const d = reply[1]
  if (!d.ok) throw new Error(d.error)
  return d.result
}

describe('installMcpBridge', () => {
  it('says hello with the page url and title, once per channel; again on focus', () => {
    const hellos = () => hot.sent.filter(([e]) => e === 'sygnal:mcp:hello')
    expect(hellos()).toHaveLength(1)
    expect(hellos()[0][1]).toMatchObject({ url: expect.stringContaining('http'), title: 'Fixture' })
    window.dispatchEvent(new Event('focus'))
    expect(hellos()).toHaveLength(2)
  })

  it('get_state: the root, a path, a component by name or id; unknown components list the names', async () => {
    mount()
    await until(() => expect(document.querySelector('.count')).toBeTruthy())
    const root = await ask('get_state')
    expect(root).toMatchObject({ component: 'App', state: { count: 0, todos: [{ id: 1, text: 'water plants' }] } })
    expect(await ask('get_state', { path: 'deep.a.0.b' })).toMatchObject({ path: 'deep.a.0.b', state: 'x' })
    expect(await ask('get_state', { path: ['todos', 0, 'text'] })).toMatchObject({ state: 'water plants' })
    expect((await ask('get_state', { component: 'App' })).id).toBe(root.id)
    expect((await ask('get_state', { component: root.id })).component).toBe('App')
    await expect(ask('get_state', { component: 'Nope' })).rejects.toThrow(/no component "Nope".*components: App/)
    await expect(ask('get_state', { path: 'count.x.y' })).rejects.toThrow(/state has no count.x.y/)
  })

  it("dispatch: runs the action with cause 'agent', waits for the render, returns the state; unknown actions are listed", async () => {
    mount()
    await until(() => expect(document.querySelector('.count')).toBeTruthy())
    const r = await ask('dispatch', { action: 'INC' })
    expect(r).toMatchObject({ ok: true, component: 'App', action: 'INC', changed: true, state: { count: 1 } })
    expect(document.querySelector('.count').textContent).toBe('1')
    await ask('dispatch', { component: 'App', action: 'ADD', data: 'buy milk' })
    expect((await ask('get_state', { path: 'todos.1.text' })).state).toBe('buy milk')
    await expect(ask('dispatch', { action: 'NOPE' })).rejects.toThrow(/App has no action NOPE; its actions: INC, RESET, ADD, CLEAR/)
    await expect(ask('dispatch', {})).rejects.toThrow(/needs action/)
    const log = await ask('recent_actions', { limit: 5, cause: 'agent' })
    expect(log.actions.map((a) => [a.type, a.cause])).toEqual([['INC', 'agent'], ['ADD', 'agent']])
    expect(log.actions[0]).toMatchObject({ component: 'App', before: { count: 0 }, after: { count: 1 } })
    const filtered = await ask('recent_actions', { type: 'ADD' })
    expect(filtered.actions.map((a) => a.data)).toEqual(['buy milk'])
  })

  it('component_tree (inspect) and get_diagnostics (codes with docs URLs)', async () => {
    mount()
    await until(() => expect(document.querySelector('.count')).toBeTruthy())
    const tree = await ask('component_tree')
    expect(tree.components.map((c) => c.name)).toContain('App')
    await until(async () => {
      // SYG102 (info): ADD and CLEAR have no intent action (only the agent sends them)
      const d = await ask('get_diagnostics', { code: 'syg102' })
      expect(d.diagnostics[0]).toMatchObject({ code: 'SYG102', severity: 'info', component: 'App', docsUrl: 'https://sygnal.js.org/reference/errors#syg102', fix: expect.any(String) })
      expect(d.summary.info).toBeGreaterThan(0)
    })
  })

  it('agent_tools: lists the live tools and context; calls one under A-1\'s rules', async () => {
    mount()
    await until(() => expect(document.querySelector('.count')).toBeTruthy())
    const list = await ask('agent_tools')
    expect(list.tools.map((t) => t.name)).toEqual(['todos_read', 'todos_add', 'todos_clear'])
    expect(list.context.todos).toMatchObject({ count: 0 })
    expect(await ask('agent_tools', { call: 'todos_add', input: { value: 'call mom' } })).toMatchObject({ ok: true })
    expect((await ask('get_state', { path: 'todos.1.text' })).state).toBe('call mom')
    expect(await ask('agent_tools', { call: 'todos_add', input: { value: '' } })).toMatchObject({ ok: false, error: expect.stringMatching(/invalid input/) })
    // consequential, with confirm: false: declined
    expect(await ask('agent_tools', { call: 'todos_clear' })).toEqual({ ok: false, error: 'the user declined' })
    const log = await ask('recent_actions', { cause: 'agent' })
    expect(log.actions.map((a) => a.type)).toEqual(['ADD'])
  })

  it('copy_as_test: a renderComponent test of the session', async () => {
    mount()
    await until(() => expect(document.querySelector('.count')).toBeTruthy())
    await ask('dispatch', { action: 'INC' })
    const t = await ask('copy_as_test', { componentImport: './App.jsx' })
    expect(t.code).toContain("import App from './App.jsx'")
    expect((await ask('copy_as_test', { componentImport: "import { App } from './app'" })).code).toContain("import { App } from './app'")
    expect(t.code).toContain("simulateAction('INC'")
    expect(t.replayed).toBeGreaterThan(0)
  })

  it('no app on the page: a clear error; unknown page tools too', async () => {
    document.body.innerHTML = ''
    await expect(ask('get_state')).rejects.toThrow(/no Sygnal app is running/)
    await expect(ask('rm_rf')).rejects.toThrow(/unknown page tool/)
  })
})
