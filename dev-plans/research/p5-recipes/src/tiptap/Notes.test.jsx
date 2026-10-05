// Notes.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Notes } from './Notes.jsx'

test('edits reach the state, and the toolbar sends commands to the editor', async () => {
  const t = renderComponent(Notes)
  await t.ready()
  t.widget('.body').dispatch('edit', '<p>Hello <strong>you</strong></p>')
  await t.next((state) => state.html === '<p>Hello <strong>you</strong></p>')

  t.simulateEvent('.make-bold', 'click')
  t.simulateEvent('.make-italic', 'click')
  await t.settle()
  expect(t.commands()).toEqual([{ bold: '.body' }, { italic: '.body' }])

  t.simulateEvent('.clear', 'click')
  await t.next((state) => state.html === '<p></p>')
  expect(t.widget('.body').props.html).toBe('<p></p>')
  t.dispose()
})
