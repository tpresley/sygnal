// The app: the pickers (chat model, card backend), the user's plan, and the assistant for the
// picked pair. The conversation persists (cards and all): an answered card comes back frozen with
// its pick, an open one stays answerable.
import { ABORT, persist } from 'sygnal'
import { OLLAMA, chatModels, cardBackends } from './backends.js'
import { assistantFor, NEW_CHAT } from './Assistant.jsx'
import { PLANS } from './data.js'

const busy = (state) => state.assistant?.status === 'submitted' || state.assistant?.status === 'streaming'

function App({ state, context }) {
  const plan = state.plans.find((p) => p.id === state.plan)
  const ready = state.chatModel && state.cards
  const Assistant = ready ? assistantFor(state.cards) : null
  return (
    <div className="app">
      <header>
        <div>
          <h1>Ask with cards</h1>
          <p className="muted">The assistant asks with cards built from parts the app prepared, and continues with your answer.</p>
        </div>
        <p className="account">
          Your plan: <b className="current-plan">{plan?.name}</b>
          {state.leads.length > 0 && <span className="muted"> · sales will write to {state.leads.at(-1).email}</span>}
          {state.rating && <span className="muted"> · you rated {state.rating}/5</span>}
        </p>
      </header>

      <form className="setup">
        <label>
          Chat model
          <select className="chat-model" disabled={busy(state)}>
            {context.chatModels.length === 0 && <option value="">no chat model found</option>}
            {context.chatModels.map((m) => <option value={m} selected={m === state.chatModel}>{m}</option>)}
          </select>
        </label>
        <label>
          Cards composed by
          <select className="card-backend" disabled={busy(state)}>
            {context.cardBackends.map((c) => <option value={c.id} selected={c.id === state.cards?.id}>{c.kind === 'llm' ? `${c.label} (compose.llm)` : `${c.label} (decision model)`}</option>)}
          </select>
        </label>
        <button type="button" className="new-chat" disabled={busy(state) || !state.assistant?.messages.length}>New conversation</button>
      </form>

      {Assistant ? <Assistant key={state.cards.id} /> : <p className="status muted">{context.offline ?? 'Looking for models…'}</p>}
    </div>
  )
}

App.initialState = {
  assistant: NEW_CHAT, // the conversation: the assistant's chat slice, here so that it persists
  plans: PLANS,
  plan: 'free',      // the user's plan (the agent action billing_choose_plan sets it)
  leads: [],         // contact details sent from a card
  rating: null,      // a rating sent from a card
  chatModel: null,   // the picked chat model (qwen3:8b when installed)
  cards: null,       // the picked card backend: a choice from cardBackends()
  cardsBy: {},       // who composed each card, by tool call id (the "what happened" panel)
}

App.resources = {
  // the installed Ollama models: chat models (e.g. qwen3:8b) and decision models (e.g. nimble)
  models: () => ({ url: `${OLLAMA}/api/tags`, ok: 'MODELS_LOADED' }),
  // whether the dev server's /api/decide proxy has a TypeSafe key (vite.config.js)
  jev: () => ({ url: '/api/decide/available' }),
}

App.context = {
  chatModels: (state) => chatModels(state.models?.data),
  cardBackends: (state) => cardBackends(state.models?.data, state.jev?.data?.available),
  offline: (state) => (state.models?.error ? `Can't reach Ollama at ${OLLAMA}. Is it running?` : null),
}

App.intent = ({ DOM }) => ({
  PICK_CHAT: DOM.change('.chat-model').value(),
  PICK_CARDS: DOM.change('.card-backend').value(),
  NEW_CHAT: DOM.click('.new-chat'),
})

App.model = {
  // the first chat model (qwen3:8b when installed) and the chat model for cards, unless restored
  MODELS_LOADED: (state, tags) => {
    const models = chatModels(tags)
    const chatModel = models.includes(state.chatModel) ? state.chatModel : models[0] ?? null
    return { ...state, chatModel, cards: state.cards ?? cardBackends(tags, false)[0] }
  },
  PICK_CHAT: (state, chatModel, next, { context }) => (context.chatModels.includes(chatModel) && !busy(state) ? { ...state, chatModel } : ABORT),
  PICK_CARDS: (state, id, next, { context }) => {
    const cards = context.cardBackends.find((c) => c.id === id)
    return cards && !busy(state) ? { ...state, cards } : ABORT
  },
  NEW_CHAT: (state) => (busy(state) || !state.assistant ? ABORT : { ...state, assistant: NEW_CHAT, cardsBy: {} }),
}

// the conversation (cards and all), the user's plan and the pickers survive a reload
App.persist = persist({ key: 'ai-ask', pick: ['assistant', 'plan', 'leads', 'rating', 'chatModel', 'cards', 'cardsBy'] })

export default App
