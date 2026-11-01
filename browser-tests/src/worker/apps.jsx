// 7.2 W-1 (sygnal/worker): the apps the worker suite runs in a real module Web Worker
// (tests/worker-7-2.jsx). The worker's name picks the app.
import { run, Collection } from 'sygnal'
import { createWorkerTarget } from 'sygnal/worker'

function Todos({ state }) {
  return (
    <div>
      <form className="add"><input className="new" value={state.text} /></form>
      <ul className="items">{state.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  )
}
Todos.initialState = { text: '', items: [] }
Todos.intent = ({ DOM }) => ({ TYPE: DOM.select('.new').events('input').value(), ADD: DOM.select('.add').events('submit') })
Todos.model = {
  TYPE: (s, v) => ({ ...s, text: v }),
  ADD: (s) => (s.text ? { text: '', items: [...s.items, s.text] } : s),
}

// declared preventDefaults: Tab kept in a field (a pattern), a client-side link (true), in a Collection row's scope
function Row({ state }) {
  return <li><a className="go" href={'#row-' + state.id}>row {state.id}</a></li>
}
Row.intent = ({ DOM }) => ({ GO: DOM.select('.go').events('click', { preventDefault: true }) })
Row.model = { GO: { PARENT: (s) => 'go' + s.id } }
function Keys({ state }) {
  return (
    <div>
      <input className="tabbed" />
      <input className="next" />
      <a className="out" href="#out">out</a>
      <ul><Collection of={Row} from="rows" /></ul>
      <p className="log">{state.log.join(',')}</p>
    </div>
  )
}
Keys.initialState = { rows: [{ id: 1 }, { id: 2 }], log: [] }
Keys.intent = ({ DOM, CHILD }) => ({
  KEY: DOM.select('.tabbed').events('keydown', { preventDefault: { key: 'Tab' } }).map((e) => e.key),
  ROWS: CHILD.select(Row),
})
const log = (s, x) => ({ ...s, log: [...s.log, x] })
Keys.model = { KEY: log, ROWS: log }

// the caret through a worker write: the model drops leading spaces
function Trim({ state }) { return <input className="trim" value={state.v} /> }
Trim.initialState = { v: '' }
Trim.intent = ({ DOM }) => ({ V: DOM.select('.trim').events('input').value() })
Trim.model = { V: (s, v) => ({ v: v.replace(/^\s+/, '') }) }

// high-frequency events: how many pointermoves and wheels reach the app, the last position, the wheel's total
function Pad({ state }) {
  return <div className="pad" style={{ width: '300px', height: '120px', background: '#eef' }}><p className="moves">{state.n}:{state.x}</p><p className="wheel">{state.w}:{state.dy}</p></div>
}
Pad.initialState = { n: 0, x: 0, w: 0, dy: 0 }
Pad.intent = ({ DOM }) => ({
  MOVE: DOM.select('.pad').events('pointermove').map((e) => Math.round(e.clientX)),
  WHEEL: DOM.select('.pad').events('wheel').map((e) => e.deltaY),
})
Pad.model = {
  MOVE: (s, x) => ({ ...s, n: s.n + 1, x }),
  WHEEL: (s, dy) => ({ ...s, w: s.w + 1, dy: s.dy + dy }),
}

const apps = { todos: Todos, keys: Keys, trim: Trim, pad: Pad }
const target = createWorkerTarget(self)
run(apps[self.name], { DOM: target.driver })
