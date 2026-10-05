// Stock.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Stock } from './Stock.jsx'

test('edits and restocking change the rows the grid gets', async () => {
  const t = renderComponent(Stock)
  await t.ready()
  t.widget('.grid').dispatch('cell-edit', { id: 'a2', field: 'count', value: 75 })
  await t.next((state) => state.items[1].count === 75)

  t.widget('.grid').dispatch('row-select', 'a3')
  await t.next((state) => state.selected === 'a3')
  t.simulateEvent('.restock', 'click')
  await t.next((state) => state.items[2].count === 10)
  expect(t.query('.selected').textContent).toBe('Washers: 10 in stock')
  expect(t.widget('.grid').props.rows.map((item) => item.count)).toEqual([120, 75, 10])

  t.simulateEvent('.export', 'click')
  await t.settle()
  expect(t.commands()).toEqual([{ exportCsv: '.grid', fileName: 'stock.csv' }])
  t.dispose()
})
