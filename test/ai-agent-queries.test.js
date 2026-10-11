// @vitest-environment jsdom
// agent.queries (sygnal/ai, src/extra/ai/agent/index.ts): read-only tools that take an input.
// run(state, input) is a pure, synchronous function of the instance's state: a call validates the
// input (as for actions), checks `when`, and returns { ok: true, result } without dispatching.
// SYG240 / SYG241 / SYG246 / SYG247, Collection items, the chat behavior, WebMCP's result budget.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { z } from 'zod'
import run from '../src/extra/run.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { agentTools, experimentalExposeWebMcp, getDiagnostics, clearDiagnostics } from '../src/index.js'
import { chat } from '../src/extra/ai/chat/behavior.ts'
import { messageText } from '../src/extra/ai/messages.ts'

let t, app, stop
afterEach(() => {
  try { stop?.() } catch (_) {}
  try { t?.dispose() } catch (_) {}
  try { app?.dispose() } catch (_) {}
  t = app = stop = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const INVOICES = [
  { id: 1, customer: 'Acme', total: 120, overdue: true },
  { id: 2, customer: 'Acme', total: 80, overdue: false },
  { id: 3, customer: 'Globex', total: 300, overdue: true },
]
const Filter = z.object({ customer: z.string().optional().describe('The customer name'), overdue: z.boolean().optional() })
const matches = ({ customer, overdue }) => (i) => (customer === undefined || i.customer === customer) && (overdue === undefined || i.overdue === overdue)

function Invoices({ state }) { return h('p', null, `${state.invoices.length} invoices`) }
Invoices.initialState = { invoices: INVOICES }
Invoices.model = { PAY: (s, id) => ({ ...s, invoices: s.invoices.map((i) => (i.id === id ? { ...i, overdue: false } : i)) }) }
Invoices.agent = {
  name: 'invoices',
  description: 'The invoices',
  read: (state) => ({ count: state.invoices.length }),
  actions: { PAY: { description: 'Mark an invoice paid', input: z.number().int() } },
  queries: {
    find: { description: 'Invoices matching a filter', input: Filter, run: (state, input) => state.invoices.filter(matches(input)) },
    total: { description: 'The sum of all invoices', run: (state) => state.invoices.reduce((n, i) => n + i.total, 0) },
    overdue: { description: 'The overdue invoices', when: (state) => state.invoices.some((i) => i.overdue), run: (state) => state.invoices.filter((i) => i.overdue) },
  },
}

describe('agent.queries', () => {
  it('are read-only tools after the actions, with the input schema; a call returns { ok, result }', async () => {
    t = renderComponent(Invoices, { strict: true })
    await t.ready()
    expect(t.tools().map((x) => x.name)).toEqual(['invoices_read', 'invoices_pay', 'invoices_find', 'invoices_total', 'invoices_overdue'])
    const find = t.tools().find((x) => x.name === 'invoices_find')
    expect(find).toMatchObject({ description: 'Invoices matching a filter', annotations: { readOnlyHint: true } })
    expect(find.inputSchema.properties.customer).toMatchObject({ type: 'string', description: 'The customer name' })
    expect(t.tools().find((x) => x.name === 'invoices_total').inputSchema).toEqual({ type: 'object', properties: {} })
    expect(await t.callTool('invoices_find', { customer: 'Acme', overdue: true })).toEqual({ ok: true, result: [INVOICES[0]] })
    expect(await t.callTool('invoices_total')).toEqual({ ok: true, result: 500 })
    // repair coerces 'true', as for actions (D264)
    expect((await t.callTool('invoices_find', { overdue: 'true' })).result.map((i) => i.id)).toEqual([1, 3])
    t.expectNoDiagnostics()
  })

  it('dispatch nothing: the state and the rendered view stay as they were', async () => {
    t = renderComponent(Invoices)
    await t.ready()
    const state = t.state, html = t.html()
    await t.callTool('invoices_find', { customer: 'Globex' })
    await t.settle()
    expect(t.state).toBe(state)
    expect(t.html()).toBe(html)
  })

  it('see the state of now, and `when` follows it', async () => {
    t = renderComponent(Invoices)
    await t.ready()
    expect(await t.callTool('invoices_overdue')).toEqual({ ok: true, result: [INVOICES[0], INVOICES[2]] })
    await t.callTool('invoices_pay', { value: 1 })
    await t.callTool('invoices_pay', { value: 3 })
    expect((await t.callTool('invoices_find', { overdue: true })).result).toEqual([])
    expect(t.tools().map((x) => x.name)).not.toContain('invoices_overdue')
    expect(await t.callTool('invoices_overdue')).toMatchObject({ ok: false, error: 'invoices_overdue is not available now' })
  })

  it('invalid input returns the issues; a throw is SYG241, a promise SYG246: { ok: false, error }', async () => {
    function C({ state }) { return h('p', null, String(state.n)) }
    C.initialState = { n: 1 }
    C.agent = {
      name: 'c',
      queries: {
        find: { description: 'Find', input: Filter, run: () => [] },
        broken: { description: 'Throws', run: () => { throw new Error('nope') } },
        slow: { description: 'Async', run: async (s) => s.n },
      },
    }
    t = renderComponent(C)
    await t.ready()
    const bad = await t.callTool('c_find', { customer: 42 })
    expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid input for c_find: customer: /), issues: [expect.objectContaining({ path: ['customer'] })] })
    expect(await t.callTool('c_broken')).toEqual({ ok: false, error: 'c_broken failed: nope' })
    expect(await t.callTool('c_slow')).toEqual({ ok: false, error: 'c_slow is not available: it returned a promise' })
    expect(t.diagnostics.map((d) => [d.code, d.severity])).toEqual([['SYG241', 'error'], ['SYG246', 'error']])
    expect(t.diagnostics[1].message).toContain('agent.queries.slow.run returned a promise')
  })

  it('SYG246: a query without run is not offered; SYG247: a query with an action\'s tool name is not offered', async () => {
    function C({ state }) { return h('p', null, String(state.n)) }
    C.initialState = { n: 1 }
    C.model = { FIND: (s) => ({ ...s, n: s.n + 1 }) }
    C.agent = {
      name: 'c',
      actions: { FIND: { description: 'The action' } },
      queries: { find: { description: 'Shadowed', run: () => 1 }, none: { description: 'No run' } },
    }
    t = renderComponent(C)
    await t.ready()
    expect(t.tools({ all: true }).map((x) => [x.name, x.description])).toEqual([['c_find', 'The action']])
    expect(await t.callTool('c_find')).toMatchObject({ ok: true })
    expect(t.state.n).toBe(2)
    expect(t.diagnostics.map((d) => [d.code, d.severity])).toEqual([['SYG247', 'warn'], ['SYG246', 'error']])
  })

  it('SYG240: an input with no JSON Schema form leaves the query out, like an action', async () => {
    function C() { return h('p', null, 'c') }
    C.initialState = {}
    C.agent = { name: 'c', queries: { q: { description: 'q', input: { type: 'string' }, run: () => 1 } } }
    t = renderComponent(C)
    await t.ready()
    expect(t.tools()).toEqual([expect.objectContaining({ name: 'c_q', error: 'SYG240 a plain JSON Schema: wrap it with jsonSchema()' })])
    expect(await t.callTool('c_q', 'x')).toEqual({ ok: false, error: 'SYG240 a plain JSON Schema: wrap it with jsonSchema()' })
    expect(t.diagnostics[0]).toMatchObject({ code: 'SYG240', message: expect.stringContaining('agent.queries.q.input') })
  })

  it('a declaration with queries only; untrusted adds untrustedContentHint', async () => {
    function Notes({ state }) { return h('p', null, String(state.notes.length)) }
    Notes.initialState = { notes: ['call Ada', 'buy tea'] }
    Notes.agent = { name: 'notes', untrusted: true, queries: { search: { description: 'Notes containing a word', input: z.string(), run: (s, word) => s.notes.filter((n) => n.includes(word)) } } }
    t = renderComponent(Notes)
    await t.ready()
    expect(t.tools()).toEqual([expect.objectContaining({ name: 'notes_search', annotations: { readOnlyHint: true, untrustedContentHint: true } })])
    // a non-object input is wrapped as { value }, as for actions
    expect(await t.callTool('notes_search', { value: 'tea' })).toEqual({ ok: true, result: ['buy tea'] })
  })

  it('on Collection items: the key parameter and the hidden-key error, as for actions', async () => {
    function Row({ state }) { return h('li', null, state.name) }
    Row.agent = {
      name: 'contact', label: (s) => s.name,
      queries: { notes: { description: 'This contact\'s notes containing a word', input: z.object({ word: z.string() }), run: (s, { word }) => s.notes.filter((n) => n.includes(word)) } },
    }
    function List({ state }) { return h('ul', null, h(Collection, { of: Row, from: 'contacts', filter: (c) => c.name !== state.hide })) }
    List.initialState = { hide: 'Cy', contacts: [{ id: 'a', name: 'Ada', notes: ['likes tea', 'met in May'] }, { id: 'b', name: 'Bo', notes: ['tea allergy'] }, { id: 'c', name: 'Cy', notes: [] }] }
    t = renderComponent(List)
    await t.ready()
    const tool = t.tools().find((x) => x.name === 'contact_notes')
    expect(tool.inputSchema.properties.id.enum).toEqual(['a', 'b'])
    expect(tool.inputSchema.required).toEqual(['id', 'word'])
    expect(await t.callTool('contact_notes', { id: 'b', word: 'tea' })).toEqual({ ok: true, result: ['tea allergy'] })
    expect(await t.callTool('contact_notes', { id: 'c', word: 'x' })).toMatchObject({ ok: false })
    expect(await t.callTool('contact_notes', { word: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('needs id') })
  })

  it('agentTools() on a run() app: the same tools and results', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    app = run(Invoices, {}, { mountPoint: '#root', diagnostics: 'off' })
    await app.__runtime.flushed()
    const layer = agentTools(app)
    expect(layer.list().filter((x) => x.annotations.readOnlyHint).map((x) => x.name)).toEqual(['invoices_read', 'invoices_find', 'invoices_total', 'invoices_overdue'])
    expect(await layer.call('invoices_find', { customer: 'Globex' })).toEqual({ ok: true, result: [INVOICES[2]] })
    layer.stop()
  })
})

