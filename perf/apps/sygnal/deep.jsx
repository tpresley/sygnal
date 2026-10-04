import { run } from 'sygnal'
import { DEPTH } from '../../lib/data.js'

// A chain of DEPTH nested components; the leaf changes root state
function Leaf({ state }) {
  return (
    <div className="leaf">
      <span className="val">{state.count}</span>
      <button className="inc">+</button>
    </div>
  )
}
Leaf.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Leaf.model = { INC: (state) => ({ ...state, count: state.count + 1 }) }

function Level({ depth }) {
  return <div className="lvl">{depth > 0 ? <Level depth={depth - 1} /> : <Leaf />}</div>
}

function App() {
  return <div><Level depth={DEPTH} /></div>
}
App.initialState = { count: 0 }
run(App, {}, { mountPoint: '#main' })
