---
title: AI Chat
description: Streaming LLM chat with sygnal/ai — makeChatDriver() and its reply actions, a local model with Ollama, Stop and latest, structured output, tools, testing with the LLM fake, and shipping it behind an AI SDK server route
---

`sygnal/ai` is Sygnal's subpath for working with language models. It has a **chat driver** that streams replies as actions, **transports** that speak each provider's wire format, helpers for [decision models](/guide/ai-decisions/), and the layer that lets agents operate your components. Everything is pay per use: an app that never imports `sygnal/ai` carries none of it, and each transport is left out unless you import it.

A chat request is a driver request like an [HTTP](/guide/http/) one. A model entry sends it to the `LLM` sink and names the actions that receive the reply: the text so far while it streams, the finished message, and the failure. No component calls `fetch` or a provider SDK.

## Getting started

Start with a model on your own machine: no account, no key, no server code. Install [Ollama](https://ollama.com), then pull a small model:

```sh
ollama pull llama3.2
```

Ollama serves the Open Responses API at `http://localhost:11434/v1`. Register the chat driver once in `main.js`, with the `openResponses()` transport pointed at it:

```js
import { run } from 'sygnal'
import { makeChatDriver, openResponses } from 'sygnal/ai'
import Chat from './Chat.jsx'

run(Chat, {
  LLM: makeChatDriver({ transport: openResponses({ baseURL: 'http://localhost:11434/v1', model: 'llama3.2' }) }),
})
```

Ollama accepts requests from pages on `localhost` by default. A dev server on another host name needs `OLLAMA_ORIGINS` set.

The live examples on this page get the same driver, under the same name, with one difference: `openResponses()` posts to the page's demo server instead of Ollama. The demo server's `POST /v1/responses` route is the "model". It answers in the Open Responses format a real model streams, built with `encodeOpenResponses` ([below](#encodeopenresponses-scripted-replies)). The component code is what you would run against Ollama.

## A streaming chat

The demo asks its first question as soon as it shows, and the reply streams in. Ask another one, or press **Stop** while a reply streams: the text that arrived stays, marked as stopped.

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

const words = (text) => text.match(/\S+\s*/g)

export default {
  'POST /v1/responses': ({ json }) => {
    const question = String(json.input.at(-1).content).toLowerCase()
    const text = /\b(hello|hi)\b/.test(question)
      ? 'Hello! I am this page\'s demo model: a route, not an LLM.'
      : 'A reply is a request to the LLM driver. Its text streams back as actions, at most one per frame, so the view renders a few dozen times, not once per token.'
    return { sse: encodeOpenResponses(words(text)), delayMs: 300, chunkMs: 60 }
  },
}
```

```jsx live live-height=260
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
const ask = (messages) => ({ messages, key: 'reply', delta: 'DELTA', ok: 'DONE', error: 'FAILED' })

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
    LLM: () => ask([userSays('How does a reply stream?')]),
  },
  TYPE: (state, prompt) => ({ ...state, prompt }),
  SEND: {
    STATE: (state) => (state.prompt.trim()
      ? { ...state, messages: [...state.messages, userSays(state.prompt)], prompt: '', status: 'streaming', error: null }
      : ABORT),
    // sinks see the state before the action: the conversation plus the prompt being sent
    LLM: (state) => (state.prompt.trim() ? ask([...state.messages, userSays(state.prompt)]) : ABORT),
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

What the component does:

- **The conversation is state.** `messages` holds the user's messages and the model's replies. Every request sends the whole conversation: models are stateless, so the history goes with each turn.
- **`SEND` has two sinks.** `STATE` adds the user's message, `LLM` sends the request. Both see the state from before the action ([Model](/guide/model/#sinks-see-the-state-before-the-action)), so the `LLM` sink builds the message list with the prompt itself.
- **`DELTA` shows the reply so far.** Its `text` is all the text received, not just the new piece, so the reducer only replaces `draft`.
- **`DONE` gets the finished message** and appends it to the conversation as is.
- **`STOP` aborts the request** by its key. Nothing arrives after an abort, not even `FAILED`.

## Requests

A request is an object sent to the `LLM` sink. The driver passes it to the transport as is, so a transport's own options can go in it too.

| Field | Default | Meaning |
|---|---|---|
| `messages` | (required) | The conversation: `{ role, parts }` messages, or `{ role, content }` with a plain string for messages you write by hand |
| `instructions` | — | System instructions |
| `model` | the transport's | A model id for this request |
| `delta` | — | Action for the reply so far, while it streams |
| `ok` | — | Action for the finished reply |
| `error` | — | Action for a failure. Without one, a failure is only logged ([SYG678](/reference/errors/#syg678)) |
| `tool` | — | Action for each tool call the model makes ([Tools](#tools)) |
| `tools` | — | Tools the model may call: `{ name: { description, inputSchema } }` |
| `output` | — | A schema for [structured output](#structured-output) |
| `key` | the `ok` action, else `error` | The group for `latest` and `abort` |
| `latest` | `true` | A new request aborts this instance's request with the same key that is still streaming |
| `coalesce` | the driver's (`'frame'`) | How often `delta` fires: `'frame'`, `'none'` or a number of ms ([Streaming](#streaming-and-delta-coalescing)) |
| `continue` | — | The reply continues the last message, an assistant message (after tool results) |

The reply goes to **exactly the instance that sent the request**, as with the fetch driver: two chat panels, or the items of a Collection, can use the same action names. A request with a `then` or `catch` key is not sent ([SYG610](/reference/errors/#syg610)): use `ok` and `error`.

### Reply actions

| Action | Data |
|---|---|
| `delta` | `{ key, text, reasoning, delta, message }`: all the text so far, all the reasoning so far, the text new since the previous `delta` (`''` when only the reasoning grew), and the assistant message so far |
| `ok` | `{ key, message, text, value, toolCalls, finishReason, usage }`: the finished assistant message (append it to the conversation), its text, the validated structured output (with `output`), the tool calls, the finish reason (`'stop'`, `'length'`, `'tool-calls'`, …) and the token usage |
| `tool` | `{ key, call: { id, name, input } }`, once per completed tool call, before `ok` |
| `error` | `{ key, error, request, issues }`: the Error (`error.status` for an HTTP error), the request as sent, and the schema issues when structured output failed |

### Messages

Messages have the same shape as the AI SDK's `UIMessage`: an `id`, a `role` and a list of `parts`. The parts a reply can have are `text`, `reasoning`, `tool-<name>` (a tool call, with its `state`, `input` and `output`), `file`, `source-*` and `data-*`. Because the shape is the AI SDK's, a conversation goes to an AI SDK server route unchanged.

Every reply message has an `id` that doesn't change: the provider's (the response id, or an AI SDK server's message id) or, when the transport gives none, a new random one. A reply that continues a message (`continue: true`, after tool results or an approval) keeps that message's id. The [`chat()` behavior](/guide/agent/#an-in-app-assistant-chat) gives the user's messages an id when they are sent, so each message in `state.assistant.messages` keeps the same `id` from request to request: a server can store a conversation by message id. Messages you write yourself may leave it out.

`messageText(message)` returns a message's text: its text parts joined, or its `content`. Render the other parts as your app needs them: a reasoning part in a collapsed `<details>`, a tool part as a line saying what the model did.

## Streaming and delta coalescing

A model streams one event per token or so: a 300-token reply is about 300 events. One action per event would render 300 times. The driver coalesces them instead: by default (`coalesce: 'frame'`) `delta` fires at most once per animation frame, and at most every 15 ms on a fast display. In a hidden tab, where the browser stops animation frames, it fires about once a second. The pending text is always delivered before `tool` and `ok`, so nothing is lost.

`coalesce: 'none'` fires once per streamed event; a number fires at most every that many ms. Set it on a request, or for every request with `makeChatDriver({ transport, coalesce })`.

Reasoning models stream their reasoning first. It arrives through `delta` too: `reasoning` grows while `text` stays `''`. The finished message keeps it as `reasoning` parts.

## Stop, abort and latest

- **`{ abort: 'reply' }`** aborts this instance's request with the key `'reply'`. The transport stops reading and the connection closes. `{ abort: true, key: 'reply' }` is the same, and `{ abort: true }` aborts all of this instance's requests.
- **`latest` is on by default.** Sending a request aborts the instance's request with the same key that is still streaming, so a second question replaces the first. `latest: false` lets both run, each with its own key.
- **An aborted request delivers nothing.** The text it had streamed is in your state already, through `delta`. Keep it, as the demo does, or drop it.
- **A removed component's requests are aborted**, as are all requests when the app is disposed.

## Structured output

With `output`, the model answers with JSON that matches a schema, and `ok` gets the validated value as `value`. The schema is a [Standard Schema](https://standardschema.dev) that can also give a JSON Schema (zod 4.2 or later, ArkType, Valibot through `toStandardJsonSchema()`). The transport sends its JSON Schema to the model; the driver parses the reply and validates it. A reply that isn't JSON, or doesn't match, is the `error` reply, with the schema's `issues`.

In this demo, the note is turned into a task as soon as it shows. Edit the note and extract again.

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

export default {
  'POST /v1/responses': ({ json }) => {
    // json.text.format holds the task's JSON Schema; a real model answers to match it
    const note = String(json.input.at(-1).content)
    const task = {
      title: note.split(/[,.]/)[0].trim(),
      due: note.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday)\b/i)?.[0].toLowerCase() ?? null,
      priority: /\b(urgent|asap)\b/i.test(note) ? 'high' : 'normal',
    }
    return { sse: encodeOpenResponses(JSON.stringify(task).match(/.{1,16}/g)), delayMs: 300, chunkMs: 40 }
  },
}
```

```jsx live live-height=200
import { z } from 'zod'
import { ABORT } from 'sygnal'

const Task = z.object({
  title: z.string().describe('What to do, in a few words'),
  due: z.string().nullable().describe('The day it is due, or null'),
  priority: z.enum(['low', 'normal', 'high']),
})

const extract = (note) => ({
  instructions: 'Turn the note into a task.',
  messages: [{ role: 'user', content: note }],
  output: Task,
  ok: 'EXTRACTED',
  error: 'FAILED',
})

function QuickAdd({ state }) {
  const task = state.task
  return (
    <section className="quick-add">
      <form className="extract">
        <label>Note <input className="note" value={state.note} /></label>
        <button type="submit" disabled={state.status === 'reading'}>Make a task</button>
      </form>
      <p aria-live="polite">{state.status === 'reading' ? 'Reading the note…' : ''}</p>
      {task && (
        <dl className="task">
          <dt>Title</dt><dd>{task.title}</dd>
          <dt>Due</dt><dd>{task.due ?? 'no date'}</dd>
          <dt>Priority</dt><dd>{task.priority}</dd>
        </dl>
      )}
      {state.error && <p role="alert">{state.error}</p>}
    </section>
  )
}

QuickAdd.initialState = { note: 'Call the plumber about the leak tomorrow, urgent', task: null, status: 'ready', error: null }

QuickAdd.intent = ({ DOM }) => ({
  TYPE: DOM.input('.note').value(),
  EXTRACT: DOM.select('.extract').events('submit', { preventDefault: true }),
})

QuickAdd.model = {
  BOOTSTRAP: {
    STATE: (state) => ({ ...state, status: 'reading' }),
    LLM: (state) => extract(state.note),
  },
  TYPE: (state, note) => ({ ...state, note }),
  EXTRACT: {
    STATE: (state) => (state.note.trim() ? { ...state, status: 'reading', error: null } : ABORT),
    LLM: (state) => (state.note.trim() ? extract(state.note) : ABORT),
  },
  EXTRACTED: (state, { value }) => ({ ...state, task: value, status: 'ready' }),
  FAILED: (state, { error, issues }) => ({
    ...state,
    status: 'ready',
    error: issues ? 'The model\'s answer did not match the task schema.' : error.message,
  }),
}
```

- `value` is the schema's **output**: transforms and defaults have run, and its type is the schema's output type.
- A schema whose root isn't an object (a `z.array(...)`, a `z.enum(...)`) is sent wrapped as `{ value }` and unwrapped again, because providers want an object at the root.
- `.describe()` texts go to the model with the schema. They are the best place to say what a field means. With ArkType, a field's `.describe()` also replaces the expected text in its `issues` messages (`title must be What to do (was a number)`); see [Input schemas](/guide/agent/#input-schemas) for how to keep both.
- Small local models follow a schema less reliably than hosted ones. Handle `issues` in `error` (ask again, or show the text), and keep schemas small and flat.
- For OpenAI's and Anthropic's strict schema modes, see [Strict schemas](#strict-schemas).

The [structured output into a form](/recipes/ai-form-fill/) recipe fills a `form` behavior's fields from a reply like this one.

## Tools

A request's `tools` lists functions the model may call, each with a description and a JSON Schema for its input. When the model calls one, the `tool` action gets the call, and the reply ends with `finishReason: 'tool-calls'`. Your app runs the call, writes the result into the tool's part of the message, and sends the conversation again so the model can answer with the result.

In this demo, the model has one tool, `add_item`. Ask it to add something to the list.

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

const reply = (chunks) => ({ sse: encodeOpenResponses(chunks), delayMs: 300, chunkMs: 40 })

export default {
  'POST /v1/responses': ({ json }) => {
    const last = json.input.at(-1)
    // the app ran the tool and sent its output back: answer with it
    if (last.type === 'function_call_output') {
      const { items } = JSON.parse(last.output)
      return reply([`Done. The list has ${items.length} item${items.length === 1 ? '' : 's'}: `, items.join(', '), '.'])
    }
    const item = String(last.content).match(/add (.+?)\.?$/i)?.[1]
    if (item) return reply([{ toolCall: { name: 'add_item', input: { name: item } } }])
    return reply(['Ask me to add something, like ', '"add oat milk".'])
  },
}
```

```jsx live live-height=260
import { ABORT } from 'sygnal'
import { messageText, withToolResults } from 'sygnal/ai'

const tools = {
  add_item: {
    description: 'Add an item to the shopping list',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
}

const said = (m) => messageText(m) || m.parts.filter((p) => p.type.startsWith('tool-')).map((p) => `(called ${p.type.slice(5)})`).join(' ')
const userSays = (text) => ({ role: 'user', parts: [{ type: 'text', text }] })
const ask = (messages) => ({ messages, tools, key: 'reply', delta: 'DELTA', tool: 'TOOL', ok: 'DONE', error: 'FAILED' })

// the reply with each add_item call answered: the output goes into the call's tool-add_item part
const answered = (message, items) => withToolResults(message, { add_item: { items } })

function Shopping({ state }) {
  const busy = state.status === 'streaming'
  return (
    <section className="shopping">
      <ul className="items">{state.items.map((item) => <li>{item}</li>)}</ul>
      <ol className="messages" aria-live="polite">
        {state.messages.map((m, i) => <li key={i} className={m.role}><b>{m.role}:</b> {said(m)}</li>)}
        {state.draft && <li className="assistant streaming"><b>assistant:</b> {state.draft}</li>}
      </ol>
      {state.error && <p role="alert">{state.error}</p>}
      <form className="ask">
        <label>Message <input className="prompt" value={state.prompt} /></label>
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </section>
  )
}

Shopping.initialState = { items: ['bread'], messages: [], prompt: 'Add oat milk', draft: '', status: 'ready', error: null }

Shopping.intent = ({ DOM }) => ({
  TYPE: DOM.input('.prompt').value(),
  SEND: DOM.select('.ask').events('submit', { preventDefault: true }),
})

Shopping.model = {
  TYPE: (state, prompt) => ({ ...state, prompt }),
  SEND: {
    STATE: (state) => (state.prompt.trim()
      ? { ...state, messages: [...state.messages, userSays(state.prompt)], prompt: '', status: 'streaming', error: null }
      : ABORT),
    LLM: (state) => (state.prompt.trim() ? ask([...state.messages, userSays(state.prompt)]) : ABORT),
  },
  DELTA: (state, { text }) => ({ ...state, draft: text }),
  // runs the call as it arrives; the model's input is unchecked, so check it
  TOOL: (state, { call }) => (call.name === 'add_item' && typeof call.input.name === 'string'
    ? { ...state, items: [...state.items, call.input.name] }
    : ABORT),
  DONE: {
    STATE: (state, { message, toolCalls }) => ({
      ...state,
      messages: [...state.messages, answered(message, state.items)],
      draft: '',
      status: toolCalls.length ? 'streaming' : 'ready',
    }),
    // after tool calls, send the conversation again with their outputs
    LLM: (state, { message, toolCalls }) => (toolCalls.length ? ask([...state.messages, answered(message, state.items)]) : ABORT),
  },
  FAILED: (state, { error }) => ({ ...state, draft: '', status: 'ready', error: error.message }),
}
```

- **`tool` arrives before `ok`**, once per call, so `TOOL` has run by the time `DONE` builds the outputs from the state.
- **`withToolResults(message, results)`** answers the message's open tool calls: each `tool-<name>` part waiting for a result gets `state: 'output-available'` and the `output`. `results` is an object keyed by the call's `id` or, as here, the tool's name, or a function of the call (`{ id, name, input }`) that returns the output. An `Error` (returned or thrown) becomes `state: 'output-error'` with its message as `errorText`, which tells the model the call failed; `undefined` leaves the part open.
- **The input is the model's, unchecked.** The driver doesn't validate a call's input against the tool's `inputSchema`. Check it in the reducer as you would any outside input.
- **The loop needs a limit in a real app**: count the steps in state and stop sending after a few.

This is the low-level form. For an in-app assistant that operates your components, the [`chat` behavior](/guide/agent/#an-in-app-assistant-chat) (`uses = { assistant: chat({ … }) }`, from `sygnal/ai`) runs this loop for you: it builds the tools from the components' [`agent` declarations](/guide/agent/#the-agent-static), validates every call against its schema, asks the user before consequential ones, and stops after `maxSteps`. [Agents](/guide/agent/) documents it.

## Testing

`renderComponent` serves the `LLM` sink with a fake: the real chat driver over an in-memory stream that the test writes to. No transport, no network, no timers. Each request stays pending until the test answers it:

- `t.requests('LLM')`: the requests sent, as the model built them.
- `await t.stream('LLM', chunks, target?)`: streams chunks into the pending request, then ends it (the `ok` action). Chunks are strings (text), `{ reasoning }`, `{ toolCall: { id?, name, input } }`, `{ data, name? }` or `{ finish: reason }`. Each call is one frame: at most one `delta`. Pass `{ end: false }` to keep the stream open for another call.
- `await t.respond('LLM', text, target?)`: the whole reply as one chunk. A non-string is sent as JSON, for structured output.
- `await t.fail('LLM', error, target?)`: the stream fails. A number is an HTTP status: `t.fail('LLM', 429)` gives an Error `'HTTP 429'` with `status: 429`.

`target` picks the request as for the HTTP fake: an action name or key (`'reply'`), a partial request, or a predicate. The newest pending request is the default.

Here `Chat.jsx` is the streaming demo's component without its `BOOTSTRAP` entry (an app rarely sends a question on its own):

```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import Chat from './Chat.jsx'

let t
afterEach(() => t?.dispose())

it('streams a reply, and keeps the text when stopped', async () => {
  t = renderComponent(Chat)
  t.simulateEvent('.prompt', 'input', { value: 'Tell me a story' })
  t.simulateEvent('.ask', 'submit')
  await t.stream('LLM', ['Once', ' upon'], 'reply', { end: false })
  expect(t.state.draft).toBe('Once upon')
  t.simulateEvent('.stop', 'click')
  await t.settle()
  expect(t.state.messages.at(-1).parts[0].text).toBe('Once upon [stopped]')
})

it('shows a failure', async () => {
  t = renderComponent(Chat)
  t.simulateEvent('.prompt', 'input', { value: 'Hello' })
  t.simulateEvent('.ask', 'submit')
  await t.fail('LLM', 429, 'reply')
  expect(t.html()).toContain('HTTP 429')
})
```

The fake uses the real driver, so `latest`, `abort`, coalescing and the reply routing behave as in the app. It works under `vi.useFakeTimers()` unchanged. The sink name is `'LLM'`; for another name, pass `renderComponent(C, { llmSink: 'AI' })`.

For structured output, respond with the object: `await t.respond('LLM', { title: 'Call the plumber', due: null, priority: 'high' })` reaches `EXTRACTED` with it as `value`. For tools, stream a call: `await t.stream('LLM', [{ toolCall: { name: 'add_item', input: { name: 'eggs' } } }])`.

## Shipping it

Ollama on your machine has no key to protect. A hosted model has one, and it must never reach the browser: anyone who opens the page can read every header and every byte of your bundle. In production the browser talks to **your server**, and your server talks to the provider.

The recommended server is the [AI SDK](https://ai-sdk.dev) (version 7). Its `streamText()` works with every major provider, and `toUIMessageStreamResponse()` answers in the UI message stream format that the `uiMessageStream()` transport reads. A route, as a handler that takes a `Request` and returns a `Response` (Next.js, Hono, SvelteKit, Vike with a server, Cloudflare and Deno all have this shape):

```js
// server: POST /api/chat
import { streamText, convertToModelMessages, tool, jsonSchema } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'          // reads ANTHROPIC_API_KEY on the server
import { currentUser, overLimit } from './auth.js'      // your session and rate limit

export async function POST(req) {
  const user = await currentUser(req)
  if (!user) return new Response('Sign in first', { status: 401 })
  if (await overLimit(user)) return new Response('Too many requests', { status: 429 })

  const { messages, tools = {} } = await req.json()
  const result = streamText({
    model: anthropic('claude-opus-5-5'),               // the server picks the model…
    instructions: 'You help customers of Acme with their orders. Keep replies short.',  // …and the instructions
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 1000,
    // the app's tools, without execute: the calls go back to the browser, which runs them
    tools: Object.fromEntries(Object.entries(tools).map(([name, t]) => [name, tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema) })])),
  })
  return result.toUIMessageStreamResponse()
}
```

The request body is what the AI SDK's own client sends (`{ id, messages, trigger }`), plus `instructions`, `model`, `tools` and `output` from the chat request. The messages are already `UIMessage`s, so `convertToModelMessages()` takes them as they are. Tools you define on the server with an `execute` run there; their calls and results come back as tool parts of the message, and they don't reach your `tool` action.

:::caution[A proxy that only adds your key is an open relay]
A route that forwards whatever the browser sends (any model, any instructions, any length) and adds your API key lets anyone on the internet use your account as a free LLM API. Your route is public the moment the page is: its URL is in the bundle.

- **The server decides** the model, the system instructions and the token limit. Ignore the `model` and `instructions` the request carries, or check them against a short list.
- **Require a session**, and **rate-limit per user**, as you would any endpoint that costs money.
- **Set a spending limit** with the provider as the last line of defence.
:::

The transports refuse the other mistake for you. In a browser, a request with an auth header (`Authorization`, `x-api-key`, …) to a host that is neither local nor the page's own origin is not sent: it fails with [SYG670](/reference/errors/#syg670). The only exception is a key the user typed in themselves (a "bring your own key" app): pass `dangerouslyAllowBrowser: true` to the transport for that.

### The same component, two transports

The component never changes. Only the transport in `main.js` does: Ollama while you develop, your AI SDK route in production.

```js
// main.js: development, a local model
import { run } from 'sygnal'
import { makeChatDriver, openResponses } from 'sygnal/ai'
import Chat from './Chat.jsx'

run(Chat, {
  LLM: makeChatDriver({ transport: openResponses({ baseURL: 'http://localhost:11434/v1', model: 'llama3.2' }) }),
})
```

```js
// main.js: production, the AI SDK route above
import { run } from 'sygnal'
import { makeChatDriver, uiMessageStream } from 'sygnal/ai'
import Chat from './Chat.jsx'

run(Chat, {
  LLM: makeChatDriver({ transport: uiMessageStream('/api/chat') }),
})
```

Or pick one at build time, so the development transport isn't in the production bundle:

```js
import { run } from 'sygnal'
import { makeChatDriver, openResponses, uiMessageStream } from 'sygnal/ai'
import Chat from './Chat.jsx'

const transport = import.meta.env.DEV
  ? openResponses({ baseURL: 'http://localhost:11434/v1', model: 'llama3.2' })
  : uiMessageStream('/api/chat')

run(Chat, { LLM: makeChatDriver({ transport }) })
```

`uiMessageStream(url, { headers })` takes headers, as an object or a function of the request, for a session token your server checks. Same-origin requests carry the page's cookies anyway.

### What `uiMessageStream` sends

Each request is one `POST` to the URL with a JSON body and the headers `content-type: application/json` plus your `headers` option. With the transport `uiMessageStream('/api/chat', { body: { tenant: 'acme' } })` and this request:

```js
// the value the LLM sink sends
const request = {
  messages: [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is my order?' }] },
    { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Which order number?' }] },
    { role: 'user', content: '42' },
  ],
  instructions: 'Be brief',
  chatId: 'chat-1',
  body: { locale: 'en' },
  ok: 'DONE',
}
```

the body is:

```json
{
  "id": "chat-1",
  "messages": [
    { "id": "u1", "role": "user", "parts": [{ "type": "text", "text": "Where is my order?" }] },
    { "id": "a1", "role": "assistant", "parts": [{ "type": "text", "text": "Which order number?" }] },
    { "id": "m2", "role": "user", "parts": [{ "type": "text", "text": "42" }] }
  ],
  "trigger": "submit-message",
  "instructions": "Be brief",
  "tenant": "acme",
  "locale": "en"
}
```

| Key | Sent | Value |
|---|---|---|
| `id` | when the request has `chatId` | The request's `chatId` |
| `messages` | always | AI SDK `UIMessage`s `{ id, role, parts, metadata? }`: a `content` string becomes one text part, a message without an `id` gets `m<index>`. The [`chat()` behavior](/guide/agent/) adds its app-state message (id `sygnal-app-state`) |
| `trigger` | always | `'submit-message'`. There is no other value: a regenerate sends the conversation again |
| `messageId` | with `continue: true` | The last message's id, when it is the assistant's: the reply continues it (after tool results or an approval) |
| `instructions`, `model` | when the request has them | From the request. The server should ignore them, or check them against a short list |
| `tools` | when the request has them | `{ name: { description, inputSchema } }`: client tools, declared on the server without `execute` |
| `output` | with `output` | `{ schema }`: the JSON Schema of the [structured output](#structured-output) |

The transport's `body` option and then the request's own `body` are merged in (per-request fields win). They can add keys and replace `instructions`, `model`, `tools` and `output`, but not the protocol fields `id`, `messages`, `trigger` and `messageId`, which are always the transport's (as in the AI SDK's own transport). The [`chat()` behavior](/guide/agent/) puts its `transportOptions` into each request, so `transportOptions: { chatId: 'chat-1', body: { locale: 'en' } }` sets `id` and adds `locale`. Other request keys (`key`, `ok`, `delta`, `coalesce`, …) are not sent.

An AI SDK 7 route needs only `messages`: `await convertToModelMessages(messages)` takes them as they are. It reads `tools` if the app has client tools, and `id` if it stores conversations. It ignores `trigger` and `messageId` (the client builds the continued message), and it should ignore `model` and `instructions` and set its own, as [the route above](#shipping-it) does.

#### Storing conversations

A route that saves the conversation (the AI SDK's `originalMessages` and `onFinish`) should not save the `chat()` behavior's app-state message: the app state is rebuilt for every request, and a stored copy would be sent again as stale data. That message is marked `metadata: { sygnal: 'sygnal-app-state', … }` (its id is always `sygnal-app-state`). Send every message to the model, and keep the others:

```js
// server: POST /api/chat, storing conversations
import { streamText, convertToModelMessages, validateUIMessages } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { saveChat } from './store.js'                     // your store

export async function POST(req) {
  const body = await req.json()
  // the model sees the app state; the store doesn't
  const messages = await validateUIMessages({ messages: body.messages })
  const stored = messages.filter((m) => !m.metadata?.sygnal)

  const result = streamText({ model: anthropic('claude-opus-5-5'), messages: await convertToModelMessages(messages) })
  return result.toUIMessageStreamResponse({
    originalMessages: stored,
    onFinish: ({ messages }) => saveChat(body.id, messages),
  })
}
```

The ids round-trip: the user's messages keep the ids the browser gave them, and the reply takes the id the server sends (with `generateMessageId`) or the client makes, so the next request names the same messages.

## Transports

A transport speaks one wire format. Pick the one your server or model speaks; every transport gives the component the same actions and the same messages.

| Transport | Speaks | Use it for |
|---|---|---|
| `uiMessageStream(url)` | The AI SDK UI message stream (v1) | **Production**: an AI SDK route on your server. Server-run tools, tool approvals and `data-*` parts come back as message parts |
| `openResponses({ baseURL, model })` | Open Responses / OpenAI Responses | **Getting started**: Ollama, vLLM, OpenRouter, OpenAI (through your proxy) |
| `chatCompletions({ baseURL, model })` | Chat Completions | Older local servers (LM Studio, llama.cpp) and anything that only has `/chat/completions` |
| `chromePrompt()` | Chrome's built-in Prompt API (`LanguageModel`) | On-device answers with no server and no key ([recipe](/recipes/ai-summarize/)) |
| `anthropicMessages({ baseURL, model })` | Anthropic Messages | Claude through your pass-through proxy, or Ollama's `/v1/messages`. Thinking comes back as `reasoning` parts; `serverTools` adds Anthropic's server tools |
| `agui(url)` | AG-UI events | An agent server built with TanStack AI, CopilotKit, LangGraph or Mastra. The agent's state comes back as a `data-agui-state` part |
| `fromAISDK({ streamText, model })` | The AI SDK, in process | Server rendering, Node scripts, tests against an AI SDK mock model. Not in a browser: the key would be in the page |

Each HTTP transport takes `headers` (an object, or a function of the request), `fetch` (another fetch: a test server, a proxy, SSR), `body` (extra JSON fields for every request) and `dangerouslyAllowBrowser`.

- `chromePrompt()` sends no tools (the Prompt API has none yet). The Prompt API takes one system prompt, so `instructions` and every `system` message, wherever it is in the conversation, are joined into it. Its `status()` resolves with `'available'`, `'downloadable'`, `'downloading'` or `'unavailable'`; a component reads it through [`driverFromAsync`](/guide/custom-drivers/), with no awaiting in `main.js`:

  ```js
  // main.js
  const onDevice = chromePrompt()
  run(App, { LLM: makeChatDriver({ transport: onDevice }), MODEL: driverFromAsync(onDevice.status) })

  // App.jsx
  App.model = {
    BOOTSTRAP: { MODEL: () => ({ ok: 'MODEL_STATUS' }) },
    MODEL_STATUS: (state, status) => ({ ...state, model: status }),   // 'available', 'downloadable', …
  }
  ```

- `fromAISDK` takes `streamText` (and `Output`, for structured output) from your own `ai` import, so Sygnal never depends on the AI SDK: `fromAISDK({ streamText, Output, model: anthropic('claude-opus-5-5') })`. A request's `model` picks another model: a model id is resolved through the `models` option, a provider or a map (`fromAISDK({ streamText, model: anthropic('claude-opus-5-5'), models: anthropic })`, then `{ model: 'claude-haiku-5-5', ... }` on a request). A model id without `models`, or one `models` doesn't resolve, fails the request: it never falls back to the AI SDK's global provider or to the default model.

### Strict schemas

OpenAI and Anthropic have a strict mode for tool and output schemas: the model's JSON is guaranteed to match. Strict mode only accepts a subset of JSON Schema (every key required, no extra keys). `openResponses`, `chatCompletions` and `anthropicMessages` take a `strict` option for it:

```js
import { makeChatDriver, openResponses, strictSchemas } from 'sygnal/ai'

makeChatDriver({ transport: openResponses({ baseURL: '/api/openai/v1', model: 'gpt-6-luna', strict: strictSchemas }) })
```

`strictSchemas` rewrites each schema to the provider's subset (optional keys become required and nullable; the nulls are dropped again before validation). A schema with no strict form is sent non-strict, with a [SYG675](/reference/errors/#syg675) warning in development. It is an import, not `strict: true`, so apps that don't use strict mode don't carry it; `strict: true` is a development error ([SYG672](/reference/errors/#syg672)). Claude's structured output always uses its subset, so without `strict`, `anthropicMessages` still sends the `output` schema in it: keywords Claude doesn't support (`minLength`, `pattern`, `minimum`, `uniqueItems`, …) move into the description, where the model still reads them, and every object gets `additionalProperties: false`. The reply is validated against your original schema. Tool schemas without `strict` go as they are: Claude takes any JSON Schema there.

### Writing your own transport

A transport is an object with one method, `stream(request, signal)`, that returns an async iterable of events. The driver calls it once per request, with the request as the model sent it. Stop when `signal` aborts; a throw is the request's failure (the `error` action).

```js
// a transport for a server that streams lines of JSON: {"text":"…"}
export function jsonLines(url) {
  return {
    async *stream(request, signal) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: request.messages, instructions: request.instructions }),
        signal,
      })
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) if (line.trim()) yield { type: 'text', delta: JSON.parse(line).text }
      }
      yield { type: 'finish', reason: 'stop' }
    },
  }
}
```

The events, in order:

| Event | Meaning |
|---|---|
| `{ type: 'start', id? }` | The message id |
| `{ type: 'text', delta }` | More text |
| `{ type: 'reasoning', delta }` | More reasoning |
| `{ type: 'tool-call', id, name, input }` | A complete tool call (`executed: true` when the server ran it: no `tool` action) |
| `{ type: 'tool-result', id, output }`, `{ type: 'tool-error', id, error }` | The result of a call the server ran |
| `{ type: 'data', name, data }` | A `data-<name>` part |
| `{ type: 'file', mediaType, url }`, `{ type: 'source-url', … }` | A file or source part |
| `{ type: 'finish', reason?, usage? }` | The end, with the finish reason and usage |

Unknown event types are ignored; a known type with the wrong shape is skipped, with a [SYG673](/reference/errors/#syg673) warning in development. A transport that sends `output` should send its JSON Schema: `outputJsonSchema(request.output)` (from `sygnal/ai`) returns `{ schema, wrapped }`, and the driver parses and validates the reply text.

### encodeOpenResponses: scripted replies

`encodeOpenResponses(chunks)` returns the Open Responses events a model would stream for a scripted reply: strings for text, and `{ reasoning }`, `{ toolCall: { name, input } }` and `{ finish }` items. This page's demo server uses it, and so can a mock server for end-to-end tests or a demo without a model. In Playwright:

```js
import { encodeOpenResponses } from 'sygnal/ai'

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')

await page.route('**/v1/responses', (route) => route.fulfill({
  status: 200,
  contentType: 'text/event-stream',
  body: sse(encodeOpenResponses(['Hello ', 'there.'])),
}))
```

## Related

- [Agents](/guide/agent/): the `chat` behavior, an assistant that operates your components through their `agent` declarations
- [AI Decisions](/guide/ai-decisions/): typed answers from decision models, and escalating unsure ones to chat
- [Recipes](/recipes/overview/#ai): a support inbox, structured output into a form, on-device summaries
- [HTTP](/guide/http/): the fetch driver, whose reply actions the chat driver shares
