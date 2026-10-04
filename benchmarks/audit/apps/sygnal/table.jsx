import { run } from 'sygnal'
import { buildData } from '../../lib/data.js'

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
App.initialState = { rows: [], selected: 0 }
App.intent = ({ DOM }) => ({
  RUN: DOM.click('#run'),
  RUNLOTS: DOM.click('#runlots'),
  ADD: DOM.click('#add'),
  UPDATE: DOM.click('#update'),
  CLEAR: DOM.click('#clear'),
  SWAP: DOM.click('#swaprows'),
  SELECT: DOM.click('.lbl').data('id', Number),
  REMOVE: DOM.click('.remove').data('id', Number),
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
  SELECT: (state, id) => ({ ...state, selected: id }),
  REMOVE: (state, id) => ({ ...state, rows: state.rows.filter(r => r.id !== id) }),
}
run(App, {}, { mountPoint: '#main' })
