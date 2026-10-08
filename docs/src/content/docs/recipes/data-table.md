---
title: Data Table (TanStack Table)
description: Sorting, search and paging with TanStack Table v9 as a pure function of state, rendered with ordinary JSX
---

[TanStack Table](https://tanstack.com/table) is headless: it computes which rows to show (sorted, filtered, paged) and renders nothing. That fits Sygnal without a widget. Keep the table's settings (sorting, search, page) in your state, build the table from that state in the view, and render its rows with JSX. Sygnal still renders every element, so the table works in the mock DOM, on the server, and with sygnal-check.

This recipe uses **v9** (`@tanstack/table-core` 9.x), whose API differs from v8: `constructTable` and `tableFeatures` replace `createTable` and the `get*RowModel` options.

## Install

```sh
npm install @tanstack/table-core
```

## The table

```js live-file=./peopleTable.js
// peopleTable.js
import {
  constructTable, createColumnHelper, tableFeatures,
  rowSortingFeature, createSortedRowModel, sortFn_alphanumeric, sortFn_basic,
  columnFilteringFeature, globalFilteringFeature, createFilteredRowModel, filterFn_includesString,
  rowPaginationFeature, createPaginatedRowModel,
} from '@tanstack/table-core'
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings'

const features = tableFeatures({
  coreReactivityFeature: storeReactivityBindings(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
})

const column = createColumnHelper()
const columns = column.columns([
  column.accessor('name', { header: 'Name', sortFn: 'alphanumeric' }),
  column.accessor('team', { header: 'Team', sortFn: 'alphanumeric' }),
  column.accessor('points', { header: 'Points', sortFn: 'basic' }),
])

export const PAGE_SIZE = 3

// A pure function of the component's state: the table never holds state of its own
export const peopleTable = (state) => constructTable({
  features,
  columns,
  data: state.people,
  getRowId: (person) => person.id,
  globalFilterFn: 'includesString',
  state: {
    sorting: state.sorting,
    globalFilter: state.search,
    pagination: { pageIndex: state.page, pageSize: PAGE_SIZE },
  },
})

// click a column: ascending, then descending, then unsorted
export const nextSorting = (sorting, id) =>
  sorting[0]?.id !== id ? [{ id, desc: false }] : sorting[0].desc ? [] : [{ id, desc: true }]
```

- `features`, `columns` and the sort and filter functions are created once, at module level. v9 registers each feature explicitly; an API you didn't register (say `getCanNextPage` without `rowPaginationFeature`) doesn't exist.
- `peopleTable(state)` passes every setting through the `state` option. The table owns no state and nobody calls its setters (`setSorting`, `nextPage`): actions change Sygnal's state, and the next render builds the table from it.

## Using it

```jsx live
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
```

The column headers are buttons inside the `<th>`, so they work with the keyboard, and `aria-sort` tells screen readers which column is sorted and how.

## Testing

Everything is plain markup, so the mock DOM shows the result directly:

```jsx
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
```

`peopleTable` is a plain function too: a test can call it with a state object and check `getRowModel().rows` without rendering anything.

## Size

Measured with Vite, minified and gzipped, Sygnal not included: **16 KB** for `table-core` with sorting, filtering and pagination. Each feature you register adds to it; `stockFeatures` registers all of them.

## Performance

The view builds a new table on every render. In a browser that took about 1.5–3 ms for 1,000 rows and 9–23 ms for 10,000 rows (sorted, filtered and paged, depending on the engine). That is fine up to a few thousand rows. Beyond that:

- page or filter on the server and pass only the visible rows as `data` (`manualPagination`, `manualSorting`, `manualFiltering`);
- or render all rows with a [`VirtualCollection`](/guide/virtual-collections/) and sort and filter the array in the model.

## Pitfalls

- **Register a reactivity binding.** v9's `constructTable` needs `coreReactivityFeature` in `features`. Without it, it throws `Cannot read properties of undefined (reading 'wrapExternalAtoms')`. `storeReactivityBindings()` is the framework-neutral one; the table's own atoms aren't used here, because the state comes from Sygnal.
- **Create features and columns once.** Build them at module level, not in the view: TanStack expects them to keep their identity, and creating them per render also costs time.
- **One owner per setting.** Pass each setting through `state` and change it in the model. Calling the table's own setters (`table.setSorting`, `table.nextPage`) changes nothing that lasts: the next render builds a new table from Sygnal's state.
- **Reset the page.** A new search or sort can leave the current page past the end. The reducers here go back to page 0, as most tables do.
- **Call methods on their objects.** `row.getValue('name')` works; `const { getValue } = row` loses `this`.
