import { run, ABORT } from 'sygnal'
import { buildRows, swapped } from './data.js'
import './harness.js'

// The same scenario without per-row components: one component maps the rows
// to keyed elements (the shape of the js-framework-benchmark entry). It isolates
// what the Collection's per-item components cost.
function App({ state }) {
  return (
    <div className="app">
      <div className="controls">
        <button type="button" id="run">Create 1,000 rows</button>
        <button type="button" id="add">Append 1,000 rows</button>
        <button type="button" id="swaprows">Swap rows</button>
        <button type="button" id="clear">Clear</button>
      </div>
      <div className="rows">
        {state.rows.map((row) => (
          <div key={row.id} className="row" data={{ id: row.id }}>
            <span className="id">{row.id}</span>
            <button type="button" className="lbl">{row.label}</button>
          </div>
        ))}
      </div>
    </div>
  )
}

App.initialState = { rows: [], nextId: 1 }

App.intent = ({ DOM }) => ({
  RUN:   DOM.click('#run'),
  ADD:   DOM.click('#add'),
  SWAP:  DOM.click('#swaprows'),
  CLEAR: DOM.click('#clear'),
  EDIT:  DOM.click('.lbl').data('id', Number),
})

App.model = {
  RUN:   (state) => ({ ...state, rows: buildRows(1000, state.nextId), nextId: state.nextId + 1000 }),
  ADD:   (state) => ({ ...state, rows: state.rows.concat(buildRows(1000, state.nextId)), nextId: state.nextId + 1000 }),
  SWAP:  (state) => (state.rows.length <= 998 ? ABORT : { ...state, rows: swapped(state.rows) }),
  CLEAR: (state) => (state.rows.length === 0 ? ABORT : { ...state, rows: [] }),
  EDIT:  (state, id) => ({ ...state, rows: state.rows.map((row) => (row.id === id ? { ...row, label: row.label + ' !!!' } : row)) }),
}

run(App, {}, { mountPoint: '#app' })
