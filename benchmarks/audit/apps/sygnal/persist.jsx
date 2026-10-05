import { run, Collection, persist } from 'sygnal'
import { buildData } from '../../lib/data.js'

// PLAN-4.6 R3: the persist write path: a root with a 1k-row list persisted to localStorage
// (debounceMs 0), an action that changes one row: render + the write
localStorage.removeItem('bench-persist')
// localStorage, with each write marked on <body> (the bench re-checks its done() on DOM mutations)
let writes = 0
const storage = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => { localStorage.setItem(k, v); document.body.setAttribute('data-saved', String(++writes)) },
  removeItem: (k) => localStorage.removeItem(k),
}
function Row({ state }) {
  return (
    <div className="row">
      <span className="col-id">{state.id}</span>
      <a className="lbl">{state.label}</a>
      <a className="bump">b</a>
    </div>
  )
}
Row.intent = ({ DOM }) => ({ BUMP: DOM.click('.bump') })
Row.model = { BUMP: (s) => ({ ...s, label: s.label + '!' }) }

function App({ state }) {
  return (
    <div className="container">
      <div className="controls">
        <button id="run">Create 1,000 rows</button>
        <button id="clear">Clear</button>
        <span className="count">{state.rows.length}</span>
      </div>
      <Collection of={Row} from="rows" className="table" />
    </div>
  )
}
App.initialState = { rows: [] }
App.persist = persist({ key: 'bench-persist', debounceMs: 0, storage })
App.intent = ({ DOM }) => ({ RUN: DOM.click('#run'), CLEAR: DOM.click('#clear') })
App.model = {
  RUN: (state) => ({ ...state, rows: buildData(1000) }),
  CLEAR: (state) => ({ ...state, rows: [] }),
}
run(App, {}, { mountPoint: '#main' })
