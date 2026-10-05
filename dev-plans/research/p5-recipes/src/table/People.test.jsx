// People.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { People } from './People.jsx'

const names = (t) => t.queryAll('tbody tr').map((row) => row.querySelector('td').textContent)

test('sorts, searches and pages', async () => {
  const t = renderComponent(People)
  await t.ready()
  expect(names(t)).toEqual(['Ada', 'Grace', 'Alan'])
  expect(t.query('.page').textContent).toBe('Page 1 of 2')

  t.simulateEvent('.sort[data-column="points"]', 'click')
  t.simulateEvent('.sort[data-column="points"]', 'click')
  await t.next((state) => state.sorting[0]?.desc === true)
  expect(names(t)).toEqual(['Grace', 'Alan', 'Ada'])
  expect(t.queryAll('th')[2].getAttribute('aria-sort')).toBe('descending')

  t.simulateEvent('.next', 'click')
  await t.next((state) => state.page === 1)
  expect(names(t)).toEqual(['Barbara', 'Edsger'])
  expect(t.query('.next').disabled).toBe(true)

  t.simulateEvent('.search', 'input', { value: 'compilers' })
  await t.next((state) => state.search === 'compilers')
  expect(names(t)).toEqual(['Grace', 'Edsger'])
  expect(t.query('.page').textContent).toBe('Page 1 of 1')
  t.dispose()
})
