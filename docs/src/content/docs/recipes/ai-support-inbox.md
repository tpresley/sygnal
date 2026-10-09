---
title: Support Inbox
description: Triage every ticket with a decision model as a Collection item resource, sort the inbox by urgency, and escalate the unsure tickets to a chat model with structured output
---

A support inbox where every ticket is triaged as it arrives: its topic picks the team, its urgency sorts the list. A [decision model](/guide/ai-decisions/) answers in a few hundred milliseconds for each ticket. The few it is unsure about go to a [chat model](/guide/ai-chat/), which answers with structured output: a topic and the reason.

The pieces:

- **Each ticket is a Collection item with its own resource.** The decision follows the ticket's text, and its result is written into the ticket, so the inbox can sort by it.
- **The resource's `ok` action checks the confidence**, and only an unsure ticket sends a chat request.
- **The chat model's answer is typed**: `output` is a schema, and `ok` gets the validated value.

## Install

Nothing beyond Sygnal and a schema library for the structured output:

```sh
npm install sygnal zod
```

`main.js` registers both drivers: the fetch driver for decisions, the chat driver for the escalations.

```js
import { run, makeFetchDriver } from 'sygnal'
import { makeChatDriver, uiMessageStream } from 'sygnal/ai'
import Inbox from './Inbox.jsx'

run(Inbox, {
  HTTP: makeFetchDriver(),
  LLM: makeChatDriver({ transport: uiMessageStream('/api/chat') }),
})
```

`decide()` posts to `/api/decide` and the chat driver to `/api/chat`: your server's routes, which hold the keys ([decisions](/guide/ai-decisions/#keys-stay-on-the-server), [chat](/guide/ai-chat/#shipping-it)). In development, point them at a local Ollama instead.

## The inbox

In this demo, the demo server answers for both models. The third ticket is ambiguous, so its escalation runs as soon as the demo shows.

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

const has = (text, words) => words.some((w) => text.toLowerCase().includes(w))

export default {
  'POST /v1/systemone': ({ json }) => {
    const t = String(json.state)
    const topic = has(t, ['charge', 'refund']) ? 'billing' : has(t, ['crash', 'error']) ? 'bug' : 'account'
    const sure = has(t, ['charge', 'crash', 'password']) ? 0.93 : 0.38
    const others = ['billing', 'bug', 'account'].filter((k) => k !== topic)
    return {
      delayMs: 500,
      json: {
        model: json.model,
        answers: {
          topic: { type: 'choice', choice: topic, confidence: sure, probabilities: { [topic]: sure, [others[0]]: (1 - sure) / 2, [others[1]]: (1 - sure) / 2 } },
          urgent: { type: 'noul', noul: has(t, ['twice', 'down', 'today']) ? 0.92 : 0.1 },
        },
      },
    }
  },
  'POST /v1/responses': () => ({
    sse: encodeOpenResponses(['{"topic":"billing",', '"reason":"They ask', ' for an invoice', ' copy, a billing', ' document."}']),
    delayMs: 300,
    chunkMs: 60,
  }),
}
```

```jsx live live-height=280
import { z } from 'zod'
import { ABORT, Collection } from 'sygnal'
import { decide, choice, noul } from 'sygnal/ai'

const TOPICS = { billing: 'Payments, invoices, plans, refunds', bug: 'Something in the product is broken', account: 'Login, access or profile' }
const TEAMS = { billing: 'Billing team', bug: 'Engineering', account: 'Account support' }

const questions = {
  topic: choice('What is this ticket about?', TOPICS),
  urgent: noul('Does the customer need this handled today?', {
    true: 'Blocked, losing money, or a deadline',
    false: 'A question or a minor issue',
  }),
}

const SecondOpinion = z.object({
  topic: z.enum(['billing', 'bug', 'account']),
  reason: z.string().describe('One short sentence'),
})

const SURE = 0.6

// the topic to act on: the chat model's when it was asked, else the decision's
const topicOf = (ticket) => ticket.opinion?.topic ?? ticket.triage?.data?.answers.topic.choice
const urgency = (ticket) => ticket.triage?.data?.answers.urgent.noul ?? 0

