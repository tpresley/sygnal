import { it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import App from './App.jsx'

afterEach(cleanup)

let container
const query = (sel) => container.querySelector(sel)
const entries = () => [...container.querySelectorAll('.activity li')].map((el) => el.textContent)

it('Clear empties the log', () => {
  ;({ container } = render(<App />))
  fireEvent.click(query('.candidate[data-id="5"] .advance'))
  expect(entries()).toEqual(['Eli Stone moved to Hired'])

  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(entries()).toEqual([])
  expect(query('.activity .empty').textContent).toBe('No activity yet.')
})
