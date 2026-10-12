// @vitest-environment jsdom
// PLAN-9: the compose behavior's CONTROL intent selects `[data-compose-control]` only when the
// catalog has a container with its own render (the built-in page / row / slots views render no
// controls). Before, every app selected it, and in a real DOM in dev a catalog without such a
// container got SYG103 (an intent selector that never matches). Catalogs with one keep CONTROL
// (tabs: a click on a tab sets ui); there SYG103 (info) can still show before a container with
// controls is rendered, as for any element the view source doesn't name. Real DOM: the mock DOM
// doesn't report SYG103.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { setupChecks, settle } from './diagnostics/helpers.js'
import { getDiagnostics } from '../src/extra/diagnostics/index.ts'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { composeWith, compose, defineCatalog } from '../src/extra/ai/index.ts'
import { makeApp, catalog, Kpi } from './p9-compose-app.js'
import { fakeDecisions } from './p9-compose-fakes.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null })

const plain = defineCatalog({
  parts: {
    revenue: { component: Kpi, props: { metric: 'revenue' }, description: 'Revenue (KPI card)' },
    churn: { component: Kpi, props: { metric: 'churn' }, description: 'Churn (KPI card)' },
  },
})
function Plain({ state }) {
  return h('div', { className: 'app' },
    h('form', { className: 'ask' }, h('input', { className: 'prompt', value: state.page.prompt }), h('button', { type: 'submit' }, 'Compose')),
    h('main', null, plain.render(state.page, state)))
}
Plain.uses = { page: compose(plain, { backend: fakeDecisions(), form: '.ask', prompt: '.prompt' }) }

const ask = async (prompt) => {
  t.simulateEvent('.prompt', 'input', { value: prompt })
  t.simulateEvent('.ask', 'submit')
  await t.next((s) => s.page.status === 'composing')
}

describe('compose: CONTROL only for catalogs with their own containers', () => {
  it('a catalog without one: no SYG103 in a real DOM (strict, the dev checks), before and after a composition', async () => {
    t = renderComponent(Plain, { strict: true, dom: 'real' })
    await t.ready()
    await settle(150)
    await ask('revenue and churn side by side')
    await composeWith(t, plain, [{ part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] }])
    await t.waitForState((s) => s.page.status === 'done')
    expect(t.query('.compose-row')).toBeTruthy()
    await settle(150)
    expect(getDiagnostics()).toEqual([])
    t.expectNoDiagnostics()
  })

  it('a catalog with one (tabs): a click on a tab sets ui in a real DOM', async () => {
    t = renderComponent(makeApp(fakeDecisions()), { strict: true, dom: 'real' })
    await ask('tasks and feedback as tabs')
    await composeWith(t, catalog, [{ part: 'tabs', children: { overview: [{ part: 'tasks' }], billing: [{ part: 'feedback' }] } }])
    await t.waitForState((s) => s.page.status === 'done')
    t.query('[role="tab"]:nth-child(2)').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await t.next((s) => s.page.ui.tabs?.tab === 1)
    expect(t.queryAll('[role="tabpanel"]')[0].hasAttribute('hidden')).toBe(true)
  })
})
