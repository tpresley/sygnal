import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'
import { router } from './routes.js'

let t
afterEach(() => t?.dispose())

const errors = () => t.queryAll('p.error').map((p) => p.textContent).filter(Boolean)

async function openForm() {
  t = renderComponent(App, { router, url: '/expenses/new' })
  await t.ready()
}

it('shows every message on submit and sends nothing', async () => {
  await openForm()
  t.simulateEvent('[name="amount"]', 'input', { value: '0' })
  t.simulateEvent('.expense-form', 'submit')
  await t.settle()
  expect(errors()).toEqual(['Enter a description.', 'Enter an amount greater than 0 and at most 10000.', 'Choose a category.', 'Enter the date as YYYY-MM-DD.'])
  expect(t.requests('HTTP').filter((r) => r.method === 'POST')).toHaveLength(0)
  t.expectNoDiagnostics()
})

it('shows a message after leaving a field with an invalid value', async () => {
  await openForm()
  t.simulateEvent('[name="description"]', 'input', { value: 'x'.repeat(81) })
  t.simulateEvent('[name="description"]', 'focusout')
  await t.settle()
  expect(errors()).toEqual(['Keep the description to 80 characters or fewer.'])
})

it('saves a draft, then shows its page with a message', async () => {
  await openForm()
  expect(t.query('button[type="submit"]').textContent).toBe('Save draft')
  t.simulateEvent('[name="description"]', 'input', { value: ' Taxi to the airport ' })
  t.simulateEvent('[name="amount"]', 'input', { value: '42.5' })
  t.simulateEvent('[name="category"]', 'input', { value: 'Travel' })
  t.simulateEvent('[name="date"]', 'input', { value: '2026-10-01' })
  t.simulateEvent('.expense-form', 'submit')
  await t.settle()
  expect(t.query('button[type="submit"]').textContent).toBe('Saving…')
  expect(t.requests('HTTP').at(-1)).toMatchObject({
    url: '/api/expenses',
    method: 'POST',
    json: { description: 'Taxi to the airport', amount: 42.5, category: 'Travel', date: '2026-10-01', status: 'draft' },
  })
  await t.respond('HTTP', { id: 9, description: 'Taxi to the airport', amount: 42.5, category: 'Travel', date: '2026-10-01', status: 'draft' })
  expect(t.location.path).toBe('/expenses/9')
  expect(t.query('p.flash').textContent).toBe('Draft saved')
})

it('keeps the values when saving fails', async () => {
  await openForm()
  t.simulateEvent('[name="description"]', 'input', { value: 'Taxi' })
  t.simulateEvent('[name="amount"]', 'input', { value: '12' })
  t.simulateEvent('[name="category"]', 'input', { value: 'Travel' })
  t.simulateEvent('[name="date"]', 'input', { value: '2026-10-01' })
  t.simulateEvent('.expense-form', 'submit')
  await t.settle()
  await t.fail('HTTP', 500)
  expect(t.query('.save-error').textContent).toBe("Couldn't save the expense.")
  expect(t.query('[name="description"]').value).toBe('Taxi')
  expect(t.location.path).toBe('/expenses/new')
})
