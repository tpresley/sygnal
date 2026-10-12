// The app: the models on offer, and the workspace for the picked one's kind.
import { ABORT, Switchable } from 'sygnal'
import { catalog } from './catalog.js'
import { OLLAMA, backendChoices } from './backends.js'
import { DecisionsWorkspace, LlmWorkspace } from './Workspace.jsx'
import { TASKS } from './data.js'

function App({ state }) {
  return (
    <div className="app">
      <header>
        <h1>Compose a workspace</h1>
        <p className="muted">A model builds the page from {Object.keys(catalog.parts).length} prepared parts: a decision model answers multiple-choice questions, a chat model fills a schema. Either way it only picks and arranges.</p>
      </header>
      <Switchable of={{ decisions: DecisionsWorkspace, llm: LlmWorkspace }} current={state.backend?.kind ?? 'decisions'} />
    </div>
  )
}

App.initialState = {
  backend: null,           // the picked model: a choice from backendChoices() (the first one until the user picks)
  composer: null,          // the choice that composed the page on screen
  tasks: TASKS,            // the checklist part's state (a lens: state: 'tasks')
  feedback: { draft: '', sent: [] },
}

App.resources = {
  // the installed Ollama models: decision models (e.g. nimble) and chat models (e.g. qwen3:8b)
  models: () => ({ url: `${OLLAMA}/api/tags`, ok: 'MODELS_LOADED', error: 'MODELS_FAILED' }),
  // whether the dev server's /api/decide proxy has a TypeSafe key (vite.config.js)
  jev: () => ({ url: '/api/decide/available', ok: 'JEV_CHECKED' }),
}

App.context = {
  choices: (state) => backendChoices(state.models?.data, state.jev?.data?.available),
  offline: (state) => (state.models?.error ? `Can't reach Ollama at ${OLLAMA}. Is it running?` : null),
}

// the first choice until the user picks one, once Ollama has answered (so a local decision model
// comes before Jev, whichever reply comes first)
const firstChoice = (state, choices) => (state.backend || choices.length === 0 ? ABORT : { ...state, backend: choices[0] })
const ollamaAnswered = (state) => state.models?.status === 'success' || state.models?.status === 'error'

App.model = {
  MODELS_LOADED: (state, tags) => firstChoice(state, backendChoices(tags, state.jev?.data?.available)),
  MODELS_FAILED: (state) => firstChoice(state, backendChoices(null, state.jev?.data?.available)),
  JEV_CHECKED: (state, reply) => (ollamaAnswered(state) ? firstChoice(state, backendChoices(state.models?.data, reply?.available)) : ABORT),
}

export default App
