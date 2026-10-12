// PLAN-9 C-1 / T-1 / T-2 (worker A): the compose behavior, run once per backend (the contract's
// fake decision-like backend: 2 steps + a preview; the fake LLM-like one: streamed deltas), with
// composeWith answering each backend through its own fake(). The coordinator adds the real
// compose.decisions() / compose.llm() to BACKENDS after B and C merge.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { setupChecks } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { persist } from '../src/extra/persist.ts'
import { composeWith, compose, defineCatalog } from '../src/extra/ai/index.ts'
import { makeApp, catalog, CustomerCard, renders } from './p9-compose-app.js'
import { fakeDecisions, fakeLlm, shape } from './p9-compose-fakes.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null; try { localStorage.clear() } catch (_) {} })

async function ask(prompt) {
  t.simulateEvent('.prompt', 'input', { value: prompt })
  t.simulateEvent('.ask', 'submit')
  await t.next((s) => s.page.status === 'composing')
}

const BACKENDS = {
  decisions: () => fakeDecisions(),
  llm: () => fakeLlm(),
}

for (const [name, backend] of Object.entries(BACKENDS)) {
  describe(`compose behavior, ${name} backend`, () => {
    it('composes a row and a param from a form submit, renders real parts, runs the host DONE entry', async () => {
      t = renderComponent(makeApp(backend()), { strict: true })
      expect(t.state.page).toMatchObject({ prompt: '', status: 'idle', layout: null, preview: null, pending: null, ui: {}, local: {} })
      await ask('Revenue and churn side by side, then the revenue chart for the quarter')
      expect(t.state.page.prompt).toBe('Revenue and churn side by side, then the revenue chart for the quarter')
      await composeWith(t, catalog, [
        { part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] },
        { part: 'revenueChart', params: { range: 'quarter' } },
      ])
      await t.waitForState((s) => s.page.status === 'done')
      expect(shape(t.state.page.layout)).toEqual(['row(revenue,churn)', 'revenueChart'])
      expect(t.state.page.layout.nodes.revenueChart.params).toEqual({ range: 'quarter' })
      expect(t.state.page.pending).toBe(null)
      expect(t.state.page.decisions).toBeTruthy()
      expect(t.html()).toContain('$48.2k')
      expect(t.query('.chart').getAttribute('data-range')).toBe('quarter')
      expect(t.query('.compose-row')).toBeTruthy()
      expect(t.state.lastDone).toBe(5)
      expect(t.state.doneCount).toBe(1)
      t.expectNoDiagnostics()
    })

    it('record lenses write app state, CHILD.select hears composed parts, a follow-up edit keeps keys and instances', async () => {
      t = renderComponent(makeApp(backend()), { strict: true })
      await ask('Northwind and Globex, and my tasks')
      await composeWith(t, catalog, [{ part: 'customer', params: { id: 7 } }, { part: 'customer', params: { id: 9 } }, { part: 'tasks' }])
      await t.waitForState((s) => s.page.status === 'done')
      expect(shape(t.state.page.layout)).toEqual(['customer:7', 'customer:9', 'tasks'])
      t.simulateEvent('.customer[data-node="customer:9"] .notes', 'input', { value: 'call back' })
      await t.next((s) => s.customers[1].notes === 'call back')
      t.simulateEvent('.task-toggle[data-id="2"]', 'change')
      await t.next((s) => s.tasks[1].done)
      t.simulateEvent('.customer[data-node="customer:7"] .open', 'click')
      await t.next((s) => s.opened === 7)
      const idOf = () => t.inspect().components.filter((c) => c.name === 'CustomerCard').map((c) => c.id)
      const before = idOf()

      await ask('Put my tasks first and drop Northwind')
      await composeWith(t, catalog, [{ part: 'tasks' }, { part: 'customer', params: { id: 9 } }])
      await t.waitForState((s) => s.page.status === 'done' && !s.page.layout.nodes['customer:7'])
      expect(shape(t.state.page.layout)).toEqual(['tasks', 'customer:9'])
      expect(t.query('.customer .notes').value).toBe('call back')
      expect(idOf()).toEqual([before[1]])
      expect(t.state.tasks[1].done).toBe(true)
      t.expectNoDiagnostics()
    })

    it('a local part keeps its state in slice.local across a recomposition; COMPOSE takes a string or { prompt, fresh }', async () => {
      t = renderComponent(makeApp(backend()), { strict: true })
      t.simulateAction('page.COMPOSE', 'A note called Calls, then the weather')
      await t.next((s) => s.page.status === 'composing')
      expect(t.state.page.prompt).toBe('A note called Calls, then the weather')
      // a decision model can't fill a required text param, so the note comes from a SET_LAYOUT here
      t.simulateAction('page.SET_LAYOUT', { root: 'page', nodes: { page: { part: 'page', slots: { default: ['note', 'weather'] } }, note: { part: 'note', params: { title: 'Calls' } }, weather: { part: 'weather' } } })
      await t.next((s) => s.page.status === 'done')
      expect(t.query('.note h4').textContent).toBe('Calls')
      t.simulateEvent('.note-text', 'input', { value: 'Ann, Bob' })
      await t.next((s) => s.page.local.note?.text === 'Ann, Bob')
      t.simulateAction('page.COMPOSE', { prompt: 'Weather first, then the tickets', fresh: true })
      await t.next((s) => s.page.status === 'composing')
      await composeWith(t, catalog, [{ part: 'weather' }, { part: 'tickets' }])
      await t.waitForState((s) => s.page.status === 'done')
      expect(shape(t.state.page.layout)).toEqual(['weather', 'tickets'])
      expect(t.state.page.local.note).toEqual({ text: 'Ann, Bob' })
      t.expectNoDiagnostics()
    })

    it('says when nothing fits and keeps the layout; a failure keeps it too', async () => {
      t = renderComponent(makeApp(backend()), { strict: true })
      await ask('weather')
      await composeWith(t, catalog, [{ part: 'weather' }])
      await t.waitForState((s) => s.page.status === 'done')
      await ask('the stock price of Apple')
      await composeWith(t, catalog, [])
      await t.waitForState((s) => s.page.status === 'unavailable')
      expect(shape(t.state.page.layout)).toEqual(['weather'])
      expect(t.state.doneCount).toBe(1)
      await ask('tickets')
      await t.fail(backend().sink, 500, 'page.FAILED')
      await t.waitForState((s) => s.page.status === 'error')
      expect(t.state.page.error).toMatch(/500/)
      expect(t.state.page.pending).toBe(null)
      expect(shape(t.state.page.layout)).toEqual(['weather'])
      expect(t.query('.weather')).toBeTruthy()
    })

    it('tabs: a control click sets ui, hidden tabs stay alive, REMOVE and SET_LAYOUT restore', async () => {
      t = renderComponent(makeApp(backend()), { strict: true })
      await ask('tasks and feedback as tabs')
      await composeWith(t, catalog, [{ part: 'tabs', children: { overview: [{ part: 'tasks' }], billing: [{ part: 'feedback' }] } }])
      await t.waitForState((s) => s.page.status === 'done')
      expect(shape(t.state.page.layout)).toEqual(['tabs(tasks,feedback)'])
      expect(t.queryAll('[role="tabpanel"]')[1].hasAttribute('hidden')).toBe(true)
      t.simulateEvent('.feedback-draft', 'input', { value: 'dark mode' })
      await t.next((s) => s.feedback.draft === 'dark mode')
      t.simulateEvent('[role="tab"]:nth-child(2)', 'click')
      await t.next((s) => s.page.ui.tabs?.tab === 1)
      expect(t.queryAll('[role="tabpanel"]')[0].hasAttribute('hidden')).toBe(true)
      const saved = t.state.page.layout
      t.simulateAction('page.REMOVE', 'feedback')
      // tabs fall below minSlots: unwrapped
      await t.next((s) => !s.page.layout.nodes.feedback)
      expect(shape(t.state.page.layout)).toEqual(['tasks'])
      t.simulateAction('page.SET_LAYOUT', saved)
      await t.next((s) => !!s.page.layout.nodes.tabs)
      expect(t.query('.feedback-draft').value).toBe('dark mode')
      t.simulateAction('page.CONTROL', { key: 'tabs', name: 'tab', value: 0 })
      await t.next((s) => s.page.ui.tabs.tab === 0)
      t.expectNoDiagnostics()
    })
  })
}

