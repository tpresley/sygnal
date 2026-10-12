---
title: Cards in a Chat
description: Let a chat assistant ask the user with a composed card — chat({ ask }), result parts and compose.answer, askCard, the card lifecycle, both backends, direct cards, client tools with TOOL_OUTPUT, persistence and testing
---

Some answers are easier to click than to type: one of a few options, a plan from the app's list, a short form, "does this look right?". With `chat({ ask })` the assistant asks for them with a **card**. The model calls the `ask_user` tool and says in one sentence what it needs, the app composes a card from **parts it prepared** (the same [catalog](/guide/ai-compose/#the-catalog) as a composed page), and the user's answer goes back to the model as the tool's result.

As with a composed page, the model only chooses: every button and label on the card is the app's own component, and the answer is a value your component sends.

## A plan assistant

The demo server below stands in for the model. It matches words and replies in the Open Responses format a real model streams, through the page's `LLM` driver:

- the chat's first request: "Let me ask.", then an `ask_user` call;
- a card's request (a structured-output request: it has `text.format`): the layout JSON a chat model writes, from the call's `need`;
- a request after a card's answer (the last input is the tool's output, `{ part, answer }`): the next question, or the end.

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

const words = (text) => text.match(/\S+\s*/g)
const say = (chunks) => ({ sse: encodeOpenResponses(chunks), delayMs: 300, chunkMs: 40 })
const ask = (need) => ({ toolCall: { name: 'ask_user', input: { need } } })

// the card for a need: the layout JSON compose.llm() asks for (a real model reads the catalog)
function card(need) {
  const children = /plan/i.test(need)
    ? [{ part: 'plans' }]
    : [{ part: 'choice', params: { question: need, options: ['Just me', '2 to 10', 'More than 10'] } }]
  return JSON.stringify({ asked_for: children.map((c) => c.part), children }).match(/[\s\S]{1,16}/g)
}

export default {
  'POST /v1/responses': ({ json }) => {
    const last = json.input.at(-1)
    // compose.llm() building a card: its message is the call's `need`
    if (json.text?.format) return say(card(String(last.content)))
    // a card was answered (or closed): its output is { part, answer } (or { error })
    if (last.type === 'function_call_output') {
      const out = JSON.parse(last.output)
      if (out.part === 'choice' && out.answer === 'Just me') return say([...words('Then Free is enough. '), ask('Pick the plan you want')])
      if (out.part === 'choice') return say([...words(`For ${out.answer.toLowerCase()} people, Team or Business. `), ask('Pick the plan you want')])
      if (out.part === 'plans') return say(words(`Done: you are on the ${out.answer} plan.`))
      return say(words('No card then. Tell me how many people will use it.'))
    }
    return say(['Let me ask. ', ask('How many people will use it?')])
  },
}
```

The catalog: parts with `result: true` answer a card. `choice` has free-text params (the model writes the question and the options); `plans` is the app's own list.

```jsx live-file=./cards.jsx title="cards.jsx"
import { defineCatalog, compose } from 'sygnal/ai'

export const PLANS = [
  { id: 'free', name: 'Free', price: '$0' },
  { id: 'team', name: 'Team', price: '$12' },
  { id: 'business', name: 'Business', price: '$30' },
]

export function Choice({ question, options = [], answer, frozen }) {
  return (
    <div className="choice">
      <p>{question}</p>
      {options.map((o) => <button type="button" className={o === answer ? 'option picked' : 'option'} data={{ value: o }} disabled={frozen}>{o}</button>)}
    </div>
  )
}
Choice.intent = ({ DOM }) => ({ PICK: DOM.click('.option').data('value') })
Choice.model = { PICK: { PARENT: (state, value, next, props) => compose.answer(props, value) } }

// no `state` in the catalog entry: the part sees the host's state, as any child does
export function PlanPicker({ state, answer, frozen }) {
  return (
    <ul className="plans">
      {state.plans.map((p) => (
        <li><button type="button" className={p.id === answer ? 'plan picked' : 'plan'} data={{ id: p.id }} disabled={frozen}>{p.name} ({p.price})</button></li>
      ))}
    </ul>
  )
}
PlanPicker.intent = ({ DOM }) => ({ PICK: DOM.click('.plan').data('id') })
PlanPicker.model = { PICK: { PARENT: (state, id, next, props) => compose.answer(props, id) } }

