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
