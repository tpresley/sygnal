import { run, Collection, makeFetchDriver } from 'sygnal'
import { buildData } from '../../lib/data.js'

// Spike 0-S: every Collection item fetches its own detail (reply actions to the exact item).
// fetch is stubbed in the page: it resolves at once with the URL and a counter
let calls = 0
window.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ d: url + '#' + ++calls }), { headers: { 'Content-Type': 'application/json' } }))

function Row({ state }) {
  return (
    <div className="row">
      <span className="col-id">{state.id}</span>
      <a className="lbl">{state.label}</a>
      <span className="det">{state.d || '-'}</span>
      <a className="reload">r</a>
    </div>
  )
}
Row.intent = ({ DOM }) => ({ RELOAD: DOM.click('.reload') })
Row.model = {
  BOOTSTRAP: { HTTP: (s) => ({ url: '/r/' + s.id, ok: 'GOT' }) },
  RELOAD: { HTTP: (s) => ({ url: '/r/' + s.id, ok: 'GOT', latest: true }) },
  GOT: (s, body) => ({ ...s, d: body.d }),
}

function App({ state }) {
  return (
    <div className="container">
      <div className="controls">
        <button id="run">Create 1,000 rows</button>
        <button id="clear">Clear</button>
        <span className="loaded">{state.loaded}</span>
      </div>
      <div className="table">
        <Collection of={Row} from="rows" />
      </div>
    </div>
  )
}
App.initialState = { rows: [] }
App.calculated = { loaded: [['rows'], (s) => s.rows.filter((r) => r.d).length] }
App.intent = ({ DOM }) => ({ RUN: DOM.click('#run'), CLEAR: DOM.click('#clear') })
App.model = {
  RUN: (state) => ({ ...state, rows: buildData(1000) }),
  CLEAR: (state) => ({ ...state, rows: [] }),
}
run(App, { HTTP: makeFetchDriver() }, { mountPoint: '#main' })
