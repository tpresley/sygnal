import { run, Collection } from 'sygnal'
import { buildData } from '../../lib/data.js'

// PLAN-5 V-1: the virtual scenario with a plain Collection (every row rendered) in the same 640 px
// scroll container; the jump scrolls the container (element command scrollTo)
function Row({ state }) {
  return (
    <div className="row" data-index={state.i}>
      <span className="col-id">{state.id}</span>
      <span className="lbl">{state.label}</span>
    </div>
  )
}

function App() {
  return (
    <div className="container">
      <div className="controls">
        <button id="run10k">Create 10,000 rows</button>
        <button id="run100k">Create 100,000 rows</button>
        <button id="clear">Clear</button>
        <button id="jump">Jump to row 9,000</button>
      </div>
      <div className="rows">
        <Collection of={Row} from="rows" />
      </div>
    </div>
  )
}
// data-index: the row's position (the ops' `done` checks are the same for every page)
const make = (n) => buildData(n).map((r, i) => ({ ...r, i }))
App.initialState = { rows: [] }
App.intent = ({ DOM }) => ({
  RUN10K: DOM.click('#run10k'),
  RUN100K: DOM.click('#run100k'),
  CLEAR: DOM.click('#clear'),
  JUMP: DOM.click('#jump'),
})
App.model = {
  RUN10K: (state) => ({ ...state, rows: make(10000) }),
  RUN100K: (state) => ({ ...state, rows: make(100000) }),
  CLEAR: (state) => ({ ...state, rows: [] }),
  JUMP: { ELEMENT: { scrollTo: '.rows', top: 9000 * 32 } },
}
run(App, {}, { mountPoint: '#main' })
