// Baseline: the benchmark's Collection table (one Row component per row) as written
import { run, Collection } from 'sygnal'
import { collStatics } from './table-statics.js'

function Row({ state, context }) {
  return (
    <div className={context.selected === state.id ? 'row danger' : 'row'}>
      <span className="col-id">{state.id}</span>
      <a className="lbl">{state.label}</a>
      <a className="remove">x</a>
    </div>
  )
}
function App() {
  return (
    <div className="container">
      <div className="controls">
        <button id="run">Create 1,000 rows</button>
        <button id="runlots">Create 10,000 rows</button>
        <button id="add">Append 1,000 rows</button>
        <button id="update">Update every 10th row</button>
        <button id="clear">Clear</button>
        <button id="swaprows">Swap Rows</button>
      </div>
      <div className="table">
        <Collection of={Row} from="rows" />
      </div>
    </div>
  )
}
run(collStatics(App, Row), {}, { mountPoint: '#main' })
