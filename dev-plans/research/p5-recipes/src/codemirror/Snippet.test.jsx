// Snippet.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Snippet } from './Snippet.jsx'

test('edits reach the state, Reset puts the start code back', async () => {
  const t = renderComponent(Snippet)
  await t.ready()
  t.widget('.code').dispatch('edit', 'const answer = 42\nconsole.log(answer)\n')
  await t.next((state) => state.code.includes('console.log'))
  expect(t.query('.lines').textContent).toBe('3 lines')

  t.simulateEvent('.reset', 'click')
  await t.next((state) => state.code === 'const answer = 42\n')
  expect(t.widget('.code').props.code).toBe('const answer = 42\n')

  t.simulateEvent('.edit-code', 'click')
  await t.settle()
  expect(t.commands()).toEqual([{ focus: '.code' }])
  t.dispose()
})
