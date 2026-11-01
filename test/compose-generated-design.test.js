// @vitest-environment jsdom
// compose.generated (experimental): the generated part kind in a compose layout. How the model
// emits code (the reply schema and the prompt), how it mounts (a Worker by default, the page's
// thread as the opt-in), where its data comes from, and how declared, validated `emits` become the
// host's own actions. From the compose-sandbox spike's design suite (Q1); the model is scripted.
import { describe, it, expect, afterEach } from 'vitest'
import { outputJsonSchema } from '../src/extra/ai/chat/output.ts'
import { compose, defineCatalog } from '../src/extra/ai/compose/index.ts'
import { generatedRuntime, lintGenerated, GENERATED_LIMITS } from '../src/sandbox.ts'
import { start, until, parts, allReady, sleep, custom, orders, customers, makeApp, DATA, EMITS, compile, fixRequests } from './fixtures/generated-app.js'
import { kernel } from './fixtures/sandbox-helpers.js'
import { GOOD } from './fixtures/generated-code.js'
import { check as sygnalCheck } from '../sygnal-check/src/index.js'

let t
afterEach(() => { t?.dispose(); t = null })

describe('the model emits code as a param of the layout', {timeout: 20000}, () => {
  it("compose.llm's request: the custom part in the schema (code capped at maxCode + 1, a code param), the rules in the prompt", async () => {
    ;({ t } = await start(null))
    t.simulateAction('page.COMPOSE', 'orders by status')
    await t.next((s) => s.page.status === 'composing')
    const req = t.requests('LLM').at(-1)
    const schema = JSON.stringify(outputJsonSchema(req.output).schema)
    expect(req.instructions).toContain('Custom parts:')
    expect(req.instructions).toContain('At most 3 of them per page')
    expect(req.instructions).toContain('OPEN_CUSTOMER: the user picked a customer')
    expect(req.instructions).toContain('"id":{"type":"integer"')   // the emits schema, from zod's Standard JSON Schema
    expect(req.instructions).toContain('orders: the recent orders; shape [{ id: number')
    expect(req.instructions).not.toMatch(/Northwind|1003/)          // data shapes, never the user's data
    // §7: a code param is described as source code, not as short text
    expect(req.instructions).toMatch(/code: its source code \(see "Custom parts"\); source code, at most 4001 characters; always set it/)
    // the custom part's params (code last, so it streams last); asked_for items stay short
    expect(schema).toContain('"part":{"const":"custom"}')
    expect(schema).toContain('"properties":{"title":{"type":"string","maxLength":60},"reads":{"type":"array","items":{"type":"string","maxLength":40},"maxItems":2},"code":{"type":"string","maxLength":4001}},"required":["code"]')
    expect(schema).toContain('"asked_for":{"type":"array","items":{"type":"string","maxLength":60}')
  })

  it('the defaults: maxUses 3, maxCode 4000 (the worker default, the check and no capabilities: the other suites); never in a catalog by itself', () => {
    const { gen, catalog } = makeApp()
    expect(gen.part.maxUses).toBe(3)
    expect(gen.part.params.code).toMatchObject({ type: 'text', format: 'code', maxLength: 4001, required: true })
    expect(catalog.parts.custom.params.code).toMatchObject({ kind: 'text', format: 'code' })
    // a catalog without gen.part has no generated part (an app opts in per catalog)
    const plain = defineCatalog({ parts: { revenue: { render: () => null, description: 'Revenue' } } })
    expect(Object.keys(plain.parts)).toEqual(['revenue'])
    expect(GENERATED_LIMITS).toMatchObject({ bootMs: 500, callMs: 50, maxWasmBytes: 48 << 20 })
  })

  it('a valid reply mounts in a Worker by default; the part reads only what its node lists', async () => {
    ;({ t } = await start([{ part: 'revenue' }, custom('By status', ['orders'], GOOD.byStatus)]))
    expect(t.state.page.layout.nodes.custom.params.reads).toEqual(['orders'])
    await until(() => allReady(t, 1), 8000, 'the part')
    expect(t.state.page.local.custom).toMatchObject({ status: 'ok', tier: 'worker' })
    expect(t.container.querySelectorAll('.bar')).toHaveLength(3)
    expect(t.container.querySelector('.bar[data-status="pending"]').textContent).toBe('pending: 10')
    // the host's own part renders next to it, outside the box
    expect(t.container.querySelector('.kpi strong').textContent).toBe('EUR 48.2k')
  })

  it("isolation: 'thread' is the opt-in: same part, in the page's thread", async () => {
    ;({ t } = await start([custom('Top customers', ['orders', 'customers'], GOOD.topCustomers)], { isolation: 'thread' }))
    await until(() => allReady(t, 1))
    expect(t.state.page.local.custom.tier).toBe('thread')
    const paid = (id) => orders.filter((o) => o.customer === id && o.status === 'paid').reduce((a, o) => a + o.total, 0)
    const expected = [...customers].sort((a, b) => paid(b.id) - paid(a.id)).map((c) => c.name)
    expect([...t.container.querySelectorAll('.name')].map((e) => e.textContent)).toEqual(expected)
  })
})

