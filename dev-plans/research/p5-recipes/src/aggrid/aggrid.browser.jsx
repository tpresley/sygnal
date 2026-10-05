import { renderComponent } from 'sygnal'
import { Stock } from './Stock.jsx'
import { assert, equal, waitFor, pw } from '../browser-util.js'

const cell = (row, col) => `.grid [row-id="${row}"] [col-id="${col}"]`

export const tests = {
  async 'AG Grid: a real cell edit reaches the state (the row objects stay untouched), selection + restock update the grid, export command, destroy'() {
    const t = renderComponent(Stock, { dom: 'real' })
    await t.ready()
    await waitFor(() => document.querySelector(cell('a1', 'count')), 'rows rendered')
    const grid = t.widget('.grid').instance
    const before = t.state.items

    // edit "Nuts" count: double-click, type, Enter
    await pw('dblclick', cell('a2', 'count'))
    await waitFor(() => document.querySelector(`${cell('a2', 'count')} input`), 'editor open')
    await pw('fill', `${cell('a2', 'count')} input`, '75')
    await pw('press', `${cell('a2', 'count')} input`, 'Enter')
    await t.waitForState((state) => state.items[1].count === 75)
    equal(before[1].count, 80, 'readOnlyEdit: the grid did not mutate the old row object')
    await waitFor(() => document.querySelector(cell('a2', 'count')).textContent === '75', 'grid shows the edited value from state')

    // select "Washers" with a real click, restock
    await pw('click', cell('a3', 'name'))
    await t.waitForState((state) => state.selected === 'a3')
    await pw('click', '.restock')
    await t.waitForState((state) => state.items[2].count === 10)
    await waitFor(() => document.querySelector(cell('a3', 'count')).textContent === '10', 'grid shows the restocked count')
    equal(t.query('.selected').textContent, 'Washers: 10 in stock')
    assert(grid.getSelectedRows()[0]?.id === 'a3', 'selection kept across the rowData update (getRowId)')

    // the export command reaches the grid with its options
    let exported = null
    grid.exportDataAsCsv = (options) => { exported = options }
    await pw('click', '.export')
    await waitFor(() => exported, 'export command ran')
    equal(exported, { fileName: 'stock.csv' })

    t.dispose()
    assert(grid.isDestroyed(), 'destroyed on unmount')
  },
}
