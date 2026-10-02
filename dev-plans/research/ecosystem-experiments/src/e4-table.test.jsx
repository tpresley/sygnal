import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { createTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel } from '@tanstack/table-core'

// The whole "adapter": table state lives in Sygnal state; createTable is a pure function of it
const columns = [{ accessorKey: 'name', header: 'Name' }, { accessorKey: 'age', header: 'Age' }]
const tableFor = (state) => createTable({
  data: state.people, columns,
  state: { sorting: state.sorting, globalFilter: state.filter, pagination: state.page, columnPinning: {}, columnVisibility: {}, columnOrder: [] },
  onStateChange: () => {}, renderFallbackValue: null,
  getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
})

function People({ state }) {
  const table = tableFor(state)
  return <div>
    <input className="filter" value={state.filter} />
    <table><thead>{table.getHeaderGroups().map(g => <tr>{g.headers.map(h =>
      <th className="sort" data={{ col: h.column.id }}>{h.column.columnDef.header}{({ asc: ' ▲', desc: ' ▼' })[h.column.getIsSorted()] || ''}</th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(r => <tr className="row">{r.getVisibleCells().map(c => <td>{String(c.getValue())}</td>)}</tr>)}</tbody></table>
    <button className="next">next</button>
  </div>
}
People.initialState = {
  people: [{ name: 'Ann', age: 41 }, { name: 'Bob', age: 25 }, { name: 'Cy', age: 33 }, { name: 'Di', age: 19 }],
  sorting: [], filter: '', page: { pageIndex: 0, pageSize: 3 },
}
People.intent = ({ DOM }) => ({
  SORT: DOM.click('.sort').data('col'), FILTER: DOM.input('.filter').value(), NEXT: DOM.click('.next'),
})
People.model = {
  SORT: (s, id) => {  // the same cycle TanStack's toggleSorting performs: none → asc → desc → none
    const cur = s.sorting[0]?.id === id ? s.sorting[0].desc : undefined
    return { ...s, sorting: cur === undefined ? [{ id, desc: false }] : cur === false ? [{ id, desc: true }] : [] }
  },
  FILTER: (s, filter) => ({ ...s, filter, page: { ...s.page, pageIndex: 0 } }),
  NEXT: (s) => ({ ...s, page: { ...s.page, pageIndex: s.page.pageIndex + 1 } }),
}

let t; afterEach(() => t?.dispose())
const names = () => t.queryAll('.row').map(r => r.firstChild.textContent)
it('table-core: sort, filter, paginate from Sygnal state', async () => {
  t = renderComponent(People, { dom: 'real' })
  await t.ready()
  expect(names()).toEqual(['Ann', 'Bob', 'Cy'])
  t.simulateEvent('th[data-col="age"]', 'click')
  await t.next(s => s.sorting.length === 1)
  expect(names()).toEqual(['Di', 'Bob', 'Cy'])
  t.simulateEvent('.next', 'click')
  await t.next(s => s.page.pageIndex === 1)
  expect(names()).toEqual(['Ann'])
  t.simulateEvent('.filter', 'input', { value: 'b' })
  await t.next(s => s.filter === 'b')
  expect(names()).toEqual(['Bob'])
})
