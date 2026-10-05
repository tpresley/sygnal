import { Collection } from 'sygnal'
import { run } from '../../../../dev-plans/research/core-rewrite/proto/core-next.ts'
import { buildData } from '../../lib/data.js'

// Spike 0-S: a Collection with filter + sort, calculated fields on the items and on the parent
function Row({ state }) {
  return (
    <div className={state.hot ? 'row danger' : 'row'}>
      <span className="col-id">{state.id}</span>
      <a className="lbl">{state.short}</a>
      <span className="len">{state.len}</span>
      <a className="bump">+</a>
    </div>
  )
}
Row.calculated = {
  short: [['label'], (s) => s.label.slice(0, 14)],
  len: [['label'], (s) => s.label.length],
  hot: [['score'], (s) => s.score > 90],
}
Row.intent = ({ DOM }) => ({ BUMP: DOM.click('.bump') })
Row.model = { BUMP: (s) => ({ ...s, score: s.score + 5, label: s.label + '!' }) }

const even = (r) => r.id % 2 === 0
const BY_SCORE = [{ score: 'desc' }, 'id']
function App({ state }) {
  return (
    <div className="container">
      <div className="controls">
        <button id="run">Create 1,000 rows</button>
        <button id="filter">Toggle filter</button>
        <button id="sort">Toggle sort</button>
        <button id="update">Update every 10th row</button>
        <button id="clear">Clear</button>
        <span className="visible">{state.visible}</span>
        <span className="bumped">{state.bumped}</span>
      </div>
      <Collection of={Row} from="rows" filter={state.evenOnly ? even : undefined} sort={state.byScore ? BY_SCORE : 'id'} className="table" />
    </div>
  )
}
App.initialState = { rows: [], evenOnly: false, byScore: false }
App.calculated = {
  visible: [['rows', 'evenOnly'], (s) => (s.evenOnly ? s.rows.filter(even).length : s.rows.length)],
  bumped: [['rows'], (s) => s.rows.filter((r) => r.label.endsWith('!')).length],
}
const withScore = (rows) => rows.map((r) => ({ ...r, score: (r.id * 37) % 100 }))
App.intent = ({ DOM }) => ({
  RUN: DOM.click('#run'), FILTER: DOM.click('#filter'), SORT: DOM.click('#sort'), UPDATE: DOM.click('#update'), CLEAR: DOM.click('#clear'),
})
App.model = {
  RUN: (state) => ({ ...state, rows: withScore(buildData(1000)), evenOnly: false, byScore: false }),
  FILTER: (state) => ({ ...state, evenOnly: !state.evenOnly }),
  SORT: (state) => ({ ...state, byScore: !state.byScore }),
  UPDATE: (state) => ({ ...state, rows: state.rows.map((r, i) => (i % 10 === 0 ? { ...r, label: r.label + '!' } : r)) }),
  CLEAR: (state) => ({ ...state, rows: [] }),
}
run(App, {}, { mountPoint: '#main' })
