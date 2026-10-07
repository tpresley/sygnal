import { it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import App from './App.jsx'

afterEach(cleanup)

let container
const query = (sel) => container.querySelector(sel)
const card = (id) => `.candidate[data-id="${id}"]`
const stageOf = (id) => query(`${card(id)} .stage`).textContent
const tabText = (stage) => query(`.tab[data-stage="${stage}"]`).textContent

it('rejects a candidate', () => {
  ;({ container } = render(<App />))
  fireEvent.click(query(`${card(3)} .reject`))
  expect(stageOf(3)).toBe('Rejected')
  expect(tabText('interview')).toBe('Interview (1)')
  expect(tabText('rejected')).toBe('Rejected (2)')
  expect(query('.summary').textContent).toBe('5 active · 1 hired')
  expect(query(`${card(3)} .advance`)).toBeNull()
})

it('removes a candidate', () => {
  ;({ container } = render(<App />))
  fireEvent.click(query(`${card(2)} .remove`))
  expect(query(card(2))).toBeNull()
  expect([...container.querySelectorAll('.candidate .name')].map((el) => el.textContent)).not.toContain('Ben Ode')
  expect(tabText('all')).toBe('All (7)')
  expect(tabText('applied')).toBe('Applied (1)')
})
