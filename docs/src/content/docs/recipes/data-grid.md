---
title: Data Grid (AG Grid)
description: AG Grid Community as a Sygnal widget tag, with rows in state, edits and selection as events, and an export command
---

[AG Grid](https://www.ag-grid.com/) is a full spreadsheet-like grid: virtual scrolling for large data sets, column resizing and reordering, in-cell editing, keyboard navigation, CSV export. It renders everything itself, so [`defineWidget`](/guide/widgets/) turns it into a JSX tag. The rows stay in your state: the grid reports edits and selection as events, and the model decides what changes.

This recipe uses the free Community edition (`ag-grid-community`). For a table you style yourself, with a few hundred rows, the lighter [TanStack Table recipe](/recipes/data-table/) is enough.

## Install

```sh
npm install ag-grid-community
```

## The widget

```js live-file=./Grid.js
// Grid.js
import { defineWidget } from 'sygnal'
import {
  createGrid, ModuleRegistry, ClientSideRowModelModule, RowSelectionModule,
  TextEditorModule, NumberEditorModule, CsvExportModule,
} from 'ag-grid-community'

ModuleRegistry.registerModules([
  ClientSideRowModelModule, RowSelectionModule, TextEditorModule, NumberEditorModule, CsvExportModule,
])

export const Grid = defineWidget({
  name: 'Grid',
  mount: (el, props, dispatch) => createGrid(el, {
    columnDefs: props.columns,
    rowData: props.rows,
    getRowId: (params) => params.data.id,
    // edits become events; the grid shows them once the state has them
    readOnlyEdit: true,
    onCellEditRequest: (event) =>
      dispatch('cell-edit', { id: event.data.id, field: event.colDef.field, value: event.newValue }),
    rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: true },
    onSelectionChanged: (event) => dispatch('row-select', event.api.getSelectedRows()[0]?.id ?? null),
  }),
  update: (grid, props) => {
    grid.setGridOption('columnDefs', props.columns)
    grid.setGridOption('rowData', props.rows)
  },
  unmount: (grid) => grid.destroy(),
  events: ['cell-edit', 'row-select'],
  commands: {
    exportCsv: (grid, { fileName }) => grid.exportDataAsCsv({ fileName }),
  },
})
```

- `readOnlyEdit: true` keeps the grid from writing an edit into the row object. It fires `onCellEditRequest` instead, the widget sends that as a `cell-edit` event, and the edit shows up in the grid when the new rows come back through `update`.
- `getRowId` gives each row its identity, so a new `rowData` array updates only the rows that changed, and keeps the selection, the scroll position and the focused cell.
- The `exportCsv` command gets the options of the element command (`fileName`).

## Using it

```jsx live
// Stock.jsx
import { Grid } from './Grid.js'

const COLUMNS = [
  { field: 'name', headerName: 'Item', editable: true, flex: 2 },
  { field: 'count', headerName: 'In stock', editable: true, cellDataType: 'number', flex: 1 },
]

export function Stock({ state }) {
  const selected = state.items.find((item) => item.id === state.selected)
  return (
    <section>
      <Grid className="grid" columns={COLUMNS} rows={state.items} />
      <p className="selected">{selected ? `${selected.name}: ${selected.count} in stock` : 'No item selected'}</p>
      <button className="restock" disabled={!selected}>Restock 10</button>
      <button className="export">Export CSV</button>
    </section>
  )
}

Stock.initialState = {
  items: [
    { id: 'a1', name: 'Bolts', count: 120 },
    { id: 'a2', name: 'Nuts', count: 80 },
    { id: 'a3', name: 'Washers', count: 0 },
  ],
  selected: null,
}

Stock.intent = ({ DOM }) => ({
  EDIT: DOM.select('.grid').events('cell-edit').detail(),
  SELECT: DOM.select('.grid').events('row-select').detail(),
  RESTOCK: DOM.click('.restock'),
  EXPORT: DOM.click('.export'),
})

const change = (items, id, values) => items.map((item) => (item.id === id ? { ...item, ...values } : item))

Stock.model = {
  EDIT: (state, { id, field, value }) => ({ ...state, items: change(state.items, id, { [field]: value }) }),
  SELECT: (state, id) => ({ ...state, selected: id }),
  RESTOCK: (state) => {
    const item = state.items.find((it) => it.id === state.selected)
    return { ...state, items: change(state.items, item.id, { count: item.count + 10 }) }
  },
  EXPORT: { ELEMENT: { exportCsv: '.grid', fileName: 'stock.csv' } },
}
```

```css live
.grid { height: 400px; }
```

`COLUMNS` is a module constant, so the `columns` prop keeps its identity and only a change to `items` runs `update`. The grid draws its own theme (Quartz by default); it needs a height to fill.

## Testing

```jsx
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
```

In a real browser (`renderComponent(Stock, { dom: 'real' })` under Playwright), double-click a cell (`.grid [row-id="a2"] [col-id="count"]`), type and press Enter: the state gets the new count, and the cell shows it once the new rows reach the grid. `t.widget('.grid').instance` is the grid API (`getSelectedRows()`, `isDestroyed()`).

## Size

Measured with Vite, minified and gzipped, Sygnal not included: **240 KB** with the five modules above. `AllCommunityModule` registers every Community feature and makes it 333 KB. `defineWidget` adds 1.1 KB for the first widget in an app.

## Pitfalls

- **Keep `readOnlyEdit: true`.** Without it, AG Grid writes each edit into the row object it was given, which is the object in your state: the state changes without an action, and the next render can't tell anything changed.
- **Give rows an id.** Without `getRowId`, each new `rowData` array replaces every row: the selection and the focused cell are lost after each edit.
- **Register the modules you use.** AG Grid 33 and later are modular. An option whose module isn't registered doesn't work, and the grid logs an error with a link; register `ValidationModule` in development to get messages that name the missing module.
- **Don't recreate `columns` in the view.** A new array on every render runs `update` every time and makes the grid rebuild its columns. Keep column definitions in a constant, or in state if the user can change them.
- **Keyboard and screen readers.** The grid has its own keyboard navigation and ARIA grid roles: don't wrap it in elements that capture arrow keys, and label the page section it sits in.