export const catalog = defineCatalog({
  parts: {
    choice: {
      component: Choice, result: true,
      description: 'A question with 2 to 5 short options; the user picks one',
      params: {
        question: { type: 'text', maxLength: 120, required: true },
        options: { type: 'list', items: { maxLength: 40 }, min: 2, max: 5, required: true },
      },
    },
    plans: { component: PlanPicker, result: true, description: 'The pricing plans to pick from (Free, Team, Business)' },
  },
})
```

```css live
.plan-chat { display: grid; gap: 0.5rem; }
.plan-chat ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
.plan-chat .ask-card { border: 1px solid #8884; border-radius: 6px; padding: 0.4rem 0.6rem; }
.plan-chat .ask-card p { margin: 0 0 0.3rem; }
.plan-chat .ask-card ul { list-style: none; margin: 0; padding: 0; display: flex; gap: 0.4rem; }
.plan-chat .ask-card fieldset { border: 0; margin: 0; padding: 0; }
.plan-chat .option, .plan-chat .plan { margin-right: 0.3rem; }
.plan-chat .picked { font-weight: bold; }
.plan-chat .card-status { font-size: 0.8rem; opacity: 0.7; }
.plan-chat .ask { display: flex; gap: 0.5rem; }
.plan-chat .ask input { flex: 1; }
```

The demo asks on load. Answer the card: the answer goes back to the model, which asks again with a second card, built from the app's plans.

```jsx live live-height=380 title="PlanChat.jsx"
import { chat, askCard } from 'sygnal/ai'
import { catalog, PLANS } from './cards.jsx'

// a message part: text, or an ask_user call with its card
function part(p, state) {
  if (p.type === 'text') return <p>{p.text}</p>
  if (p.type !== 'tool-ask_user') return null
  return (
    <section className="ask-card">
      {askCard(catalog, state, p) ?? <p>Composing a card…</p>}
      <span className="card-status">{p.ui?.status}</span>
    </section>
  )
}

function PlanChat({ state }) {
  const a = state.assistant
  const busy = a.status === 'submitted' || a.status === 'streaming'
  return (
    <div className="plan-chat">
      <ol aria-live="polite">
        {a.messages.map((m) => <li className={m.role}><b>{m.role}:</b> {m.parts.map((p) => part(p, state))}</li>)}
        {a.draft && <li className="assistant"><b>assistant:</b> {a.draft}</li>}
      </ol>
      <form className="ask">
        <input className="prompt" aria-label="Message" value={a.prompt} />
        <button type="submit" disabled={busy}>Send</button>
        <button type="button" className="stop" hidden={!busy}>Stop</button>
      </form>
    </div>
  )
}

PlanChat.initialState = { plans: PLANS }

PlanChat.uses = {
  assistant: chat({
    form: '.ask', prompt: '.prompt', stop: '.stop',
    instructions: 'Help the user choose a plan. Ask with ask_user when they need to choose something.',
    ask: { catalog },
  }),
}

PlanChat.model = {
  // the demo asks on load only to have something to show
  BOOTSTRAP: { EFFECT: (state, data, next) => next('assistant.SEND', 'Which plan should I take?') },
}

export default PlanChat
```

## How a card works

`chat({ ask: { catalog, backend?, instructions?, direct? } })` adds the tool `ask_user({ need })` to the chat's requests. Its description tells the model to say in one sentence what it needs, and to prefer a card to a question in text when the answer is one of a few options or structured. `instructions` adds your own guidance on when and how to ask.

1. **The model calls `ask_user`** with its `need`. The call stays open (`input-available`), and its card starts composing.
2. **The backend composes the card** from the `need` and the app state, never the conversation: `compose.llm()` by default, on the chat's own sink, or `compose.decisions()` ([below](#two-backends)). Cards compose one at a time, each under its own request key (`assistant.ask:<call id>`), so a card's request never aborts the chat's.
3. **The host renders it** with `askCard(catalog, state, part)` wherever it renders the message's `tool-ask_user` part. It is null while there is no card yet.
4. **The user answers** in a result part, which sends `compose.answer(props, value)` to `PARENT`. The call closes with the output `{ part, answer }` (the part's id, the value), and once no call is open the chat sends the next request, so the model continues from the answer.

The card lives on the tool part, as `part.ui`:

| Field | |
|---|---|
| `status` | `composing` (queued, or its request is out), `open` (answerable), `answered`, `failed`, `cancelled` |
| `layout` | The card: a layout, as on a composed page |
| `answer` | `{ node, part, value }` once answered, else `null` |
| `local`, `ui` | The card's `local` parts' state and container state, per node key |

- **Statuses of the chat.** While a card composes, the chat's `status` is `'streaming'`. Once every open card is composed and only the user's answers are outstanding, it is `'ready'`, and the turn is not over (no `DONE`). Several `ask_user` calls in one reply give several cards; the next request goes when all are answered.
- **A failed card** (its request fails, or the reply is not a valid card) closes the call with the error "could not show a card: …; ask in text instead", and the turn goes on: the model can ask in text.
- **STOP** aborts a card that is composing and cancels the open ones: their calls close as "not answered: stopped by the user", and nothing is sent. **SEND** of a new message cancels them too ("not answered: the user sent a new message"), so the model sees its question went unanswered. A cancelled or answered card renders frozen.

### Result parts

A part with `result: true` answers the card. It sends its answer to `PARENT` with `compose.answer(props, value)`: `props` carries the card's `scope` and the part's `node`, so the answer reaches the right call. Any value works: a string, an id, a form's values.

- `askCard` renders each card in its own scope, so two cards with the same part are two instances, with their own `local` state (a small form keeps what the user typed, per card).
- The answered part gets the prop `answer` (its value, to mark the pick), and every part of a card that isn't open gets `frozen`. The card is wrapped in a disabled `<fieldset>` too.
- The host hears result parts as well: `CHILD.select(PlanPicker)` in the host's intent gets `{ scope, node, value }`, to keep the pick in app state.
- A catalog for `ask` needs at least one result part ([SYG686](/reference/errors/#syg686)), and a result part rendered outside a card can't answer anything ([SYG160](/reference/errors/#syg160)).

## Two backends

| | `compose.llm()` (the default) | `compose.decisions({ model })` |
|---|---|---|
| Who composes the card | The chat model, in a second, structured-output request | A decision model, from the parts' descriptions |
| Sink | The chat's (`LLM`) | `HTTP` (`/api/decide` by default) |
| Parts it can use | All, free-text params too (a question and its options written for this need) | Prepared parts only: a part with required free text is LLM-only |

```js
chat({ ask: { catalog, backend: compose.decisions({ model: 'jev-latest' }) } })
```

**Why two steps.** The chat model only says what it needs (`need`), and a separate request builds the card. Writing the card as the tool's arguments in one step needs a provider that enforces tool schemas: on Ollama, none of the measured calls with the layout as tool arguments was a valid card as emitted, against 5 of 5 with the two-step form.

**`direct: true`** is that one-step form, for providers that do enforce tool schemas: the `ask_user` input schema is the catalog's layout schema, and the card opens as soon as the call arrives, with no compose round trip. An input that is not a card closes the call with the error, so the model can try again. It is LLM-only.

**What the backend explains** stays with the card as `part.ui.decisions`, as a [composed page](/guide/ai-compose/) keeps it in its slice: `compose.llm()`'s plan (`asked_for`) and repairs, or `compose.decisions()`'s answers per step by question name (`use_<part>`, `rec_<part>__<n>`, `first_<a>_vs_<b>`, ...). It is persisted with the card, for an explain panel.

**Switching models.** `model` may be a function of the host's state, read per request: `chat({ model: (state) => state.chatModel, ask: { catalog } })` follows the app's model picker with one chat behavior, and the default card backend follows it too (`compose.llm({ model: (state) => state.chatModel })` for an explicit one). The card backend itself is fixed when `chat()` is called, since it decides the sink the cards go to: an app that lets the user pick it makes one host component per backend.

**Call `chat()` before `run()`.** The first `chat()` call links the sygnal/ai behaviors to the apps started after it (and to the page's first running app). A host component defined in a module the entry imports is in time; one created only later, in a second app, runs without tools ([SYG442](/reference/errors/#syg442)). An app that makes host components on demand calls `chat()` once at load.

## Client tools

`ask_user` is one case of a **client tool**: a tool the app answers itself, often with the user's help, instead of an `agent` action that runs on its own. `clientTools` declares your own:

```jsx
import { z } from 'zod'
import { chat, openToolCalls } from 'sygnal/ai'

function confirmations(a) {
  return openToolCalls(a).filter((p) => p.type === 'tool-confirm').map((p) => (
    <p className="confirm">
      {p.input.question}
      <button type="button" className="yes" data={{ id: p.toolCallId }}>Yes</button>
      <button type="button" className="no" data={{ id: p.toolCallId }}>No</button>
    </p>
  ))
}

function Booking({ state }) {
  const a = state.assistant
  return (
    <main>
      {confirmations(a)}
      <form className="ask"><input className="prompt" aria-label="Message" value={a.prompt} /></form>
    </main>
  )
}

Booking.uses = {
  assistant: chat({
    form: '.ask', prompt: '.prompt',
    clientTools: {
      confirm: { description: 'Ask the user a yes / no question', inputSchema: z.object({ question: z.string().min(1) }) },
    },
  }),
}

Booking.intent = ({ DOM }) => ({ YES: DOM.click('.yes').data('id'), NO: DOM.click('.no').data('id') })

Booking.model = {
  YES: { EFFECT: (state, id, next) => next('assistant.TOOL_OUTPUT', { toolCallId: id, output: { confirmed: true } }) },
  NO: { EFFECT: (state, id, next) => next('assistant.TOOL_OUTPUT', { toolCallId: id, output: { confirmed: false } }) },
}
```

- A client tool is `{ description, inputSchema }`: a JSON Schema, or a Standard Schema (zod, valibot) with a JSON Schema form. A Standard Schema input is validated first; an invalid one closes the call with the issues, so the model can repair it.
- Its calls stay open until `'assistant.TOOL_OUTPUT'` answers them: `{ toolCallId, output }`, or `{ toolCallId, errorText }` for an error. A TOOL_OUTPUT for a call that isn't open does nothing ([SYG685](/reference/errors/#syg685)).
- `openToolCalls(state.assistant)` lists the calls of the last message that wait for an answer (each a `tool-<name>` part with its `input`).
- A host entry `'assistant.TOOL_CALL'` runs once when each call opens, with `{ id, name, input }` (the input after validation).
- STOP and SEND close open calls as they close cards. A client tool with the name of an `agent` tool replaces it ([SYG684](/reference/errors/#syg684)).

These are the AI SDK's `addToolOutput` and `onToolCall`, on the `chat` behavior.

## Persistence

Cards live on the messages (`part.ui`), so [`persist()`](/guide/persistence/) of the chat slice keeps them: an answered card comes back frozen with its pick, an open card stays answerable, and a card that was composing composes again. A chat saved while a reply streamed comes back `'ready'`, so Send works after a reload.

```js
import { persist } from 'sygnal'

PlanChat.persist = persist({ key: 'plan-chat', pick: ['assistant'] })
```

On the wire, the `openResponses()` and `chatCompletions()` transports send only a call's input and output, never `ui`. `uiMessageStream()` sends the parts as they are: a server route that stores conversations must store `body.messages` as received to keep the cards ([Storing conversations](/guide/ai-chat/#storing-conversations)).

## Testing

`composeWith(t, catalog, tree)` answers a card's pending composition too, whichever backend it uses. Here `makePlanChat()` returns the demo's component without its `BOOTSTRAP` entry:

```js
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith } from 'sygnal/ai'
import { catalog } from './cards.jsx'
import { makePlanChat } from './PlanChat.jsx'

