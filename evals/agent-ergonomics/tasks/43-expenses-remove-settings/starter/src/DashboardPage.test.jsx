import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'
import { router } from './routes.js'
import { EXPENSES } from './fixtures.js'

let t
afterEach(() => t?.dispose())

const texts = (sel) => t.queryAll(sel).map((el) => el.textContent.replace(/\s+/g, ' ').trim())

it('shows the pending count, the approved total, the category totals and the 3 most recent expenses', async () => {
  t = renderComponent(App, { router, url: '/' })
  await t.ready()
  expect(t.query('.loading').textContent).toBe('Loading expenses…')
  await t.respond('HTTP', { expenses: EXPENSES }, 'expenseList')

  expect(t.query('.pending-count').textContent).toBe('Pending approval: 3')
  expect(t.query('.approved-total').textContent).toBe('Approved total: $685.20')
  // rejected expenses (the desk lamp) don't count
  expect(texts('table.category-totals tbody th')).toEqual(['Travel', 'Meals', 'Office', 'Software'])
  expect(texts('table.category-totals td.total')).toEqual(['$730.50', '$231.60', '$24.75', '$120.00'])
  expect(texts('ul.recent-expenses a')).toEqual(['Printer paper', 'Client dinner', 'Design tool licence'])
  expect(t.query('ul.recent-expenses a').getAttribute('href')).toBe('/expenses/7')
  t.expectNoDiagnostics()
})
