// The assistant: a chat on a local model that asks the user with cards (chat({ ask })).
//
// `chat({ model, ask: { backend } })` fixes the chat model and the card backend when the behavior
// is defined, so assistantFor() makes one component per pair (once) with the same view, intent,
// model and agent declaration, and App.jsx shows the picked one. It has no state of its own: it
// shares the app's, so the conversation (`state.assistant`) stays when you switch, and persists.
import { ABORT, classes } from 'sygnal'
import { chat, askCard, openToolCalls, jsonSchema } from 'sygnal/ai'
import { catalog, ContactForm, Rating } from './cards.jsx'
import { cardBackend, DEFAULT_CHAT, LLM_CARDS } from './backends.js'
import { PLANS, EXAMPLES } from './data.js'
import { whatHappened } from './WhatHappened.jsx'

export const INSTRUCTIONS = [
  'You are the assistant of a project-management app. You help the user with its plans (Free, Team, Business): choosing one, switching, talking to sales.',
  'The app state lists the plans with their prices, seats and features, and the user\'s current plan: quote only those, never other numbers.',
  'When you need the user to choose, pick, fill in, rate or confirm something, call ask_user with one sentence saying what you need, and wait for the answer. Ask one thing at a time. Do not ask such questions in text.',
  'When the user has picked a plan and confirmed it, call billing_choose_plan with its id. When they want to talk to sales, ask for their contact details with ask_user.',
  'Keep replies short: one to three sentences.',
].join(' ')

const STATUS = {
  composing: 'Building the card…',
  open: 'Waiting for your answer',
  answered: 'Answered',
  failed: 'Could not show a card',
  cancelled: 'Not answered',
}

/** a tool call the model made: a card, or a line saying which tool ran */
function toolPart(p, state) {
  if (p.type === 'tool-ask_user') {
    const status = p.ui?.status ?? 'composing'
    return (
      <section className={classes('ask-card', status)} data={{ card: p.toolCallId }}>
        <p className="need">{p.input?.need}</p>
        {askCard(catalog, state, p)}
        <span className="card-status">{STATUS[status]}{status === 'failed' && p.errorText ? `: ${p.errorText.replace(/^could not show a card: /, '')}` : ''}</span>
      </section>
    )
  }
  const name = p.type.slice(5)
  return <p className="tool muted">Used <code>{name}</code>{p.state === 'output-error' ? ` (failed: ${p.errorText})` : ''}</p>
}

function messagePart(p, state) {
  if (p.type === 'text') return p.text.trim() ? <p className="text">{p.text}</p> : null
  if (p.type.startsWith('tool-')) return toolPart(p, state)
  return null
}

function view({ state }) {
  const a = state.assistant
  const busy = a.status === 'submitted' || a.status === 'streaming'
  // Stop also dismisses a card that waits for an answer (its call closes as "not answered")
  const waiting = openToolCalls(a).some((p) => p.ui?.status === 'open')
  return (
    <div className="assistant">
      <div className="conversation">
        <ol className="messages" aria-live="polite">
          {a.messages.map((m) => <li className={classes('msg', m.role)}>{m.parts.map((p) => messagePart(p, state))}</li>)}
          {a.draft && <li className="msg assistant draft"><p className="text">{a.draft}</p></li>}
          {a.status === 'submitted' && <li className="msg assistant thinking muted">…</li>}
        </ol>
        <div className="examples" hidden={a.messages.length > 0}>
          {EXAMPLES.map((p) => <button type="button" className="example" data={{ prompt: p }}>{p}</button>)}
        </div>
        {a.error && <p className="error">The model failed: {a.error}</p>}
        <form className="ask">
          <input className="prompt" aria-label="Message" placeholder="Ask about plans, switching, sales…" value={a.prompt} />
          <button type="submit" className="send" disabled={busy || !a.prompt.trim()}>Send</button>
          <button type="button" className="stop" hidden={!busy && !waiting}>{busy ? 'Stop' : 'Skip the card'}</button>
        </form>
      </div>
      {whatHappened(a)}
    </div>
  )
}

const intent = ({ DOM, CHILD }) => ({
  EXAMPLE: DOM.click('.example').data('prompt'),
  // the host hears result parts too: the contact details and the rating go into app state
  CONTACTED: CHILD.select(ContactForm),
  RATED: CHILD.select(Rating),
})

const model = {
  EXAMPLE: { EFFECT: (state, prompt, next) => next('assistant.SEND', prompt) },
  CONTACTED: (state, { value }) => ({ ...state, leads: [...state.leads, value] }),
  RATED: (state, { value }) => ({ ...state, rating: value }),
  // the agent's action (billing_choose_plan): the plan the user picked and confirmed
  CHOOSE_PLAN: (state, id) => (state.plans.some((p) => p.id === id) && id !== state.plan ? { ...state, plan: id } : ABORT),
}

// What the model sees of the app and may do in it. `read` goes with every request as app state:
// the plans with their real prices, so the model quotes those (without it, a small model invents one).
const agent = {
  name: 'billing',
  description: "The app's pricing plans and the user's current plan",
  read: (state) => ({
    plans: state.plans.map(({ id, name, price, seats, features }) => ({ id, name, pricePerSeatPerMonthUSD: price, maxSeats: seats, features })),
    currentPlan: state.plan,
  }),
  actions: {
    CHOOSE_PLAN: {
      description: 'Switch the user to a plan, by id, once they picked and confirmed it',
      input: jsonSchema({ type: 'string', enum: PLANS.map((p) => p.id) }),
    },
  },
}

/** one assistant: this chat model, cards composed by this card backend (a choice from backends.js) */
export function makeAssistant(chatModel, choice) {
  function Assistant(props) {
    return view(props)
  }
  Assistant.uses = {
    assistant: chat({
      model: chatModel,
      form: '.ask', prompt: '.prompt', stop: '.stop',
      instructions: INSTRUCTIONS,
      ask: { catalog, backend: cardBackend(choice, chatModel) },
    }),
  }
  Assistant.agent = agent
  Assistant.intent = intent
  Assistant.model = model
  return Assistant
}

const made = new Map()
/** the assistant for a chat model and a card backend, made once per pair */
export function assistantFor(chatModel, choice) {
  const id = `${chatModel} ${choice.id}`
  if (!made.has(id)) made.set(id, makeAssistant(chatModel, choice))
  return made.get(id)
}

// Made at load, before run(): chat()'s first call links the sygnal/ai behaviors to the apps started
// after it (an assistant made later still gets its tools; SYG442 otherwise)
const first = assistantFor(DEFAULT_CHAT, LLM_CARDS)

/** the chat slice before the first message: the app keeps the conversation in its own state (App.initialState) */
export const NEW_CHAT = first.uses.assistant.state
