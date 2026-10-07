import { it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { fakeApi, renderApp } from './test-utils.jsx'
import { expenseById } from './fixtures.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const buttons = () => [...document.querySelectorAll('.actions button')].map((b) => b.textContent)
const status = () => document.querySelector('.status').textContent

async function openExpense(id) {
  const api = fakeApi()
  const router = renderApp(`/expenses/${id}`)
  await api.respond(`GET /api/expenses/${id}`, expenseById(id))
  return { api, router }
}

it('shows a pending expense with Approve and Reject', async () => {
  await openExpense(2)
  expect(document.querySelector('h1').textContent).toBe('Team lunch')
  expect(document.querySelector('dd.amount').textContent).toBe('$86.40')
  expect(document.querySelector('dd.category').textContent).toBe('Meals')
  expect(status()).toBe('Pending')
  expect(buttons()).toEqual(['Approve', 'Reject'])
})

it('offers Submit for approval and Delete on a draft, Delete on a rejected expense', async () => {
  await openExpense(8)
  expect(status()).toBe('Draft')
  expect(buttons()).toEqual(['Submit for approval', 'Delete'])
  cleanup()
  await openExpense(3)
  expect(buttons()).toEqual(['Delete'])
  cleanup()
  await openExpense(1)
  expect(buttons()).toEqual([])
})

it('submits a draft for approval', async () => {
  const { api } = await openExpense(8)
  fireEvent.click(screen.getByText('Submit for approval'))
  expect(api.requests().at(-1)).toMatchObject({ path: '/api/expenses/8', method: 'PUT', json: { status: 'pending' } })
  await api.respond('PUT /api/expenses/8', { ...expenseById(8), status: 'pending' })
  expect(status()).toBe('Pending')
  expect(buttons()).toEqual(['Approve', 'Reject'])
  expect(document.querySelector('p.flash').textContent).toBe('Submitted for approval')
})

it('approves a pending expense', async () => {
  const { api } = await openExpense(2)
  fireEvent.click(screen.getByText('Approve'))
  expect(api.requests().at(-1)).toMatchObject({ path: '/api/expenses/2', method: 'PUT', json: { status: 'approved' } })
  await api.respond('PUT /api/expenses/2', { ...expenseById(2), status: 'approved' })
  expect(status()).toBe('Approved')
  expect(buttons()).toEqual([])
  expect(document.querySelector('p.flash').textContent).toBe('Expense approved')
})

it('rejects a pending expense', async () => {
  const { api } = await openExpense(5)
  fireEvent.click(screen.getByText('Reject'))
  await api.respond('PUT /api/expenses/5', { ...expenseById(5), status: 'rejected' })
  expect(api.requests().at(-1)).toMatchObject({ method: 'PUT', json: { status: 'rejected' } })
  expect(status()).toBe('Rejected')
  expect(document.querySelector('p.flash').textContent).toBe('Expense rejected')
})

it('deletes a draft, then shows the list with a message', async () => {
  const { api, router } = await openExpense(8)
  fireEvent.click(screen.getByText('Delete'))
  expect(api.requests().at(-1)).toMatchObject({ path: '/api/expenses/8', method: 'DELETE' })
  await api.respond('DELETE /api/expenses/8', null, 204)
  expect(router.state.location.pathname).toBe('/expenses')
  expect(document.querySelector('p.flash').textContent).toBe('Expense deleted')
})

it('says so when the expense does not exist', async () => {
  const api = fakeApi()
  renderApp('/expenses/99')
  await api.fail('GET /api/expenses/99', 404)
  expect(document.querySelector('h1').textContent).toBe('Expense not found.')
})
