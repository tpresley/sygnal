// The parts a card is built from. A part with `result: true` answers the card: it sends
// compose.answer(props, value) to PARENT, and that value is what the model gets back (the call's
// output `{ part, answer }`). Every label and button is the app's own; the model only says what it
// needs, and the card's composer picks parts and their params.
//   - destinations: a picker over the app's destinations (prepared: no generated text)
//   - destination:  one destination's details (a record param: the model names it, never its price)
//   - choice:       a generated question with options (free-text params: a chat model writes them)
//   - tripSize:     travelers and nights, a small form whose values live on the card (`local`)
//   - tripSummary:  the trip so far, with its total
//   - confirm, rating
import { classes } from 'sygnal'
import { defineCatalog, compose } from 'sygnal/ai'
import { destinationOf } from './destinations.js'

/** a result part's PARENT entry: the card's answer is `value`, or the action's data */
const answerWith = (value) => (state, data, next, props) => compose.answer(props, value ?? data)

// no `state` in its catalog entry: it sees the host's state (the destinations), as any child does
export function DestinationPicker({ state, vibe, answer: picked, frozen }) {
  const shown = state.destinations.filter((d) => vibe === 'any' || d.vibes.includes(vibe))
  return (
    <div className="tc-picker">
      {shown.map((d) => (
        <button type="button" className={classes('tc-dest', d.id, { picked: d.id === picked })} data={{ id: d.id }} disabled={frozen}>
          <span className="tc-swatch">{d.emoji}</span>
          <b>{d.name}</b>
          <span className="tc-muted">{d.country}</span>
          <span className="tc-price">${d.price}<small>/night</small></span>
        </button>
      ))}
    </div>
  )
}
DestinationPicker.intent = ({ DOM }) => ({ PICK: DOM.click('.tc-dest').data('id') })
DestinationPicker.model = { PICK: { PARENT: answerWith() } }

// a display part: the destination its record param names
export function DestinationDetails({ destination }) {
  const d = destinationOf(destination)
  if (!d) return null
  return (
    <div className={classes('tc-details', d.id)}>
      <span className="tc-swatch big">{d.emoji}</span>
      <div>
        <b>{d.name}</b> <span className="tc-muted">{d.country} · ${d.price} a night</span>
        <p>{d.blurb}</p>
        <ul>{d.highlights.map((h) => <li>{h}</li>)}</ul>
      </div>
    </div>
  )
}

export function Choice({ question, options = [], answer: picked, frozen }) {
  return (
    <div className="tc-choice">
      {question && <p>{question}</p>}
      <div className="tc-options">
        {options.map((o) => <button type="button" className={classes('tc-option', { picked: o === picked })} data={{ value: o }} disabled={frozen}>{o}</button>)}
      </div>
    </div>
  )
}
Choice.intent = ({ DOM }) => ({ PICK: DOM.click('.tc-option').data('value') })
Choice.model = { PICK: { PARENT: answerWith() } }

