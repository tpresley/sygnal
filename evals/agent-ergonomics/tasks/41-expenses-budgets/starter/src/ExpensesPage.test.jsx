import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'
import { router } from './routes.js'
import { EXPENSES } from './fixtures.js'

let t
afterEach(() => t?.dispose())

const descriptions = () => t.queryAll('li.expense a').map((a) => a.textContent)

async function openList() {
  t = renderComponent(App, { router, url: '/expenses' })
  await t.ready()
  await t.respond('HTTP', { expenses: EXPENSES }, 'expenseList')
}

it('lists every expense, newest first, with its amount and status', async () => {
  await openList()
  expect(descriptions()).toEqual(['Printer paper', 'Client dinner', 'Design tool licence', 'Desk lamp', 'Team lunch', 'Hotel in Berlin', 'Flight to Berlin'])
  expect(t.query('.count').textContent).toBe('Showing 7 expenses')
  const lunch = t.query('li.expense:nth-child(5)')
  expect(lunch.querySelector('.amount').textContent).toBe('$86.40')
  expect(lunch.querySelector('.status').textContent).toBe('Pending')
  expect(lunch.querySelector('a').getAttribute('href')).toBe('/expenses/2')
  t.expectNoDiagnostics()
})

it('filters by status and category, and sorts by amount', async () => {
  await openList()
  t.simulateEvent('select[name="status"]', 'input', { value: 'pending' })
  await t.next((s) => s.filters.status === 'pending')
  expect(descriptions()).toEqual(['Printer paper', 'Team lunch', 'Hotel in Berlin'])
  expect(t.query('.count').textContent).toBe('Showing 3 expenses')

  t.simulateEvent('select[name="sort"]', 'input', { value: 'amount' })
  await t.next((s) => s.filters.sort === 'amount')
  expect(descriptions()).toEqual(['Hotel in Berlin', 'Team lunch', 'Printer paper'])

  t.simulateEvent('select[name="category"]', 'input', { value: 'Travel' })
  await t.next((s) => s.filters.category === 'Travel')
  expect(descriptions()).toEqual(['Hotel in Berlin'])
  expect(t.query('.count').textContent).toBe('Showing 1 expense')
})

it('shows an error with Retry when the list fails to load', async () => {
  t = renderComponent(App, { router, url: '/expenses' })
  await t.ready()
  await t.fail('HTTP', 500, 'expenseList')
  expect(t.query('.load-error').textContent).toContain("Couldn't load expenses.")

  t.simulateEvent('.retry', 'click')
  await t.respond('HTTP', { expenses: EXPENSES }, 'expenseList')
  expect(t.query('.count').textContent).toBe('Showing 7 expenses')
})
