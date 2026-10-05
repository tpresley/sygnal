// People.jsx
import { peopleTable, nextSorting } from './peopleTable.js'

const ARIA_SORT = { asc: 'ascending', desc: 'descending' }

export function People({ state }) {
  const table = peopleTable(state)
  return (
    <section>
      <label>Search <input className="search" value={state.search} /></label>
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} aria-sort={ARIA_SORT[header.column.getIsSorted()] || 'none'}>
                  <button className="sort" data={{ column: header.id }}>{header.column.columnDef.header}</button>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getAllCells().map((cell) => <td key={cell.id}>{cell.getValue()}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <button className="prev" disabled={!table.getCanPreviousPage()}>Previous</button>
      <span className="page">Page {state.page + 1} of {Math.max(table.getPageCount(), 1)}</span>
      <button className="next" disabled={!table.getCanNextPage()}>Next</button>
    </section>
  )
}

People.initialState = {
  people: [
    { id: 'p1', name: 'Ada', team: 'Engines', points: 36 },
    { id: 'p2', name: 'Grace', team: 'Compilers', points: 45 },
    { id: 'p3', name: 'Alan', team: 'Engines', points: 41 },
    { id: 'p4', name: 'Edsger', team: 'Compilers', points: 12 },
    { id: 'p5', name: 'Barbara', team: 'Languages', points: 28 },
  ],
  sorting: [],
  search: '',
  page: 0,
}

People.intent = ({ DOM }) => ({
  SEARCH: DOM.input('.search').value(),
  SORT: DOM.click('.sort').data('column'),
  PREV: DOM.click('.prev'),
  NEXT: DOM.click('.next'),
})

People.model = {
  SEARCH: (state, search) => ({ ...state, search, page: 0 }),
  SORT: (state, id) => ({ ...state, sorting: nextSorting(state.sorting, id), page: 0 }),
  PREV: (state) => ({ ...state, page: state.page - 1 }),
  NEXT: (state) => ({ ...state, page: state.page + 1 }),
}
