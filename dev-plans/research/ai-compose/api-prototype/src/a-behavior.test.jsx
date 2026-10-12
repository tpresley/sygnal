import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { answers } from 'sygnal/ai'
import { makeApp } from './app/AppA.jsx'
import { catalog } from './app/catalog.jsx'
import { decisions, llm, layoutSchema } from './lib/backends.js'
import { composeWith } from './lib/testing.js'

let t
afterEach(() => t?.dispose())

// the page top to bottom: 'part' or 'container(a,b)'
const shape = (layout, key = layout.root) => (layout.nodes[key].slots?.default || []).map((k) => {
  const n = layout.nodes[k]
  return n.slots ? `${n.part}(${shape(layout, k).join(',')})` : k
})

async function ask(prompt) {
  t.simulateEvent('.prompt', 'input', { value: prompt })
  t.simulateEvent('.ask', 'submit')
  await t.next((s) => s.page.status === 'composing')
}

const BACKENDS = {
  decisions: () => decisions({ url: '/api/decide', model: 'nimble' }),
  llm: () => llm({ model: 'qwen3' }),
}

for (const [name, backend] of Object.entries(BACKENDS)) {
  describe(`candidate A, ${name}: the same app, the same fixtures`, () => {
    it('composes a page with a row and a param, and renders real parts', async () => {
      t = renderComponent(makeApp(backend()), { strict: true })
      await ask('Revenue and churn side by side, then the revenue chart for the quarter')
      await composeWith(t, catalog, [
        { part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] },
        { part: 'revenueChart', params: { range: 'quarter' } },
      ])
      await t.waitForState((s) => s.page.status === 'done')
      expect(shape(t.state.page.layout)).toEqual(['row(revenue,churn)', 'revenueChart'])
      expect(t.state.page.layout.nodes.revenueChart.params).toEqual({ range: 'quarter' })
      expect(t.html()).toContain('$48.2k')
      expect(t.query('.chart').getAttribute('data-range')).toBe('quarter')
      expect(t.state.lastComposed).toBe(5)        // the host's 'page.DONE' entry ran
      t.expectNoDiagnostics()
    })

    it('parts are wired into app state: record lenses, CHILD.select, state survives a follow-up edit', async () => {
      t = renderComponent(makeApp(backend()), { strict: true })
      await ask('Northwind and Globex, and my tasks')
      await composeWith(t, catalog, [{ part: 'customer', params: { id: 7 } }, { part: 'customer', params: { id: 9 } }, { part: 'tasks' }])
      await t.waitForState((s) => s.page.status === 'done')
      expect(shape(t.state.page.layout)).toEqual(['customer:7', 'customer:9', 'tasks'])

      t.simulateEvent('.customer[data-node="customer:9"] .notes', 'input', { value: 'call back' })
      await t.next((s) => s.customers[1].notes === 'call back')        // written into the app's own record
      t.simulateEvent('.task-toggle[data-id="2"]', 'change')
      await t.next((s) => s.tasks[1].done)
      t.simulateEvent('.customer[data-node="customer:7"] .open', 'click')
      await t.next((s) => s.opened === 7)                                // the host hears the composed part

      // follow-up edit: the previous layout goes with the request; tasks move to the top, Northwind goes
      await ask('Put my tasks first and drop Northwind')
      const sent = name === 'llm' ? t.requests('LLM').at(-1).messages[0].content : JSON.stringify(t.requests('HTTP').at(-1).json.state)
      expect(sent).toContain(name === 'llm' ? '"part":"customer","params":{"id":9}' : 'current_page')
      await composeWith(t, catalog, [{ part: 'tasks' }, { part: 'customer', params: { id: 9 } }])
      await t.waitForState((s) => s.page.status === 'done' && s.page.composed === 'Put my tasks first and drop Northwind')
      expect(shape(t.state.page.layout)).toEqual(['tasks', 'customer:9'])
      expect(t.query('.customer .notes').value).toBe('call back')
      expect(t.state.tasks[1].done).toBe(true)
      t.expectNoDiagnostics()
    })
  })
}

describe('candidate A: decision-specific', () => {
  it('shows the preview after the select step, keeps the old layout on an error', async () => {
    t = renderComponent(makeApp(decisions({ model: 'nimble' })), { strict: true })
    await ask('orders and tickets')
    const select = t.requests('HTTP').at(-1).json.questions
    expect(Object.keys(select)).not.toContain('use_note')   // a part with a required free-text param is LLM-only
    await t.respond('HTTP', answers(select, { use_orders: 'use', use_tickets: 'use' }), 'compose')
    expect(t.state.page.status).toBe('preview')
    expect(shape(t.state.page.preview)).toEqual(['orders', 'tickets'])
    expect(t.query('.canvas').classList.contains('preview')).toBe(true)
    await t.fail('HTTP', 500, 'compose')
    expect(t.state.page.status).toBe('error')
    expect(t.state.page.layout).toBe(null)
  })

  it('says when nothing fits, and keeps what was on the page', async () => {
    t = renderComponent(makeApp(decisions({ model: 'nimble' })), { strict: true })
    await ask('weather')
    await composeWith(t, catalog, [{ part: 'weather' }])
    await t.waitForState((s) => s.page.status === 'done')
    await ask('the stock price of Apple')
    await composeWith(t, catalog, [])
    await t.waitForState((s) => s.page.status === 'unavailable')
    expect(shape(t.state.page.layout)).toEqual(['weather'])
  })
})

