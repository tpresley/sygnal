import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

let t
afterEach(() => t?.dispose())

const entries = () => t.queryAll('.activity li').map((el) => el.textContent)

it('records advances, rejections, additions and removals, newest first', async () => {
  t = renderComponent(App, { strict: true })
  await t.ready()
  expect(t.query('.activity .empty').textContent).toBe('No activity yet.')

  t.simulateEvent('.candidate[data-id="1"] .advance', 'click')
  await t.next((s) => s.activity.entries.length === 1)
  t.simulateEvent('.candidate[data-id="2"] .reject', 'click')
  await t.next((s) => s.activity.entries.length === 2)
  t.simulateEvent('[name="name"]', 'input', { value: 'Ivy Chen' })
  t.simulateEvent('[name="role"]', 'change', { value: 'Product manager' })
  t.simulateEvent('.add-candidate', 'submit')
  await t.next((s) => s.activity.entries.length === 3)
  t.simulateEvent('.candidate[data-id="4"] .remove', 'click')
  await t.next((s) => s.activity.entries.length === 4)

  expect(entries()).toEqual([
    'Removed Dee Park',
    'Added Ivy Chen (Product manager)',
    'Ben Ode rejected',
    'Ana Ruiz moved to Screen',
  ])
  t.expectNoDiagnostics()
})

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
