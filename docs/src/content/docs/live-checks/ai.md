---
title: "Live check: AI demos"
description: Not linked from the sidebar. Live demos of sygnal/ai against the page's demo server, so check-live streams a chat, runs a tool call and a decision on every engine
pagefind: false
head:
  - tag: meta
    attrs:
      name: robots
      content: noindex
---

:::note[Not a guide]
This page is not in the sidebar. It keeps the docs' live AI demos under `check-live` (PLAN-6 DX-1) until the AI guides reuse the pattern. The "model" here is the demo server block above each demo: a route that answers in Open Responses SSE, the format of Ollama's `/v1/responses`. No network model, no key.
:::

In an app, `main.js` gives the chat driver a transport to a real model, here a local Ollama:

```js
import { run } from 'sygnal'
import { makeChatDriver, openResponses } from 'sygnal/ai'
import Chat from './Chat.jsx'

run(Chat, {
  LLM: makeChatDriver({ transport: openResponses({ baseURL: 'http://localhost:11434/v1', model: 'llama3.2' }) }),
})
```

The live examples get the same driver and transport as `LLM`, pointed at the page's demo server instead: its `POST /v1/responses` route is the model, and `encodeOpenResponses` builds the events a model would stream.

## A streaming chat

The demo asks its first question as soon as it shows, and the reply streams in word by word. Ask another one, or press **Stop** while it streams.

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

const REPLIES = {
  hello: 'Hello! I am the demo model of this page: a route, not an LLM.',
  default: 'A Sygnal chat reply is a request to the LLM driver. Its text streams back as actions, at most one per frame.',
}
const words = (text) => text.match(/\S+\s*/g)

export default {
  'POST /v1/responses': ({ json }) => {
    const question = String(json.input.at(-1).content).toLowerCase()
    const text = /\b(hello|hi)\b/.test(question) ? REPLIES.hello : REPLIES.default
    return { sse: encodeOpenResponses(words(text)), delayMs: 300, chunkMs: 40 }
  },
}
```

```jsx live live-height=240
import { ABORT } from 'sygnal'
import { messageText } from 'sygnal/ai'

function Chat({ state }) {
  const busy = state.status === 'streaming'
  return (
    <section className="chat">
      <ol className="messages" aria-live="polite">
        {state.messages.map((m, i) => <li key={i} className={m.role}><b>{m.role}:</b> {messageText(m)}</li>)}
        {state.draft && <li className="assistant streaming"><b>assistant:</b> {state.draft}</li>}
      </ol>
      {state.error && <p role="alert">{state.error}</p>}
      <form className="ask">
        <label>Message <input className="prompt" value={state.prompt} /></label>
        <button type="submit" disabled={busy}>Send</button>
        <button type="button" className="stop" hidden={!busy}>Stop</button>
      </form>
    </section>
  )
}

const userSays = (text) => ({ role: 'user', parts: [{ type: 'text', text }] })

Chat.initialState = { messages: [], prompt: '', draft: '', status: 'ready', error: null }

Chat.intent = ({ DOM }) => ({
  TYPE: DOM.input('.prompt').value(),
  SEND: DOM.select('.ask').events('submit', { preventDefault: true }),
  STOP: DOM.click('.stop'),
})