describe('candidate A: LLM-specific', () => {
  it('fills free-text params (schema-constrained), keeps a local-state part across recomposition', async () => {
    t = renderComponent(makeApp(llm()), { strict: true })
    await ask('A note called Call list, then the weather')
    const req = t.requests('LLM').at(-1)
    expect(req.output).toBeDefined()
    await composeWith(t, catalog, [{ part: 'note', params: { title: 'Call list' } }, { part: 'weather' }])
    await t.waitForState((s) => s.page.status === 'done')
    expect(t.query('.note h4').textContent).toBe('Call list')
    t.simulateEvent('.note-text', 'input', { value: 'Ann, Bob' })
    await t.next((s) => s.page.local.note?.text === 'Ann, Bob')
    await ask('Weather first')
    await composeWith(t, catalog, [{ part: 'weather' }, { part: 'note', params: { title: 'Call list' } }])
    await t.waitForState((s) => s.page.status === 'done' && s.page.composed === 'Weather first')
    expect(t.query('.note-text').value).toBe('Ann, Bob')
  })

  it('a reply that breaks the schema is an error (the old page stays)', async () => {
    t = renderComponent(makeApp(llm()), { strict: true })
    await ask('weather')
    await t.respond('LLM', JSON.stringify({ page: [{ part: 'stockTicker' }] }), 'compose')
    await t.waitForState((s) => s.page.status === 'error')
    expect(t.state.page.error).toMatch(/alternative|valid|expected/i)
  })

  it('streams: complete nodes show as a preview while the layout arrives', async () => {
    t = renderComponent(makeApp(llm()), { strict: true })
    await ask('tickets, orders, weather')
    const text = JSON.stringify({ page: [{ part: 'tickets' }, { part: 'orders' }, { part: 'weather' }] })
    const cut = text.indexOf('{"part":"weather"') + 5
    await t.stream('LLM', [text.slice(0, cut)], 'compose', { end: false })
    expect(t.state.page.status).toBe('preview')
    expect(shape(t.state.page.preview)).toEqual(['tickets', 'orders'])
    await t.stream('LLM', [text.slice(cut)], 'compose')
    await t.waitForState((s) => s.page.status === 'done')
    expect(shape(t.state.page.layout)).toEqual(['tickets', 'orders', 'weather'])
  })

  it('the schema is built from the catalog and the app state (record ids as an enum)', () => {
    const s = layoutSchema(catalog, { customers: [{ id: 7, name: 'N' }] })
    const customer = s.$defs.node.anyOf.find((v) => v.properties.part.const === 'customer')
    expect(customer.properties.params.properties.id.enum).toEqual([7])
  })
})

describe('candidate A: tabs, layout as state', () => {
  it('a tabs container keeps hidden tabs alive; the layout can be set (restore / undo) without a model', async () => {
    t = renderComponent(makeApp(llm()), { strict: true })
    await ask('tasks and feedback as tabs')
    await composeWith(t, catalog, [{ part: 'tabs', children: [{ part: 'tasks' }, { part: 'feedback' }] }])
    await t.waitForState((s) => s.page.status === 'done')
    expect(t.queryAll('[role="tabpanel"]')[1].hasAttribute('hidden')).toBe(true)
    t.simulateEvent('.feedback-draft', 'input', { value: 'dark mode' })   // in the hidden tab: alive
    await t.next((s) => s.feedback.draft === 'dark mode')
    t.simulateEvent('[role="tab"]:nth-child(2)', 'click')
    await t.next((s) => s.page.ui.tabs?.tab === 1)
    expect(t.queryAll('[role="tabpanel"]')[0].hasAttribute('hidden')).toBe(true)

    const saved = t.state.page.layout
    t.simulateAction('page.REMOVE', 'tabs')
    await t.next((s) => !s.page.layout.nodes.tabs)
    expect(t.html()).not.toContain('feedback-form')
    t.simulateAction('page.SET_LAYOUT', saved)
    await t.next((s) => !!s.page.layout.nodes.tabs)
    expect(t.query('.feedback-draft').value).toBe('dark mode')
  })

  it('a part keeps its instance when an edit moves it out of a container and reorders it', async () => {
    t = renderComponent(makeApp(llm()), { strict: true })
    await ask('tasks and feedback as tabs')
    await composeWith(t, catalog, [{ part: 'weather' }, { part: 'tabs', children: [{ part: 'tasks' }, { part: 'feedback' }] }])
    await t.waitForState((s) => s.page.status === 'done')
    const idOf = (name) => t.inspect().components.find((c) => c.name === name).id
    const before = { tasks: idOf('Checklist'), feedback: idOf('FeedbackForm') }
    await ask('feedback on top, then tasks and weather side by side')
    await composeWith(t, catalog, [{ part: 'feedback' }, { part: 'row', children: [{ part: 'tasks' }, { part: 'weather' }] }])
    await t.waitForState((s) => s.page.status === 'done' && s.page.composed.startsWith('feedback'))
    expect(shape(t.state.page.layout)).toEqual(['feedback', 'row(tasks,weather)'])
    expect({ tasks: idOf('Checklist'), feedback: idOf('FeedbackForm') }).toEqual(before)
  })
})
