// Q1: the `generated` part kind in a compose layout: how the model emits code (the schema and the
// prompt), how it mounts (Worker by default, in-page opt-in), where its data comes from, and how
// declared, validated `emits` become the host's own actions.
import {describe, it, expect, afterEach} from 'vitest'
import {outputJsonSchema} from 'sygnal'
import {start, composePage, until, parts, allReady, sleep} from './helpers.js'
import {custom, makeApp, orders, customers} from '../fixtures/app.js'
import {GOOD} from '../fixtures/code.js'
import {sandboxedSpec} from '../src/Sandboxed.js'

let t
afterEach(() => { t?.dispose(); t = null })

describe('the model emits code as a param of the layout', () => {
  it("compose.llm's request: the custom part in the schema (code capped at maxCode + 1), the rules in the prompt", async () => {
    ;({t} = await start(null))
    t.simulateAction('page.COMPOSE', 'orders by status')
    await t.next((s) => s.page.status === 'composing')
    const req = t.requests('LLM').at(-1)
    const schema = JSON.stringify(outputJsonSchema(req.output).schema)
    expect(req.instructions).toContain('Custom parts:')
    expect(req.instructions).toContain('OPEN_CUSTOMER: the user picked a customer')
    expect(req.instructions).toContain('"id":{"type":"integer"')   // the emits schema, from zod's Standard JSON Schema
    expect(req.instructions).toContain('orders: the recent orders; shape [{ id: number')
    expect(req.instructions).not.toMatch(/Northwind|1003/)          // data shapes, never the user's data
    // the custom part's params in the reply schema (an anyOf entry per part); code is last, so it streams last
    expect(schema).toContain('"part":{"const":"custom"}')
    expect(schema).toContain('"properties":{"title":{"type":"string","maxLength":60},"reads":{"type":"array","items":{"type":"string","maxLength":40},"maxItems":2},"code":{"type":"string","maxLength":6001}},"required":["code"]')
    // a side effect of a long text param: compose.llm sizes asked_for items by the longest text param
    expect(schema).toContain('"asked_for":{"type":"array","items":{"type":"string","maxLength":6001}')
  })

  it('a valid reply mounts in a Worker by default; the part reads only what its node lists', async () => {
    ;({t} = await start([{part: 'revenue'}, custom('By status', ['orders'], GOOD.byStatus)]))
    expect(t.state.page.layout.nodes.custom.params.reads).toEqual(['orders'])
    await until(() => allReady(t, 1), 5000, 'the part')
    expect(t.state.page.local.custom).toMatchObject({status: 'ok', tier: 'worker'})
    expect(t.container.querySelectorAll('.bar')).toHaveLength(3)
    expect(t.container.querySelector('.bar[data-status="pending"]').textContent).toBe('pending: 10')
    // the host's own part renders next to it, outside the box
    expect(t.container.querySelector('.kpi strong').textContent).toBe('EUR 48.2k')
  })

  it("isolation: 'thread' is the opt-in: same part, in the page's thread", async () => {
    ;({t} = await start([custom('Top customers', ['orders', 'customers'], GOOD.topCustomers)], {isolation: 'thread'}))
    await until(() => allReady(t, 1))
    expect(t.state.page.local.custom.tier).toBe('thread')
    // paid totals, highest first, computed in the box from the orders and customers it reads
    const paid = (id) => orders.filter((o) => o.customer === id && o.status === 'paid').reduce((a, o) => a + o.total, 0)
    const expected = [...customers].sort((a, b) => paid(b.id) - paid(a.id)).map((c) => c.name)
    expect([...t.container.querySelectorAll('.name')].map((e) => e.textContent)).toEqual(expected)
  })
})

describe('emits: declared, validated, then the host\'s own action', () => {
  for (const isolation of ['worker', 'thread']) {
    it(`${isolation}: a click in the box → OPEN_CUSTOMER {id} (zod-checked) → the host's OPEN_CUSTOMER`, async () => {
      ;({t} = await start([custom('Top customers', ['orders', 'customers'], GOOD.topCustomers)], {isolation}))
      await until(() => allReady(t, 1))
      t.container.querySelector('.open[data-id="9"]').click()
      await until(() => t.state.openCustomer === 9)
      expect(t.container.querySelector('.picked').textContent).toBe('customer:9 status:-')
    })
  }

  it('an undeclared type or an invalid payload is dropped (a dev warning), never reaching the host', async () => {
    const bad = GOOD.topCustomers
      .replace('OPEN: DOM.select', "OOPS: DOM.select('.name').events('click'),\n  OPEN: DOM.select")
      .replace('  OPEN: { EVENTS:', "  OOPS: { EVENTS: (state) => ({ type: 'DELETE_ALL', data: {} }) },\n  OPEN: { EVENTS:")
      .replace("data: { id } })", "data: { id: String(id), __proto__: { admin: true } } })")
    let w
    ;({t, warnings: w} = await start([custom('Top customers', ['orders', 'customers'], bad)], {checks: false}))
    await until(() => allReady(t, 1))
    t.container.querySelector('.name').click()
    t.container.querySelector('.open[data-id="9"]').click()
    await until(() => w.length === 2)
    await sleep(30)
    expect(w[0]).toMatch(/undeclared event 'DELETE_ALL'/)
    expect(w[1]).toMatch(/dropped 'OPEN_CUSTOMER': id: Invalid input: expected number/)
    expect(t.state.openCustomer).toBe(null)
    expect({}.admin).toBe(undefined)
  })

  it('the validated value is the schema\'s output: extra keys the guest adds are stripped', async () => {
    const extra = GOOD.topCustomers.replace("data: { id } })", "data: { id, note: 'x'.repeat(100), role: 'admin' } })")
    ;({t} = await start([custom('Top customers', ['orders', 'customers'], extra)]))
    await until(() => allReady(t, 1))
    const seen = []
    t.container.addEventListener('emit', (e) => seen.push(e.detail))
    t.container.querySelector('.open[data-id="7"]').click()
    await until(() => seen.length)
    expect(seen[0]).toEqual({type: 'OPEN_CUSTOMER', data: {id: 7}})
  })
})

