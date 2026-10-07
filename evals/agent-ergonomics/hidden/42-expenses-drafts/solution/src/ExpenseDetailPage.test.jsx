import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'
import { router } from './routes.js'
import { expenseById } from './fixtures.js'

let t
afterEach(() => t?.dispose())

const buttons = () => t.queryAll('.actions button').map((b) => b.textContent)

async function openExpense(id) {
  t = renderComponent(App, { router, url: `/expenses/${id}` })
  await t.ready()
  await t.respond('HTTP', expenseById(id), 'expense')
}

it('shows a pending expense with Approve and Reject', async () => {
  await openExpense(2)
  expect(t.query('h1').textContent).toBe('Team lunch')
  expect(t.query('dd.amount').textContent).toBe('$86.40')
  expect(t.query('dd.category').textContent).toBe('Meals')
  expect(t.query('.status').textContent).toBe('Pending')
  expect(buttons()).toEqual(['Approve', 'Reject'])
  t.expectNoDiagnostics()
})

it('offers Submit for approval and Delete on a draft, Delete on a rejected expense', async () => {
  await openExpense(8)
  expect(t.query('.status').textContent).toBe('Draft')
  expect(buttons()).toEqual(['Submit for approval', 'Delete'])
  t.dispose()
  await openExpense(3)
  expect(buttons()).toEqual(['Delete'])
  t.dispose()
  await openExpense(1)
  expect(buttons()).toEqual([])
})

it('submits a draft for approval', async () => {
  await openExpense(8)
  t.simulateEvent('.submit', 'click')
  await t.settle()
  expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/expenses/8', method: 'PUT', json: { status: 'pending' } })
  await t.respond('HTTP', { ...expenseById(8), status: 'pending' }, 'DECIDED')
  expect(t.query('.status').textContent).toBe('Pending')
  expect(buttons()).toEqual(['Approve', 'Reject'])
  expect(t.query('p.flash').textContent).toBe('Submitted for approval')
})

it('approves a pending expense', async () => {
  await openExpense(2)
  t.simulateEvent('.approve', 'click')
  await t.settle()
  expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/expenses/2', method: 'PUT', json: { status: 'approved' } })
  await t.respond('HTTP', { ...expenseById(2), status: 'approved' }, 'DECIDED')
  expect(t.query('.status').textContent).toBe('Approved')
  expect(buttons()).toEqual([])
  expect(t.query('p.flash').textContent).toBe('Expense approved')
})

it('rejects a pending expense', async () => {
  await openExpense(5)
  t.simulateEvent('.reject', 'click')
  await t.respond('HTTP', { ...expenseById(5), status: 'rejected' }, 'DECIDED')
  expect(t.requests('HTTP').at(-1)).toMatchObject({ method: 'PUT', json: { status: 'rejected' } })
  expect(t.query('.status').textContent).toBe('Rejected')
  expect(t.query('p.flash').textContent).toBe('Expense rejected')
})

it('deletes a draft, then shows the list with a message', async () => {
  await openExpense(8)
  t.simulateEvent('.delete', 'click')
  await t.settle()
  expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/expenses/8', method: 'DELETE' })
  await t.respond('HTTP', null, 'DELETED')
  expect(t.location.path).toBe('/expenses')
  expect(t.query('p.flash').textContent).toBe('Expense deleted')
})

it('says so when the expense does not exist', async () => {
  t = renderComponent(App, { router, url: '/expenses/99' })
  await t.ready()
  await t.fail('HTTP', 404, 'expense')
  expect(t.query('h1').textContent).toBe('Expense not found.')
})
