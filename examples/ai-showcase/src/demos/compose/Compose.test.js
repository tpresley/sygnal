// The widget on both backends, without a model: composeWith answers each step with the backend's
// own fake reply (decide() answers for a decision model, the layout JSON for a chat model).
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith, toTree } from 'sygnal/ai'
import Compose from './Compose.jsx'
import { catalog } from './catalog.js'
import { PROVIDERS, OLLAMA_ONLY } from '../../shared/fixtures.js'

let t
afterEach(() => { t?.dispose(); t = null })

async function start({ providers = PROVIDERS, model } = {}) {
  t = renderComponent(Compose)
  await t.respond('HTTP', providers)
  if (model) {
    t.simulateEvent('.model-pick', 'change', { value: model })
    await t.waitForState((s) => s.model === model)
  }
  await t.settle()
}

const example = async (prefix) => {
  t.simulateEvent('.example.fresh', 'click', { dataset: { prompt: t.queryAll('.example.fresh').map((b) => b.getAttribute('data-prompt')).find((p) => p.startsWith(prefix)) } })
  await t.waitForState((s) => s.page.status === 'composing')
}
const done = () => t.waitForState((s) => s.page.status === 'done')
const tree = () => toTree(t.state.page.layout)

it('offers decision and chat models in one picker: Jev first when it has a key, else nimble', async () => {
  await start()
  expect(t.html()).toContain('<optgroup label="Decision models · TypeSafe (via the dev proxy)"><option value="typesafe::jev-latest" selected')
  expect(t.html()).toContain('<optgroup label="Chat models · Ollama (local)"><option value="ollama::qwen3:8b"')
  expect(t.html()).toContain('Decision model · from probabilities')
  t.dispose()
  await start({ providers: OLLAMA_ONLY })
  expect(t.html()).toContain('<option value="ollama::nimble:latest" selected')
})

describe.each([
  ['compose.decisions() with Jev', undefined, { url: '/api/decide', json: { model: 'jev-latest' } }, 'HTTP', 'Which parts?'],
  ['compose.llm() with qwen3', 'ollama::qwen3:8b', { model: 'ollama::qwen3:8b', delta: 'page.DELTA' }, 'LLM', 'Its plan'],
])('%s', (name, model, request, sink, panel) => {
  it('composes a row and a param from an example; the panel explains it', async () => {
    await start({ model })
    await example('Active users')
    expect(t.requests(sink).at(-1)).toMatchObject({ key: 'compose', ...request })
    expect(t.query('.canvas').getAttribute('class')).toContain('busy')
    await composeWith(t, catalog, [
      { part: 'row', children: [{ part: 'activeUsers' }, { part: 'revenue' }, { part: 'conversion' }] },
      { part: 'traffic', params: { range: 'quarter' } },
    ])
    await done()
    expect(t.queryAll('.compose-row .ca-card')).toHaveLength(3)
    expect(t.query('.ca-area').getAttribute('data-range')).toBe('quarter')
    expect(t.html()).toContain('last 3 months')
    expect(t.query('.status-line').textContent).toMatch(/^Composed by (Jev|qwen3:8b)/)
    expect(t.query('.how-decided').textContent).toContain(panel)
  })

  it('a follow-up edits the page: the checklist keeps its instance and its ticks', async () => {
    await start({ model })
    await example('On call')
    await composeWith(t, catalog, [{ part: 'incidents', params: { severity: 'critical' } }, { part: 'releases' }, { part: 'launch' }])
    await done()
    t.simulateEvent('.ca-toggle[data-id="2"]', 'change')
    await t.waitForState((s) => s.launch[1].done)
    const ids = () => t.inspect().components.filter((c) => c.name === 'LaunchChecklist').map((c) => c.id)
    const before = ids()

    t.simulateEvent('.follow-up', 'click', { dataset: { prompt: 'Remove the release notes' } })
    await t.waitForState((s) => s.page.status === 'composing')
    await composeWith(t, catalog, [{ part: 'incidents', params: { severity: 'critical' } }, { part: 'launch' }])
    await t.waitForState((s) => s.page.status === 'done' && s.page.prompt === 'Remove the release notes')
    expect(tree().map((n) => n.part)).toEqual(['incidents', 'launch'])
    expect(ids()).toEqual(before)
    expect(t.query('.ca-toggle[data-id="2"]').checked).toBe(true)
    expect(t.html()).toContain('Launch checklist 2/4')
  })
})

it('keeps the page when nothing fits, and when switching to a chat model; the next edit goes to the LLM', async () => {
  await start()
  await example('Growth review')
  await composeWith(t, catalog, [{ part: 'countries' }, { part: 'pages' }, { part: 'funnel' }])
  await done()
  await example("What's the weather")
  await composeWith(t, catalog, [])
  await t.waitForState((s) => s.page.status === 'unavailable')
  expect(t.query('.status-line').textContent).toContain('Nothing in the catalog fits')
  expect(t.queryAll('.ca-card')).toHaveLength(3)

  t.simulateEvent('.model-pick', 'change', { value: 'ollama::qwen3:8b' })
  await t.waitForState((s) => s.model === 'ollama::qwen3:8b')
  expect(t.queryAll('.ca-card')).toHaveLength(3)
  t.simulateEvent('.follow-up', 'click', { dataset: { prompt: 'Show all ten pages' } })
  await t.waitForState((s) => s.page.status === 'composing')
  expect(t.requests('LLM').at(-1)).toMatchObject({ model: 'ollama::qwen3:8b', key: 'compose' })
  await composeWith(t, catalog, [{ part: 'countries' }, { part: 'pages', params: { limit: 10 } }, { part: 'funnel' }])
  await done()
  expect(t.queryAll('.ca-table tbody tr')).toHaveLength(10)
  t.expectNoDiagnostics()
})
