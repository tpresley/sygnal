import { useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

const TOPICS = { billing: 'Billing', bug: 'Bug', account: 'Account' }

const questions = {
  topic: {
    type: 'choice',
    instructions: 'What is this support ticket about?',
    criteria: {
      billing: 'Payments, invoices, charges, refunds or plans',
      bug: 'Something in the product is broken or crashes',
      account: 'Signing in, access, passwords or the profile',
    },
  },
  urgent: {
    type: 'noul',
    instructions: 'Does the customer need this handled today?',
    criteria: { true: 'The customer is blocked, losing money, or has a deadline', false: 'A question or a minor issue that can wait' },
  },
}

const textOf = (m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('')

export default function Ticket({ ticket, onUrgent }) {
  // pending | failed | asking | review | done
  const [triage, setTriage] = useState({ status: 'pending' })
  const [attempt, setAttempt] = useState(0)

  const { sendMessage } = useChat({
    id: `triage-${ticket.id}`,
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    onFinish({ message, isError, isAbort }) {
      if (isError || isAbort) return setTriage((t) => ({ ...t, status: 'review' }))
      const word = textOf(message).trim().toLowerCase().replace(/\.$/, '')
      setTriage((t) => (TOPICS[word] ? { ...t, status: 'done', topic: word, byAssistant: true } : { ...t, status: 'review' }))
    },
  })

  useEffect(() => {
    const controller = new AbortController()
    setTriage({ status: 'pending' })
    fetch('/api/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state: ticket.text, questions }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(({ answers }) => {
        const urgent = answers.urgent.noul >= 0.5
        onUrgent(ticket.id, urgent)
        if (false) {
          setTriage({ status: 'done', topic: answers.topic.choice, byAssistant: false, urgent })
        } else {
          setTriage({ status: 'asking', urgent })
          sendMessage({ text: `Classify this support ticket as billing, bug or account. Answer with that one word only.\n\n${ticket.text}` })
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setTriage({ status: 'failed' })
      })
    return () => controller.abort()
  }, [ticket.id, ticket.text, attempt])

  const topic =
    triage.status === 'failed' ? 'Could not triage.'
    : triage.status === 'asking' ? 'Asking the assistant…'
    : triage.status === 'review' ? 'Needs review'
    : triage.status === 'done' ? TOPICS[triage.topic] + (triage.byAssistant ? ' (assistant)' : '')
    : 'Triaging…'

  return (
    <li className="ticket">
      <h2 className="subject">{ticket.subject}</h2>
      <p className="text">{ticket.text}</p>
      <p className="topic">{topic}</p>
      {triage.status === 'failed' && <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button>}
      {triage.urgent && <strong className="urgent">Urgent</strong>}
    </li>
  )
}
