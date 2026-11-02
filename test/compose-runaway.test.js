// @vitest-environment jsdom
// Runaway compose.llm() replies (examples/ai-adaptive FINDINGS.md, "Found while verifying the fixes"):
// an edit the operations can't express made qwen3:8b repeat `add dates top, add amount top, …`
// without end, and the page sat in 'preview' for minutes. The guards: `maxItems` on every list in
// the schemas (an edit's ops: opsCap), a streamed reply stopped where it repeats itself or passes
// the cap (the behavior aborts the request and finishes with what came before), a reply cut at the
// output-token limit read as the prefix it is, `timeoutMs` on the request (the chat driver fails
// the step: status 'error'), and `maxTokens` on the HTTP transports.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { compose, defineCatalog } from '../src/extra/ai/index.ts'
import { llm, opsSchema, layoutSchema, opsCap, preorder } from '../src/extra/ai/compose/llm.ts'
import { decisions } from '../src/extra/ai/compose/decisions.ts'
import { finish, fromTree } from '../src/extra/ai/compose/layout.ts'
import { makeChatDriver } from '../src/extra/ai/chat/driver.ts'
import { chatCompletions } from '../src/extra/ai/transports/chatCompletions.ts'
import { openResponses } from '../src/extra/ai/transports/openResponses.ts'
import { configureDiagnostics, getDiagnostics, _resetDiagnostics } from '../src/extra/diagnostics/index.ts'
import { dataSSE, fixtureFetch, collect } from './helpers/p6-sse-fixture.js'
import { makeApp, catalog as appCatalog } from './p9-compose-app.js'
import { shape } from './p9-compose-fakes.js'
import { names } from './p9-llm-helpers.js'

let t
beforeEach(() => { _resetDiagnostics(); configureDiagnostics({ mode: 'collect' }) })
afterEach(() => { t?.dispose(); t = null; _resetDiagnostics() })
const codes = () => getDiagnostics().map((d) => d.code)

const anywhere = ['page', 'section']
const form = defineCatalog({
  parts: {
    dates: { render: () => null, description: 'Dates', in: anywhere },
    amount: { render: () => null, description: 'Amount', in: anywhere },
    approver: { render: () => null, description: 'Approver', in: anywhere },
    contact: { render: () => null, description: 'Contact', in: anywhere },
  },
  containers: { section: { description: 'Section', maxUses: 3, params: { title: { type: 'text', required: true, maxLength: 40 } } } },
  rows: false,
  limits: { maxParts: 10, maxDepth: 2 },
})
const page = (cat, tree) => finish(cat, fromTree(cat, tree), {})
const PREV = page(form, [{ part: 'contact' }, { part: 'dates' }, { part: 'amount' }, { part: 'approver' }])
// the loop qwen3:8b wrote for "Put the dates and amount in a Trip section, and the approver and contact in an Approval section"
const LOOP = [{ op: 'add', part: 'dates', where: 'top' }, { op: 'add', part: 'amount', where: 'top' }, { op: 'add', part: 'approver', where: 'top' }, { op: 'add', part: 'contact', where: 'top' }]
const loopText = (n) => JSON.stringify({ ops: Array.from({ length: n }, (_, i) => LOOP[i % 4]) })

describe('every list in the schemas has a maxItems', () => {
  it("an edit's ops: one per node on the page plus maxParts (at least 8)", () => {
    const s = opsSchema(form, {}, PREV)
    expect(s.properties.ops.maxItems).toBe(4 + 10)
    expect(opsCap({ maxParts: 2 }, ['page', 'a'])).toBe(8)
  })

  it("a composition: the page and each container's slots (the container's max, else maxParts)", () => {
    const s = layoutSchema(form, {})
    expect(s.properties.children.maxItems).toBe(10)
    const lists = []
    const walk = (x) => { if (x && typeof x == 'object') { if (x.type == 'array' && x.items?.$ref) lists.push(x.maxItems); Object.values(x).forEach(walk) } }
    walk(s)
    expect(lists).toEqual([10, 10])
    const rows = layoutSchema(appCatalog, {})
    expect(JSON.stringify(rows)).toContain('"maxItems":4')   // the row's own max
  })
})

