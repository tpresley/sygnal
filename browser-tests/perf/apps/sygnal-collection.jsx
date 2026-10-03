import { run, ABORT, Collection } from 'sygnal'
import { buildRows, swapped } from './data.js'
import './harness.js'

// The scenario as idiomatic Sygnal: one Collection item component per row.
// An edit is the row's own action; the Collection writes it back by id.
function Row({ state }) {
  return (
    <div className="row" data={{ id: state.id }}>
      <span className="id">{state.id}</span>
      <button type="button" className="lbl">{state.label}</button>
    </div>
  )
}

Row.intent = ({ DOM }) => ({ EDIT: DOM.click('.lbl') })
Row.model = { EDIT: (state) => ({ ...state, label: state.label + ' !!!' }) }

function App() {
  return (
    <div className="app">
      <div className="controls">
        <button type="button" id="run">Create 1,000 rows</button>
        <button type="button" id="add">Append 1,000 rows</button>
        <button type="button" id="swaprows">Swap rows</button>
        <button type="button" id="clear">Clear</button>
      </div>
      <Collection of={Row} from="rows" className="rows" />
    </div>
  )
}

App.initialState = { rows: [], nextId: 1 }

App.intent = ({ DOM }) => ({
  RUN:   DOM.click('#run'),
  ADD:   DOM.click('#add'),
  SWAP:  DOM.click('#swaprows'),
  CLEAR: DOM.click('#clear'),
})

App.model = {
  RUN:   (state) => ({ ...state, rows: buildRows(1000, state.nextId), nextId: state.nextId + 1000 }),
  ADD:   (state) => ({ ...state, rows: state.rows.concat(buildRows(1000, state.nextId)), nextId: state.nextId + 1000 }),
  SWAP:  (state) => (state.rows.length <= 998 ? ABORT : { ...state, rows: swapped(state.rows) }),
  CLEAR: (state) => (state.rows.length === 0 ? ABORT : { ...state, rows: [] }),
}

run(App, {}, { mountPoint: '#app' })
