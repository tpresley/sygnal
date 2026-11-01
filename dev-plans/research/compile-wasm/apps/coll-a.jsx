// Tier A for the Collection table: Row's view compiled to direct vnodes (App keeps its JSX:
// it renders once; the Collection marker stays a pragma call)
import { run, Collection } from 'sygnal'
import { P } from '../proto/compiled-runtime.js'
import { collStatics } from './table-statics.js'

const $colid = { props: { className: 'col-id' } }, $lbl = { props: { className: 'lbl' } }, $remove = { props: { className: 'remove' } }
const $row = { props: { className: 'row' } }, $danger = { props: { className: 'row danger' } }

function Row({ state, context }) {
  return new P('div', context.selected === state.id ? $danger : $row, [
    new P('span', $colid, undefined, '' + state.id),
    new P('a', $lbl, undefined, '' + state.label),
    new P('a', $remove, undefined, 'x'),
  ])
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
