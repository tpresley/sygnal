// PLAN-9 T-2: the per-backend matrix. The same app scenarios (test/p9-compose-app.js) run once with
// compose.decisions({ model: 'jev-latest' }) and once with compose.llm({ model: 'qwen3:8b' }), the
// real backends end to end: the behavior sends their requests, composeWith answers each step with
// the backend's own fake() (decide() answers / the model's JSON text), and the backend reads them.
// The preview goes through t.respond (decisions: the select step) or t.stream (llm: a partial
// reply). No network. The behavior's contract against minimal fakes: p9-compose-behavior.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { setupChecks } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.ts'
import { persist } from '../src/extra/persist.ts'
import { composeWith, compose } from '../src/extra/ai/index.ts'
import { makeApp, catalog } from './p9-compose-app.js'
import { shape } from './p9-compose-fakes.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null; try { localStorage.clear() } catch (_) {} })

async function ask(prompt) {
  t.simulateEvent('.prompt', 'input', { value: prompt })
  t.simulateEvent('.ask', 'submit')
  await t.next((s) => s.page.status === 'composing')
}
const done = () => t.waitForState((s) => s.page.status === 'done')

const MATRIX = {
  decisions: {
    make: () => compose.decisions({ model: 'jev-latest' }),
    /** answer the select step only: the preview shows, the layout step is out */
    async preview(b, tree) {
      await t.respond('HTTP', b.fake({ catalog, state: t.state, pending: t.state.page.pending, target: tree }), 'page.REPLY')
      return () => composeWith(t, catalog, tree)
    },
    /** a reply the backend can't read: no answers */
    bad: { nope: 1 },
    error: /no answers/,
  },
  llm: {
    make: () => compose.llm({ model: 'qwen3:8b' }),
    /** stream the reply up to the start of the last top-level node: the complete ones preview */
    async preview(b, tree) {
      const text = b.fake({ catalog, state: t.state, pending: t.state.page.pending, target: tree })
      const cut = text.lastIndexOf(`{"part":"${tree.at(-1).part}"`) + 5
      await t.stream('LLM', [text.slice(0, cut)], 'page.REPLY', { end: false })
      return () => t.stream('LLM', [text.slice(cut)], 'page.REPLY')
    },
    /** JSON the backend can't repair into a layout: only unknown parts (SYG683; text that isn't JSON
     * at all fails earlier, in the chat driver's structured output: FAILED) */
    bad: '{"children":[{"part":"stockTicker"}]}',
    error: /not a layout \(stockTicker\)/,
  },
}