// `local` in its catalog entry: the counts the user sets live on this card, per card. Until then
// they are the params (a chat model can prefill them: "4 travelers").
const count = (state, props, field) => state[field] ?? props[field]
const stepper = (label, field, value, min, max, frozen) => (
  <div className="tc-step">
    <span>{label}</span>
    <button type="button" className="tc-minus" data={{ field }} disabled={frozen || value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>−</button>
    <b>{value}</b>
    <button type="button" className="tc-plus" data={{ field }} disabled={frozen || value >= max} aria-label={`More ${label.toLowerCase()}`}>+</button>
  </div>
)
export function TripSize({ state, frozen, ...props }) {
  return (
    <div className="tc-size">
      {stepper('Travelers', 'travelers', count(state, props, 'travelers'), 1, 8, frozen)}
      {stepper('Nights', 'nights', count(state, props, 'nights'), 1, 14, frozen)}
      <button type="button" className="btn small tc-done" disabled={frozen}>Done</button>
    </div>
  )
}
TripSize.intent = ({ DOM }) => ({
  MORE: DOM.click('.tc-plus').data('field'),
  LESS: DOM.click('.tc-minus').data('field'),
  DONE: DOM.click('.tc-done'),
})
TripSize.model = {
  MORE: (state, field, next, props) => ({ ...state, [field]: count(state, props, field) + 1 }),
  LESS: (state, field, next, props) => ({ ...state, [field]: count(state, props, field) - 1 }),
  DONE: { PARENT: (state, data, next, props) => compose.answer(props, { travelers: count(state, props, 'travelers'), nights: count(state, props, 'nights') }) },
}

export const totalOf = (trip) => (trip.destination && trip.nights ? destinationOf(trip.destination).price * trip.nights : null)

// a display part: the host's trip, as planned so far
export function TripSummary({ state }) {
  const trip = state.trip
  const d = destinationOf(trip.destination)
  return (
    <dl className="tc-summary">
      <dt>Where</dt><dd>{d ? `${d.emoji} ${d.name}` : '—'}</dd>
      <dt>Travelers</dt><dd>{trip.travelers ?? '—'}</dd>
      <dt>Nights</dt><dd>{trip.nights ?? '—'}</dd>
      <dt>Total</dt><dd>{totalOf(trip) ? `$${totalOf(trip).toLocaleString('en-US')}` : '—'}</dd>
    </dl>
  )
}

export function Confirm({ answer: picked, frozen }) {
  return (
    <div className="tc-confirm">
      <button type="button" className={classes('btn', 'small', 'tc-yes', { picked: picked === true })} disabled={frozen}>Yes, book it</button>
      <button type="button" className={classes('btn', 'small', 'ghost', 'tc-no', { picked: picked === false })} disabled={frozen}>Not yet</button>
    </div>
  )
}
Confirm.intent = ({ DOM }) => ({ YES: DOM.click('.tc-yes'), NO: DOM.click('.tc-no') })
Confirm.model = { YES: { PARENT: answerWith(true) }, NO: { PARENT: answerWith(false) } }

export function Rating({ answer: picked, frozen }) {
  return (
    <div className="tc-rating" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => <button type="button" className={classes('tc-star', { on: picked >= n })} aria-label={`${n} of 5`} data={{ n }} disabled={frozen}>★</button>)}
    </div>
  )
}
Rating.intent = ({ DOM }) => ({ RATE: DOM.click('.tc-star').data('n', Number) })
Rating.model = { RATE: { PARENT: answerWith() } }

export const catalog = defineCatalog({
  description: 'A card in the chat: what the assistant shows to get an answer from the user',
  // quoted in the prompt that composes a card
  guidance: 'A card asks for exactly one answer: use one part the user answers with. Add at most one display part, before it, only when it helps: destination details when the question is about one destination; to confirm a booking, the trip summary, then the yes / no buttons. To choose a destination, use the destination picker, not a choice.',
  parts: {
    destinations: {
      component: DestinationPicker, result: true,
      description: 'Destination picker (the destinations with their price per night; the user picks one)',
      params: { vibe: { label: 'kind of trip', default: 'any', options: { any: 'every destination', warm: 'warm, sunny places', city: 'city breaks', nature: 'nature and the outdoors' } } },
    },
    destination: {
      component: DestinationDetails,
      description: "Destination details (one destination by name: what it's like, its highlights and price)",
      params: { destination: { label: 'destination', from: (state) => state.destinations.map((d) => ({ value: d.id, name: d.name, aliases: [d.country] })) } },
    },
    choice: {
      component: Choice, result: true,
      description: 'Choice (a question with 2 to 5 short options; the user picks one)',
      params: {
        question: { type: 'text', maxLength: 120, required: true },
        options: { type: 'list', items: { maxLength: 40 }, min: 2, max: 5, required: true },
      },
    },
    tripSize: {
      component: TripSize, result: true, local: { travelers: null, nights: null },
      description: 'Trip size (steppers for the number of travelers and nights, with a Done button)',
      params: {
        travelers: { type: 'number', label: 'travelers (only when the need says how many)', default: 2, min: 1, max: 8, bins: { 1: 'one (solo)', 2: 'two (the default)', 4: 'a small group (about 4)' } },
        nights: { type: 'number', label: 'nights (only when the need says how many)', default: 3, min: 1, max: 14, bins: { 3: 'a long weekend (3)', 7: 'a week' } },
      },
    },
    tripSummary: { component: TripSummary, description: 'Trip summary (the trip as planned: destination, travelers, nights and total price, to review before booking)' },
    confirm: { component: Confirm, result: true, description: 'Yes / no buttons (the user confirms or declines)' },
    rating: { component: Rating, result: true, description: 'Rating (1 to 5 stars; how satisfied the user is)' },
  },
})
