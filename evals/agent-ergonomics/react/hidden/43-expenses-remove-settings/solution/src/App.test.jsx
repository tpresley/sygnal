import { it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { fakeApi, renderApp } from './test-utils.jsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows "Page not found" for an unknown address', () => {
  fakeApi()
  renderApp('/reports')
  expect(document.querySelector('h1').textContent).toBe('Page not found')
  expect([...document.querySelectorAll('nav.main-nav a')].map((a) => a.textContent)).toEqual(['Dashboard', 'Expenses', 'New expense'])
})
