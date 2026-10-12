// CANDIDATE A: the compose behavior. The backend is the only difference between a decision model
// and an LLM: makeApp(decisions({ url, model })) or makeApp(llm({ model })).
import { compose } from '../lib/compose.js'
import { catalog, STATE, CustomerCard } from './catalog.jsx'

export function makeApp(backend) {
  function App({ state }) {
    const page = state.page
    return (
      <div className="app">
        <form className="ask">
          <input className="prompt" aria-label="What do you want to see?" value={page.prompt} />
          <button type="submit">Compose</button>
        </form>
        <p className="status">{page.status}</p>
        <p className="opened">{state.opened ?? ''}</p>
        <p className="last">{state.lastComposed ?? ''}</p>
        <main className={page.preview ? 'canvas preview' : 'canvas'}>{catalog.render(page, state)}</main>
      </div>
    )
  }
  App.initialState = { ...STATE, lastComposed: null }
  App.uses = { page: compose(catalog, { backend, form: '.ask', prompt: '.prompt' }) }
  // composed parts are the host's children: CHILD.select hears every CustomerCard on the page
  App.intent = ({ CHILD }) => ({ OPENED: CHILD.select(CustomerCard) })
  App.model = {
    OPENED: (state, { id }) => ({ ...state, opened: id }),
    // after each finished composition (a host entry runs after the behavior's)
    'page.DONE': (state, layout) => ({ ...state, lastComposed: Object.keys(layout.nodes).length }),
  }
  return App
}
