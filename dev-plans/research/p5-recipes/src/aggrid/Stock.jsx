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