function TicketRow({ state }) {
  const { status, data } = state.triage
  const topic = topicOf(state)
  return (
    <li className="ticket">
      <p><b>{state.from}</b>: {state.text}</p>
      <p className="labels" aria-live="polite">
        {status === 'loading' && 'Triaging…'}
        {status === 'error' && 'Not triaged: a person will look at it.'}
        {state.asking && 'Unsure, asking the chat model…'}
        {topic && !state.asking && <>→ {TEAMS[topic]}</>}
        {data && data.answers.urgent.noul > 0.5 && <strong> urgent</strong>}
      </p>
      {state.opinion && <p className="reason"><i>{state.opinion.reason}</i></p>}
    </li>
  )
}

TicketRow.resources = {
  triage: (state) => decide({ url: '/v1/systemone', model: 'nimble', state: state.text, questions, ok: 'TRIAGED' }),
}

TicketRow.model = {
  TRIAGED: {
    STATE: (state, { answers }) => (answers.topic.confidence < SURE ? { ...state, asking: true } : ABORT),
    LLM: (state, { answers }) => (answers.topic.confidence < SURE
      ? {
        instructions: 'Classify the support ticket and give one short reason.',
        messages: [{ role: 'user', content: state.text }],
        output: SecondOpinion,
        ok: 'CLASSIFIED',
        error: 'NOT_CLASSIFIED',
      }
      : ABORT),
  },
  CLASSIFIED: (state, { value }) => ({ ...state, asking: false, opinion: value }),
  NOT_CLASSIFIED: (state) => ({ ...state, asking: false }),
}

function Inbox({ state }) {
  const urgent = state.tickets.filter((t) => urgency(t) > 0.5).length
  return (
    <section className="inbox">
      <h3>Inbox ({urgent} urgent)</h3>
      <ul>
        <Collection of={TicketRow} from="tickets" sort={(a, b) => urgency(b) - urgency(a)} />
      </ul>
    </section>
  )
}

Inbox.initialState = {
  tickets: [
    { id: 1, from: 'Ana', text: 'The app crashes when I export a report' },
    { id: 2, from: 'Ben', text: 'I was charged twice, please fix it today' },
    { id: 3, from: 'Cleo', text: 'Where can I get a copy of last month\'s invoice?' },
  ],
}
```

- **The resource lives on the item.** Each `TicketRow` has its own `triage` resource, written into its ticket: `state.tickets[i].triage` in the inbox. That is how `Inbox` counts the urgent ones and sorts by urgency, with no messages between the two. The items keep their instances as they move.
- **One request per ticket.** A decision model answers each in a few hundred milliseconds, and questions are answered in parallel. For hundreds of tickets, triage on the server when they arrive and store the answers instead.
- **The escalation is typed.** The chat model's answer must match `SecondOpinion`. An answer that doesn't arrives as `NOT_CLASSIFIED`, and the ticket shows the decision's topic.
- **Unsure is information.** Show it: a ticket the models disagree about, or both are unsure about, is one for a person.

## Testing

`answers()` builds a decision reply typed from the questions; the LLM fake answers the escalation. Export `TicketRow` and `questions` from the module to test a row on its own:

```js
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { answers } from 'sygnal/ai'
import { TicketRow, questions } from './Inbox.jsx'

it('routes a confident ticket and asks the chat model about an unsure one', async () => {
  const sure = renderComponent(TicketRow, { initialState: { id: 1, from: 'Ana', text: 'It crashes' } })
  await sure.respond('HTTP', answers(questions, { topic: 'bug' }), 'triage')
  expect(sure.html()).toContain('Engineering')
  expect(sure.requests('LLM')).toEqual([])
  sure.dispose()

  const unsure = renderComponent(TicketRow, { initialState: { id: 3, from: 'Cleo', text: 'Invoice copy?' } })
  await unsure.respond('HTTP', answers(questions, { topic: { choice: 'account', confidence: 0.4 } }), 'triage')
  await unsure.respond('LLM', { topic: 'billing', reason: 'An invoice is a billing document.' })
  expect(unsure.html()).toContain('Billing team')
  unsure.dispose()
})
```

## Pitfalls

- **Don't put the decision on the inbox.** One resource on the list would send every ticket again when one changes. A resource per item sends one request per ticket, and only again when that ticket's text changes.
- **Keep the escalation rare.** Tune `SURE` on real tickets: if most go to the chat model, the questions or their option descriptions need work.
- **A chat model's topic can be anything** without `output`. With a `z.enum`, it can only be one of yours.
