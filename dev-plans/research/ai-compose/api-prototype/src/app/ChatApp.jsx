// In-chat agent UI: an assistant that asks the user with cards built from the app's parts.
// makeChatApp() = an LLM writes the card's layout (generated question / options allowed);
// makeChatApp(decisions(...)) = the LLM only says what to ask, a decision model picks prepared parts.
import { chat } from 'sygnal/ai'
import { defineCatalog, answer } from '../lib/catalog.jsx'
import { askUser, askTool, cardResult, renderCard } from '../lib/askUser.jsx'

// ---------------------------------------------------------------- result parts (they answer the card)
// a question with options the LLM writes (free-text params: LLM only)
export function ChoiceCard({ question, options = [], answer: picked, frozen }) {
  return (
    <div className="choice">
      <p className="question">{question}</p>
      {options.map((o) => <button type="button" className={o === picked ? 'option picked' : 'option'} data={{ value: o }} disabled={frozen}>{o}</button>)}
    </div>
  )
}
ChoiceCard.intent = ({ DOM }) => ({ PICK: DOM.click('.option').data('value') })
ChoiceCard.model = { PICK: { PARENT: (_s, value, _n, props) => answer(props, value) } }

// a prepared picker over app data (decision-friendly: no generated text)
export function PlanPicker({ state, answer: picked, frozen }) {
  return (
    <ul className="plans">
      {state.plans.map((p) => <li><button type="button" className={p.id === picked ? 'plan picked' : 'plan'} data={{ id: p.id }} disabled={frozen}>{p.name} ({p.price})</button></li>)}
    </ul>
  )
}
PlanPicker.intent = ({ DOM }) => ({ PICK: DOM.click('.plan').data('id') })
PlanPicker.model = { PICK: { PARENT: (_s, id, _n, props) => answer(props, id) } }

// a small form with local state (kept per card), answering with its values
export function ContactForm({ state, frozen }) {
  return (
    <form className="contact">
      <input className="name" aria-label="Name" value={state.name} disabled={frozen} />
      <input className="email" aria-label="Email" value={state.email} disabled={frozen} />
      <button type="submit" className="send" disabled={frozen}>Send</button>
    </form>
  )
}
ContactForm.intent = ({ DOM }) => ({
  NAME: DOM.input('.name').value(),
  EMAIL: DOM.input('.email').value(),
  SEND: DOM.select('.contact').events('submit', { preventDefault: true }),
})
ContactForm.model = {
  NAME: (s, name) => ({ ...s, name }),
  EMAIL: (s, email) => ({ ...s, email }),
  SEND: { PARENT: (s, _d, _n, props) => answer(props, { name: s.name, email: s.email }) },
}

// display parts + a fixed-wording confirmation ("looks right?")
export function Chart({ range }) { return <figure className="chart" data={{ range }}>Revenue ({range})</figure> }
export function LooksRight({ answer: picked, frozen }) {
  return (
    <p className="looks-right">Does this look right?
      <button type="button" className="yes" disabled={frozen}>{picked === true ? 'Yes ✓' : 'Yes'}</button>
      <button type="button" className="no" disabled={frozen}>{picked === false ? 'No ✓' : 'No'}</button>
    </p>
  )
}
LooksRight.intent = ({ DOM }) => ({ YES: DOM.click('.yes'), NO: DOM.click('.no') })
LooksRight.model = {
  YES: { PARENT: (_s, _d, _n, props) => answer(props, true) },
  NO: { PARENT: (_s, _d, _n, props) => answer(props, false) },
}

export const chatCatalog = defineCatalog({
  parts: {
    choice: {
      component: ChoiceCard, result: true, description: 'A question with 2 to 5 short options; the user picks one',
      params: {
        question: { type: 'string', maxLength: 120, required: true, description: 'The question' },
        options: { type: 'array', items: { type: 'string', maxLength: 40 }, minItems: 2, maxItems: 5, required: true, description: 'The options' },
      },
    },
    plans: { component: PlanPicker, result: true, description: 'The pricing plans to pick from (Free, Team, Business)' },
    contact: { component: ContactForm, result: true, local: { name: '', email: '' }, description: 'A form asking for a name and an email' },
    chart: {
      component: Chart, description: 'Line chart: the revenue trend',
      params: { range: { enum: ['month', 'quarter', 'year'], default: 'year', description: 'The time range' } },
    },
    looksRight: { component: LooksRight, result: true, description: 'Asks: does this look right? (yes / no)' },
  },
  containers: { row: { description: 'Elements side by side', render: ({ slots }) => <div className="row">{slots.default}</div> } },
})

export const PLANS = [{ id: 'free', name: 'Free', price: '$0' }, { id: 'team', name: 'Team', price: '$12' }, { id: 'biz', name: 'Business', price: '$30' }]

const TOOL = 'tool-ui_cards_ask'

export function makeChatApp(backend) {
  function App({ state }) {
    const a = state.assistant
    return (
      <div className="chat">
        <ol className="messages">
          {a.messages.map((m) => (
            <li className={`msg ${m.role}`}>
              {m.parts.map((p) => (p.type === 'text' ? <p className="text">{p.text}</p>
                : p.type === TOOL ? renderCard(chatCatalog, state, 'cards', p)
                : null))}
            </li>
          ))}
        </ol>
        {a.draft && <p className="draft">{a.draft}</p>}
        <form className="ask">
          <input className="prompt" aria-label="Message" value={a.prompt} />
          <button type="submit" disabled={a.status !== 'ready'}>Send</button>
        </form>
      </div>
    )
  }
  App.initialState = { plans: PLANS }
  App.uses = {
    assistant: chat({ form: '.ask', prompt: '.prompt', instructions: 'Help the user choose a plan. Ask with ui_cards_ask when you need the user to choose, fill in or confirm something.' }),
    cards: askUser(chatCatalog, { backend }),
  }
  App.agent = {
    name: 'ui',
    description: 'Cards shown to the user in the conversation',
    read: (s) => cardResult(s.cards),
    actions: { 'cards.ASK': askTool(chatCatalog, 'cards', { backend, state: { plans: PLANS } }) },
  }
  return App
}
