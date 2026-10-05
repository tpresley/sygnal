import { run } from 'sygnal'
import { COUNTERS } from '../../lib/data.js'

// PLAN-4.6 R1: 1,000 counters as tag children (no Collection), each bound to its own state slice;
// the same ops as counters.jsx (React's counters page is the same shape: a map of children)
function Counter({ state }) {
  return (
    <div className="counter">
      <span className="val">{state.n}</span>
      <button className="inc">+</button>
    </div>
  )
}
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (state) => ({ ...state, n: state.n + 1 }) }

function App({ state }) {
  return (
    <div>
      <button id="create">Create counters</button>
      <button id="destroy">Destroy counters</button>
      <div className="counters">{state.ids.map(id => <Counter id={id} state={'c' + id} />)}</div>
    </div>
  )
}
App.initialState = { ids: [] }
App.intent = ({ DOM }) => ({ CREATE: DOM.click('#create'), DESTROY: DOM.click('#destroy') })
App.model = {
  CREATE: () => {
    const s = { ids: Array.from({ length: COUNTERS }, (_, i) => i + 1) }
    for (const id of s.ids) s['c' + id] = { n: 0 }
    return s
  },
  DESTROY: () => ({ ids: [] }),
}
run(App, {}, { mountPoint: '#main' })
