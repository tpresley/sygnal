// Sales.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Sales } from './Sales.jsx'

test('a clicked bar is selected, and a new sale reaches the chart', async () => {
  const t = renderComponent(Sales)
  await t.ready()
  t.widget('.sales').dispatch('bar-select', 1)
  await t.next((state) => state.selected === 1)
  expect(t.query('.picked').textContent).toBe('Feb: 19')

  t.simulateEvent('.add-sale', 'click')
  await t.next((state) => state.values[3] === 5)
  expect(t.widget('.sales').props.values).toEqual([12, 19, 7, 5])
  t.dispose()
})