for (const [name, M] of Object.entries(MATRIX)) {
  describe(`compose matrix: compose.${name}()`, () => {
    it('composes a row and a param from a form submit; real parts render; the host DONE entry runs', async () => {
      const b = M.make()
      t = renderComponent(makeApp(b), { strict: true })
      await ask('Revenue and churn side by side, then the revenue chart for the quarter')
      expect(t.requests(b.sink).at(-1)).toMatchObject({ key: 'compose', latest: true, ok: 'page.REPLY', error: 'page.FAILED', ...(name === 'decisions' ? { json: { model: 'jev-latest' } } : { model: 'qwen3:8b', delta: 'page.DELTA' }) })
      await composeWith(t, catalog, [
        { part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] },
        { part: 'revenueChart', params: { range: 'quarter' } },
      ])
      await done()
      expect(shape(t.state.page.layout)).toEqual(['row(revenue,churn)', 'revenueChart'])
      expect(t.state.page.layout.nodes.revenueChart.params).toEqual({ range: 'quarter' })
      expect(t.state.page).toMatchObject({ pending: null, preview: null, error: null })
      expect(t.state.page.decisions).toBeTruthy()
      expect(t.html()).toContain('$48.2k')
      expect(t.query('.chart').getAttribute('data-range')).toBe('quarter')
      expect(t.query('.compose-row')).toBeTruthy()
      expect(t.state.doneCount).toBe(1)
      t.expectNoDiagnostics()
    })

    it('a preview shows while composing, then the finished layout', async () => {
      const b = M.make()
      t = renderComponent(makeApp(b), { strict: true })
      await ask('the orders, then the tickets')
      const tree = [{ part: 'orders' }, { part: 'tickets' }]
      const rest = await M.preview(b, tree)
      await t.waitForState((s) => s.page.status === 'preview')
      expect(shape(t.state.page.preview)).toContain('orders')
      expect(t.state.page.layout).toBe(null)
      expect(t.query('.canvas').classList.contains('preview')).toBe(true)
      expect(t.query('.orders')).toBeTruthy()
      await rest()
      await done()
      expect(shape(t.state.page.layout)).toEqual(['orders', 'tickets'])
      expect(t.state.page.preview).toBe(null)
      expect(t.query('.canvas').classList.contains('preview')).toBe(false)
      t.expectNoDiagnostics()
    })

    it('nothing fits: unavailable, the layout kept, no DONE', async () => {
      t = renderComponent(makeApp(M.make()), { strict: true })
      await ask('the weather')
      await composeWith(t, catalog, [{ part: 'weather' }])
      await done()
      await ask('the stock price of Apple')
      await composeWith(t, catalog, [])
      await t.waitForState((s) => s.page.status === 'unavailable')
      expect(shape(t.state.page.layout)).toEqual(['weather'])
      expect(t.state.page.pending).toBe(null)
      expect(t.state.doneCount).toBe(1)
      expect(t.query('.weather')).toBeTruthy()
    })

    it('an error keeps the layout: a failed request, and a reply the backend rejects', async () => {
      const b = M.make()
      t = renderComponent(makeApp(b), { strict: true })
      await ask('the weather')
      await composeWith(t, catalog, [{ part: 'weather' }])
      await done()
      await ask('the tickets')
      await t.fail(b.sink, 500, 'page.FAILED')
      await t.waitForState((s) => s.page.status === 'error')
      expect(t.state.page.error).toMatch(/500/)
      expect(t.state.page).toMatchObject({ pending: null, preview: null })
      expect(shape(t.state.page.layout)).toEqual(['weather'])
      await ask('the orders')
      await t.respond(b.sink, M.bad, 'page.REPLY')
      await t.waitForState((s) => s.page.status === 'error')
      expect(t.state.page.error).toMatch(M.error)
      expect(t.state.page.pending).toBe(null)
      expect(shape(t.state.page.layout)).toEqual(['weather'])
      expect(t.query('.weather')).toBeTruthy()
    })

    it('record lenses write app state, CHILD.select hears a composed part, a follow-up keeps keys and instances', async () => {
      t = renderComponent(makeApp(M.make()), { strict: true })
      await ask('Northwind and Globex, and my tasks')
      await composeWith(t, catalog, [{ part: 'customer', params: { id: 7 } }, { part: 'customer', params: { id: 9 } }, { part: 'tasks' }])
      await done()
      expect(shape(t.state.page.layout)).toEqual(['customer:7', 'customer:9', 'tasks'])
      t.simulateEvent('.customer[data-node="customer:9"] .notes', 'input', { value: 'call back' })
      await t.next((s) => s.customers[1].notes === 'call back')
      t.simulateEvent('.task-toggle[data-id="2"]', 'change')
      await t.next((s) => s.tasks[1].done)
      t.simulateEvent('.customer[data-node="customer:7"] .open', 'click')
      await t.next((s) => s.opened === 7)
      const ids = () => t.inspect().components.filter((c) => c.name === 'CustomerCard').map((c) => c.id)
      const before = ids()

      await ask('My tasks first, then Globex')
      await composeWith(t, catalog, [{ part: 'tasks' }, { part: 'customer', params: { id: 9 } }])
      await t.waitForState((s) => s.page.status === 'done' && !s.page.layout.nodes['customer:7'])
      expect(shape(t.state.page.layout)).toEqual(['tasks', 'customer:9'])
      expect(t.query('.customer .notes').value).toBe('call back')
      expect(ids()).toEqual([before[1]])
      expect(t.state.tasks[1].done).toBe(true)
      t.expectNoDiagnostics()
    })

    it("a local part's state survives a recomposition", async () => {
      t = renderComponent(makeApp(M.make()), { strict: true })
      // a required free-text title: the app places the note (a decision model can't write text)
      t.simulateAction('page.SET_LAYOUT', { root: 'page', nodes: { page: { part: 'page', slots: { default: ['note', 'weather'] } }, note: { part: 'note', params: { title: 'Calls' } }, weather: { part: 'weather' } } })
      await t.next((s) => s.page.status === 'done')
      t.simulateEvent('.note-text', 'input', { value: 'Ann, Bob' })
      await t.next((s) => s.page.local.note?.text === 'Ann, Bob')
      await ask('The weather first, then the tickets')
      await composeWith(t, catalog, [{ part: 'weather' }, { part: 'tickets' }])
      await done()
      expect(shape(t.state.page.layout)).toEqual(['weather', 'tickets'])
      expect(t.state.page.local.note).toEqual({ text: 'Ann, Bob' })
      t.expectNoDiagnostics()
    })

    it('a persisted layout is restored without a model call', async () => {
      const b = M.make()
      const App = makeApp(b, { persist: persist({ key: 'p9-matrix', pick: ['page', 'customers'] }) })
      const saved = { page: { prompt: 'Globex', status: 'done', layout: { root: 'page', nodes: { page: { part: 'page', slots: { default: ['customer:9', 'note'] } }, 'customer:9': { part: 'customer', params: { id: 9 } }, note: { part: 'note', params: { title: 'Hi' } } } }, preview: null, pending: null, decisions: null, error: null, ui: {}, local: { note: { text: 'kept' } } } }
      t = renderComponent(App, { strict: true, storage: { 'p9-matrix': JSON.stringify({ v: 1, state: saved }) } })
      await t.ready?.()
      expect(t.state.page.status).toBe('done')
      expect(t.query('.customer h3').textContent).toBe('Globex')
      expect(t.query('.note-text').value).toBe('kept')
      await t.settle()
      expect(t.requests(b.sink)).toEqual([])
    })

    it('COMPOSE takes a string, { prompt, fresh }, or the form submit', async () => {
      const b = M.make()
      t = renderComponent(makeApp(b), { strict: true })
      t.simulateAction('page.COMPOSE', 'the weather')
      await t.next((s) => s.page.status === 'composing')
      expect(t.state.page.prompt).toBe('the weather')
      await composeWith(t, catalog, [{ part: 'weather' }])
      await done()
      const layout = t.state.page.layout
      // a string: an edit of the current layout (the backend gets it as `previous`)
      t.simulateAction('page.COMPOSE', 'the weather and the tickets')
      await t.next((s) => s.page.status === 'composing')
      expect(t.state.page.pending.previous).toEqual(layout)
      await composeWith(t, catalog, [{ part: 'weather' }, { part: 'tickets' }])
      await done()
      // { prompt, fresh }: no previous layout
      t.simulateAction('page.COMPOSE', { prompt: 'the orders', fresh: true })
      await t.next((s) => s.page.status === 'composing')
      expect(t.state.page.prompt).toBe('the orders')
      expect(t.state.page.pending.previous).toBeUndefined()
      await composeWith(t, catalog, [{ part: 'orders' }])
      await done()
      expect(shape(t.state.page.layout)).toEqual(['orders'])
      // the form: the typed prompt
      await ask('the tickets')
      expect(t.state.page.prompt).toBe('the tickets')
      await composeWith(t, catalog, [{ part: 'tickets' }])
      await done()
      expect(shape(t.state.page.layout)).toEqual(['tickets'])
      expect(t.requests(b.sink).length).toBeGreaterThanOrEqual(4)
      expect(t.state.doneCount).toBe(4)
    })
  })
}
