import { it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import App from './App.jsx'

afterEach(cleanup)

let container
const query = (sel) => container.querySelector(sel)
const card = (id) => `.candidate[data-id="${id}"]`
const notesOf = (id) => [...container.querySelectorAll(`${card(id)} .notes .note-text`)].map((el) => el.textContent)
const countOf = (id) => query(`${card(id)} .note-count`).textContent

it("shows each candidate's notes and how many there are", () => {
  ;({ container } = render(<App />))
  expect(countOf(1)).toBe('No notes')
  expect(notesOf(1)).toEqual([])
  expect(countOf(3)).toBe('1 note')
  expect(notesOf(3)).toEqual(['Great product sense'])
  expect(countOf(5)).toBe('2 notes')
  expect(notesOf(5)).toEqual(['Strong portfolio', 'Can start in May'])
})

it('adds a note to one candidate, ignores an empty one, and clears the field', () => {
  ;({ container } = render(<App />))
  fireEvent.change(query(`${card(2)} [name="note"]`), { target: { value: '   ' } })
  fireEvent.submit(query(`${card(2)} .note-form`))
  fireEvent.change(query(`${card(2)} [name="note"]`), { target: { value: ' Knows Rust ' } })
  fireEvent.submit(query(`${card(2)} .note-form`))
  expect(notesOf(2)).toEqual(['Knows Rust'])
  expect(countOf(2)).toBe('1 note')
  expect(query(`${card(2)} [name="note"]`).value).toBe('')
  // Other cards are unchanged.
  expect(countOf(1)).toBe('No notes')
  expect(countOf(3)).toBe('1 note')

  // Notes stay with the candidate when their stage changes.
  fireEvent.click(query(`${card(2)} .reject`))
  expect(query(`${card(2)} .stage`).textContent).toBe('Rejected')
  expect(notesOf(2)).toEqual(['Knows Rust'])
})

it('deletes one note', () => {
  ;({ container } = render(<App />))
  fireEvent.click(query(`${card(5)} .delete-note[data-index="0"]`))
  expect(notesOf(5)).toEqual(['Can start in May'])
  expect(countOf(5)).toBe('1 note')
  fireEvent.click(query(`${card(5)} .delete-note`))
  expect(countOf(5)).toBe('No notes')
  expect(query(`${card(5)} .notes`)).toBeNull()
})
