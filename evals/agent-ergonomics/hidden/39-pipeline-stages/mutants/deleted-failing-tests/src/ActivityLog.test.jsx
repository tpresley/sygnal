import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

let t
afterEach(() => t?.dispose())

const entries = () => t.queryAll('.activity li').map((el) => el.textContent)

it('Clear empties the log', async () => {
  t = renderComponent(App, { strict: true })
  t.simulateEvent('.candidate[data-id="5"] .advance', 'click')
  await t.next((s) => s.activity.entries.length === 1)
  expect(entries()).toEqual(['Eli Stone moved to Hired'])

  t.simulateEvent('.activity .clear', 'click')
  await t.next((s) => s.activity.entries.length === 0)
  expect(t.query('.activity .empty').textContent).toBe('No activity yet.')
  t.expectNoDiagnostics()
})
