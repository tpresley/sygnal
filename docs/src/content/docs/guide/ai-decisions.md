---
title: AI Decisions
description: Typed answers from decision models with decide() and the choice, noul and score questions — as a resource or a reply-action request, confidence and escalation to a chat model, OpenAI Decisions, testing with answers(), and the server route that keeps the key
---

A **decision model** answers typed questions about some state: which category is this ticket, is it urgent, how upset is the customer. You send the state and the questions; it sends back a probability for every answer. It writes no text and streams nothing, so it is fast (a few hundred milliseconds) and cheap, and its answers are calibrated: a confidence of 0.4 means it is unsure, and you can act on that.

Decision models in this shape:

| Model | Where | `model` |
|---|---|---|
| TypeSafe Jev | TypeSafe's `/v1/systemone` (through your server) | `'jev-latest'` |
| Ollama 0.35 or later | `http://localhost:11434/v1/systemone`, on your machine | `'nimble'`, `'clef'`, `'clef-flash'` |
| OpenRouter | OpenRouter's decisions endpoint (through your server) | the model's OpenRouter id |
| Vercel AI Gateway | the gateway's decisions endpoint (through your server) | the model's gateway id |
| OpenAI Decisions | `POST /v1/decisions` (through your server), with [`decide.openai()`](#openai-decisions) | e.g. `'gpt-6-luna'` |

A decision is an ordinary HTTP request, so there is no new driver: `decide()` from `sygnal/ai` builds a request for the [fetch driver](/guide/http/). Register it in `main.js` as usual:

```js
import { run, makeFetchDriver } from 'sygnal'
import App from './App.jsx'

run(App, { HTTP: makeFetchDriver() })
```

To try it with no key, pull a decision model into Ollama (`ollama pull nimble`) and point `decide()` at it: `decide({ url: 'http://localhost:11434/v1/systemone', model: 'nimble', ... })`.

## Questions

Three builders make the questions. Give each a name; the answers come back under the same names.

```js
import { choice, noul, score } from 'sygnal/ai'

export const questions = {
  // pick one option: name → description
  topic: choice('What is this ticket about?', {
    billing: 'Payments, invoices, plans, refunds',
    bug: 'Something in the product is broken',
    account: 'Login, access or profile',
  }),
  // the probability of yes; the criteria say what counts as true and false
  urgent: noul('Does the customer need this handled today?', {
    true: 'Blocked, losing money, or a deadline',
    false: 'A question or a minor issue',
  }),
  // an ordered scale, lowest first
  mood: score('How upset is the customer?', ['calm', 'annoyed', 'angry']),
}
```

| Question | Answer |
|---|---|
| `choice(instructions, options)` | `{ type: 'choice', choice, probabilities, confidence }`: the most likely option, every option's probability (they sum to 1), and how strongly the model favours one |
| `noul(instructions, criteria?)` | `{ type: 'noul', noul }`: the probability of yes, 0 to 1 |
| `score(instructions, levels)` | `{ type: 'score', score, legend, probabilities, confidence }`: the probability-weighted level index (0 is the first level; 1.4 is between the second and third), each level's probability, and the confidence |

- `options` can also be a plain list of names: `choice('Which language?', ['en', 'fr', 'de'])`.
- `instructions` can be text, or an object or array that holds the question with the data it names.
- Write `noul` criteria: answers are better calibrated with them.
- Questions are answered in parallel, so a few more cost little time.

**Typed answers.** In TypeScript the answers are typed from the questions: `answers.topic.choice` is `'billing' | 'bug' | 'account'`. Name the reply type with `Decision<typeof questions>`:

```ts
import type { Decision } from 'sygnal/ai'
import { questions } from './questions'

type Triage = Decision<typeof questions>

const label = (d: Triage) => (d.answers.urgent.noul > 0.5 ? `${d.answers.topic.choice} (urgent)` : d.answers.topic.choice)
```

## As a resource

Most decisions describe some state the app already has: a ticket, a message, a form. Declare the decision as a [resource](/guide/resources/), and it runs again whenever the state it depends on changes. A stale answer is never shown for new text: the earlier request is aborted.

```jsx
import { decide } from 'sygnal/ai'
import { questions } from './questions.js'

function Ticket({ state }) {
  const t = state.triage
  return (
    <article>
      <p>{state.text}</p>
      {t.status === 'loading' && <p>Triaging…</p>}
      {t.status === 'success' && <p className="topic">{t.data.answers.topic.choice}</p>}
      {t.status === 'error' && <p role="alert">Could not triage: {t.error.message}</p>}
    </article>
  )
}

Ticket.initialState = { text: 'I was charged twice this month' }

Ticket.resources = {
  triage: (state) => state.text && decide({ model: 'jev-latest', state: state.text, questions }),
}
```

`decide()` returns `{ url, method: 'POST', json: { model, state, questions } }`. The default `url` is `'/api/decide'`, a route on your own server that adds the key ([below](#keys-stay-on-the-server)). Every other key passes through to the request: `ok`, `error`, `key`, `latest`, `headers`, `timeoutMs`, `retry`, and the resource options `keepPrevious`, `refetchEvery` and `background`.

## As a request

A decision the user asks for (a button, a submit) is a request with reply actions, like any HTTP request:

```jsx
import { decide } from 'sygnal/ai'
import { questions } from './questions.js'

Inbox.model = {
  TRIAGE: {
    STATE: (state) => ({ ...state, triaging: true }),
    HTTP: (state, ticket) => decide({ model: 'jev-latest', state: ticket.text, questions, ok: 'TRIAGED', error: 'TRIAGE_FAILED' }),
  },
  TRIAGED: (state, { answers }) => ({ ...state, triaging: false, topic: answers.topic.choice, urgent: answers.urgent.noul > 0.5 }),
  TRIAGE_FAILED: (state, { error }) => ({ ...state, triaging: false, error: error.message }),
}
```

`state` can be text, or an object or array, sent as JSON: `state: { subject, body, plan: customer.plan }`. Models that read images take `images`: base64 PNG, JPEG or WebP files shared by every question.

## Confidence and escalation

`confidence` (0 to 1) says how strongly the model favours one option over the others. It is not a promise that the answer is right, but a low value is a reliable sign that the question is hard for this input: the text is ambiguous, or fits two options. That is when to ask something slower and smarter. Sending only the unsure cases to a chat model keeps the cost and the wait of a decision for most inputs, and gets a written reason for the rest.

In this demo, the resource's `ok` action looks at the confidence. Above 0.6 the decision stands; below it, the component asks the chat model (the [chat driver](/guide/ai-chat/), as `LLM`) for a second opinion, which streams in. The first ticket is ambiguous, so the escalation runs as soon as the demo shows. Try "The app crashes when I open settings".

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

const has = (text, words) => words.some((w) => text.toLowerCase().includes(w))

export default {
  // the decision model
  'POST /v1/systemone': ({ json }) => {
    const t = String(json.state)
    const topic = has(t, ['charge', 'refund', 'invoice']) ? 'billing' : has(t, ['crash', 'broken', 'error']) ? 'bug' : 'account'
    const sure = has(t, ['charge', 'crash', 'password']) ? 0.94 : 0.41
    const others = ['billing', 'bug', 'account'].filter((k) => k !== topic)
    return {
      delayMs: 400,
      json: {
        model: json.model,
        answers: {
          topic: { type: 'choice', choice: topic, confidence: sure, probabilities: { [topic]: sure, [others[0]]: (1 - sure) / 2, [others[1]]: (1 - sure) / 2 } },
          urgent: { type: 'noul', noul: has(t, ['twice', 'now', 'today']) ? 0.9 : 0.15 },
        },
      },
    }
  },
  // the chat model, for the unsure ones
  'POST /v1/responses': () => ({
    sse: encodeOpenResponses(['account: ', 'the customer ', 'cannot open ', 'their invoices, ', 'which sounds like ', 'an access problem, ', 'not a payment one.']),
    delayMs: 300,
    chunkMs: 80,
  }),
}
```

```jsx live live-height=220
import { ABORT } from 'sygnal'
import { decide, choice, noul } from 'sygnal/ai'

const questions = {
  topic: choice('What is this ticket about?', {
    billing: 'Payments, invoices, plans, refunds',
    bug: 'Something in the product is broken',
    account: 'Login, access or profile',
  }),
  urgent: noul('Does the customer need this handled today?', {
    true: 'Blocked, losing money, or a deadline',
    false: 'A question or a minor issue',
  }),
}

const SURE = 0.6

const secondOpinion = (text) => ({
  instructions: 'Classify the support ticket as billing, bug or account. Answer with the category, a colon, and one short reason.',
  messages: [{ role: 'user', content: text }],
  key: 'opinion',
  delta: 'OPINION',
  ok: 'OPINION',
  error: 'OPINION_FAILED',
})

function Ticket({ state }) {
  const t = state.triage
  const answers = t.status === 'success' && t.data.answers
  return (
    <article className="ticket">
      <form className="triage">
        <label>Ticket <input className="text" value={state.draft} /></label>
        <button type="submit">Triage</button>
      </form>
      <p aria-live="polite">
        {t.status === 'loading' && 'Triaging…'}
        {answers && <>
          <b className="topic">{answers.topic.choice}</b> ({Math.round(answers.topic.confidence * 100)}% sure)
          {answers.urgent.noul > 0.5 && <strong> urgent</strong>}
        </>}
        {t.status === 'error' && `Could not triage: ${t.error.message}`}
      </p>
      {state.opinion && <p className="opinion" aria-live="polite"><b>Second opinion:</b> {state.opinion}</p>}
    </article>
  )
}

Ticket.initialState = { draft: 'I cannot see my invoices anymore', text: 'I cannot see my invoices anymore', opinion: '' }

Ticket.intent = ({ DOM }) => ({
  TYPE: DOM.input('.text').value(),
  TRIAGE: DOM.select('.triage').events('submit', { preventDefault: true }),
})

Ticket.resources = {
  triage: (state) => state.text.trim() && decide({ url: '/v1/systemone', model: 'nimble', state: state.text, questions, ok: 'TRIAGED' }),
}

Ticket.model = {
  TYPE: (state, draft) => ({ ...state, draft }),
  TRIAGE: (state) => (state.draft.trim() ? { ...state, text: state.draft, opinion: '' } : ABORT),
  // runs after the resource is written: escalate only the unsure ones
  TRIAGED: {
    LLM: (state, { answers }) => (answers.topic.confidence < SURE ? secondOpinion(state.text) : ABORT),
  },
  OPINION: (state, { text }) => ({ ...state, opinion: text }),
  OPINION_FAILED: (state, { error }) => ({ ...state, opinion: `(no second opinion: ${error.message})` }),
}
```

- **The threshold is yours to tune.** Look at the confidence of a few dozen real inputs. With a threshold of 0.6, an experiment with a local `nimble` sent about one ticket in ten to the chat model.
- **`delta` and `ok` can name the same action** when the finished reply needs nothing more than the text so far.
- A chat request's `key` (`'opinion'`) keeps it apart from other chat requests of the component, and `latest` aborts the second opinion of an earlier ticket.
- `score` answers have a `confidence` too. A `noul` answer has none: its `noul` itself says how sure it is (near 0.5 is unsure).

The [support inbox](/recipes/ai-support-inbox/) recipe puts this into a whole inbox.

## OpenAI Decisions

OpenAI Decisions takes the same idea in another form: an array of questions (`predicate`, `choice`, `score`) and per-question refusals. `decide.openai()` takes the same options and questions as `decide()`, sends OpenAI's form, and maps the reply back. Your reply actions and resources get the same `{ answers: { name: answer } }` shape whichever you use:

```js
Ticket.resources = {
  triage: (state) => state.text && decide.openai({ model: 'gpt-6-luna', state: state.text, questions }),
}
```

A `noul` question becomes a `predicate` whose instructions include the criteria. OpenAI may refuse a question: its answer is then `{ type: 'refusal', … }`, so check `answer.type` before reading `choice`. The type `Decision<Q, RefusalAnswer>` includes it.

## Keys stay on the server

The browser never holds a provider key ([SYG670](/reference/errors/#syg670) refuses to send one to another origin). `decide()` posts to `/api/decide` on your own server by default, and that route adds the key. Keep it narrow, as for [chat](/guide/ai-chat/#shipping-it): fix the model, require a session, and limit the size of `state`, so the route can't be used as a free decision API.

```js
// server: POST /api/decide
import { currentUser } from './auth.js'      // your session check

const MODELS = new Set(['jev-latest'])

export async function POST(req) {
  if (!(await currentUser(req))) return new Response('Sign in first', { status: 401 })
  const { model, state, questions } = await req.json()
  if (!MODELS.has(model) || JSON.stringify(state).length > 20000) return new Response('Bad request', { status: 400 })

  // DECIDE_URL: the provider's decisions endpoint, e.g. TypeSafe's /v1/systemone
  const res = await fetch(process.env.DECIDE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DECIDE_API_KEY}` },
    body: JSON.stringify({ model, state, questions }),
  })
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } })
}
```

For a local Ollama in development there is no key and no route: point `url` at `http://localhost:11434/v1/systemone`. To switch per environment, build the options in one place: `const DECIDE = import.meta.env.DEV ? { url: 'http://localhost:11434/v1/systemone', model: 'nimble' } : { model: 'jev-latest' }`, then `decide({ ...DECIDE, state, questions })`.

## Testing

`renderComponent` answers the `HTTP` sink with its fetch fake ([HTTP testing](/guide/http/#testing-without-a-driver)). `answers(questions, picks)` from `sygnal/ai` builds the reply a decision model would send, typed from the questions: pick the answers the test cares about, and the rest are filled in (a `choice` gets its first option at confidence 0.9, a `noul` false, a `score` 0).

Here `Ticket.jsx` is the escalation demo's component, with `export const questions` and `export default Ticket`:

```js
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { answers } from 'sygnal/ai'
import Ticket, { questions } from './Ticket.jsx'

it('trusts a confident triage', async () => {
  const t = renderComponent(Ticket)
  await t.respond('HTTP', answers(questions, { topic: 'billing', urgent: true }), 'triage')
  expect(t.html()).toContain('billing')
  expect(t.requests('LLM')).toEqual([])
  t.dispose()
})

it('asks the chat model when the triage is unsure', async () => {
  const t = renderComponent(Ticket)
  await t.respond('HTTP', answers(questions, { topic: { choice: 'account', confidence: 0.4 } }), 'triage')
  await t.respond('LLM', 'account: an access problem.')
  expect(t.state.opinion).toBe('account: an access problem.')
  t.dispose()
})
```

- A pick is an option name, `{ choice, confidence }` or `{ probabilities }` for a `choice`; `true`, `false` or a probability for a `noul`; a level index, a level description or `{ score, confidence }` for a `score`. An unknown question name, option or level throws, so a test can't drift from the questions.
- For `decide.openai()`, answer with `answers.openai(questions, picks)`: OpenAI's array form, which the request's `parse` maps back as in the app.
- The resource's request is sent after the first render; `t.respond` by the resource name (`'triage'`) waits for it.

## A command bar

The `commandBar` behavior from `sygnal/ai` puts a decision model in front of your components' agent actions: the user types "mark the milk as bought", one decision picks the action and the item, and the behavior runs it. Below the confidence you set, it hands the command to a chat assistant instead (`escalate`), or tells the user it is unsure:

```jsx
import { commandBar } from 'sygnal/ai'

TodoApp.uses = {
  cmd: commandBar({ input: '.command', decide: { url: '/api/decide', model: 'jev-latest' }, below: 0.6, escalate: 'assistant' }),
}
```

It reads the actions from the components' [`agent` declarations](/guide/agent/#the-agent-static), the same ones the in-app assistant and browser agents use. [Agents: a command bar](/guide/agent/#a-command-bar-commandbar) documents it: the questions it asks, its options and state, escalation, free-text arguments, and a live demo.

## Related

- [Agents](/guide/agent/): the `agent` static, the command bar and the in-app assistant
- [AI Chat](/guide/ai-chat/): the chat driver, transports, and shipping an AI SDK route
- [Resources and Caching](/guide/resources/): the rules a decision resource follows
- [Support inbox](/recipes/ai-support-inbox/): triage, sorting and escalation in a whole inbox
