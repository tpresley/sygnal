// @vitest-environment jsdom
// The same app in a real DOM (renderComponent's dom: 'real'): a decision model's preview shows the
// selected parts on the page, then its layout moves two of them into a new row. Each part keeps its
// instance, so its DOM moves into a parent element created in the same patch, before the part's
// old place among its siblings (the core's G-753 case; G-750 is a move to an existing parent).
// Before the fix the DOM stayed at the preview (snabbdom's insertBefore threw NotFoundError).
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith } from 'sygnal/ai'
import App from './App.jsx'
import { catalog } from './catalog.js'
import { decisionsBackend } from './backends.js'

let t
afterEach(() => { t?.dispose(); t = null })

it('previewed parts move into a row', async () => {
  t = renderComponent(App, { strict: true, dom: 'real' })
  await t.respond('HTTP', { models: [{ name: 'nimble:latest', capabilities: ['decision'] }] }, 'models')
  await t.fail('HTTP', 404, 'jev')
  await t.waitForState((s) => s.backend?.id === 'nimble:latest')
  t.simulateEvent('.prompt', 'input', { value: 'Signups and churn side by side, then the revenue chart' })
  t.simulateEvent('.prompt-form', 'submit')
  await t.next((s) => s.page.status === 'composing')

  const tree = [{ part: 'row', children: [{ part: 'signups' }, { part: 'churn' }] }, { part: 'revenueChart' }]
  // the select step: the three parts preview on the page
  await t.respond('HTTP', decisionsBackend.fake({ catalog, state: t.state, pending: t.state.page.pending, target: tree }), 'page.REPLY')
  await t.waitForState((s) => s.page.status === 'preview')
  const cards = () => [...t.container.querySelectorAll('.card')].map((e) => e.className)
  expect(cards()).toEqual(['card part-signups', 'card part-churn', 'card part-revenueChart'])

  // the layout step: signups and churn move into a row
  await composeWith(t, catalog, tree)
  await t.waitForState((s) => s.page.status === 'done')
  await t.settle()
  expect([...t.container.querySelectorAll('.compose-page > *')].map((e) => e.className)).toEqual(['compose-row', 'card part-revenueChart'])
  expect([...t.container.querySelectorAll('.compose-row > .card')].map((e) => e.className)).toEqual(['card part-signups', 'card part-churn'])
})
