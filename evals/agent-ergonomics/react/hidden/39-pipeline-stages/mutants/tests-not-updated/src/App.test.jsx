import { it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import App from './App.jsx'

afterEach(cleanup)

let container
const query = (sel) => container.querySelector(sel)
const queryAll = (sel) => [...container.querySelectorAll(sel)]
const names = () => queryAll('.candidate .name').map((el) => el.textContent)

it('shows the stage tabs with counts and the summary', () => {
  ;({ container } = render(<App />))
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Hiring pipeline')
  expect(queryAll('.stage-tabs .tab').map((el) => el.textContent)).toEqual([
    'All (8)',
    'Applied (2)',
    'Interview (2)',
    'Offer (2)',
    'Hired (1)',
    'Rejected (1)',
  ])
  expect(query('.tab.active').textContent).toBe('All (8)')
  expect(query('.summary').textContent).toBe('6 active · 1 hired')
  expect(query('.roles').textContent).toBe('Engineer: 4, Designer: 2, Product manager: 2')
  expect(names()).toHaveLength(8)
})

it('filters the list by stage and shows a message for an empty stage', () => {
  ;({ container } = render(<App />))
  fireEvent.click(query('.tab[data-stage="offer"]'))
  expect(names()).toEqual(['Eli Stone', 'Fay Wu'])
  expect(query('.tab.active').textContent).toBe('Offer (2)')
  expect(query('.candidate-list .empty')).toBeNull()

  fireEvent.click(query('.tab[data-stage="hired"]'))
  expect(names()).toEqual(['Gus Hale'])
  fireEvent.click(query('.candidate[data-id="7"] .remove'))
  expect(names()).toEqual([])
  expect(query('.candidate-list .empty').textContent).toBe('No candidates in this stage.')
})

it('adds a candidate at the end of Applied and clears the form', () => {
  ;({ container } = render(<App />))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Ivy Chen ' } })
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Designer' } })
  fireEvent.submit(query('.add-candidate'))
  expect(names().at(-1)).toBe('Ivy Chen')
  expect(query('.candidate[data-id="9"] .role').textContent).toBe('Designer')
  expect(query('.candidate[data-id="9"] .stage').textContent).toBe('Applied')
  expect(query('.tab[data-stage="applied"]').textContent).toBe('Applied (3)')
  expect(screen.getByLabelText('Name').value).toBe('')
})

it('refuses a candidate without a name', () => {
  ;({ container } = render(<App />))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
  fireEvent.submit(query('.add-candidate'))
  expect(query('.add-candidate .error').textContent).toBe('Enter a name.')
  expect(names()).toHaveLength(8)

  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jo Bell' } })
  fireEvent.submit(query('.add-candidate'))
  expect(names()).toHaveLength(9)
  expect(query('.add-candidate .error')).toBeNull()
})
