import { run, Switchable, Collection } from 'sygnal'

// Spike 0-S: a Switchable with two pages of 500 counters each; the hidden page stays alive
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

function PageA() { return <section className="pa"><Collection of={Counter} from="a" className="counters" /></section> }
function PageB() { return <section className="pb"><Collection of={Counter} from="b" className="counters" /></section> }
const make = (k) => Array.from({ length: 500 }, (_, i) => ({ id: i + 1, n: k }))
function App({ state }) {
  return (
    <div>
      <button id="create">Create</button>
      <button id="show-a">A</button>
      <button id="show-b">B</button>
      <button id="bump-b">Bump B</button>
      <Switchable of={{ a: PageA, b: PageB }} current={state.page} />
    </div>
  )
}
App.initialState = { page: 'a', a: [], b: [] }
App.intent = ({ DOM }) => ({ CREATE: DOM.click('#create'), A: DOM.click('#show-a'), B: DOM.click('#show-b'), BUMP_B: DOM.click('#bump-b') })
App.model = {
  CREATE: (state) => ({ ...state, page: 'a', a: make(0), b: make(0) }),
  A: (state) => ({ ...state, page: 'a' }),
  B: (state) => ({ ...state, page: 'b' }),
  BUMP_B: (state) => ({ ...state, b: state.b.map((c) => ({ ...c, n: c.n + 1 })) }),
}
run(App, {}, { mountPoint: '#main' })
