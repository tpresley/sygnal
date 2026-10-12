// AddTodo.test.jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { AddTodo, Draft, Add } from './AddTodo.jsx'

it('adds the typed todo', async () => {
  const t = renderComponent(AddTodo, { dom: 'real' })
  await t.ready()
  t.simulateEvent(Draft, 'input', { value: 'milk' })
  await t.next(s => s.draft === 'milk')
  t.simulateEvent(Add, 'click')
  await t.next(s => s.todos.length === 1)
  expect(t.query(Draft).value).toBe('')
  expect(t.queryAll('li').map(li => li.textContent)).toEqual(['milk'])
  t.dispose()
})
