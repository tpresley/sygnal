import { run, Collection } from 'sygnal'
import { buildData } from '../../lib/data.js'

// Same table, idiomatic "component per row": each row is a Collection item with its own intent/model
function Row({ state, context }) {
  return (
    <div className={context.selected === state.id ? 'row danger' : 'row'}>
      <span className="col-id">{state.id}</span>
      <a className="lbl">{state.label}</a>
      <a className="remove">x</a>
    </div>
  )
}
Row.intent = ({ DOM }) => ({ SELECT: DOM.click('.lbl'), REMOVE: DOM.click('.remove') })
Row.model = {
  SELECT: { PARENT: (state) => state.id },
  REMOVE: () => undefined,
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
App.initialState = { rows: [], selected: 0 }
App.context = { selected: (state) => state.selected }
App.intent = ({ DOM, CHILD }) => ({
  RUN: DOM.click('#run'),
  RUNLOTS: DOM.click('#runlots'),
  ADD: DOM.click('#add'),
  UPDATE: DOM.click('#update'),
  CLEAR: DOM.click('#clear'),
  SWAP: DOM.click('#swaprows'),
  SELECTED: CHILD.select(Row),
})
App.model = {
  RUN: (state) => ({ ...state, rows: buildData(1000), selected: 0 }),
  RUNLOTS: (state) => ({ ...state, rows: buildData(10000), selected: 0 }),
  ADD: (state) => ({ ...state, rows: state.rows.concat(buildData(1000)) }),
  UPDATE: (state) => ({ ...state, rows: state.rows.map((r, i) => (i % 10 === 0 ? { ...r, label: r.label + ' !!!' } : r)) }),
  CLEAR: (state) => ({ ...state, rows: [], selected: 0 }),
  SWAP: (state) => {
    if (state.rows.length < 999) return state
    const rows = state.rows.slice(); const t = rows[1]; rows[1] = rows[998]; rows[998] = t
    return { ...state, rows }
  },
  SELECTED: (state, id) => ({ ...state, selected: id }),
}
run(App, {}, { mountPoint: '#main' })