Chat.model = {
  // the first question, as soon as the demo shows
  BOOTSTRAP: {
    STATE: (state) => ({ ...state, messages: [userSays('How does a reply stream?')], status: 'streaming' }),
    LLM: () => ({ messages: [userSays('How does a reply stream?')], key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED' }),
  },
  TYPE: (state, prompt) => ({ ...state, prompt }),
  SEND: {
    STATE: (state) => (state.prompt.trim()
      ? { ...state, messages: [...state.messages, userSays(state.prompt)], prompt: '', status: 'streaming', error: null }
      : ABORT),
    // sinks get the state before the action: the conversation plus the prompt being sent
    LLM: (state) => (state.prompt.trim()
      ? { messages: [...state.messages, userSays(state.prompt)], key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED' }
      : ABORT),
  },
  STOP: {
    // keep the text that arrived; nothing arrives after the abort
    STATE: (state) => ({
      ...state,
      draft: '',
      status: 'ready',
      messages: state.draft ? [...state.messages, { role: 'assistant', parts: [{ type: 'text', text: `${state.draft} [stopped]` }] }] : state.messages,
    }),
    LLM: () => ({ abort: 'reply' }),
  },
  DELTA: (state, { text }) => ({ ...state, draft: text }),
  DONE: (state, { message }) => ({ ...state, messages: [...state.messages, message], draft: '', status: 'ready' }),
  FAILED: (state, { error }) => ({ ...state, draft: '', status: 'ready', error: error.message }),
}
```

## An assistant that calls a tool

The lamp declares one action for agents in its `agent` static, and the `chat` behavior gives it an assistant. The demo asks for blue as soon as it shows: the demo model calls `lamp_set_color`, the behavior runs it as the lamp's own `SET_COLOR` action (the reducer the buttons use), sends the result back, and the model answers. Ask for another colour, or click one.

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

const COLORS = ['red', 'green', 'blue', 'white']
const words = (text) => text.match(/\S+\s*/g)
const reply = (chunks) => ({ sse: encodeOpenResponses(chunks), delayMs: 300, chunkMs: 40 })

export default {
  'POST /v1/responses': ({ json }) => {
    const last = json.input.at(-1)
    // the tool ran: answer with its result
    if (last.type === 'function_call_output') {
      const result = typeof last.output === 'string' ? JSON.parse(last.output) : last.output
      return reply(words(result.ok ? `Done: the lamp is ${result.state.color} now.` : `That did not work: ${result.error}.`))
    }
    const color = COLORS.find((c) => String(last.content).toLowerCase().includes(c))
    if (color && json.tools?.some((t) => t.name === 'lamp_set_color')) {
      return reply([{ toolCall: { name: 'lamp_set_color', input: { color } } }])
    }
    return reply(words(`I can set the lamp to ${COLORS.join(', ')}.`))
  },
}
```

```jsx live live-height=300
import { z } from 'zod'
import { ABORT } from 'sygnal'
import { chat, messageText } from 'sygnal/ai'

const COLORS = ['red', 'green', 'blue', 'white']

const said = (m) => messageText(m) || m.parts.filter((p) => p.type.startsWith('tool-')).map((p) => `(${p.type.slice(5)} ${JSON.stringify(p.input)})`).join(' ')

function Lamp({ state }) {
  const a = state.assistant
  const busy = a.status === 'submitted' || a.status === 'streaming'
  return (
    <section className="lamp-demo">
      <p>
        <span className="lamp" style={{ display: 'inline-block', background: state.color, width: '2rem', height: '2rem', borderRadius: '50%', border: '1px solid #888', verticalAlign: 'middle' }} />
        {' '}The lamp is <b className="color">{state.color}</b>.
      </p>
      <p>{COLORS.map((c) => <button type="button" className="pick" data={{ color: c }}>{c}</button>)}</p>
      <ol className="conversation" aria-live="polite">
        {a.messages.map((m, i) => <li key={i} className={m.role}><b>{m.role}:</b> {said(m)}</li>)}
        {a.draft && <li className="assistant streaming"><b>assistant:</b> {a.draft}</li>}
      </ol>
      {a.error && <p role="alert">{a.error}</p>}
      <form className="ask">
        <label>Ask <input className="prompt" value={a.prompt} /></label>
        <button type="submit" disabled={busy}>Send</button>
        <button type="button" className="stop" hidden={!busy}>Stop</button>
      </form>
    </section>
  )
}

Lamp.initialState = { color: 'white' }

Lamp.intent = ({ DOM }) => ({
  SET_COLOR: DOM.click('.pick').data('color', (color) => ({ color })),
})

Lamp.model = {
  // the first request, as soon as the demo shows
  BOOTSTRAP: { EFFECT: (state, data, next) => next('assistant.SEND', 'Make the lamp blue') },
  SET_COLOR: (state, { color }) => (color === state.color ? ABORT : { ...state, color }),
}

// what agents may do and see: only this
Lamp.agent = {
  name: 'lamp',
  description: 'A desk lamp',
  read: (state) => ({ color: state.color }),
  actions: {
    SET_COLOR: { description: 'Set the lamp colour', input: z.object({ color: z.enum(COLORS) }) },
  },
}

Lamp.uses = {
  assistant: chat({ form: '.ask', prompt: '.prompt', stop: '.stop', instructions: 'You control a desk lamp. Keep replies short.' }),
}
```

## A decision

A decision model answers typed questions about some state: no text and no stream. `decide()` builds a request for the `HTTP` driver; here it goes to the demo server's `/v1/systemone` route, as a resource that runs again when the ticket text changes.

```js live-server
const has = (text, words) => words.some((w) => text.toLowerCase().includes(w))

export default {
  'POST /v1/systemone': ({ json }) => {
    const t = String(json.state)
    const topic = has(t, ['charge', 'refund', 'invoice']) ? 'billing' : has(t, ['crash', 'broken', 'error']) ? 'bug' : 'account'
    const sure = has(t, ['charge', 'crash', 'login']) ? 0.93 : 0.48
    const urgent = has(t, ['urgent', 'twice', 'now']) ? 0.91 : 0.12
    const others = ['billing', 'bug', 'account'].filter((k) => k !== topic)
    return {
      delayMs: 400,
      json: {
        model: json.model,
        answers: {
          topic: { type: 'choice', choice: topic, confidence: sure, probabilities: { [topic]: sure, [others[0]]: (1 - sure) / 2, [others[1]]: (1 - sure) / 2 } },
          urgent: { type: 'noul', noul: urgent },
        },
      },
    }
  },
}
```

```jsx live live-height=120
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

function Ticket({ state }) {
  const t = state.triage
  const answers = t.status === 'success' && t.data.answers
  return (
    <article>
      <label>Ticket <input className="text" value={state.text} /></label>
      <p className="labels" aria-live="polite">
        {t.status === 'loading' && 'Triaging…'}
        {answers && <>
          <span className="topic">{answers.topic.choice}</span>
          {' '}({Math.round(answers.topic.confidence * 100)}% sure)
          {answers.urgent.noul > 0.5 && <strong className="urgent"> urgent</strong>}
          {answers.topic.confidence < 0.6 && <em> (unsure: a person or a chat model should check it)</em>}
        </>}
        {t.status === 'error' && `Could not triage: ${t.error.message}`}
      </p>
    </article>
  )
}

Ticket.initialState = { text: 'I was charged twice this month, refund please' }

Ticket.intent = ({ DOM }) => ({ TYPE: DOM.input('.text').value() })

Ticket.model = { TYPE: (state, text) => ({ ...state, text }) }

Ticket.resources = {
  triage: (state) => state.text.trim() && decide({ url: '/v1/systemone', model: 'nimble', state: state.text, questions }),
}
```
