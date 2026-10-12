// CANDIDATE B: no behavior. The catalog renders; the backend builds requests and reads replies;
// the app wires the steps in its own model (like the first example). Full control, more code, and
// the sink name (HTTP vs LLM) is written in the model, so switching backends edits the model.
import { ABORT } from 'sygnal'
import { decisions } from '../lib/backends.js'
import { catalog, STATE, CustomerCard } from './catalog.jsx'

const backend = decisions({ url: '/api/decide', model: 'nimble' })
const NAMES = { ok: 'COMPOSED', error: 'COMPOSE_FAILED' }

function App({ state }) {
  return (
    <div>
      <form className="ask"><input className="prompt" aria-label="Request" value={state.prompt} /><button type="submit">Go</button></form>
      <p className="status">{state.page.status}</p>
      <main>{catalog.render(state.page, state)}</main>
    </div>
  )
}
App.initialState = { ...STATE, prompt: '', page: { status: 'idle', layout: null, preview: null, pending: null } }
App.intent = ({ DOM, CHILD }) => ({
  PROMPT: DOM.input('.prompt').value(),
  COMPOSE: DOM.select('.ask').events('submit', { preventDefault: true }),
  OPENED: CHILD.select(CustomerCard),
})
const start = (state) => backend.start({ catalog, state, prompt: state.prompt.trim(), previous: state.page.layout, names: NAMES })
App.model = {
  PROMPT: (state, prompt) => ({ ...state, prompt }),
  COMPOSE: {
    STATE: (state) => (state.prompt.trim() ? { ...state, page: { ...state.page, status: 'composing', pending: start(state).pending } } : ABORT),
    HTTP: (state) => (state.prompt.trim() ? start(state).request : ABORT),
  },
  COMPOSED: {
    STATE: (state, reply) => {
      const r = backend.reply({ catalog, state, pending: state.page.pending, reply, names: NAMES })
      return { ...state, page: r.layout
        ? { status: 'done', layout: r.layout, preview: null, pending: null }
        : { ...state.page, status: 'preview', preview: r.preview, pending: r.pending } }
    },
    HTTP: (state, reply) => backend.reply({ catalog, state, pending: state.page.pending, reply, names: NAMES }).request ?? ABORT,
  },
  COMPOSE_FAILED: (state, { error }) => ({ ...state, page: { ...state.page, status: 'error', preview: null, pending: null, error: error.message } }),
  OPENED: (state, { id }) => ({ ...state, opened: id }),
}
export default App
