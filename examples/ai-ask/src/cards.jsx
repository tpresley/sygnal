// The parts a card is built from: one catalog for both card backends.
//
// A part with `result: true` answers the card: it sends compose.answer(props, value) to PARENT,
// and that value is what the model gets back (the call's output `{ part, answer }`). Every label
// and button is the app's own; a model only picks parts and their params.
//   - choice:  a generated question with options (free-text params: LLM only)
//   - plans:   a picker over the app's plans (prepared: works on a decision backend too)
//   - plan:    one plan's details (a record param: the model names a plan, never its price)
//   - contact: a small form whose values live in the card (`local`)
//   - confirm: yes / no
//   - rating:  1 to 5 stars
import { defineCatalog, compose } from 'sygnal/ai'
import { priceOf } from './data.js'

export function Choice({ question, options = [], answer, frozen }) {
  return (
    <div className="part choice">
      <p className="question">{question}</p>
      <div className="options">
        {options.map((o) => <button type="button" className={o === answer ? 'option picked' : 'option'} data={{ value: o }} disabled={frozen}>{o}</button>)}
      </div>
    </div>
  )
}
Choice.intent = ({ DOM }) => ({ PICK: DOM.click('.option').data('value') })
Choice.model = { PICK: { PARENT: (state, value, next, props) => compose.answer(props, value) } }

// no `state` in its catalog entry: it sees the host's state (the app's plans), as any child does
export function PlanPicker({ state, answer, frozen }) {
  return (
    <ul className="part plans">
      {state.plans.map((p) => (
        <li>
          <button type="button" className={p.id === answer ? 'plan picked' : 'plan'} data={{ id: p.id }} disabled={frozen}>
            <b>{p.name}</b> <span className="muted">{priceOf(p)}, up to {p.seats} {p.seats === 1 ? 'seat' : 'seats'}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
PlanPicker.intent = ({ DOM }) => ({ PICK: DOM.click('.plan').data('id') })
PlanPicker.model = { PICK: { PARENT: (state, id, next, props) => compose.answer(props, id) } }

// a display part: the plan named by its record param
export function PlanDetails({ state, plan }) {
  const p = state.plans.find((x) => x.id === plan)
  if (!p) return null
  return (
    <div className="part plan-details" data={{ plan: p.id }}>
      <b>{p.name}</b>: {priceOf(p)}, up to {p.seats} {p.seats === 1 ? 'seat' : 'seats'}
      <ul>{p.features.map((f) => <li>{f}</li>)}</ul>
    </div>
  )
}

// `local` in its catalog entry: its state is kept on the card, per card
export function ContactForm({ state, frozen }) {
  return (
    <form className="part contact">
      <input className="name" aria-label="Name" placeholder="Name" value={state.name} disabled={frozen} />
      <input className="email" type="email" aria-label="Email" placeholder="Email" value={state.email} disabled={frozen} />
      <button type="submit" className="send" disabled={frozen || !state.name.trim() || !state.email.includes('@')}>Send</button>
    </form>
  )
}
ContactForm.intent = ({ DOM }) => ({
  NAME: DOM.input('.name').value(),
  EMAIL: DOM.input('.email').value(),
  SEND: DOM.select('.contact').events('submit', { preventDefault: true }),
})
ContactForm.model = {
  NAME: (state, name) => ({ ...state, name }),
  EMAIL: (state, email) => ({ ...state, email }),
  SEND: { PARENT: (state, data, next, props) => compose.answer(props, { name: state.name.trim(), email: state.email.trim() }) },
}

export function Confirm({ answer, frozen }) {
  return (
    <div className="part confirm">
      <button type="button" className={answer === true ? 'yes picked' : 'yes'} disabled={frozen}>Yes</button>
      <button type="button" className={answer === false ? 'no picked' : 'no'} disabled={frozen}>No</button>
    </div>
  )
}
Confirm.intent = ({ DOM }) => ({ YES: DOM.click('.yes'), NO: DOM.click('.no') })
Confirm.model = {
  YES: { PARENT: (state, data, next, props) => compose.answer(props, true) },
  NO: { PARENT: (state, data, next, props) => compose.answer(props, false) },
}

const STARS = [1, 2, 3, 4, 5]
export function Rating({ answer, frozen }) {
  return (
    <div className="part rating" role="group" aria-label="Rating">
      {STARS.map((n) => (
        <button type="button" className={answer && n <= answer ? 'star on' : 'star'} aria-label={`${n} of 5`} data={{ n }} disabled={frozen}>★</button>
      ))}
    </div>
  )
}
Rating.intent = ({ DOM }) => ({ RATE: DOM.click('.star').data('n') })
Rating.model = { RATE: { PARENT: (state, n, next, props) => compose.answer(props, Number(n)) } }

export const catalog = defineCatalog({
  description: 'A card in the chat: what the assistant shows to get an answer from the user',
  // quoted in the LLM's prompt (and in a decision model's order questions)
  guidance: 'A card asks for one answer: use exactly one part the user answers with, plus at most one plan details part when the question is about a specific plan. To choose a plan, use the plan picker, not a choice.',
  parts: {
    choice: {
      component: Choice, result: true,
      description: 'Choice (a question with 2 to 5 short options; the user picks one)',
      params: {
        question: { type: 'text', maxLength: 120, required: true },
        options: { type: 'list', items: { maxLength: 40 }, min: 2, max: 5, required: true },
      },
    },
    plans: { component: PlanPicker, result: true, description: 'Plan picker (the pricing plans with prices and seats; the user picks one)' },
    plan: {
      component: PlanDetails,
      description: 'Plan details (one plan by name: its cost per seat, seat limit and features)',
      params: { plan: { label: 'plan', from: (state) => state.plans.map((p) => ({ value: p.id, name: p.name })) } },
    },
    contact: {
      component: ContactForm, result: true, local: { name: '', email: '' },
      description: 'Contact form (asks for a name and an email address, to be contacted)',
    },
    confirm: { component: Confirm, result: true, description: 'Yes / no buttons (the user confirms or declines)' },
    rating: { component: Rating, result: true, description: 'Rating (1 to 5 stars; how satisfied the user is)' },
  },
})
