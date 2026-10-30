// Tier B for the Collection table: Row's view is one block
import { run, Collection } from 'sygnal'
import { block } from '../proto/compiled-runtime.js'
import { collStatics } from './table-statics.js'

const RowBlock = block('div', '<span class="col-id"> </span><a class="lbl"> </a><a class="remove">x</a>',
  [['class', []], ['text', [0, 0]], ['text', [1, 0]]])

function Row({ state, context }) {
  return RowBlock([context.selected === state.id ? 'row danger' : 'row', state.id, state.label])
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
