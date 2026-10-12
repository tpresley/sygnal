// The team dashboard: the user describes the page they want, a model builds it from the
// parts in catalog.js.
import { compose } from 'sygnal/ai'
import { catalog } from './catalog.js'
import { GOALS, ORDERS } from './data.js'

const STATUS = {
  idle: 'Describe the page you want.',
  composing: 'Composing…',
  preview: 'Composing…',
  done: '',
  unavailable: 'Nothing on offer fits that request.',
  error: 'Something went wrong. Try again.',
}

function App({ state }) {
  const done = state.goals.filter((g) => g.done).length
  const busy = state.page.status === 'composing' || state.page.status === 'preview'
  return (
    <div className="app">
      <header>
        <h1>Team dashboard</h1>
        <p className="goal-count">{done} of {state.goals.length} goals done</p>
      </header>
      <form className="ask">
        <input className="prompt" aria-label="The page you want" value={state.page.prompt} placeholder="e.g. Revenue and the pending orders" />
        <button type="submit" disabled={busy}>Compose</button>
      </form>
      <p className="status">{STATUS[state.page.status]}</p>
      <main className="canvas">{catalog.render(state.page, state)}</main>
    </div>
  )
}

App.initialState = {
  goals: GOALS,
  orders: ORDERS,
}

App.uses = {
  page: compose(catalog, { backend: compose.decisions({ model: 'jev-latest' }), form: '.ask', prompt: '.prompt' }),
}

export default App