describe("emits: declared, validated, then the host's own action", {timeout: 20000}, () => {
  for (const isolation of ['worker', 'thread']) {
    it(`${isolation}: a click in the box → OPEN_CUSTOMER {id} (zod-checked) → the host's OPEN_CUSTOMER`, async () => {
      ;({ t } = await start([custom('Top customers', ['orders', 'customers'], GOOD.topCustomers)], { isolation }))
      await until(() => allReady(t, 1), 8000)
      t.container.querySelector('.open[data-id="9"]').click()
      await until(() => t.state.openCustomer === 9)
      await until(() => t.container.querySelector('.picked').textContent === 'customer:9 status:-')
    })
  }

  it('an undeclared type or an invalid payload is dropped (a sandboxreject), never reaching the host', async () => {
    const bad = GOOD.topCustomers
      .replace('OPEN: DOM.select', "OOPS: DOM.select('.name').events('click'),\n  OPEN: DOM.select")
      .replace('  OPEN: { EVENTS:', "  OOPS: { EVENTS: (state) => ({ type: 'DELETE_ALL', data: {} }) },\n  OPEN: { EVENTS:")
      .replace('data: { id } })', 'data: { id: String(id), __proto__: { admin: true } } })')
    ;({ t } = await start([custom('Top customers', ['orders', 'customers'], bad)]))
    await until(() => allReady(t, 1), 8000)
    const rejects = []
    t.container.addEventListener('sandboxreject', (e) => rejects.push(e.detail))
    t.container.querySelector('.name').click()
    t.container.querySelector('.open[data-id="9"]').click()
    await until(() => rejects.length === 2)
    await sleep(30)
    expect(rejects[0]).toMatchObject({ type: 'DELETE_ALL', reason: 'undeclared', declared: ['OPEN_CUSTOMER', 'FILTER_STATUS'] })
    expect(rejects[1]).toMatchObject({ type: 'OPEN_CUSTOMER', reason: 'invalid', issues: [{ path: ['id'] }] })
    expect(rejects[1].issues[0].message).toMatch(/expected number/)
    expect(t.state.openCustomer).toBe(null)
    expect({}.admin).toBe(undefined)
    // and the repair loop hears about the first (the part still works meanwhile)
    expect(fixRequests(t)[0].messages[0].content).toMatch(/What went wrong: the app dropped an event DELETE_ALL: undeclared \(it takes only OPEN_CUSTOMER, FILTER_STATUS\)/)
  })

  it("the validated value is the schema's output: extra keys the guest adds are stripped", async () => {
    const extra = GOOD.topCustomers.replace('data: { id } })', "data: { id, note: 'x'.repeat(100), role: 'admin' } })")
    ;({ t } = await start([custom('Top customers', ['orders', 'customers'], extra)]))
    await until(() => allReady(t, 1), 8000)
    const seen = []
    t.container.addEventListener('emit', (e) => seen.push(e.detail))
    t.container.querySelector('.open[data-id="7"]').click()
    await until(() => seen.length)
    expect(seen[0]).toEqual({ type: 'OPEN_CUSTOMER', data: { id: 7 } })
    await until(() => t.state.openCustomer === 7)
  })
})

