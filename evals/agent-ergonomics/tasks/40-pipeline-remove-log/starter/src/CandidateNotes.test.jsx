import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

let t
afterEach(() => t?.dispose())

const card = (id) => `.candidate[data-id="${id}"]`
const notesOf = (id) => t.queryAll(`${card(id)} .notes .note-text`).map((el) => el.textContent)
const countOf = (id) => t.query(`${card(id)} .note-count`).textContent
const notes = (id) => t.state.candidates.find((c) => c.id === id).notes

it('shows each candidate\'s notes and how many there are', async () => {
  t = renderComponent(App, { strict: true })
  await t.ready()
  expect(countOf(1)).toBe('No notes')
  expect(notesOf(1)).toEqual([])
  expect(countOf(3)).toBe('1 note')
  expect(notesOf(3)).toEqual(['Great product sense'])
  expect(countOf(5)).toBe('2 notes')
  expect(notesOf(5)).toEqual(['Strong portfolio', 'Can start in May'])
})

it('adds a note to one candidate, ignores an empty one, and clears the field', async () => {
  t = renderComponent(App, { strict: true })
  t.simulateEvent(`${card(2)} [name="note"]`, 'input', { value: '   ' })
  t.simulateEvent(`${card(2)} .note-form`, 'submit')
  t.simulateEvent(`${card(2)} [name="note"]`, 'input', { value: ' Knows Rust ' })
  t.simulateEvent(`${card(2)} .note-form`, 'submit')
  await t.next(() => notes(2).length === 1)
  expect(notes(2)).toEqual(['Knows Rust'])
  expect(notesOf(2)).toEqual(['Knows Rust'])
  expect(countOf(2)).toBe('1 note')
  expect(t.query(`${card(2)} [name="note"]`).value).toBe('')
  // Other cards are unchanged.
  expect(countOf(1)).toBe('No notes')
  expect(countOf(3)).toBe('1 note')

  // Notes stay with the candidate when their stage changes.
  t.simulateEvent(`${card(2)} .reject`, 'click')
  await t.next((s) => s.candidates.find((c) => c.id === 2).stage === 'rejected')
  expect(notesOf(2)).toEqual(['Knows Rust'])
  t.expectNoDiagnostics()
})

it('deletes one note', async () => {
  t = renderComponent(App, { strict: true })
  t.simulateEvent(`${card(5)} .delete-note[data-index="0"]`, 'click')
  await t.next(() => notes(5).length === 1)
  expect(notesOf(5)).toEqual(['Can start in May'])
  expect(countOf(5)).toBe('1 note')
  t.simulateEvent(`${card(5)} .delete-note`, 'click')
  await t.next(() => notes(5).length === 0)
  expect(countOf(5)).toBe('No notes')
  expect(t.query(`${card(5)} .notes`)).toBeNull()
  t.expectNoDiagnostics()
})
