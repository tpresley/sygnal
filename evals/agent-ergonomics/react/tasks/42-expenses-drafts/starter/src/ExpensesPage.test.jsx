import { it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { fakeApi, renderApp } from './test-utils.jsx'
import { EXPENSES } from './fixtures.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const descriptions = () => [...document.querySelectorAll('li.expense a')].map((a) => a.textContent)
const count = () => document.querySelector('.count').textContent
const choose = (name, value) => fireEvent.change(document.querySelector(`select[name="${name}"]`), { target: { value } })

async function openList() {
  const api = fakeApi()
  renderApp('/expenses')
  await api.respond('GET /api/expenses', { expenses: EXPENSES })
  return api
}

it('lists every expense, newest first, with its amount and status', async () => {
  await openList()
  expect(descriptions()).toEqual(['Printer paper', 'Client dinner', 'Design tool licence', 'Desk lamp', 'Team lunch', 'Hotel in Berlin', 'Flight to Berlin'])
  expect(count()).toBe('Showing 7 expenses')
  const lunch = document.querySelector('li.expense:nth-child(5)')
  expect(lunch.querySelector('.amount').textContent).toBe('$86.40')
  expect(lunch.querySelector('.status').textContent).toBe('Pending')
  expect(lunch.querySelector('a').getAttribute('href')).toBe('/expenses/2')
})

it('filters by status and category, and sorts by amount', async () => {
  await openList()
  choose('status', 'pending')
  expect(descriptions()).toEqual(['Printer paper', 'Team lunch', 'Hotel in Berlin'])
  expect(count()).toBe('Showing 3 expenses')

  choose('sort', 'amount')
  expect(descriptions()).toEqual(['Hotel in Berlin', 'Team lunch', 'Printer paper'])

  choose('category', 'Travel')
  expect(descriptions()).toEqual(['Hotel in Berlin'])
  expect(count()).toBe('Showing 1 expense')
})

it('shows an error with Retry when the list fails to load', async () => {
  const api = fakeApi()
  renderApp('/expenses')
  await api.fail('GET /api/expenses', 500)
  expect(document.querySelector('.load-error').textContent).toContain("Couldn't load expenses.")

  fireEvent.click(screen.getByText('Retry'))
  await api.respond('GET /api/expenses', { expenses: EXPENSES })
  expect(count()).toBe('Showing 7 expenses')
})