describe('through the chat behavior', () => {
  function App({ state }) {
    const c = state.assistant
    return h('main', null, Invoices({ state }),
      h('ol', null, ...c.messages.map((m) => h('li', null, messageText(m)))),
      h('form', { className: 'ask' }, h('input', { className: 'prompt', value: c.prompt })))
  }
  App.initialState = Invoices.initialState
  App.model = Invoices.model
  App.agent = Invoices.agent
  App.uses = { assistant: chat({ form: '.ask', prompt: '.prompt' }) }

  it('the model calls a query; its result is the tool output of the next request', async () => {
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.prompt', 'input', { value: 'What does Acme owe?' })
    t.simulateEvent('.ask', 'submit')
    await t.settle()
    expect(Object.keys(t.requests('LLM')[0].tools)).toEqual(['invoices_read', 'invoices_pay', 'invoices_find', 'invoices_total', 'invoices_overdue'])
    await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'invoices_find', input: { customer: 'Acme', overdue: true } } }])
    await t.settle()
    const part = t.requests('LLM').at(-1).messages.at(-1).parts.find((p) => p.type === 'tool-invoices_find')
    expect(part).toMatchObject({ state: 'output-available', output: { ok: true, result: [INVOICES[0]] } })
    await t.respond('LLM', 'Acme owes 120.')
    expect(messageText(t.state.assistant.messages.at(-1))).toBe('Acme owes 120.')
  })
})

