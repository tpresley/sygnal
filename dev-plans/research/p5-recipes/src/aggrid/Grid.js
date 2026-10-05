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
