// The app on both backends, without a model: composeWith answers each step with the backend's own
// fake reply (decide() answers for a decision model, the JSON text for a chat model), and the
// backend reads it as it would a real one.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith } from 'sygnal/ai'
import App from './App.jsx'
import { catalog } from './catalog.js'
import { decisionsBackend, llmBackend } from './backends.js'

// GET /api/tags: a decision model, two chat models and an embedding model
const TAGS = {
  models: [
    { name: 'qwen3:8b', capabilities: ['completion', 'tools', 'thinking'] },
    { name: 'nimble:latest', capabilities: ['decision'] },
    { name: 'llama3.2:latest', capabilities: ['completion', 'tools'] },
    { name: 'nomic-embed-text:latest', capabilities: ['embedding'] },
  ],
}

/** the composed page, top to bottom ('row(a,b)' for a row; params as part[name=value]) */
function shape(layout) {
  const nodes = layout?.nodes || {}
  const one = (key) => {
    const n = nodes[key]
    if (n.slots) return `${n.part}(${Object.values(n.slots).flat().map(one).join(',')})`
    const params = Object.entries(n.params || {}).map(([k, v]) => `${k}=${v}`).join(',')
    return params ? `${n.part}[${params}]` : n.part
  }
  return (nodes.page?.slots?.default || []).map(one)
}

let t
afterEach(() => { t?.dispose(); t = null })

async function start({ jev = false, pick } = {}) {
  t = renderComponent(App, { strict: true })
  await t.respond('HTTP', TAGS, 'models')
  if (jev) await t.respond('HTTP', { available: true }, 'jev')
  else await t.fail('HTTP', 404, 'jev')
  await t.waitForState((s) => s.backend?.id === 'nimble:latest')
  if (pick) {
    t.simulateEvent('.backend', 'change', { value: pick })
    await t.waitForState((s) => s.backend.id === pick)
  }
}

async function ask(prompt) {
  t.simulateEvent('.prompt', 'input', { value: prompt })
  t.simulateEvent('.prompt-form', 'submit')
  await t.next((s) => s.page.status === 'composing')
}

const done = (prompt) => t.waitForState((s) => s.page.status === 'done' && (!prompt || s.page.prompt === prompt))

describe('the model picker', () => {
  it('offers the decision models and the chat models from /api/tags, nimble first', async () => {
    await start()
    const html = t.html()
    expect(html).toContain('<optgroup label="Decision models"><option value="nimble:latest" selected')
    expect(html).toContain('<optgroup label="Chat models (LLM)"><option value="qwen3:8b"')
    expect(html).toContain('llama3.2:latest')
    expect(html).not.toContain('nomic-embed')
    expect(html).not.toContain('Jev')
    expect(t.state.backend).toMatchObject({ kind: 'decisions', model: 'nimble:latest', url: 'http://localhost:11434/v1/systemone' })
    t.expectNoDiagnostics()
  })

  it('offers Jev only when the dev proxy has a key; it composes through /api/decide', async () => {
    await start({ jev: true, pick: 'jev' })
    expect(t.html()).toContain('<option value="jev"')
    expect(t.state.backend).toMatchObject({ kind: 'decisions', model: 'jev-latest', url: '/api/decide' })
    await ask('The weather')
    const request = t.requests('HTTP').at(-1)
    expect(request).toMatchObject({ url: '/api/decide', key: 'compose', json: { model: 'jev-latest' } })
    expect(JSON.stringify(request)).not.toMatch(/authorization|bearer/i)
    await composeWith(t, catalog, [{ part: 'weather' }])
    await done()
    expect(t.html()).toContain('Composed by Jev (TypeSafe).')
  })

  it('picks the local decision model first, whichever reply comes first', async () => {
    t = renderComponent(App, { strict: true })
    await t.respond('HTTP', { available: true }, 'jev')
    await t.settle()
    expect(t.state.backend).toBe(null)
    await t.respond('HTTP', TAGS, 'models')
    await t.waitForState((s) => s.backend?.id === 'nimble:latest')
    t.dispose()

    // no Ollama: Jev, when the proxy has a key
    t = renderComponent(App, { strict: true })
    await t.fail('HTTP', 0, 'models')
    await t.respond('HTTP', { available: true }, 'jev')
    await t.waitForState((s) => s.backend?.id === 'jev')
    t.dispose()

    // neither: say so
    t = renderComponent(App, { strict: true })
    await t.fail('HTTP', 0, 'models')
    await t.fail('HTTP', 404, 'jev')
    await t.settle()
    expect(t.html()).toContain("Can't reach Ollama at http://localhost:11434. Is it running?")
    expect(t.query('.compose').disabled).toBe(true)
  })

  it('switching kind keeps the page, the ticks and the draft', async () => {
    await start()
    await ask('My tasks and the feedback form')
    await composeWith(t, catalog, [{ part: 'tasks' }, { part: 'feedback' }])
    await done()
    t.simulateEvent('.task-toggle[data-id="1"]', 'change')
    await t.next((s) => s.tasks[0].done)
    t.simulateEvent('.feedback-draft', 'input', { value: 'More dark mode' })
    await t.next((s) => s.feedback.draft === 'More dark mode')

    t.simulateEvent('.backend', 'change', { value: 'qwen3:8b' })
    await t.waitForState((s) => s.backend.kind === 'llm')
    expect(shape(t.state.page.layout)).toEqual(['tasks', 'feedback'])
    expect(t.query('.task-toggle[data-id="1"]').checked).toBe(true)
    expect(t.query('.feedback-draft').value).toBe('More dark mode')
    await ask('Just my tasks')
    expect(t.requests('LLM').at(-1)).toMatchObject({ model: 'qwen3:8b', key: 'compose', ok: 'page.REPLY' })
    await composeWith(t, catalog, [{ part: 'tasks' }])
    await done('Just my tasks')
    expect(t.state.tasks[0].done).toBe(true)
    expect(t.state.feedback.draft).toBe('More dark mode')
    t.expectNoDiagnostics()
  })
})

