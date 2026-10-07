import { it, expect, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { fakeApi, renderApp } from './test-utils.jsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const errors = () => [...document.querySelectorAll('p.error')].map((p) => p.textContent).filter(Boolean)
const field = (name) => document.querySelector(`[name="${name}"]`)
const type = (name, value) => fireEvent.input(field(name), { target: { value } })
const submit = () => act(async () => fireEvent.submit(document.querySelector('.expense-form')))
const submitButton = () => document.querySelector('button[type="submit"]')

function openForm() {
  const api = fakeApi()
  const router = renderApp('/expenses/new')
  return { api, router }
}

it('shows every message on submit and sends nothing', async () => {
  const { api } = openForm()
  type('amount', '0')
  await submit()
  await waitFor(() =>
    expect(errors()).toEqual(['Enter a description.', 'Enter an amount greater than 0 and at most 10000.', 'Choose a category.', 'Enter the date as YYYY-MM-DD.'])
  )
  expect(api.requests().filter((r) => r.method === 'POST')).toHaveLength(0)
})

it('shows a message after leaving a field with an invalid value', async () => {
  openForm()
  type('description', 'x'.repeat(81))
  fireEvent.blur(field('description'))
  await waitFor(() => expect(errors()).toEqual(['Keep the description to 80 characters or fewer.']))
})

it('adds an expense, then shows the list with a message', async () => {
  const { api, router } = openForm()
  expect(submitButton().textContent).toBe('Add expense')
  type('description', ' Taxi to the airport ')
  type('amount', '42.5')
  fireEvent.change(field('category'), { target: { value: 'Travel' } })
  type('date', '2026-10-01')
  await submit()
  await waitFor(() => expect(submitButton().textContent).toBe('Saving…'))
  expect(api.requests().at(-1)).toMatchObject({
    path: '/api/expenses',
    method: 'POST',
    json: { description: 'Taxi to the airport', amount: 42.5, category: 'Travel', date: '2026-10-01', status: 'pending' },
  })
  await api.respond('POST /api/expenses', { id: 8, description: 'Taxi to the airport', amount: 42.5, category: 'Travel', date: '2026-10-01', status: 'pending' }, 201)
  expect(router.state.location.pathname).toBe('/expenses')
  expect(document.querySelector('p.flash').textContent).toBe('Expense added')
})

it('keeps the values when saving fails', async () => {
  const { api, router } = openForm()
  type('description', 'Taxi')
  type('amount', '12')
  fireEvent.change(field('category'), { target: { value: 'Travel' } })
  type('date', '2026-10-01')
  await submit()
  await api.fail('POST /api/expenses', 500)
  await waitFor(() => expect(document.querySelector('.save-error').textContent).toBe("Couldn't save the expense."))
  expect(field('description').value).toBe('Taxi')
  expect(router.state.location.pathname).toBe('/expenses/new')
})