describe('data from the layout and the host state', {timeout: 20000}, () => {
  it('PROPS arrive before the first render: a part with no initial data still renders its data', async () => {
    const code = GOOD.refunds.replace('Refunds.initialState = { orders: [] }', 'Refunds.initialState = {}')
    ;({ t } = await start([custom('Refunds', ['orders'], code)]))
    await until(() => allReady(t, 1), 8000)
    expect(t.container.querySelector('.badge').textContent).toBe('10 orders')
  })

  it("only the keys the node reads, only the app's declared data: an unknown name reads nothing", async () => {
    const code = GOOD.refunds.replace('const refunded', 'const keys = Object.keys(state).sort().join(",")\n  const refunded').replace('<p className="muted">Refunds</p>', '<p className="muted keys">{keys}</p>')
    ;({ t } = await start([custom('Refunds', ['orders', 'secrets', 'page'], code)]))
    await until(() => allReady(t, 1), 8000)
    expect(t.container.querySelector('.keys').textContent).toBe('orders')
  })

  it('a host state change the part does not read leaves the box alone', async () => {
    ;({ t } = await start([custom('Refunds', ['orders'], GOOD.refunds)]))
    await until(() => allReady(t, 1), 8000)
    const before = t.container.querySelector('.refund-total').textContent
    t.simulateAction('FILTER_STATUS', { status: 'paid' })
    await t.next((s) => s.statusFilter === 'paid')
    expect(t.container.querySelector('.refund-total').textContent).toBe(before)
  })

  it('a follow-up edit: setParams on the code remounts that box only; the other part keeps its instance', async () => {
    ;({ t } = await start([custom('Refunds', ['orders'], GOOD.refunds), custom('Pending', ['orders'], GOOD.pending)]))
    await until(() => allReady(t, 2), 8000)
    const keys = Object.keys(t.state.page.layout.nodes).filter((k) => k != 'page')
    const q = t.container.querySelector('.q')
    q.value = '100'
    q.dispatchEvent(new window.Event('input', { bubbles: true }))
    await until(() => t.container.querySelector('.count').textContent === '3 pending')
    t.simulateAction('page.COMPOSE', 'show refunds in a badge only')
    await t.next((s) => s.page.status === 'composing')
    const edit = t.requests('LLM').at(-1)
    expect(edit.messages[0].content).toContain('Refunds.initialState')
    const n = edit.messages[0].content.split('\n').find((l) => l.includes('title="Refunds"')).trim().split(':')[0]
    const code2 = GOOD.refunds.replace('<p className="muted">Refunds</p>', '<p className="muted">Refunded</p>')
    await t.respond('LLM', JSON.stringify({ ops: [{ op: 'setParams', node: n, params: { code: code2 } }] }), 'page.REPLY')
    await t.waitForState((s) => s.page.status === 'done')
    expect(Object.keys(t.state.page.layout.nodes).filter((k) => k != 'page')).toEqual(keys)
    await until(() => t.container.querySelector('.muted')?.textContent === 'Refunded', 8000)
    expect(t.container.querySelector('.count').textContent).toBe('3 pending')
  })
})

describe('the pieces', {timeout: 20000}, () => {
  it('compose.generated needs a runtime and a Standard Schema per event; generatedRuntime needs a kernel and a compile', () => {
    expect(() => compose.generated({}, { emits: EMITS })).toThrow(/generatedRuntime/)
    const runtime = generatedRuntime({ kernel, compile })
    expect(() => compose.generated(runtime, { emits: { PICK: { description: 'x', schema: { type: 'object' } } } })).toThrow(/emits.PICK needs `schema`/)
    expect(() => compose.generated(runtime, { data: DATA, emits: EMITS }).card('NOPE')).toThrow(/not one of the declared emits/)
    expect(() => generatedRuntime({ compile })).toThrow(/`kernel` is required/)
    expect(() => generatedRuntime({ kernel })).toThrow(/`compile` is required/)
  })

  it("the page's check before mount: JSX handlers (line numbered); the app's own check is added to it", async () => {
    expect(lintGenerated('export default function A() {\n  return <button onClick={() => 1}>x</button>\n}')[0]).toMatch(/^line 2: JSX event handlers \(onClick\) don't run.*events\('click'\)/)
    expect(lintGenerated(GOOD.byStatus)).toEqual([])
    const runtime = generatedRuntime({ kernel, compile, check: (code) => (code.includes('TODO') ? ['line 1: a TODO is left'] : []) })
    expect(await runtime.compile('// TODO\n' + GOOD.refunds)).toEqual({ ok: false, error: 'line 1: a TODO is left' })
    expect((await runtime.compile('// TODO\n' + GOOD.refunds, false)).ok).toBe(true)
    expect((await runtime.compile('export default function A() { return <div>')).ok).toBe(false)
  })

  it("the app's check can be sygnal-check where it runs (Node: a server that composes, tests): its findings fail the part before it mounts", async () => {
    const FILE = '/generated/part.jsx'
    const check = (code) => sygnalCheck([FILE], { sources: { [FILE]: code }, config: false, cwd: '/generated' })
      .filter((d) => d.code === 'SYG102').map((d) => `line ${d.line}: ${d.code} ${d.message}`)
    const runtime = generatedRuntime({ kernel, compile, check })
    // a model entry no intent action reaches (silent at run time; the kernel checks only SYG101)
    const code = GOOD.refunds.replace('Refunds.model = { DATA:', 'Refunds.model = { OPEN: (state) => state, DATA:')
    const r = await runtime.compile(code)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^line \d+: SYG102 .*OPEN/)
    expect((await runtime.compile(GOOD.refunds)).ok).toBe(true)
  })
})