const MATRIX = {
  decisions: {
    pick: undefined,
    backend: decisionsBackend,
    request: { url: 'http://localhost:11434/v1/systemone', json: { model: 'nimble:latest' } },
    /** answer the select step: the chosen parts preview while the layout step is out; then the rest */
    async preview(tree) {
      await t.respond('HTTP', decisionsBackend.fake({ catalog, state: t.state, pending: t.state.page.pending, target: tree }), 'page.REPLY')
      return () => composeWith(t, catalog, tree)
    },
    panel: ['1 · Which parts?', '2 · In what order?', 'Side by side?', 'Revenue chart · time range: <b>quarter</b>'],
  },
  llm: {
    pick: 'qwen3:8b',
    backend: llmBackend,
    request: { model: 'qwen3:8b', delta: 'page.DELTA' },
    /** stream the reply into the last part: the complete ones preview; then the rest */
    async preview(tree) {
      const text = llmBackend.fake({ catalog, state: t.state, pending: t.state.page.pending, target: tree })
      const cut = text.lastIndexOf(`{"part":"${tree.at(-1).part}"`) + 5
      await t.stream('LLM', [text.slice(0, cut)], 'page.REPLY', { end: false })
      return () => t.stream('LLM', [text.slice(cut)], 'page.REPLY')
    },
    panel: ["The model's plan"],
  },
}