describe('data from the layout and the host state', () => {
  it('PROPS arrive before the first render: a part with no initial data still renders its data', async () => {
    const code = GOOD.refunds.replace('Refunds.initialState = { orders: [] }', 'Refunds.initialState = {}')
    ;({t} = await start([custom('Refunds', ['orders'], code)]))
    await until(() => allReady(t, 1))
    expect(t.container.querySelector('.badge').textContent).toBe('10 orders')
  })

  it("only the keys the node reads, only the app's declared data: an unknown name reads nothing", async () => {
    const code = GOOD.refunds.replace('const refunded', 'const keys = Object.keys(state).sort().join(",")\n  const refunded').replace('<p className="muted">Refunds</p>', '<p className="muted keys">{keys}</p>')
    ;({t} = await start([custom('Refunds', ['orders', 'secrets', 'page'], code)]))
    await until(() => allReady(t, 1))
    expect(t.container.querySelector('.keys').textContent).toBe('orders')
  })

  it('a host state change reaches the box (only when the JSON changed)', async () => {
    ;({t} = await start([custom('Refunds', ['orders'], GOOD.refunds)]))
    await until(() => allReady(t, 1))
    const before = t.container.querySelector('.refund-total').textContent
    t.simulateAction('FILTER_STATUS', {status: 'paid'})      // a host change the part doesn't read: no message
    await t.next((s) => s.statusFilter === 'paid')
    expect(t.container.querySelector('.refund-total').textContent).toBe(before)
  })

  it('a follow-up edit: setParams on the code remounts that box only; the other part keeps its instance', async () => {
    ;({t} = await start([custom('Refunds', ['orders'], GOOD.refunds), custom('Pending', ['orders'], GOOD.pending)]))
    await until(() => allReady(t, 2))
    const keys = Object.keys(t.state.page.layout.nodes).filter((k) => k != 'page')
    // type into the pending part: its own state, inside its box
    const q = t.container.querySelector('.q')
    q.value = '100'
    q.dispatchEvent(new window.Event('input', {bubbles: true}))
    await until(() => t.container.querySelector('.count').textContent === '3 pending')
    t.simulateAction('page.COMPOSE', 'show refunds in a badge only')
    await t.next((s) => s.page.status === 'composing')
    const edit = t.requests('LLM').at(-1)
    // the edit prompt carries every generated part's code (cost: README "Numbers")
    expect(edit.messages[0].content).toContain('Refunds.initialState')
    const n = edit.messages[0].content.split('\n').find((l) => l.includes('title="Refunds"')).trim().split(':')[0]
    const code2 = GOOD.refunds.replace('<p className="muted">Refunds</p>', '<p className="muted">Refunded</p>')
    await t.respond('LLM', JSON.stringify({ops: [{op: 'setParams', node: n, params: {code: code2}}]}), 'page.REPLY')
    await t.waitForState((s) => s.page.status === 'done')
    expect(Object.keys(t.state.page.layout.nodes).filter((k) => k != 'page')).toEqual(keys)
    await until(() => t.container.querySelector('.muted')?.textContent === 'Refunded')
    expect(t.container.querySelector('.count').textContent).toBe('3 pending')     // the untouched box kept its state
  })
})

it('<Sandboxed> refuses to mount without emits schemas (decided: required)', () => {
  const {runtime} = makeApp()
  const spec = sandboxedSpec(runtime)
  const el = document.createElement('div')
  expect(() => spec.mount(el, {code: GOOD.refunds}, () => {})).toThrow(/`emits` is required/)
  expect(() => spec.mount(el, {code: GOOD.refunds, emits: {PICK: {type: 'object'}}}, () => {})).toThrow(/Standard Schema/)
})
