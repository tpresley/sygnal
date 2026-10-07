import { it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import App from './App.jsx'

afterEach(cleanup)

let container
const query = (sel) => container.querySelector(sel)
const names = () => [...container.querySelectorAll('.candidate .name')].map((el) => el.textContent)

it('shows only the chosen role, combined with the stage tab', () => {
  ;({ container } = render(<App />))
  fireEvent.change(screen.getByLabelText('Show role'), { target: { value: 'Engineer' } })
  expect(names()).toEqual(['Ben Ode', 'Dee Park', 'Fay Wu', 'Hana Kim'])
  // The tab counts keep counting every candidate.
  expect(query('.tab[data-stage="all"]').textContent).toBe('All (8)')

  fireEvent.click(query('.tab[data-stage="offer"]'))
  expect(names()).toEqual(['Fay Wu'])

  fireEvent.change(screen.getByLabelText('Show role'), { target: { value: 'Product manager' } })
  expect(names()).toEqual([])
  expect(query('.candidate-list .empty').textContent).toBe('No candidates in this stage.')
})

it('sorts newest first, and Reset view restores the board order and every role', () => {
  ;({ container } = render(<App />))
  expect(query('.reset-view').disabled).toBe(true)
  expect(query('.toolbar .total').textContent).toBe('8 candidates')

  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'newest' } })
  expect(names()).toEqual(['Hana Kim', 'Gus Hale', 'Fay Wu', 'Eli Stone', 'Dee Park', 'Cy Lam', 'Ben Ode', 'Ana Ruiz'])

  fireEvent.change(screen.getByLabelText('Show role'), { target: { value: 'Designer' } })
  expect(names()).toEqual(['Eli Stone', 'Ana Ruiz'])
  expect(query('.reset-view').disabled).toBe(false)

  fireEvent.click(query('.reset-view'))
  expect(names()).toHaveLength(8)
  expect(names()[0]).toBe('Ana Ruiz')
  expect(query('.reset-view').disabled).toBe(true)
})

it('searches by name, ignoring case and surrounding spaces, together with the role filter', () => {
  ;({ container } = render(<App />))
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: ' A ' } })
  expect(names()).toEqual(['Ana Ruiz', 'Cy Lam', 'Dee Park', 'Fay Wu', 'Gus Hale', 'Hana Kim'])

  fireEvent.change(screen.getByLabelText('Show role'), { target: { value: 'Engineer' } })
  expect(names()).toEqual(['Dee Park', 'Fay Wu', 'Hana Kim'])

  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zed' } })
  expect(names()).toEqual([])
  expect(query('.candidate-list .empty').textContent).toBe('No candidates in this stage.')

  fireEvent.click(query('.reset-view'))
  expect(names()).toHaveLength(8)
  expect(screen.getByLabelText('Search').value).toBe('')
})