for (const [kind, M] of Object.entries(MATRIX)) {
  describe(`composing with compose.${kind}()`, () => {
    it('composes a row and a param; the decision panel explains it', async () => {
      await start({ pick: M.pick })
      await ask('Sales: revenue and churn side by side, then the revenue chart for the quarter')
      expect(t.requests(M.backend.sink).at(-1)).toMatchObject({ key: 'compose', latest: true, ...M.request })
      expect(t.html()).toContain('is composing…')
      await composeWith(t, catalog, [
        { part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] },
        { part: 'revenueChart', params: { range: 'quarter' } },
      ])
      await done()
      expect(shape(t.state.page.layout)).toEqual(['row(revenue,churn)', 'revenueChart[range=quarter]'])
      expect(t.query('.compose-row .part-revenue')).toBeTruthy()
      expect(t.html()).toContain('$48.2k')
      expect(t.html()).toContain('Revenue, last 3 months')
      expect(t.query('.chart').getAttribute('data-range')).toBe('quarter')
      expect(t.html()).toContain(`Composed by ${M.pick ?? 'nimble:latest'}.`)
      for (const text of M.panel) expect(t.html()).toContain(text)
      t.expectNoDiagnostics()
    })

    it('previews while composing, then shows the finished page', async () => {
      await start({ pick: M.pick })
      await ask('Pending orders, then urgent tickets')
      const tree = [{ part: 'orders', params: { status: 'pending' } }, { part: 'tickets', params: { priority: 'high' } }]
      const rest = await M.preview(tree)
      await t.waitForState((s) => s.page.status === 'preview')
      expect(t.query('.canvas').classList.contains('preview')).toBe(true)
      expect(t.query('.part-orders')).toBeTruthy()
      await rest()
      await done()
      expect(shape(t.state.page.layout)).toEqual(['orders[status=pending]', 'tickets[priority=high]'])
      expect(t.query('.canvas').classList.contains('preview')).toBe(false)
      expect(t.queryAll('.orders tbody tr')).toHaveLength(2)
      expect(t.html()).toContain('Urgent tickets')
      t.expectNoDiagnostics()
    })

    it('says when nothing fits, and keeps the page', async () => {
      await start({ pick: M.pick })
      await ask('The weather')
      await composeWith(t, catalog, [{ part: 'weather' }])
      await done()
      await ask('Show me the stock price of Apple')
      await composeWith(t, catalog, [])
      await t.waitForState((s) => s.page.status === 'unavailable')
      expect(t.html()).toContain('Nothing in the catalog fits that request.')
      expect(t.query('.part-weather')).toBeTruthy()
    })

    it('shows an error and keeps the page', async () => {
      await start({ pick: M.pick })
      await ask('The weather')
      await composeWith(t, catalog, [{ part: 'weather' }])
      await done()
      await ask('The tickets')
      await t.fail(M.backend.sink, 500, 'page.FAILED')
      await t.waitForState((s) => s.page.status === 'error')
      expect(t.html()).toContain('The model failed:')
      expect(shape(t.state.page.layout)).toEqual(['weather'])
      expect(t.query('.part-weather')).toBeTruthy()
    })

    it('ticks and drafts survive recomposing; a part the follow-up keeps keeps its instance', async () => {
      await start({ pick: M.pick })
      await ask('My tasks and a feedback form')
      await composeWith(t, catalog, [{ part: 'tasks' }, { part: 'feedback' }])
      await done()
      t.simulateEvent('.task-toggle[data-id="1"]', 'change')
      await t.next((s) => s.tasks[0].done)
      t.simulateEvent('.feedback-draft', 'input', { value: 'More dark mode' })
      await t.next((s) => s.feedback.draft === 'More dark mode')
      const ids = () => t.inspect().components.filter((c) => c.name === 'Checklist').map((c) => c.id)
      const before = ids()

      await ask('The feedback form at the top, then my tasks and the weather')
      await composeWith(t, catalog, [{ part: 'feedback' }, { part: 'tasks' }, { part: 'weather' }])
      await done('The feedback form at the top, then my tasks and the weather')
      expect(shape(t.state.page.layout)).toEqual(['feedback', 'tasks', 'weather'])
      expect(ids()).toEqual(before)
      expect(t.query('.task-toggle[data-id="1"]').checked).toBe(true)
      expect(t.query('.feedback-draft').value).toBe('More dark mode')

      await ask('Just the weather')
      await composeWith(t, catalog, [{ part: 'weather' }])
      await done('Just the weather')
      await ask('My tasks and a feedback form')
      await composeWith(t, catalog, [{ part: 'tasks' }, { part: 'feedback' }])
      await done('My tasks and a feedback form')
      expect(t.state.tasks[0].done).toBe(true)
      expect(t.query('.feedback-draft').value).toBe('More dark mode')
      t.expectNoDiagnostics()
    })

    it('an example chip composes its prompt (page.COMPOSE)', async () => {
      await start({ pick: M.pick })
      t.simulateEvent('.example', 'click')
      await t.waitForState((s) => s.page.status === 'composing')
      expect(t.state.page.prompt).toMatch(/^Sales overview/)
      expect(t.query('.prompt').value).toMatch(/^Sales overview/)
      expect(t.query('.compose').disabled).toBe(true)
    })
  })
}
