// Baseline: the benchmark's table view as written (JSX through the pragma)
import { run } from 'sygnal'
import { tableStatics } from './table-statics.js'

function App({ state }) {
  return (
    <div className="container">
      <div className="controls">
        <button id="run">Create 1,000 rows</button>
        <button id="runlots">Create 10,000 rows</button>
        <button id="add">Append 1,000 rows</button>
        <button id="update">Update every 10th row</button>
        <button id="clear">Clear</button>
        <button id="swaprows">Swap Rows</button>
        <button id="updatelast">Update last row</button>
      </div>
      <div className="table">
        {state.rows.map(row => (
          <div className={row.id === state.selected ? 'row danger' : 'row'} key={row.id} data={{ id: row.id }}>
            <span className="col-id">{row.id}</span>
            <a className="lbl">{row.label}</a>
            <a className="remove">x</a>
          </div>
        ))}
      </div>
    </div>
  )
}
run(tableStatics(App), {}, { mountPoint: '#main' })