describe('compose behavior: backend-specific', () => {
  it('decisions: the preview shows after the select step, a failure then keeps the old layout', async () => {
    t = renderComponent(makeApp(fakeDecisions()), { strict: true })
    await ask('orders and tickets')
    const select = t.requests('HTTP').at(-1)
    expect(select).toMatchObject({ key: 'compose', latest: true, ok: 'page.REPLY', error: 'page.FAILED' })
    expect(Object.keys(select.json.questions)).not.toContain('use_note')
    const fake = fakeDecisions().fake({ catalog, state: t.state, pending: t.state.page.pending, target: [{ part: 'orders' }, { part: 'tickets' }] })
    await t.respond('HTTP', fake, 'page.REPLY')
    expect(t.state.page.status).toBe('preview')
    expect(shape(t.state.page.preview)).toEqual(['orders', 'tickets'])
    expect(t.query('.canvas').classList.contains('preview')).toBe(true)
    expect(t.query('.orders')).toBeTruthy()
    await t.fail('HTTP', 500, 'page.FAILED')
    expect(t.state.page).toMatchObject({ status: 'error', layout: null, preview: null, pending: null })
    expect(t.query('.orders')).toBe(null)
  })

  it('llm: streamed deltas preview the complete nodes so far, then the layout', async () => {
    t = renderComponent(makeApp(fakeLlm()), { strict: true })
    await ask('tickets, orders, weather')
    const req = t.requests('LLM').at(-1)
    expect(req).toMatchObject({ key: 'compose', ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA' })
    const text = JSON.stringify({ page: [{ part: 'tickets' }, { part: 'orders' }, { part: 'weather' }] })
    const cut = text.indexOf('{"part":"weather"') + 5
    await t.stream('LLM', [text.slice(0, cut)], 'page.REPLY', { end: false })
    expect(t.state.page.status).toBe('preview')
    expect(shape(t.state.page.preview)).toEqual(['tickets', 'orders'])
    await t.stream('LLM', [text.slice(cut)], 'page.REPLY')
    await t.waitForState((s) => s.page.status === 'done')
    expect(shape(t.state.page.layout)).toEqual(['tickets', 'orders', 'weather'])
    expect(t.state.page.preview).toBe(null)
  })

  it('llm: composeWith streams in chunks; a reply the backend rejects is an error, the old page stays', async () => {
    t = renderComponent(makeApp(fakeLlm()), { strict: true })
    await ask('weather')
    await composeWith(t, catalog, [{ part: 'weather' }, { part: 'note', params: { title: 'Calls' } }], { stream: 4 })
    await t.waitForState((s) => s.page.status === 'done')
    expect(shape(t.state.page.layout)).toEqual(['weather', 'note'])
    expect(t.query('.note h4').textContent).toBe('Calls')
    await ask('nonsense')
    await t.respond('LLM', 'not json', 'page.REPLY')
    await t.waitForState((s) => s.page.status === 'error')
    expect(t.state.page.error).toMatch(/JSON/)
    expect(shape(t.state.page.layout)).toEqual(['weather', 'note'])
  })

  it('a new prompt while composing aborts the old step (latest, one lane)', async () => {
    t = renderComponent(makeApp(fakeDecisions()), { strict: true })
    await ask('orders')
    t.simulateAction('page.COMPOSE', 'tickets')
    await t.next((s) => s.page.prompt === 'tickets')
    await composeWith(t, catalog, [{ part: 'tickets' }])
    await t.waitForState((s) => s.page.status === 'done')
    expect(shape(t.state.page.layout)).toEqual(['tickets'])
  })
})

describe('compose behavior: the host side', () => {
  it('context reaches parts; a Collection inside a part works', async () => {
    t = renderComponent(makeApp(fakeLlm()), { strict: true })
    t.simulateAction('page.SET_LAYOUT', { root: 'page', nodes: { page: { part: 'page', slots: { default: ['badge', 'todos'] } }, badge: { part: 'badge' }, todos: { part: 'todos' } } })
    await t.next((s) => s.page.status === 'done')
    expect(t.query('.badge').textContent).toBe('dark')
    t.simulateAction('THEME', 'light')
    await t.next((s) => s.theme === 'light')
    expect(t.query('.badge').textContent).toBe('light')
    expect(t.queryAll('.todo').length).toBe(2)
    t.simulateEvent('.todo:nth-child(2) .todo-done', 'click')
    await t.next((s) => s.todos.items[1].done)
    expect(t.state.todos.items[0].done).toBe(false)
    t.expectNoDiagnostics()
  })

  it('a persisted layout is restored without a model call', async () => {
    const App = makeApp(fakeDecisions(), { persist: persist({ key: 'p9-compose', pick: ['page', 'customers'] }) })
    const saved = { page: { prompt: 'Globex', status: 'done', layout: { root: 'page', nodes: { page: { part: 'page', slots: { default: ['customer:9', 'note'] } }, 'customer:9': { part: 'customer', params: { id: 9 } }, note: { part: 'note', params: { title: 'Hi' } } } }, preview: null, pending: null, decisions: null, error: null, ui: {}, local: { note: { text: 'kept' } } } }
    t = renderComponent(App, { strict: true, storage: { 'p9-compose': JSON.stringify({ v: 1, state: saved }) } })
    await t.ready?.()
    expect(t.state.page.status).toBe('done')
    expect(t.query('.customer h3').textContent).toBe('Globex')
    expect(t.query('.note-text').value).toBe('kept')
    expect(t.requests('HTTP')).toEqual([])
  })

  it('a host intent action of the same name and a host STATE entry run with the behavior', async () => {
    const App = makeApp(fakeLlm())
    t = renderComponent(App, { strict: true })
    t.simulateAction('page.SET_LAYOUT', null)
    await t.next((s) => s.page.status === 'idle')
    expect(t.state.page.layout).toBe(null)
    expect(catalog.render(t.state.page, t.state)).toBe(null)
  })

  it('no backend, or no catalog, throws SYG681', () => {
    expect(() => compose(catalog, {})).toThrow(/SYG681/)
    expect(() => compose({}, { backend: fakeLlm() })).toThrow(/SYG681/)
  })

  it('composeWith without a pending composition throws', async () => {
    t = renderComponent(makeApp(fakeLlm()), { strict: true })
    await expect(composeWith(t, catalog, [])).rejects.toThrow(/waiting/)
    const other = defineCatalog({ parts: { a: { component: () => h('i', null), description: 'A' } } })
    await expect(composeWith(t, other, [])).rejects.toThrow(/no compose behavior/)
  })

  it('a local part does not re-render on unrelated host changes (memoized lenses, G-752)', async () => {
    t = renderComponent(makeApp(fakeLlm()), { strict: true })
    t.simulateAction('page.SET_LAYOUT', { root: 'page', nodes: { page: { part: 'page', slots: { default: ['note', 'weather'] } }, note: { part: 'note', params: { title: 'X' } }, weather: { part: 'weather' } } })
    await t.next((s) => s.page.status === 'done')
    const n0 = renders.Note
    for (let i = 0; i < 3; i++) { t.simulateAction('BUMP'); await t.next(); expect(renders.Note).toBe(n0) }
    t.simulateEvent('.note-text', 'input', { value: 'a' })
    await t.next((s) => s.page.local.note?.text === 'a')
    expect(renders.Note).toBe(n0 + 1)
  })

  it('CHILD.select reaches a composed part inside a container', async () => {
    t = renderComponent(makeApp(fakeLlm()), { strict: true })
    t.simulateAction('page.SET_LAYOUT', { root: 'page', nodes: { page: { part: 'page', slots: { default: ['row'] } }, row: { part: 'row', slots: { default: ['customer:7', 'weather'] } }, 'customer:7': { part: 'customer', params: { id: 7 } }, weather: { part: 'weather' } } })
    await t.next((s) => s.page.status === 'done')
    t.simulateEvent('.customer .open', 'click')
    await t.next((s) => s.opened === 7)
    expect(t.inspect().components.find((c) => c.name === 'CustomerCard')).toBeTruthy()
    expect(CustomerCard).toBeTruthy()
  })
})
