import { run, Collection, makeTimerDriver } from 'sygnal'
import { buildData } from '../../lib/data.js'

// PLAN-4.6 R3: a statics-heavy page: every Collection item declares its own timer (the generic
// statics path with the real makeTimerDriver). Long periods: the ops measure the declarations,
// not ticks
function Row({ state }) {
  return (
    <div className="row">
      <span className="col-id">{state.id}</span>
      <a className="lbl">{state.label}</a>
      <span className="on">{state.off ? 'off' : 'on'}</span>
      <a className="toggle">t</a>
    </div>
  )
}
Row.timers = (s) => ({ tick: !s.off && { every: 60000 + (s.n || 0), action: 'TICK' } })
Row.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
Row.model = {
  TOGGLE: (s) => ({ ...s, off: !s.off }),
  TICK: (s) => s,
}

function App({ state }) {
  return (
    <div className="container">
      <div className="controls">
        <button id="run">Create 1,000 rows</button>
        <button id="clear">Clear</button>
        <button id="update">Update every 10th</button>
        <span className="bumped">{state.bumped}</span>
      </div>
      <div className="table">
        <Collection of={Row} from="rows" />
      </div>
    </div>
  )
}
App.initialState = { rows: [], bumped: 0 }
App.intent = ({ DOM }) => ({ RUN: DOM.click('#run'), CLEAR: DOM.click('#clear'), UPDATE: DOM.click('#update') })
App.model = {
  RUN: (state) => ({ ...state, rows: buildData(1000), bumped: 0 }),
  CLEAR: (state) => ({ ...state, rows: [], bumped: 0 }),
  // a new timer spec (a new period) for every 10th row: their declarations change
  UPDATE: (state) => ({ ...state, bumped: state.bumped + 100, rows: state.rows.map((r, i) => (i % 10 ? r : { ...r, n: (r.n || 0) + 1 })) }),
}
run(App, { TIMER: makeTimerDriver() }, { mountPoint: '#main' })
