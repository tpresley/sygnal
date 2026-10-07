import { it, expect, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { fakeApi, renderApp } from './test-utils.jsx'
import { EXPENSES } from './fixtures.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const select = (name) => document.querySelector(`select[name="${name}"]`)

it('shows every amount in the chosen currency and saves the choice', async () => {
  const api = fakeApi()
  const router = renderApp('/settings')
  fireEvent.change(select('currency'), { target: { value: 'EUR' } })
  await act(() => router.navigate('/'))
  await api.respond('GET /api/expenses', { expenses: EXPENSES })
  expect(document.querySelector('.approved-total').textContent).toBe('Approved total: €685.20')
  expect(document.querySelector('table.category-totals td').textContent).toBe('€730.50')
  expect(JSON.parse(localStorage.getItem('expenses-settings'))).toEqual({ settings: { currency: 'EUR', defaultCategory: '', budgets: { Travel: '', Meals: '', Office: '', Software: '' } } })
})

it('compares each category with its budget on the dashboard', async () => {
  const api = fakeApi()
  const router = renderApp('/settings')
  fireEvent.change(document.querySelector('input[name="budget-Travel"]'), { target: { value: '500' } })
  fireEvent.change(document.querySelector('input[name="budget-Meals"]'), { target: { value: '300' } })
  await act(() => router.navigate('/'))
  await api.respond('GET /api/expenses', { expenses: EXPENSES })
  expect([...document.querySelectorAll('td.budget')].map((td) => td.textContent)).toEqual(['$730.50 of $500.00', '$231.60 of $300.00', 'No budget', 'No budget'])
  expect([...document.querySelectorAll('tr.over-budget')].map((tr) => tr.querySelector('th').textContent)).toEqual(['Travel'])
  expect(document.querySelector('.over-budget-summary').textContent).toBe('Over budget: Travel')
})

it('starts the new-expense form on the saved default category', async () => {
  localStorage.setItem('expenses-settings', JSON.stringify({ settings: { currency: 'GBP', defaultCategory: 'Meals' } }))
  fakeApi()
  const router = renderApp('/expenses/new')
  expect(select('category').value).toBe('Meals')
  await act(() => router.navigate('/settings'))
  expect(select('currency').value).toBe('GBP')
  expect(select('defaultCategory').value).toBe('Meals')
})
