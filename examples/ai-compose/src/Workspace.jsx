// The workspace: a prompt, the model picker, the composed page and the decision panel.
//
// One view, two components: DecisionsWorkspace composes with a decision model (decide() on HTTP),
// LlmWorkspace with a chat model (the LLM driver). A compose behavior's backend is fixed when it is
// defined, so each backend kind is its own component, and App.jsx shows the one the picked model
// needs in a <Switchable>. Both share the app state (no `state=`): the layout, the tasks and the
// feedback draft stay put when you switch.
import { ABORT, classes } from 'sygnal'
import { compose } from 'sygnal/ai'
import { catalog } from './catalog.js'
import { decisionsBackend, llmBackend } from './backends.js'
import { EXAMPLES } from './data.js'
import DecisionLog from './DecisionLog.jsx'

const who = (state) => state.page.pending?.choice?.label ?? 'The model'

const STATUS = {
  idle: () => 'Describe the page you want. The model picks and arranges prepared parts; it writes nothing.',
  composing: (state) => `${who(state)} is composing…`,
  preview: (state) => `${who(state)} is ${state.page.pending?.choice?.kind === 'llm' ? 'writing the layout' : 'arranging the parts'}…`,
  done: (state) => `Composed by ${state.composer?.label ?? 'the model'}.`,
  unavailable: () => 'Nothing in the catalog fits that request.',
  error: (state) => `The model failed: ${state.page.error}`,
}

function status(state, offline) {
  if (!state.backend) return offline ? offline : 'Looking for models…'
  return STATUS[state.page.status](state)
}

function workspace({ state, context }) {
  const page = state.page
  const busy = page.status === 'composing' || page.status === 'preview'
  const decisionModels = context.choices.filter((c) => c.kind === 'decisions')
  const chatModels = context.choices.filter((c) => c.kind === 'llm')
  const option = (c) => <option value={c.id} selected={c.id === state.backend?.id}>{c.label}</option>
  return (
    <div className="workspace">
      <form className="prompt-form">
        <input className="prompt" aria-label="The page you want" value={page.prompt} placeholder="e.g. My morning: the weather and my tasks" />
        <select className="backend" aria-label="Model">
          {context.choices.length === 0 && <option value="">no model found</option>}
          {decisionModels.length > 0 && <optgroup label="Decision models">{decisionModels.map(option)}</optgroup>}
          {chatModels.length > 0 && <optgroup label="Chat models (LLM)">{chatModels.map(option)}</optgroup>}
        </select>
        <button type="submit" className="compose" disabled={busy || !state.backend}>Compose</button>
      </form>
      <div className="examples">
        {EXAMPLES.map((p) => <button type="button" className="example" data={{ prompt: p }} disabled={busy || !state.backend}>{p}</button>)}
      </div>

      <p className={classes('status', page.status)}>{status(state, context.offline)}</p>

      <main className="layout">
        <div className={classes('canvas', { preview: !!page.preview })}>{catalog.render(page, state)}</div>
        <DecisionLog decisions={page.decisions} composer={state.composer} />
      </main>
    </div>
  )
}

const intent = ({ DOM }) => ({
  PICK: DOM.change('.backend').value(),
  EXAMPLE: DOM.click('.example').data('prompt'),
})

const model = {
  PICK: (state, id, next, { context }) => {
    const backend = context.choices.find((c) => c.id === id)
    return backend && backend.id !== state.backend?.id ? { ...state, backend } : ABORT
  },
  // a chip composes its prompt (the behavior's COMPOSE takes a string)
  EXAMPLE: { EFFECT: (state, prompt, next) => next('page.COMPOSE', prompt) },
  // runs after the behavior's COMPOSE: remember who composes (the pending step holds the choice)
  'page.COMPOSE': (state) => (state.page.pending?.choice ? { ...state, composer: state.page.pending.choice } : ABORT),
}

const uses = (backend) => ({ page: compose(catalog, { backend, form: '.prompt-form', prompt: '.prompt' }) })

/** a decision model composes (nimble on Ollama, Jev through the dev proxy) */
export function DecisionsWorkspace(props) {
  return workspace(props)
}
DecisionsWorkspace.uses = uses(decisionsBackend)
DecisionsWorkspace.intent = intent
DecisionsWorkspace.model = model

/** a chat model composes (qwen3:8b on Ollama) */
export function LlmWorkspace(props) {
  return workspace(props)
}
LlmWorkspace.uses = uses(llmBackend)
LlmWorkspace.intent = intent
LlmWorkspace.model = model
