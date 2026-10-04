import { Collection } from 'sygnal'
import { run } from '../../../../dev-plans/research/core-rewrite/proto/core-next.ts'
import { COUNTERS } from '../../lib/data.js'

// 1,000 independent counters; each is a component with its own intent/model (Collection item)
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

function App() {
  return (
    <div>
      <button id="create">Create counters</button>
      <button id="destroy">Destroy counters</button>
      <Collection of={Counter} from="counters" className="counters" />
    </div>
  )
}
App.initialState = { counters: [] }
App.intent = ({ DOM }) => ({ CREATE: DOM.click('#create'), DESTROY: DOM.click('#destroy') })
App.model = {
  CREATE: (state) => ({ ...state, counters: Array.from({ length: COUNTERS }, (_, i) => ({ id: i + 1, n: 0 })) }),
  DESTROY: (state) => ({ ...state, counters: [] }),
}
run(App, {}, { mountPoint: '#main' })
