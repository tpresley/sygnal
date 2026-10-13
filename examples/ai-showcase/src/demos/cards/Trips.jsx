// A trip planner that asks with cards. `chat({ ask: { catalog } })` gives the model the tool
// `ask_user({ need })`: it says in one sentence what it needs, and the app composes a card from its
// own parts (cards.jsx). By default the chat model composes it, in a second structured-output
// request (compose.llm()). The user's click is the tool's result, and the conversation goes on from
// it. Booking is an ordinary `agent` action that books what the cards filled in, so the model can
// only book a trip the user picked.
import { ABORT, classes } from 'sygnal'
import { chat, askCard, openToolCalls } from 'sygnal/ai'
import { providersResource, pickerState, pickerIntent, pickerModel, pickedModel, modelPicker } from '../../shared/picker.jsx'
import { catalog, DestinationPicker, TripSize, Rating, totalOf } from './cards.jsx'
import { DESTINATIONS, NEW_TRIP, destinationOf } from './destinations.js'

const EXAMPLES = [
  'Plan me a long weekend somewhere warm',
  'I want to go with 3 friends — ask me how many nights',
  'Rate this chat',
]

const INSTRUCTIONS = [
  'You are the trip planner of a travel app. The app state lists the destinations, with their price per night in USD, and the user\'s trip so far. Suggest only those destinations and quote only those prices.',
  'Whenever you need the user to pick, choose, confirm, fill in or rate something, call ask_user with one sentence saying what you need, then wait for the answer. Ask one thing at a time, and never ask such a question in text.',
  'A trip needs a destination, then the travelers and nights, then the user\'s confirmation. After each answer, look at the trip in the app state and ask for the next missing thing right away. Once the user confirmed, call trips_book and say it is booked.',
  'When the user wants to rate this chat, call ask_user right away with the need "Rate this chat from 1 to 5".',
  'Keep replies to one or two short sentences.',
].join(' ')

const picker = { need: 'tools' }

const STATUS = {
  composing: 'Building the card…',
  open: 'Waiting for you',
  answered: 'Answered',
  failed: 'Could not show a card',
  cancelled: 'Not answered',
}

/** an ask_user call: the model's `need` as the heading, then the card the app composed for it */
function cardOf(p, state) {
  const status = p.ui?.status ?? 'composing'
  return (
    <section className={classes('tc-card', status)} data={{ card: p.toolCallId }}>
      <header>
        <span className="tc-need">{p.input?.need ?? '…'}</span>
        <span className="tc-status">{status === 'composing' && <span className="spinner" />}{STATUS[status]}</span>
      </header>
      {askCard(catalog, state, p) ?? (status === 'composing' && <p className="tc-building">Picking parts for this question…</p>)}
    </section>
  )
}

/** another tool call: one muted line */
function toolLine(p) {
  const name = p.type.slice(5)
  if (name === 'trips_book' && p.state === 'output-available') return <span className="tool-line">✓ Booked the trip (<code>trips_book</code>)</span>
  return <span className="tool-line">Used <code>{name}</code>{p.state === 'output-error' ? `: ${p.errorText}` : ''}</span>
}

function part(p, state) {
  if (p.type === 'text') return p.text.trim() ? <p className="tc-text">{p.text.trim()}</p> : null
  if (p.type === 'tool-ask_user') return cardOf(p, state)
  if (p.type.startsWith('tool-')) return toolLine(p)
  return null
}

function tripPanel(state) {
  const { trip } = state
  const d = destinationOf(trip.destination)
  const total = totalOf(trip)
  return (
    <aside className={classes('panel', 'tc-trip', { booked: trip.booked })}>
      <h3 className="panel-title">Your trip {trip.booked ? <span className="badge ok">Booked</span> : <span className="badge">Planning</span>}</h3>
      <div className={classes('tc-hero', d?.id)}>
        <span className="tc-swatch big">{d?.emoji ?? '🧭'}</span>
        <div><b>{d?.name ?? 'Where to?'}</b><span className="tc-muted">{d ? `${d.country} · $${d.price} a night` : 'Ask the assistant'}</span></div>
      </div>
      <dl className="tc-facts">
        <dt>Travelers</dt><dd>{trip.travelers ?? '—'}</dd>
        <dt>Nights</dt><dd>{trip.nights ?? '—'}</dd>
        <dt>Total</dt><dd className="tc-total">{total ? `$${total.toLocaleString('en-US')}` : '—'}</dd>
      </dl>
      {state.rating && <p className="tc-rated">You rated the chat <span className="tc-stars">{'★'.repeat(state.rating)}{'☆'.repeat(5 - state.rating)}</span></p>}
    </aside>
  )
}

