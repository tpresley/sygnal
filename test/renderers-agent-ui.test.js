// sygnal/agent-ui: examples/todomvc, unchanged, operated by tool calls on its accessibility
// snapshot; the MCP server (both protocol eras) over a stream pair; sygnal/ai agentTools served
// alongside the UI tools.
import { describe, it, expect, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { z } from 'zod'
import { createElement as h, controls } from 'sygnal'
import { agentTools } from 'sygnal/ai'
import { runAgentUI, createMcpHandler, serveMcp } from 'sygnal/agent-ui'
import { APP } from './copied/todomvc-app.js'
import { memoryStore, memoryRouter, todoStyles } from './renderers-terminal.test.js'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const apps = []
afterEach(() => apps.splice(0).forEach((a) => a.dispose()))

function todomvc(todos) {
  const router = memoryRouter()
  const store = memoryStore(todos ? { todos } : {})
  const r = runAgentUI(APP, { styles: todoStyles, onNavigate: (href) => router.go(href), drivers: { STORE: store.driver, ROUTER: router.driver } })
  apps.push(r.app)
  return { ...r, store }
}
const refOf = (snapshot, line) => {
  const m = snapshot.split('\n').find((l) => l.includes(line))?.match(/\[ref=(e\d+)\]/)
  if (!m) throw new Error(`no ref on a line with ${line}:\n${snapshot}`)
  return m[1]
}

describe('todomvc, unchanged, for an agent', () => {
  it('the snapshot: roles, names, states, refs, and the events the intents listen for', async () => {
    const { ui } = todomvc([{ id: 1, title: 'Write the spike', completed: false }, { id: 2, title: 'Measure the core', completed: true }])
    await ui.settle()
    const s = ui.snapshot().replace(/ref=e\d+/g, 'ref=…')
    expect(s).toBe([
      '- heading "todos" [level=1]',
      '- textbox "What needs to be done?" [ref=…]',
      '- checkbox "Mark all as complete" [ref=…]',
      '- list:',
      '  - listitem:',
      '    - checkbox "Toggle" [ref=…]',
      '    - generic "Write the spike" [ref=…] [on=dblclick]',
      '    - button "Delete" [ref=…]',
      '  - listitem:',
      '    - checkbox "Toggle" [checked] [ref=…]',
      '    - generic "Measure the core ✓" [ref=…] [on=dblclick]',
      '    - button "Delete" [ref=…]',
      '- text: 1 item left',
      '- list:',
      '  - listitem:',
      '    - link "*All*" [ref=…]',
      '  - listitem:',
      '    - link "Active" [ref=…]',
      '  - listitem:',
      '    - link "Completed" [ref=…]',
      '- button "Clear completed" [ref=…]',
    ].join('\n').replace('"Measure the core ✓"', '"Measure the core"').replace('"*All*"', '"All"'))
  })

  it('add (type + submit), toggle, edit (double click), filter (link), each call answering with the new snapshot', async () => {
    const { ui, store } = todomvc()
    await ui.settle()
    let r = await ui.call('ui_type', { ref: refOf(ui.snapshot(), 'textbox "What needs'), text: 'Ship it', submit: true })
    expect(r.ok).toBe(true)
    expect(r.snapshot).toContain('generic "Ship it"')
    expect(store.data.get('todos')).toEqual([{ id: 1, title: 'Ship it', completed: false }])

    r = await ui.call('ui_check', { ref: refOf(r.snapshot, 'checkbox "Toggle"'), checked: true })
    expect(r.snapshot).toContain('checkbox "Toggle" [checked]')

    r = await ui.call('ui_click', { ref: refOf(r.snapshot, 'generic "Ship it"'), double: true })
    // editing: the edit field is shown and focused (autoFocus), with the title
    expect(r.snapshot).toMatch(/textbox "Edit" \[focused\] \[ref=e\d+\]: "Ship it"/)
    r = await ui.call('ui_type', { ref: refOf(r.snapshot, 'textbox "Edit"'), text: 'Ship it today', submit: true })
    expect(r.snapshot).toContain('generic "Ship it today"')

    r = await ui.call('ui_click', { ref: refOf(r.snapshot, 'link "Active"') })
    await tick(350) // the completed item's leave transition
    r = await ui.call('ui_snapshot')
    expect(r.snapshot).not.toContain('Ship it today')
    expect(r.snapshot).toContain('- text: 0 items left')
  })

  it('errors name the fix and come with the snapshot', async () => {
    const { ui } = todomvc([{ id: 1, title: 'a', completed: false }])
    await ui.settle()
    expect(await ui.call('ui_click', { ref: 'e999999' })).toMatchObject({ ok: false, error: expect.stringMatching(/take a new ui_snapshot/), snapshot: expect.stringContaining('textbox') })
    const heading = ui.doc.querySelector('h1')
    expect(await ui.call('ui_click', { ref: 'e' + (await import('sygnal/host')).nodeId(heading) })).toMatchObject({ ok: false, error: expect.stringMatching(/not interactive/) })
    expect(await ui.call('ui_type', { ref: refOf(ui.snapshot(), 'checkbox'), text: 'x' })).toMatchObject({ ok: false })
  })

  it('chatTools: the same tools in the chat driver\'s format', () => {
    const { ui } = todomvc()
    expect(Object.keys(ui.chatTools())).toEqual(['ui_snapshot', 'ui_click', 'ui_type', 'ui_press', 'ui_select', 'ui_check'])
    expect(ui.chatTools().ui_click.inputSchema.required).toEqual(['ref'])
  })
})

describe('MCP', () => {
  const spec = (calls = []) => ({
    name: 'app', version: '1.0.0', instructions: 'hi',
    tools: () => [{ name: 'ui_snapshot', description: 'd', inputSchema: { type: 'object' } }],
    call: async (name, args) => (calls.push([name, args]), { text: 'screen', value: { ok: true } }),
  })

  it('initialize era: initialize, tools/list, tools/call; notifications get nothing', async () => {
    const { handle } = createMcpHandler(spec())
    expect(await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).toMatchObject({ result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'app' }, instructions: 'hi' } })
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(null)
    expect((await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.map((t) => t.name)).toEqual(['ui_snapshot'])
    expect(await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ui_snapshot', arguments: {} } })).toMatchObject({ result: { content: [{ type: 'text', text: 'screen' }], structuredContent: { ok: true }, isError: false } })
    expect(await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })).toMatchObject({ error: { code: -32602 } })
  })

  it('2026-07-28: stateless requests with _meta, server/discover, no initialize', async () => {
    const { handle } = createMcpHandler(spec())
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} }
    expect(await handle({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: meta } })).toMatchObject({ result: { resultType: 'complete', supportedVersions: expect.arrayContaining(['2026-07-28']), _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'app' } } } })
    expect(await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { _meta: meta } })).toMatchObject({ error: { code: -32601 } })
    expect(await handle({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } } })).toMatchObject({ error: { code: -32022 } })
  })

  it('serveMcp: the UI tools plus sygnal/ai agentTools over a stream pair', async () => {
    // a component with an `agent` declaration: its semantic tools sit next to the UI tools
    const { Add } = controls({ Add: 'button' })
    function Notes({ state }) { return h('div', null, h('ul', null, ...state.notes.map((n) => h('li', null, n))), h(Add, null, 'Add note')) }
    Notes.initialState = { notes: [] }
    Notes.intent = ({ DOM }) => ({ ADD: DOM.click(Add).mapTo('from the UI') })
    Notes.model = { ADD: (s, text) => ({ notes: [...s.notes, text] }) }
    Notes.agent = { name: 'notes', read: (s) => ({ notes: s.notes }), actions: { ADD: { description: 'Add a note', input: z.string() } } }
    const { app, ui } = runAgentUI(Notes)
    apps.push(app)
    const input = new PassThrough(), output = new PassThrough()
    const lines = []
    output.on('data', (c) => lines.push(...String(c).trim().split('\n').map((l) => JSON.parse(l))))
    const server = serveMcp(ui, { name: 'notes', tools: agentTools(app), input, output })
    const send = (m) => input.write(JSON.stringify(m) + '\n')
    send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'notes_add', arguments: { value: 'from the agent' } } })
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ui_snapshot', arguments: {} } })
    for (let i = 0; i < 50 && lines.length < 3; i++) await tick(10)
    const names = lines.find((l) => l.id === 1).result.tools.map((t) => t.name)
    expect(names.slice(0, 6)).toEqual(['ui_snapshot', 'ui_click', 'ui_type', 'ui_press', 'ui_select', 'ui_check'])
    expect(names).toContain('notes_add')
    expect(lines.find((l) => l.id === 2).result).toMatchObject({ isError: false })
    expect(lines.find((l) => l.id === 3).result.content[0].text).toBe('- list:\n  - listitem:\n    - text: from the agent\n- button "Add note" [ref=' + /ref=(e\d+)/.exec(ui.snapshot())[1] + ']')
    server.stop()
  })
})
