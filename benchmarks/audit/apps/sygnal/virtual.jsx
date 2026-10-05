import { run, VirtualCollection } from 'sygnal'
import { buildData } from '../../lib/data.js'

// PLAN-5 V-1: 10k / 100k rows in a 640 px <VirtualCollection>; jump with the scrollToIndex element command
function Row({ state }) {
  return (
    <div className="row">
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
      <VirtualCollection of={Row} from="rows" className="rows" estimateSize={32} aria-label="Rows" />
    </div>
  )
}
App.initialState = { rows: [] }
App.intent = ({ DOM }) => ({
  RUN10K: DOM.click('#run10k'),
  RUN100K: DOM.click('#run100k'),
  CLEAR: DOM.click('#clear'),
  JUMP: DOM.click('#jump'),
})
App.model = {
  RUN10K: (state) => ({ ...state, rows: buildData(10000) }),
  RUN100K: (state) => ({ ...state, rows: buildData(100000) }),
  CLEAR: (state) => ({ ...state, rows: [] }),
  JUMP: { ELEMENT: { scrollToIndex: '.rows', index: 9000, align: 'start' } },
}
run(App, {}, { mountPoint: '#main' })
