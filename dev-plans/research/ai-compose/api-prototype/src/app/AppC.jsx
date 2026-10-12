// CANDIDATE C: the host renders a ready-made <Composed /> and listens to it.
import { createCommand } from 'sygnal'
import { composer } from '../lib/Composer.jsx'
import { llm } from '../lib/backends.js'
import { catalog, STATE } from './catalog.jsx'

const Composed = composer(catalog, { backend: llm({ model: 'qwen3' }) })
const cmd = createCommand()

function App({ state }) {
  return (
    <div>
      <form className="ask"><input className="prompt" aria-label="Request" value={state.prompt} /><button type="submit">Go</button></form>
      <p className="opened">{state.opened ?? ''}</p>
      <Composed commands={cmd} />
    </div>
  )
}
App.initialState = { ...STATE, prompt: '', page: { prompt: '', status: 'idle', layout: null, preview: null, pending: null, decisions: [], error: null, ui: {}, local: {}, composed: null } }
App.intent = ({ DOM, CHILD }) => ({
  PROMPT: DOM.input('.prompt').value(),
  COMPOSE: DOM.select('.ask').events('submit', { preventDefault: true }),
  FROM_PARTS: CHILD.select(Composed),
})
App.model = {
  PROMPT: (state, prompt) => ({ ...state, prompt }),
  COMPOSE: { EFFECT: (state) => cmd.send('compose', state.prompt) },
  FROM_PARTS: (state, { part, value }) => (part === 'CustomerCard' ? { ...state, opened: value.id } : state),
}
export default App
