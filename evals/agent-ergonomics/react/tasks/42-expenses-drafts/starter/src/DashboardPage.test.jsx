import { it, expect, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { fakeApi, renderApp } from './test-utils.jsx'
import { EXPENSES } from './fixtures.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const texts = (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent.replace(/\s+/g, ' ').trim())

it('shows the pending count, the approved total, the category totals and the 3 most recent expenses', async () => {
  const api = fakeApi()
  renderApp('/')
  expect(screen.getByText('Loading expenses…')).toBeTruthy()
  await api.respond('GET /api/expenses', { expenses: EXPENSES })

  expect(document.querySelector('.pending-count').textContent).toBe('Pending approval: 3')
  expect(document.querySelector('.approved-total').textContent).toBe('Approved total: $685.20')
  // rejected expenses (the desk lamp) don't count
  expect(texts('table.category-totals tbody th')).toEqual(['Travel', 'Meals', 'Office', 'Software'])
  expect(texts('table.category-totals td.total')).toEqual(['$730.50', '$231.60', '$24.75', '$120.00'])
  expect(texts('ul.recent-expenses a')).toEqual(['Printer paper', 'Client dinner', 'Design tool licence'])
  expect(document.querySelector('ul.recent-expenses a').getAttribute('href')).toBe('/expenses/7')
})
