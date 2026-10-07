import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'
import { router } from './routes.js'
import { EXPENSES } from './fixtures.js'

let t
afterEach(() => t?.dispose())

it('shows every amount in the chosen currency and saves the choice', async () => {
  t = renderComponent(App, { router, url: '/settings' })
  await t.ready()
  t.simulateEvent('select[name="currency"]', 'input', { value: 'EUR' })
  await t.next((s) => s.settings.currency === 'EUR')
  await t.navigate('/')
  await t.respond('HTTP', { expenses: EXPENSES }, 'expenseList')
  expect(t.query('.approved-total').textContent).toBe('Approved total: €685.20')
  expect(t.query('table.category-totals td').textContent).toBe('€730.50')
  await t.settle()
  expect(t.storage('expenses-settings')).toEqual({ settings: { currency: 'EUR', defaultCategory: '' } })
  t.expectNoDiagnostics()
})

it('starts the new-expense form on the saved default category', async () => {
  t = renderComponent(App, { router, url: '/expenses/new', storage: { 'expenses-settings': { settings: { currency: 'GBP', defaultCategory: 'Meals' } } } })
  await t.ready()
  expect(t.query('select[name="category"]').value).toBe('Meals')
  await t.navigate('/settings')
  expect(t.query('select[name="currency"]').value).toBe('GBP')
  expect(t.query('select[name="defaultCategory"]').value).toBe('Meals')
})
