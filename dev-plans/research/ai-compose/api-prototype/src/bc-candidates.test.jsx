import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import AppB from './app/AppB.jsx'
import AppC from './app/AppC.jsx'
import { catalog } from './app/catalog.jsx'
import { composeWith } from './lib/testing.js'

let t
afterEach(() => t?.dispose())

const keys = (layout) => layout.nodes.page.slots.default

async function ask(prompt, done) {
  t.simulateEvent('.prompt', 'input', { value: prompt })
  t.simulateEvent('.ask', 'submit')
  await t.next(done)
}

describe('candidate B: request builders + the app’s own model', () => {
  it('composes in two decide() steps, renders, hears parts, edits', async () => {
    t = renderComponent(AppB, { strict: true })
    await ask('Globex and the orders', (s) => s.page.status === 'composing')
    await composeWith(t, catalog, [{ part: 'customer', params: { id: 9 } }, { part: 'orders' }])
    await t.waitForState((s) => s.page.status === 'done')
    expect(keys(t.state.page.layout)).toEqual(['customer:9', 'orders'])
    t.simulateEvent('.customer .open', 'click')
    await t.next((s) => s.opened === 9)
    await ask('orders first', (s) => s.page.status === 'composing')
    expect(t.requests('HTTP').at(-1).json.state.current_page).toHaveLength(2)
    await composeWith(t, catalog, [{ part: 'orders' }, { part: 'customer', params: { id: 9 } }])
    await t.waitForState((s) => s.page.status === 'done' && keys(s.page.layout)[0] === 'orders')
    t.expectNoDiagnostics()
  })
})

describe('candidate C: a ready-made <Composed /> component', () => {
  it('composes on a command; parts are ITS children, so their PARENT values are relayed', async () => {
    t = renderComponent(AppC, { strict: true })
    await ask('Northwind', (s) => s.page.status === 'composing')
    await composeWith(t, catalog, [{ part: 'customer', params: { id: 7 } }, { part: 'tasks' }])
    await t.waitForState((s) => s.page.status === 'done')
    t.simulateEvent('.customer .open', 'click')
    await t.next((s) => s.opened === 7)
    t.simulateEvent('.task-toggle[data-id="1"]', 'change')
    await t.next((s) => s.tasks[0].done)             // the lens into the host's state still works
    const g = t.inspect()
    const composed = g.components.find((c) => c.name === 'Composed')
    expect(g.components.find((c) => c.name === 'CustomerCard').parentId).toBe(composed.id)
    t.expectNoDiagnostics()
  })
})
