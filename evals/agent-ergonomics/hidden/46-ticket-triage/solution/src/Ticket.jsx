import { ABORT } from 'sygnal'
import { decide, choice, noul } from 'sygnal/ai'

const TOPICS = { billing: 'Billing', bug: 'Bug', account: 'Account' }

const questions = {
  topic: choice('What is this support ticket about?', {
    billing: 'Payments, invoices, charges, refunds or plans',
    bug: 'Something in the product is broken or crashes',
    account: 'Signing in, access, passwords or the profile',
  }),
  urgent: noul('Does the customer need this handled today?', {
    true: 'The customer is blocked, losing money, or has a deadline',
    false: 'A question or a minor issue that can wait',
  }),
}

function Ticket({ state }) {
  return (
    <li className="ticket">
      <h2 className="subject">{state.subject}</h2>
      <p className="text">{state.text}</p>
      <p className="topic">{topicText(state)}</p>
      {state.status === 'failed' && <button type="button" className="retry">Retry</button>}
      {state.urgent && <strong className="urgent">Urgent</strong>}
    </li>
  )
}

function topicText(state) {
  if (state.status === 'failed') return 'Could not triage.'
  if (state.status === 'asking') return 'Asking the assistant…'
  if (state.status === 'review') return 'Needs review'
  if (state.status === 'done') return TOPICS[state.topic] + (state.byAssistant ? ' (assistant)' : '')
  return 'Triaging…'
}

const triage = (state) => decide({ model: 'jev-latest', state: state.text, questions, ok: 'TRIAGED', error: 'TRIAGE_FAILED' })
const unsure = (answers) => answers.topic.confidence < 0.6
const classify = (state) => ({
  messages: [{ role: 'user', parts: [{ type: 'text', text: `Classify this support ticket as billing, bug or account. Answer with that one word only.\n\n${state.text}` }] }],
  ok: 'CLASSIFIED',
  error: 'UNCLASSIFIED',
})

Ticket.intent = ({ DOM }) => ({
  RETRY: DOM.click('.retry'),
})

Ticket.model = {
  BOOTSTRAP: {
    STATE: (state) => ({ ...state, status: 'pending' }),
    HTTP: triage,
  },
  RETRY: {
    STATE: (state) => ({ ...state, status: 'pending' }),
    HTTP: triage,
  },
  TRIAGED: {
    STATE: (state, { answers }) => ({
      ...state,
      urgent: answers.urgent.noul >= 0.5,
      ...(unsure(answers) ? { status: 'asking' } : { status: 'done', topic: answers.topic.choice, byAssistant: false }),
    }),
    LLM: (state, { answers }) => (unsure(answers) ? classify(state) : ABORT),
  },
  TRIAGE_FAILED: (state) => ({ ...state, status: 'failed' }),
  CLASSIFIED: (state, { text }) => {
    const word = text.trim().toLowerCase().replace(/\.$/, '')
    return TOPICS[word] ? { ...state, status: 'done', topic: word, byAssistant: true } : { ...state, status: 'review' }
  },
  UNCLASSIFIED: (state) => ({ ...state, status: 'review' }),
}

export default Ticket
