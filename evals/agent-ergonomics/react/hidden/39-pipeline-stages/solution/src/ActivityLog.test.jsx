import { it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import App from './App.jsx'

afterEach(cleanup)

let container
const query = (sel) => container.querySelector(sel)
const entries = () => [...container.querySelectorAll('.activity li')].map((el) => el.textContent)

it('records advances, rejections, additions and removals, newest first', () => {
  ;({ container } = render(<App />))
  expect(query('.activity .empty').textContent).toBe('No activity yet.')

  fireEvent.click(query('.candidate[data-id="1"] .advance'))
  fireEvent.click(query('.candidate[data-id="2"] .reject'))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ivy Chen' } })
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Product manager' } })
  fireEvent.submit(query('.add-candidate'))
  fireEvent.click(query('.candidate[data-id="4"] .remove'))

  expect(entries()).toEqual([
    'Removed Dee Park',
    'Added Ivy Chen (Product manager)',
    'Ben Ode rejected',
    'Ana Ruiz moved to Screen',
  ])
})

it('Clear empties the log', () => {
  ;({ container } = render(<App />))
  fireEvent.click(query('.candidate[data-id="5"] .advance'))
  expect(entries()).toEqual(['Eli Stone moved to Hired'])

  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(entries()).toEqual([])
  expect(query('.activity .empty').textContent).toBe('No activity yet.')
})
