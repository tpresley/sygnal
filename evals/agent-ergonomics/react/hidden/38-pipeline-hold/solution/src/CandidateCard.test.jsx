import { it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import App from './App.jsx'

afterEach(cleanup)

let container
const query = (sel) => container.querySelector(sel)
const card = (id) => `.candidate[data-id="${id}"]`
const stageOf = (id) => query(`${card(id)} .stage`).textContent
const tabText = (stage) => query(`.tab[data-stage="${stage}"]`).textContent

it('advances a candidate from Applied through Interview and Offer to Hired', () => {
  ;({ container } = render(<App />))

  fireEvent.click(query(`${card(1)} .advance`))
  expect(stageOf(1)).toBe('Interview')
  expect(tabText('applied')).toBe('Applied (1)')
  expect(tabText('interview')).toBe('Interview (3)')

  fireEvent.click(query(`${card(1)} .advance`))
  expect(stageOf(1)).toBe('Offer')
  expect(tabText('offer')).toBe('Offer (3)')

  fireEvent.click(query(`${card(1)} .advance`))
  expect(stageOf(1)).toBe('Hired')
  expect(tabText('hired')).toBe('Hired (2)')
  expect(query('.summary').textContent).toBe('5 active · 2 hired · 0 on hold')
  // A hired candidate can no longer be advanced or rejected.
  expect(query(`${card(1)} .advance`)).toBeNull()
  expect(query(`${card(1)} .reject`)).toBeNull()
})

it('rejects a candidate', () => {
  ;({ container } = render(<App />))
  fireEvent.click(query(`${card(3)} .reject`))
  expect(stageOf(3)).toBe('Rejected')
  expect(tabText('interview')).toBe('Interview (1)')
  expect(tabText('rejected')).toBe('Rejected (2)')
  expect(query('.summary').textContent).toBe('5 active · 1 hired · 0 on hold')
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

it('puts a candidate on hold and resumes them', () => {
  ;({ container } = render(<App />))
  fireEvent.click(query(`${card(3)} .hold`))
  expect(query(card(3)).classList.contains('on-hold')).toBe(true)
  expect(query(`${card(3)} .hold-badge`).textContent).toBe('On hold')
  expect(query(`${card(3)} .advance`).disabled).toBe(true)
  expect(query(`${card(3)} .reject`).disabled).toBe(true)
  expect(tabText('onHold')).toBe('On hold (1)')
  expect(query('.summary').textContent).toBe('6 active · 1 hired · 1 on hold')

  fireEvent.click(query(`${card(3)} .resume`))
  expect(query(card(3)).classList.contains('on-hold')).toBe(false)
  expect(query(`${card(3)} .hold-badge`)).toBeNull()
  expect(query(`${card(3)} .advance`).disabled).toBe(false)
  expect(tabText('onHold')).toBe('On hold (0)')
})
