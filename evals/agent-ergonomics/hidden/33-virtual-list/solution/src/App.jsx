import { ABORT, VirtualCollection } from 'sygnal'
import { CUSTOMERS } from './customers.js'

function Row({ state, current }) {
  return (
    <div className="row" aria-current={state.id === current ? 'true' : undefined}>
      <span className="num">#{state.id}</span> <span className="name">{state.name}</span> <span className="city">{state.city}</span>
      <button type="button" className="star" aria-label={`Star ${state.name}`} aria-pressed={String(state.starred)}>★</button>
    </div>
  )
}

Row.intent = ({ DOM }) => ({ STAR: DOM.click('.star') })
Row.model = { STAR: (state) => ({ ...state, starred: !state.starred }) }

const rowNumber = (text, count) => {
  const n = Number(text)
  return /^\d+$/.test(String(text).trim()) && n >= 1 && n <= count ? n : null
}

function App({ state, uid }) {
  const starred = state.customers.filter((c) => c.starred).length
  return (
    <main className="customers-page">
      <h1>Customers</h1>
      <p className="summary">{state.customers.length.toLocaleString('en-US')} customers, {starred} starred</p>
      <form className="jump" noValidate>
        <label for={uid('row')}>Go to row</label>
        <input id={uid('row')} name="row" type="number" min="1" max={state.customers.length} value={state.goTo} />
        <button type="submit">Go</button>
        <p className="jump-error" role="alert">{state.jumpError}</p>
      </form>
      <VirtualCollection of={Row} from="customers" className="customers" estimateSize={40} aria-label="Customers" current={state.current} />
    </main>
  )
}

App.initialState = {
  customers: CUSTOMERS,
  goTo: '',
  current: null,
  jumpError: '',
}

App.intent = ({ DOM }) => ({
  GO_TO: DOM.input('.jump input').value(),
  JUMP: DOM.select('.jump').events('submit', { preventDefault: true }),
})

const ERROR = 'Enter a row from 1 to 10,000.'

App.model = {
  GO_TO: (state, goTo) => ({ ...state, goTo }),
  JUMP: {
    STATE: (state) => {
      const n = rowNumber(state.goTo, state.customers.length)
      return n ? { ...state, current: n, jumpError: '' } : { ...state, jumpError: ERROR }
    },
    ELEMENT: (state) => {
      const n = rowNumber(state.goTo, state.customers.length)
      return n ? { scrollToIndex: '.customers', index: n - 1, align: 'start' } : ABORT
    },
  },
}

export default App