describe('a reply in a loop is stopped', () => {
  it('streamed: delta() returns the reply up to the first repeat, and the abort', () => {
    const b = llm()
    const { pending } = b.start({ catalog: form, state: {}, prompt: 'Put the dates and amount in a Trip section', previous: PREV, names })
    expect(pending).toMatchObject({ lane: 'compose', max: 14 })
    // complete operations, no repeat yet: a preview
    expect(b.delta({ catalog: form, state: {}, pending, delta: { text: loopText(4).slice(0, -2) + ',' } }).preview).toBeTruthy()
    const r = b.delta({ catalog: form, state: {}, pending, delta: { text: loopText(9).slice(0, -2) } })
    expect(r.request).toEqual({ abort: 'compose' })
    expect(r.reply).toEqual({ value: { ops: LOOP }, stopped: 'operation 5 repeats an earlier one' })
    const done = b.reply({ catalog: form, state: {}, pending, reply: r.reply })
    expect(done.layout).toBeTruthy()
    expect(done.decisions.repairs).toContainEqual({ kind: 'stopped', detail: 'operation 5 repeats an earlier one' })
    expect(codes()).toContain('SYG687')
  })

  it('a reply that was not streamed is cut at the same place; past the cap too', () => {
    const b = llm({ stream: false })
    const { pending } = b.start({ catalog: form, state: {}, prompt: 'x', previous: PREV, names })
    const r = b.reply({ catalog: form, state: {}, pending, reply: { text: loopText(40) } })
    expect(r.decisions.ops).toHaveLength(4)
    expect(r.decisions.repairs).toContainEqual({ kind: 'stopped', detail: 'operation 5 repeats an earlier one' })
    // 20 different operations: cut at 14
    const many = Array.from({ length: 20 }, (_, i) => ({ op: 'setParams', node: 'n1', params: { x: i } }))
    const c = b.reply({ catalog: form, state: {}, pending, reply: { text: JSON.stringify({ ops: many }) } })
    expect(c.decisions.repairs).toContainEqual({ kind: 'stopped', detail: 'more than 14 operations' })
  })

  it('a composition with far more parts than a page holds is stopped too', () => {
    const b = llm()
    const { pending } = b.start({ catalog: form, state: {}, prompt: 'x', previous: null, names })
    const kids = Array.from({ length: 21 }, () => ({ part: 'section', params: { title: 'T' }, children: [{ part: 'dates' }] }))
    const r = b.delta({ catalog: form, state: {}, pending, delta: { text: JSON.stringify({ asked_for: [], children: kids }).slice(0, -2) } })
    expect(r.request).toEqual({ abort: 'compose' })
    expect(r.reply.stopped).toBe('more than 20 parts')
  })

  it('in the app: the step finishes with the operations before the loop, the request is aborted, DONE runs', async () => {
    t = renderComponent(makeApp(compose.llm({ model: 'qwen3:8b' })), { strict: true })
    t.simulateEvent('.prompt', 'input', { value: 'the weather, then the tickets' })
    t.simulateEvent('.ask', 'submit')
    await t.next((s) => s.page.status === 'composing')
    await t.stream('LLM', [JSON.stringify({ asked_for: ['weather', 'tickets'], children: [{ part: 'weather' }, { part: 'tickets' }] })], 'page.REPLY')
    await t.waitForState((s) => s.page.status === 'done')
    t.simulateEvent('.prompt', 'input', { value: 'the tickets first' })
    t.simulateEvent('.ask', 'submit')
    await t.next((s) => s.page.status === 'composing')
    const op = { op: 'move', node: 'n2', where: 'top' }
    await t.stream('LLM', [JSON.stringify({ ops: [op, op, op] }).slice(0, -2)], 'page.REPLY', { end: false })
    await t.waitForState((s) => s.page.status === 'done' && s.doneCount === 2)
    expect(shape(t.state.page.layout)).toEqual(['tickets', 'weather'])
    expect(t.state.page.decisions.repairs).toContainEqual({ kind: 'stopped', detail: 'operation 2 repeats an earlier one' })
    expect(t.sinkValues('LLM').at(-1)).toEqual(expect.objectContaining({ abort: 'compose' }))
  })
})

