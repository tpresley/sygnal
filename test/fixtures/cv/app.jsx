// CV-3 fixtures: apps driven by an IN driver, mounted on a real DOM, compiled (with blocks) and not
import { run, xs, Collection } from 'sygnal'

const rowsOf = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ id: from + i, label: 'row ' + (from + i), n: i }))
const MODEL = {
  RUN: (s) => ({ ...s, rows: rowsOf(20), selected: 0 }),
  SELECT: (s, id) => ({ ...s, selected: id }),
  UPDATE: (s) => ({ ...s, rows: s.rows.map((r, i) => i % 3 ? r : { ...r, label: r.label + ' !!!' }) }),
  SWAP: (s) => { const rows = s.rows.slice(); const t = rows[1]; rows[1] = rows[rows.length - 2]; rows[rows.length - 2] = t; return { ...s, rows } },
  REMOVE: (s, id) => ({ ...s, rows: s.rows.filter(r => r.id !== id) }),
  ADD: (s) => ({ ...s, rows: s.rows.concat(rowsOf(5, 100 + s.rows.length)) }),
  RICH: (s) => ({ ...s, rows: s.rows.map((r, i) => i == 2 ? { ...r, label: ['rich', ' ', 'label'] } : i == 3 ? { ...r, label: null } : i == 4 ? { ...r, label: 0 } : r) }),
  PLAIN: (s) => ({ ...s, rows: s.rows.map((r, i) => i == 2 ? { ...r, label: 'plain again' } : r) }),
  CLEAR: (s) => ({ ...s, rows: [] }),
}
// (renderComponent has no IN source: its tests use simulateAction)
const intent = ({ IN }) => !IN?.filter ? {} : Object.fromEntries(Object.keys(MODEL).map(k => [k, IN.filter(a => a.t === k).map(a => a.d)]))

// .map() rows in one view
export function Table({ state }) {
  return (
    <div className="table">
      <h2>Rows: {state.rows.length}</h2>
      {state.rows.map(row => (
        <div className={row.id === state.selected ? 'row danger' : 'row'} key={row.id} data={{ id: row.id }}>
          <span className="col-id">{row.id}</span>
          <a className="lbl" title={'#' + row.id}>{row.label}</a>
          <a className="remove">x</a> <i>{row.n} of {state.rows.length}</i>
        </div>
      ))}
    </div>
  )
}
Table.initialState = { rows: [], selected: 0 }
Table.intent = intent
Table.model = MODEL

// one Row component per Collection item (the view's root is a block)
function Row({ state, context }) {
  return (
    <div className={context.selected === state.id ? 'row danger' : 'row'}>
      <span className="col-id">{state.id}</span>
      <a className="lbl">{state.label}</a>
      <a className="remove">x</a>
    </div>
  )
}
export function Coll() {
  return <div className="table"><Collection of={Row} from="rows" /></div>
}
Coll.initialState = { rows: [], selected: 0 }
Coll.context = { selected: (s) => s.selected }
Coll.intent = intent
Coll.model = MODEL

export function mount(App, el) {
  let push
  const in$ = xs.create({ start(l) { push = (v) => l.next(v) }, stop() {} })
  const app = run(App, { IN: () => in$ }, { mountPoint: el })
  return { send: (t, d) => push({ t, d }), dispose: app.dispose, app }
}

// CV-4: rendered on the server with rows, then hydrated (the same initial state on both sides)
export function HydrTable(p) { return Table(p) }
HydrTable.initialState = { rows: rowsOf(12).map((r, i) => i == 3 ? { ...r, label: '' } : r), selected: 2 }
HydrTable.intent = intent
HydrTable.model = MODEL
export function HydrColl(p) { return Coll(p) }
HydrColl.initialState = { rows: rowsOf(12), selected: 2 }
HydrColl.context = Coll.context
HydrColl.intent = intent
HydrColl.model = MODEL
