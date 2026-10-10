# LLM integration: proposed API samples

Companion to [`llm-integration.md`](llm-integration.md). **Nothing here exists yet.** These
samples show what the proposals would look like in an app, written in the canonical forms
(`llms.txt`), so we can judge the API before building it. Decided: everything is exported from `sygnal/ai`, and the static is `agent`. Other names
(`makeChatDriver`, …) are still placeholders.

Contents:

1. [Streaming chat with the driver](#1-streaming-chat-with-the-driver)
2. [The server side and the transports](#2-the-server-side-and-the-transports)
3. [The `agent` declaration](#3-the-agent-declaration)
4. [An in-app assistant: the `chat` behavior](#4-an-in-app-assistant-the-chat-behavior)
5. [Browser agents: WebMCP](#5-browser-agents-webmcp)
6. [Decisions (Jev, Ollama, OpenAI Decisions)](#6-decisions-jev-ollama-openai-decisions)
7. [A command bar on a decision model](#7-a-command-bar-on-a-decision-model)
8. [Forms as declarative WebMCP tools](#8-forms-as-declarative-webmcp-tools)
9. [Testing](#9-testing)
10. [Dev MCP endpoint for coding agents](#10-dev-mcp-endpoint-for-coding-agents)
11. [An MCP App](#11-an-mcp-app)

---

## 1. Streaming chat with the driver

The low-level form: a driver with reply actions, like `makeFetchDriver`. The request names the
actions; `delta` arrives at most once per animation frame (Experiment 1: 23 renders per
300-token reply instead of 302).

```jsx
// Chat.jsx
import { ABORT } from 'sygnal'
import { messageText } from 'sygnal/ai'

export default function Chat({ state }) {
  return (
    <section className="chat">
      <ol className="messages" aria-live="polite">
        {state.messages.map((m, i) => <li key={i} className={m.role}>{messageText(m)}</li>)}
        {state.draft && <li className="assistant streaming">{state.draft}</li>}
      </ol>
      {state.error && <p role="alert">{state.error}</p>}
      <form className="ask">
        <label>Message <input className="prompt" value={state.prompt} /></label>
        <button type="submit" disabled={state.status === 'streaming'}>Send</button>
        <button type="button" className="stop" hidden={state.status !== 'streaming'}>Stop</button>
      </form>
    </section>
  )
}

Chat.initialState = { messages: [], prompt: '', draft: '', status: 'ready', error: null }

Chat.intent = ({ DOM }) => ({
  TYPE: DOM.input('.prompt').value(),
  SEND: DOM.select('.ask').events('submit', { preventDefault: true }),
  STOP: DOM.click('.stop'),
})

// the conversation including the prompt being sent (sinks see the pre-action state)
const withPrompt = (state) => [...state.messages, { role: 'user', parts: [{ type: 'text', text: state.prompt }] }]

Chat.model = {
  TYPE: (state, prompt) => ({ ...state, prompt }),
  SEND: {
    STATE: (state) => state.prompt.trim()
      ? { ...state, messages: withPrompt(state), prompt: '', status: 'streaming', error: null }
      : ABORT,
    LLM: (state) => state.prompt.trim()
      ? { messages: withPrompt(state), key: 'reply', latest: true, delta: 'DELTA', ok: 'DONE', error: 'FAILED' }
      : ABORT,
  },
  STOP: {
    STATE: (state) => ({ ...state, status: 'ready' }),
    LLM: () => ({ abort: 'reply' }),            // aborts the stream; nothing arrives after it
  },
  DELTA: (state, { text }) => ({ ...state, draft: text }),   // the text so far, not the delta
  DONE: (state, { message }) => ({ ...state, messages: [...state.messages, message], draft: '', status: 'ready' }),
  FAILED: (state, { error }) => ({ ...state, draft: '', status: 'error', error: error.message }),
}
```

```js
// main.js
import { run } from 'sygnal'
import { makeChatDriver, uiMessageStream } from 'sygnal/ai'
import Chat from './Chat.jsx'

run(Chat, { LLM: makeChatDriver({ transport: uiMessageStream('/api/chat') }) })
```

Reply data:

| Action | Data |
|---|---|
| `delta` | `{ key, text, delta, message }`: the text so far, what's new since the last one, and the message so far (parts) |
| `ok` | `{ key, message, text, toolCalls, finishReason, usage }` |
| `tool` | `{ key, call: { id, name, input } }`, once per completed tool call |
| `error` | `{ key, error, request }` |

Messages use AI SDK `UIMessage`-compatible parts (`text`, `reasoning`, `tool-call`,
`tool-result`, `file`, `data-*`), so they go to an AI SDK server unchanged.

## 2. The server side and the transports

The docs split by guide (decided): getting started and the live examples use Open Responses
against a local Ollama (no server, no key); the production guides use an AI SDK server route,
so keys, instructions and limits stay on the server and any provider works. (AI SDK 7; check
names against its docs.)

```js
// getting started: main.js, nothing else (Ollama running locally)
run(Chat, { LLM: makeChatDriver({ transport: openResponses({ baseURL: 'http://localhost:11434', model: 'qwen3:8b' }) }) })

// production: main.js, plus the server route below
run(Chat, { LLM: makeChatDriver({ transport: uiMessageStream('/api/chat') }) })
```

The production server route:

```js
// server: POST /api/chat
import { streamText, convertToModelMessages } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

export async function POST(req) {
  const { messages } = await req.json()
  const result = streamText({
    model: anthropic('claude-sonnet-5-5'),
    instructions: 'Answer briefly.',
    messages: await convertToModelMessages(messages),
  })
  return result.toUIMessageStreamResponse()
}
```

The component never changes; only the transport in `main.js` does:

```js
import { makeChatDriver, uiMessageStream, openResponses, anthropicMessages, agui, chromePrompt } from 'sygnal/ai'

makeChatDriver({ transport: uiMessageStream('/api/chat') })                    // AI SDK server (production guides)
makeChatDriver({ transport: agui('/api/agent') })                             // TanStack AI, CopilotKit, LangGraph
makeChatDriver({ transport: openResponses({ baseURL: 'http://localhost:11434', model: 'qwen3:8b' }) })  // getting started; Ollama, vLLM, OpenRouter
makeChatDriver({ transport: anthropicMessages({ baseURL: '/api/anthropic', model: 'claude-sonnet-5-5' }) })  // a pass-through proxy
makeChatDriver({ transport: chromePrompt() })                                 // on device, no key
```

A transport is `{ stream(request, signal) }` yielding normalized events, so an app can write
its own for anything else. A direct call to a hosted API from the browser needs an explicit
`dangerouslyAllowBrowser: true` (like the vendor SDKs); local servers don't.

## 3. The `agent` declaration

One static per component. It describes the actions an LLM may run and the state it may read,
and feeds the in-app assistant (§4), WebMCP (§5), the command bar (§7) and tests (§9).
Nothing is exposed that isn't listed.

```jsx
// TodoApp.jsx
import { z } from 'zod'
import { Collection } from 'sygnal'
import TodoItem from './TodoItem.jsx'

export default function TodoApp({ state }) {
  return (
    <main>
      <form className="new">
        <label>New todo <input className="text" value={state.text} /></label>
      </form>
      <ul className="todos"><Collection of={TodoItem} from="todos" /></ul>
      <button type="button" className="clear" disabled={!state.todos.some((t) => t.done)}>Clear done</button>
    </main>
  )
}

TodoApp.initialState = { todos: [], text: '', filter: 'all', nextId: 1 }
TodoApp.intent = ({ DOM }) => ({
  TYPE: DOM.input('.text').value(),
  SUBMIT: DOM.select('.new').events('submit', { preventDefault: true }),
  CLEAR_DONE: DOM.click('.clear'),
})
TodoApp.model = {
  TYPE: (state, text) => ({ ...state, text }),
  SUBMIT: (state) => ({ ...state, ...addTodo(state, state.text), text: '' }),
  ADD: (state, text) => ({ ...state, ...addTodo(state, text) }),
  SET_FILTER: (state, filter) => ({ ...state, filter }),
  CLEAR_DONE: (state) => ({ ...state, todos: state.todos.filter((t) => !t.done) }),
}
const addTodo = (state, text) => ({ todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 })

TodoApp.agent = {
  name: 'todos',                                        // tool names: todos_add, todos_read, ...
  description: 'The todo list',
  // what the model sees of this component, kept in its context after every flush:
  // Experiment 3's decisive factor (0% → 100% on two local models)
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })), filter: state.filter }),
  actions: {
    ADD: { description: 'Add a todo', input: z.string().min(1).describe('The todo text') },
    SET_FILTER: { description: 'Which todos to show', input: z.enum(['all', 'active', 'done']) },
    CLEAR_DONE: {
      description: 'Delete every todo that is done',
      consequential: true,                              // the app asks the user first
      when: (state) => state.todos.some((t) => t.done), // offered only while it can do something
    },
  },
}
```

```jsx
// TodoItem.jsx: a Collection item's actions become ONE tool with an `id` parameter,
// routed to the item with that key (no per-item tool explosion)
export default function TodoItem({ state }) {
  return (
    <li>
      <label><input type="checkbox" className="done" checked={state.done} /> {state.text}</label>
      <button type="button" className="remove" aria-label={`Remove ${state.text}`}>×</button>
    </li>
  )
}
TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.done'), REMOVE: DOM.click('.remove') })
TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  REMOVE: () => undefined,
}
TodoItem.agent = {
  name: 'todo',                                         // todo_toggle({ id }), todo_remove({ id })
  description: 'A todo',
  actions: {
    TOGGLE: { description: 'Mark the todo done, or not done again' },
    REMOVE: { description: 'Delete the todo', consequential: true },
  },
}
```

`ADD` and `SET_FILTER` have no intent trigger: they exist for agents. Today that's SYG102 ("a
model entry needs a trigger"); an `agent` entry would count as one.

Rules the runtime applies to every tool call, whoever makes it:

- `input` (any Standard Schema; JSON Schema for the model comes from Standard JSON Schema) is
  validated before the action is dispatched. A failure goes back to the model as the error,
  never into a reducer (Experiment 3: without schemas, reducers stored `{"text":"buy milk"}` as
  the text).
- The action runs with `cause: 'agent'` (visible in `t.actions`, devtools and the action log),
  and the call resolves after the flush, with the component's `read` projection.
- **No-op detection**: if the state is the same object afterwards, the result is
  `{ ok: false, error: 'TOGGLE changed nothing' }`, not a false success. An `ABORT` says so too.
- `consequential` actions wait for the user's confirmation; a declined one returns
  `{ ok: false, error: 'the user declined' }`.

## 4. An in-app assistant: the `chat` behavior

The behavior owns the conversation, the tool loop and approvals, so the component only
declares it. By default it uses the host's `agent` declaration (and its children's), so the
assistant operates this very component (and the
`TodoItem`s) through the same rules as §3.

```jsx
// TodoApp.jsx (continued)
import { chat, messageText } from 'sygnal/ai'

TodoApp.uses = {
  assistant: chat({
    sink: 'LLM',
    form: '.ask', prompt: '.prompt', stop: '.stop',          // selectors, like pager({ next, prev })
    approve: '.approve', deny: '.deny',
    instructions: 'You help the user manage this todo list. Use the tools; keep replies short.',
  }),
}

// state.assistant = { messages, prompt, draft, status, pending, error }. The markup is part of
// TodoApp's own view (a behavior's selectors are scoped to its host's JSX, SYG104): a plain
// function called from the view, `{assistantPanel(state.assistant)}`, not a child component.
function assistantPanel(a) {
  return (
    <aside className="assistant">
      <ol aria-live="polite">
        {a.messages.map((m, i) => <li key={i} className={m.role}>{messageText(m)}</li>)}
        {a.draft && <li className="assistant">{a.draft}</li>}
      </ol>
      {a.pending && (
        <div role="alertdialog" aria-label="Confirm">
          <p>The assistant wants to: {a.pending.description}</p>
          <button type="button" className="approve">Allow</button>
          <button type="button" className="deny">Deny</button>
        </div>
      )}
      <form className="ask">
        <label>Ask <input className="prompt" value={a.prompt} /></label>
        <button type="submit" disabled={a.status === 'streaming'}>Send</button>
        <button type="button" className="stop" hidden={a.status !== 'streaming'}>Stop</button>
      </form>
    </aside>
  )
}
```

Actions it adds: `assistant.SEND`, `assistant.STOP`, `assistant.REGENERATE`,
`assistant.APPROVE`, `assistant.DENY`, and `assistant.DONE` (a host entry runs after it, like
`'form.DONE'`). Status names are the AI SDK's (`ready`, `submitted`, `streaming`, `error`).
The read projections of the declared tools go into the model's context on every turn, so the
model sees `{ todos: [{ id: 1, text: 'water plants', done: false }] }` before it acts.

## 5. Browser agents: WebMCP

The same declarations, offered to the browser's agent (Gemini in Chrome and others) through
`document.modelContext`. One call in `main.js`; a no-op where the browser has no WebMCP.

```js
// main.js
import { run, makeDOMDriver } from 'sygnal'
import { experimentalExposeWebMcp } from 'sygnal/ai'
import TodoApp from './TodoApp.jsx'

const app = run(TodoApp, { DOM: makeDOMDriver('#root') })
experimentalExposeWebMcp(app)          // options: { exposedTo: ['https://partner.example'], confirm, prefix }
```

What the agent then sees (registered while each component is mounted, re-registered when
`when` or the read projection changes):

| Tool | From | Input | Hints |
|---|---|---|---|
| `todos_read` | `TodoApp.agent.read` | — | `readOnlyHint`, `untrustedContentHint` (user text) |
| `todos_add` | `ADD` | `{ value: string }` | |
| `todos_set_filter` | `SET_FILTER` | `{ value: 'all' \| 'active' \| 'done' }` | |
| `todos_clear_done` | `CLEAR_DONE` (only while a todo is done) | — | `consequentialHint` |
| `todo_toggle` | `TodoItem` `TOGGLE` | `{ id: 1 \| 2 \| 3 }` (the live keys) | |
| `todo_remove` | `TodoItem` `REMOVE` | `{ id }` | `consequentialHint` |

A call such as `todo_toggle({ id: 7 })` with no item 7 gets
`{ ok: false, error: 'no todo with id 7; ids: 1, 2, 3' }`, which the model can act on.

## 6. Decisions (Jev, Ollama, OpenAI Decisions)

No new driver: a decision is an HTTP request, so `decide()` builds one for `makeFetchDriver`
(Experiment 4 ran this through the existing driver). Answer types are inferred from the
questions, as in TypeSafe's SDK. As a `resource`, the triage re-runs when the text changes and
a stale answer is never shown.

```jsx
// Ticket.jsx
import { ABORT } from 'sygnal'
import { decide, choice, noul, score } from 'sygnal/ai'

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
  mood: score('How upset is the customer?', ['calm', 'annoyed', 'angry']),
}

export default function Ticket({ state }) {
  const t = state.triage
  return (
    <article>
      <p>{state.text}</p>
      {t.status === 'success' && (
        <p className="labels">
          {t.data.answers.topic.choice}
          {t.data.answers.urgent.noul > 0.5 && <strong> urgent</strong>}
        </p>
      )}
    </article>
  )
}

Ticket.initialState = { text: '', topicByLLM: null }

Ticket.resources = {
  // POST /api/decide on the app's server, which forwards to TypeSafe (key on the server),
  // or straight to a local Ollama: decide({ url: 'http://localhost:11434/v1/systemone', model: 'nimble', ... })
  triage: (state) => state.text && decide({ model: 'jev-latest', state: state.text, questions, ok: 'TRIAGED' }),
}

// escalation: only an unsure decision goes to a chat model (Experiment 4: 1 ticket in 10)
Ticket.model = {
  TRIAGED: {
    LLM: (state, { answers }) => answers.topic.confidence < 0.6
      ? { messages: [{ role: 'user', parts: [{ type: 'text', text: `Classify as billing, bug or account: ${state.text}` }] }], ok: 'CLASSIFIED' }
      : ABORT,
  },
  CLASSIFIED: (state, { text }) => ({ ...state, topicByLLM: text.trim() }),
}
```

`decide()` takes the dictionary form (Jev, Ollama, OpenRouter, Vercel Gateway, Clef) and
returns `{ url, method: 'POST', json, ...rest }`; `decide.openai(...)` maps the same questions
to OpenAI's array form and maps the answers back.

## 7. A command bar on a decision model

Experiment 5 as a behavior: one decision call picks the action and the target from the `agent`
declaration (8/8 correct, ~570 ms locally); a low-confidence pick goes to the chat model, or
asks the user.

```jsx
import { commandBar } from 'sygnal/ai'

TodoApp.uses = {
  cmd: commandBar({
    input: '.command',                 // <input className="command"> in the view
                                       // actions and targets: the host's `agent` declaration (Collection keys too)
    decide: { url: '/api/decide', model: 'jev-latest' },
    below: 0.6, escalate: 'assistant', // unsure: hand the text to the chat behavior (§4)
  }),
}
// "I bought the milk"  →  TodoItem TOGGLE on id 2 (confidence 0.99), through the §3 rules
// "what have I finished?"  →  SET_FILTER 'done' at 0.43: escalated
```

## 8. Forms as declarative WebMCP tools

The `form` behavior already has the schema and the labels, so one option makes the form an
agent tool (what Angular does for Signal Forms):

```jsx
Signup.uses = {
  form: form(schema, {
    values: { email: '', plan: 'free' },
    submit: 'SIGN_UP',
    tool: { name: 'sign_up', description: 'Create an account' },
  }),
}
```

The `<form>` the view renders gets `toolname` / `tooldescription`, and each field a
`toolparamdescription` from its `<label>`. An agent's submit runs the same validation, and
`respondWith` returns the field errors to the agent. A user's submit is unchanged.

## 9. Testing

No keys and no network, in the style of the existing HTTP and socket fakes:

```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import Chat from './Chat.jsx'
import TodoApp from './TodoApp.jsx'
import Ticket from './Ticket.jsx'

let t
afterEach(() => t?.dispose())

it('streams a reply and stops', async () => {
  t = renderComponent(Chat)
  t.simulateEvent('.prompt', 'input', { value: 'Hello' })
  t.simulateEvent('.ask', 'submit')
  expect(t.requests('LLM')[0].messages.at(-1).parts[0].text).toBe('Hello')
  await t.stream('LLM', ['Hi', ' there'])              // deltas, then ok, as the driver sends them
  expect(t.state.messages.at(-1)).toMatchObject({ role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] })
})

it('operates the app through its tools', async () => {
  t = renderComponent(TodoApp, { initialState: { ...TodoApp.initialState, todos: [{ id: 1, text: 'milk', done: false }], nextId: 2 } })
  expect(t.tools().map((tool) => tool.name)).toEqual(['todos_read', 'todos_add', 'todos_set_filter', 'todo_toggle', 'todo_remove'])
  expect(await t.callTool('todo_toggle', { id: 1 })).toMatchObject({ ok: true })
  expect(await t.callTool('todos_add', { value: 42 })).toMatchObject({ ok: false, error: expect.stringMatching(/string/) })
  expect(await t.callTool('todo_remove', { id: 1 }, { confirm: false })).toMatchObject({ ok: false, error: 'the user declined' })
})

it('triages, and escalates when unsure', async () => {
  t = renderComponent(Ticket, { initialState: { text: 'card declined but money left my bank' } })
  await t.respond('HTTP', { answers: { topic: { choice: 'billing', confidence: 0.35 }, urgent: { noul: 0.9 }, mood: { score: 1.4 } } }, 'triage')
  await t.stream('LLM', ['billing'])
  expect(t.state.topicByLLM).toBe('billing')
})
```

## 10. Dev MCP endpoint for coding agents

```js
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({ plugins: [sygnal({ mcp: true })] })   // dev only: /__sygnal/mcp
```

```json
// .mcp.json (Claude Code; other agents have the same idea)
{ "mcpServers": { "sygnal-app": { "type": "http", "url": "http://localhost:5173/__sygnal/mcp" } } }
```

Tools: `get_state({ component?, path? })`, `dispatch({ component, action, data })`,
`component_tree` (`inspect()`), `recent_actions({ limit })`, `get_diagnostics` (SYG codes +
docs URLs), `copy_as_test`, and the static `check` / `graph` / `explain` from `sygnal-check`.
An agent fixing a bug can then read the live state, reproduce with `dispatch`, check
`recent_actions`, and turn the session into a test with `copy_as_test`.

## 11. An MCP App

A Sygnal app inside ChatGPT, Claude or VS Code: the MCP Apps bridge as a driver.

```jsx
// WeatherCard.jsx, built as one HTML file (create-sygnal-app --template mcp-app)
export default function WeatherCard({ state }) {
  return (
    <section>
      <h2>{state.city}</h2>
      <ul>{state.days.map((d) => <li key={d.date}><button type="button" className="day" data={{ date: d.date }}>{d.date}: {d.high}°</button></li>)}</ul>
      <button type="button" className="refresh">Refresh</button>
    </section>
  )
}
WeatherCard.initialState = { city: '', days: [] }
WeatherCard.intent = ({ DOM, MCP }) => ({
  INPUT: MCP.select('tool-input'),                // the arguments the model called the tool with
  RESULT: MCP.select('tool-result'),              // the server tool's result
  REFRESH: DOM.click('.refresh'),
  PICK: DOM.click('.day').data('date'),
})
WeatherCard.model = {
  INPUT: (state, { city }) => ({ ...state, city }),
  RESULT: (state, { structuredContent }) => ({ ...state, days: structuredContent.days }),
  REFRESH: { MCP: (state) => ({ callTool: 'get_forecast', args: { city: state.city }, ok: 'RESULT' }) },
  PICK: { MCP: (state, date) => ({ updateModelContext: { selectedDay: date } }) },   // tell the model what the user chose
}
```

```js
// main.js
import { run } from 'sygnal'
import { makeMcpAppDriver } from 'sygnal/mcp-app'
import WeatherCard from './WeatherCard.jsx'

run(WeatherCard, { MCP: makeMcpAppDriver() })
```