describe("a runaway stop with busy: 'queue'", () => {
  it('the composition the stop starts is in flight: the next COMPOSE waits for it', async () => {
    const backend = compose.llm({ model: 'qwen3:8b' })
    t = renderComponent(makeApp(backend, { uses: { page: compose(appCatalog, { backend, form: '.ask', prompt: '.prompt', busy: 'queue' }) } }), { strict: true })
    t.simulateAction('page.COMPOSE', 'the weather, then the tickets')
    await t.next((s) => s.page.status === 'composing')
    await t.stream('LLM', [JSON.stringify({ asked_for: ['weather', 'tickets'], children: [{ part: 'weather' }, { part: 'tickets' }] })], 'page.REPLY')
    await t.waitForState((s) => s.page.status === 'done')

    // an edit in flight, and a fresh composition waiting for it
    t.simulateAction('page.COMPOSE', 'the tickets first')
    await t.next((s) => s.page.status === 'composing')
    t.simulateAction('page.COMPOSE', { prompt: 'the orders', fresh: true })
    await t.next((s) => s.page.queued?.prompt === 'the orders')

    // the edit loops: the stop ends it, and the waiting one starts
    const op = { op: 'move', node: 'n2', where: 'top' }
    await t.stream('LLM', [JSON.stringify({ ops: [op, op, op] }).slice(0, -2)], 'page.REPLY', { end: false })
    await t.waitForState((s) => s.page.prompt === 'the orders' && s.page.status === 'composing')
    const sent = t.requests('LLM').length

    // it is in flight, so the next COMPOSE waits instead of aborting it
    t.simulateAction('page.COMPOSE', { prompt: 'the weather', fresh: true })
    await t.next((s) => s.page.queued?.prompt === 'the weather')
    expect(t.requests('LLM')).toHaveLength(sent)
  })
})

describe('the output-token limit', () => {
  it("a reply cut there (finishReason 'length') is read up to where it stopped", () => {
    const b = llm()
    const { pending } = b.start({ catalog: form, state: {}, prompt: 'x', previous: PREV, names })
    const text = JSON.stringify({ ops: [{ op: 'move', node: 'n4', where: 'top' }, { op: 'remove', node: 'n1' }] }).slice(0, -12)
    const r = b.reply({ catalog: form, state: {}, pending, reply: { text, finishReason: 'length' } })
    expect(r.decisions.ops).toEqual([{ op: 'move', node: 'approver', where: 'top' }])
    expect(r.decisions.repairs).toContainEqual({ kind: 'stopped', detail: 'the reply reached the output-token limit' })
    // not cut there: still an error
    expect(b.reply({ catalog: form, state: {}, pending, reply: { text } }).error).toMatch(/not a layout/)
  })

  it('maxTokens: max_tokens (chatCompletions), max_output_tokens (openResponses); compose.llm passes it on', async () => {
    const f = fixtureFetch(() => dataSSE([{ choices: [{ delta: { content: '{}' }, finish_reason: 'length' }] }]))
    const ev = await collect(chatCompletions({ fetch: f.fetch }), { messages: [{ role: 'user', content: 'x' }], maxTokens: 300 })
    expect(f.calls[0].json.max_tokens).toBe(300)
    expect(ev.find((e) => e.type == 'finish').reason).toBe('length')
    const g = fixtureFetch(() => 'event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n')
    await collect(openResponses({ fetch: g.fetch }), { messages: [{ role: 'user', content: 'x' }], maxTokens: 300 })
    expect(g.calls[0].json.max_output_tokens).toBe(300)
    const h = fixtureFetch(() => dataSSE([]))
    await collect(chatCompletions({ fetch: h.fetch }), { messages: [{ role: 'user', content: 'x' }] })
    expect(h.calls[0].json).not.toHaveProperty('max_tokens')
    expect(llm({ maxTokens: 900 }).start({ catalog: form, state: {}, prompt: 'x', previous: null, names }).request.maxTokens).toBe(900)
  })
})

describe('a step that takes too long', () => {
  // a model that never answers
  const silent = { stream: (_req, signal) => (async function* () { await new Promise((_r, no) => signal.addEventListener('abort', () => no(new Error('aborted')))) })() }

  it('timeoutMs: compose.llm default 60 s (0: none), compose.decisions too', () => {
    expect(llm().start({ catalog: form, state: {}, prompt: 'x', previous: null, names }).request.timeoutMs).toBe(60000)
    expect(llm({ timeoutMs: 0 }).start({ catalog: form, state: {}, prompt: 'x', previous: null, names }).request).not.toHaveProperty('timeoutMs')
    expect(decisions({ model: 'm', timeoutMs: 5000 }).start({ catalog: form, state: {}, prompt: 'dates', previous: null, names }).request.timeoutMs).toBe(5000)
  })

  it("the chat driver fails the request with a TimeoutError: status 'error', the layout kept", async () => {
    t = renderComponent(makeApp(compose.llm({ timeoutMs: 40 })), { drivers: { LLM: makeChatDriver({ transport: silent }) } })
    t.simulateEvent('.prompt', 'input', { value: 'the weather' })
    t.simulateEvent('.ask', 'submit')
    await t.waitForState((s) => s.page.status === 'error')
    expect(t.state.page.error).toMatch(/timed out after 40ms/)
    expect(t.state.page.pending).toBe(null)
  })
})