describe('WebMCP', () => {
  function fakeModelContext() {
    const tools = new Map()
    return {
      registerTool(tool, { signal } = {}) { tools.set(tool.name, tool); signal?.addEventListener('abort', () => tools.delete(tool.name)); return Promise.resolve() },
      tool: (n) => tools.get(n),
      call: (n, input = {}) => tools.get(n).execute(input, {}),
    }
  }

  it('a query is registered read-only; a result over the budget is cut like a state (SYG242)', async () => {
    function Big() { return h('p', null, 'big') }
    Big.initialState = { rows: Array.from({ length: 200 }, (_, i) => ({ n: i, text: 'lorem ipsum dolor ' + i })) }
    Big.agent = { name: 'big', untrusted: false, queries: { rows: { description: 'All rows', run: (s) => s.rows }, first: { description: 'The first row', run: (s) => s.rows[0] } } }
    document.body.innerHTML = '<div id="root"></div>'
    app = run(Big, {}, { mountPoint: '#root', diagnostics: 'warn' })
    await app.__runtime.flushed()
    clearDiagnostics()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mc = fakeModelContext()
    stop = experimentalExposeWebMcp(app, { modelContext: mc })
    await new Promise((r) => setTimeout(r, 0))
    expect(mc.tool('big_rows').annotations).toEqual({ readOnlyHint: true })
    expect(await mc.call('big_first')).toEqual({ ok: true, result: { n: 0, text: 'lorem ipsum dolor 0' } })
    const r = await mc.call('big_rows')
    expect(r).toMatchObject({ ok: true, truncated: true })
    expect(typeof r.result).toBe('string')
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(1500)
    const d = getDiagnostics().filter((x) => x.code === 'SYG242')
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain("its result is cut (make the query's result smaller)")
  })
})