it('asks with a card, and the pick goes back to the model', async () => {
  const t = renderComponent(makePlanChat())
  t.simulateAction('assistant.SEND', 'Which plan should I take?')
  await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'ask_user', input: { need: 'Pick the plan you want' } } }])
  await composeWith(t, catalog, [{ part: 'plans' }])
  expect(t.state.assistant.status).toBe('ready')

  t.simulateEvent('.plan[data-id="team"]', 'click')
  await t.waitForState((s) => s.assistant.status === 'submitted')
  const call = t.requests('LLM').at(-1).messages.at(-1).parts.find((p) => p.type === 'tool-ask_user')
  expect(call.output).toEqual({ part: 'plans', answer: 'team' })
  t.dispose()
})
```

- `t.stream('LLM', chunks)` answers the chat's request; a `{ toolCall }` chunk is a call.
- To test a failed card, fail its request: `t.fail('LLM', new Error('overloaded'), 'assistant.CARD_FAILED')`.
- A client tool: `t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'c1', output: { confirmed: true } })`.

## Related

- [Composing UI with a Model](/guide/ai-compose/): catalogs, parts and the two backends
- [AI Chat](/guide/ai-chat/): the chat driver, transports and tools
- [Agents](/guide/agent/): the `chat` behavior and its call rules
