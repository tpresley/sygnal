import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { answers } from 'sygnal/ai'
import App from './App.jsx'
import { PARTS } from './parts.js'
import { selectQuestions, layoutQuestions } from './compose.js'

// GET /api/tags: a chat model and a decision model
const TAGS = {
  models: [
    { name: 'qwen3:8b', capabilities: ['completion', 'tools'] },
    { name: 'nimble:latest', capabilities: ['decision'] },
  ],
}
const SELECT = selectQuestions(PARTS)
const use = (...ids) => Object.fromEntries(PARTS.map((p) => [`use_${p.id}`, ids.includes(p.id) ? 'use' : 'omit']))
// the cards on the canvas, top to bottom ('row(a,b)' for a row)
const canvas = (state) => state.blocks.map((b) => (b.row ? `row(${b.row})` : b.id))

let t
afterEach(() => t?.dispose())

async function ready() {
  t = renderComponent(App, { strict: true })
  await t.respond('HTTP', TAGS, 'models')
  await t.waitForState((s) => s.model === 'nimble:latest')
}

async function compose(prompt) {
  t.simulateEvent('.prompt', 'input', { value: prompt })
  t.simulateEvent('.prompt-form', 'submit')
  await t.next((s) => s.phase === 'selecting')
}

describe('App', () => {
  it('lists only the decision models', async () => {
    await ready()
    expect(t.html()).toContain('<option value="nimble:latest"')
    expect(t.html()).not.toContain('qwen3')
    t.expectNoDiagnostics()
  })

  it('selects, previews, then arranges the parts', async () => {
    await ready()
    await compose('Sales: revenue and churn side by side, then the chart')
    const [select] = t.requests('HTTP').filter((r) => r.key === 'compose')
    expect(select.json).toMatchObject({ model: 'nimble:latest', state: { user_request: 'Sales: revenue and churn side by side, then the chart' } })

    await t.respond('HTTP', answers(SELECT, { ...use('revenue', 'churn', 'revenueChart'), row: 0.97 }), 'compose')
    await t.waitForState((s) => s.phase === 'arranging')
    expect(canvas(t.state)).toEqual(['revenue', 'churn', 'revenueChart'])   // the preview, catalog order
    expect(t.html()).toContain('nimble:latest is arranging 3 parts')

    const layout = layoutQuestions(PARTS, { ids: ['revenue', 'churn', 'revenueChart'], row: true })
    expect(t.requests('HTTP').at(-1).json.questions).toEqual(layout)
    await t.respond('HTTP', answers(layout, {
      place_revenue: 'row', place_churn: 'row', place_revenueChart: 'page',
      above_revenue__churn: 'revenue', above_revenue__revenueChart: 'revenue', above_churn__revenueChart: 'churn',
    }), 'compose')
    await t.waitForState((s) => s.phase === 'done')
    expect(canvas(t.state)).toEqual(['row(revenue,churn)', 'revenueChart'])
    expect(t.html()).toContain('Composed by nimble:latest in 2 decisions')
    expect(t.html()).toContain('$48.2k')
    t.expectNoDiagnostics()
  })

  it('needs no layout step for one part, and says when nothing fits', async () => {
    await ready()
    t.simulateEvent('.example', 'click')
    await t.next((s) => s.phase === 'selecting')
    await t.respond('HTTP', answers(SELECT, use('tasks')), 'compose')
    await t.waitForState((s) => s.phase === 'done')
    expect(canvas(t.state)).toEqual(['tasks'])
    expect(t.requests('HTTP').filter((r) => r.key === 'compose')).toHaveLength(1)

    await compose('The stock price of Apple')
    await t.respond('HTTP', answers(SELECT, use()), 'compose')
    await t.waitForState((s) => s.phase === 'unavailable')
    expect(t.html()).toContain('Nothing in the catalog fits that request.')
    t.expectNoDiagnostics()
  })

  it('composes real parts: ticks and drafts survive recomposing', async () => {
    await ready()
    await compose('My tasks')
    await t.respond('HTTP', answers(SELECT, use('tasks', 'feedback')), 'compose')
    await t.respond('HTTP', answers(layoutQuestions(PARTS, { ids: ['tasks', 'feedback'], row: false }), { above_tasks__feedback: 'feedback' }), 'compose')
    await t.waitForState((s) => s.phase === 'done')
    expect(canvas(t.state)).toEqual(['feedback', 'tasks'])

    t.simulateEvent('.task-toggle[data-id="1"]', 'change')
    await t.next((s) => s.tasks[0].done)
    t.simulateEvent('.feedback-draft', 'input', { value: 'More dark mode' })
    await t.next((s) => s.feedback.draft === 'More dark mode')

    await compose('Just my tasks')
    await t.respond('HTTP', answers(SELECT, use('tasks')), 'compose')
    await t.waitForState((s) => s.phase === 'done' && s.composing === 'Just my tasks')
    expect(t.state.tasks[0].done).toBe(true)
    expect(t.state.feedback.draft).toBe('More dark mode')
    t.expectNoDiagnostics()
  })

  it('shows the error and keeps the preview when a step fails', async () => {
    await ready()
    await compose('Tickets and orders')
    await t.respond('HTTP', answers(SELECT, use('orders', 'tickets')), 'compose')
    await t.waitForState((s) => s.phase === 'arranging')
    await t.fail('HTTP', 500, 'compose')
    await t.waitForState((s) => s.phase === 'error')
    expect(canvas(t.state)).toEqual(['orders', 'tickets'])
    expect(t.html()).toContain('The decision model failed')
  })
})
