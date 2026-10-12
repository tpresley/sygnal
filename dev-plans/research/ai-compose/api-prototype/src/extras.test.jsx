import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, persist } from 'sygnal'
import { jsonSchema } from 'sygnal/ai'
import { makeApp } from './app/AppA.jsx'
import { catalog } from './app/catalog.jsx'
import { llm, decisions } from './lib/backends.js'
import { composeWith } from './lib/testing.js'

let t
afterEach(() => t?.dispose())

describe('candidate A extras', () => {
  it('the layout persists like any state (persist pick) and renders on start without a model call', async () => {
    const App = makeApp(llm())
    App.persist = persist({ key: 'ws', pick: ['page'] })
    const layout = catalog.fromTree([{ part: 'tasks' }, { part: 'row', children: [{ part: 'weather' }, { part: 'orders' }] }])
    t = renderComponent(App, { storage: { ws: { version: 1, state: { page: { prompt: '', status: 'done', layout, preview: null, pending: null, decisions: [], error: null, ui: {}, local: {}, composed: 'x' } } } } })
    await t.ready()
    expect(t.html()).toContain('checklist')
    expect(t.requests('LLM')).toHaveLength(0)
  })

  it('an agent can compose: page.COMPOSE as an agent action (host agent static)', async () => {
    const App = makeApp(decisions({ model: 'nimble' }))
    App.agent = {
      name: 'workspace', description: 'The composed workspace',
      read: (s) => ({ layout: s.page.layout && catalog.toTree(s.page.layout) }),
      actions: { 'page.COMPOSE': { description: 'Rebuild the page from prepared parts for a request', input: jsonSchema({ type: 'string' }) } },
    }
    t = renderComponent(App)
    await t.ready()
    const tools = t.tools().map((x) => x.name)
    const name = tools.find((n) => /compose/i.test(n))
    expect(name).toBe('workspace_page_compose')
    const r = await t.callTool(name, { value: 'my tasks' })
    expect(r.ok).toBe(true)
    await composeWith(t, catalog, [{ part: 'tasks' }])
    await t.waitForState((s) => s.page.status === 'done')
    expect(t.html()).toContain('checklist')
  })
})
