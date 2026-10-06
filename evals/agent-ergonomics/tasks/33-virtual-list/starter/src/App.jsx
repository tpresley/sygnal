import { Collection } from 'sygnal'
import { CUSTOMERS } from './customers.js'

function Row({ state }) {
  return (
    <li className="row">
      <span className="num">#{state.id}</span> <span className="name">{state.name}</span> <span className="city">{state.city}</span>
      <button type="button" className="star" aria-label={`Star ${state.name}`} aria-pressed={String(state.starred)}>★</button>
    </li>
  )
}

Row.intent = ({ DOM }) => ({ STAR: DOM.click('.star') })
Row.model = { STAR: (state) => ({ ...state, starred: !state.starred }) }

function App({ state }) {
  const starred = state.customers.filter((c) => c.starred).length
  return (
    <main className="customers-page">
      <h1>Customers</h1>
      <p className="summary">{state.customers.length.toLocaleString('en-US')} customers, {starred} starred</p>
      <ul className="customers" aria-label="Customers">
        <Collection of={Row} from="customers" />
      </ul>
    </main>
  )
}

App.initialState = {
  customers: CUSTOMERS,
}

export default App
