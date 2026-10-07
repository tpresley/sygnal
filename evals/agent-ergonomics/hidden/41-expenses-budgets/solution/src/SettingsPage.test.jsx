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
  expect(t.storage('expenses-settings')).toEqual({ settings: { currency: 'EUR', defaultCategory: '', budgets: { Travel: '', Meals: '', Office: '', Software: '' } } })
  t.expectNoDiagnostics()
})

it('compares each category with its budget on the dashboard', async () => {
  t = renderComponent(App, { router, url: '/settings' })
  await t.ready()
  t.simulateEvent('input[name="budget-Travel"]', 'input', { value: '500' })
  t.simulateEvent('input[name="budget-Meals"]', 'input', { value: '300' })
  await t.next((s) => s.settings.budgets.Meals === '300')
  await t.navigate('/')
  await t.respond('HTTP', { expenses: EXPENSES }, 'expenseList')
  expect(t.queryAll('td.budget').map((td) => td.textContent)).toEqual(['$730.50 of $500.00', '$231.60 of $300.00', 'No budget', 'No budget'])
  expect(t.queryAll('tr.over-budget').map((tr) => tr.querySelector('th').textContent)).toEqual(['Travel'])
  expect(t.query('.over-budget-summary').textContent).toBe('Over budget: Travel')
})

it('starts the new-expense form on the saved default category', async () => {
  t = renderComponent(App, { router, url: '/expenses/new', storage: { 'expenses-settings': { settings: { currency: 'GBP', defaultCategory: 'Meals' } } } })
  await t.ready()
  expect(t.query('select[name="category"]').value).toBe('Meals')
  await t.navigate('/settings')
  expect(t.query('select[name="currency"]').value).toBe('GBP')
  expect(t.query('select[name="defaultCategory"]').value).toBe('Meals')
})