export default function Trips({ state }) {
  const a = state.assistant
  const busy = a.status === 'submitted' || a.status === 'streaming'
  const model = pickedModel(state, picker)
  // Stop also dismisses a card that waits for an answer (its call closes as "not answered")
  const waiting = openToolCalls(a).some((p) => p.ui?.status === 'open')
  return (
    <div className="w cards-demo">
      <div className="w-toolbar">
        {modelPicker(state, picker, { disabled: busy })}
        <span className="grow" />
        <button type="button" className="btn ghost small new-chat" disabled={busy || a.messages.length === 0}>New trip</button>
      </div>
      <div className="w-grid">
        <div className="tc-chat">
          <ol className="transcript" aria-live="polite">
            {a.messages.map((m) => <li className={classes('msg', m.role)}>{m.parts.map((p) => part(p, state))}</li>)}
            {a.draft && <li className="msg assistant streaming">{a.draft}</li>}
            {a.status === 'submitted' && <li className="msg assistant"><span className="thinking-dots"><i /><i /><i /></span></li>}
          </ol>
          {a.messages.length === 0 && (
            <div className="examples">{EXAMPLES.map((e) => <button type="button" className="example" data={{ prompt: e }} disabled={!model}>{e}</button>)}</div>
          )}
          {a.error && <p className="status-line error" role="alert">The model failed: {a.error}</p>}
          <form className="composer ask">
            <input className="prompt" aria-label="Message" placeholder={model ? 'Where would you like to go?' : 'Pick a model first'} value={a.prompt} />
            {busy || waiting
              ? <button type="button" className="btn ghost stop">{busy ? 'Stop' : 'Skip the card'}</button>
              : <button type="submit" className="btn" disabled={!a.prompt.trim() || !model}>Send</button>}
          </form>
          <p className="tc-note">Cards need a model that calls tools well: qwen3:8b works; larger models ask better questions.</p>
        </div>
        {tripPanel(state)}
      </div>
    </div>
  )
}

Trips.initialState = {
  ...pickerState,
  destinations: DESTINATIONS,
  trip: NEW_TRIP,     // filled in by the cards' answers, booked by the agent action
  rating: null,
}

Trips.resources = providersResource

Trips.uses = {
  assistant: chat({
    model: (state) => pickedModel(state, picker),   // read per request: the picker is just state
    form: '.ask', prompt: '.prompt', stop: '.stop',
    instructions: INSTRUCTIONS,
    // cards composed by the chat model (compose.llm()); `instructions` go into ask_user's description
    ask: { catalog, instructions: 'Say in the need what the card should show, such as the kind of place the user wants or how many people travel.' },
  }),
}

// What the model sees of the app (`read`, with every request) and may do in it (`actions`)
Trips.agent = {
  name: 'trips',
  description: "The travel app's destinations and the user's trip",
  read: (state) => ({
    destinations: state.destinations.map(({ id, name, country, price, vibes }) => ({ id, name, country, pricePerNightUSD: price, vibes })),
    trip: { ...state.trip, totalUSD: totalOf(state.trip) },
  }),
  actions: {
    // no input: it books the trip in the state, which only the user's answers fill in. Offered
    // only once the trip is complete, so the model can't book a place the user never picked
    BOOK: {
      description: 'Book the trip as it is in the app state, once the user has confirmed it',
      when: (state) => !!(state.trip.destination && state.trip.nights && state.trip.travelers) && !state.trip.booked,
    },
  },
  untrusted: false,   // every string in `read` is the app's own
}

Trips.intent = ({ DOM, CHILD }) => ({
  ...pickerIntent(DOM),
  EXAMPLE: DOM.click('.example').data('prompt'),
  NEW_TRIP: DOM.click('.new-chat'),
  // the host hears the result parts too: the trip fills in as the user answers
  PICKED: CHILD.select(DestinationPicker),
  SIZED: CHILD.select(TripSize),
  RATED: CHILD.select(Rating),
})

Trips.model = {
  ...pickerModel,
  EXAMPLE: { EFFECT: (state, prompt, next) => next('assistant.SEND', prompt) },
  PICKED: (state, { value }) => ({ ...state, trip: { ...state.trip, destination: value, booked: false } }),
  SIZED: (state, { value }) => ({ ...state, trip: { ...state.trip, ...value, booked: false } }),
  RATED: (state, { value }) => ({ ...state, rating: value }),
  // the agent's action (trips_book)
  BOOK: (state) => ({ ...state, trip: { ...state.trip, booked: true } }),
  NEW_TRIP: (state) => (state.assistant.status === 'ready' || state.assistant.status === 'error'
    ? { ...state, assistant: NEW_CONVERSATION, trip: NEW_TRIP, rating: null }
    : ABORT),
}

/** the chat slice before the first message */
const NEW_CONVERSATION = Trips.uses.assistant.state
