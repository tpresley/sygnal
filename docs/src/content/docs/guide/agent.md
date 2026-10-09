---
title: Agents
description: The agent static — which actions an LLM may run and what it sees — the in-app assistant (chat), the command bar, security, and testing agent paths
---

An LLM can operate a Sygnal app the way a person does: by running its actions. The `agent` static says which actions a model may run, what each one takes, and what the model sees of the component's state. Nothing else is exposed: an action that isn't listed is not a tool.

One declaration serves every kind of agent:

- the [in-app assistant](#an-in-app-assistant-chat): the `chat` behavior, a chat model that operates the component it lives in;
- the [command bar](#a-command-bar-commandbar): one line of text, one action, picked by a decision model;
- the browser's own agent, through [WebMCP](/guide/webmcp/) (experimental);
- an MCP host showing your app as an [MCP App](/guide/mcp-apps/);
- a coding agent, through the [dev server MCP endpoint](/integration/agents/#dev-server-mcp-endpoint);
- your tests: [`t.tools()`, `t.callTool()` and `t.agentContext()`](#testing).

Everything on this page is imported from `sygnal/ai`, except `abort` (from `sygnal`). An app that doesn't use it pays nothing.

## The `agent` static

```jsx
// TodoApp.jsx
import { z } from 'zod'
import { Collection } from 'sygnal'
import TodoItem from './TodoItem.jsx'

export default function TodoApp({ state }) {
  return (
    <main>
      <ul className="todos"><Collection of={TodoItem} from="todos" /></ul>
      <button type="button" className="clear" disabled={!state.todos.some((t) => t.done)}>Clear done</button>
    </main>
  )
}

TodoApp.initialState = { todos: [], filter: 'all', nextId: 1 }

TodoApp.intent = ({ DOM }) => ({ CLEAR_DONE: DOM.click('.clear') })

TodoApp.model = {
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 }),
  SET_FILTER: (state, filter) => ({ ...state, filter }),
  CLEAR_DONE: (state) => ({ ...state, todos: state.todos.filter((t) => !t.done) }),
}

TodoApp.agent = {
  name: 'todos',                       // tool names: todos_add, todos_set_filter, ..., todos_read
  description: 'The todo list',
  untrusted: true,                     // read() returns text the user typed
  // what the model sees of this component
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })), filter: state.filter }),
  actions: {
    ADD: { description: 'Add a todo', input: z.string().min(1).describe('The todo text') },
    SET_FILTER: { description: 'Which todos to show', input: z.enum(['all', 'active', 'done']), idempotent: true },
    CLEAR_DONE: {
      description: 'Delete every todo that is done',
      consequential: true,                              // the user confirms first
      when: (state) => state.todos.some((t) => t.done), // offered only while it can do something
    },
  },
}
```

`ADD` and `SET_FILTER` have no intent trigger here: they exist for agents, and an `agent.actions` entry counts as a trigger for [SYG102](/reference/errors/#syg102).

| Key | What it does |
|---|---|
| `name` | The tool name prefix: `todos` gives `todos_add`, `todos_set_filter`, `todos_clear_done` (the action in snake case) and `todos_read`. Letters, digits and `_`. Two declarations with one name are [SYG440](/reference/errors/#syg440) |
| `description` | What the component is, for the model |
| `read(state)` | What the model sees of the component: a projection, not the state. Keep ids in it, so the model can name things. Without `read`, agents see nothing of the state |
| `label(state)` | A [Collection item](#collection-items)'s label for the model |
| `untrusted` | `read` returns text users typed (see [Security](#security)). Unset, Sygnal infers it from the strings in the projection |
| `actions` | The only actions agents may run, by action name |

Each entry of `actions`:

| Key | What it does |
|---|---|
| `description` | What the action does, in the app's own words (at most 500 characters for WebMCP) |
| `input` | The schema of the action's data. Without one the action takes no arguments |
| `consequential` | Ask the user before running it |
| `when(state)` | The tool is offered only while this is true |
| `idempotent` | A call that changes nothing is a success (`{ ok: true, unchanged: true }`), not an error |

### Input schemas

`input` is any [Standard Schema](https://standardschema.dev) that also implements Standard JSON Schema: Zod 4.2+, ArkType 2.1.28+, or Valibot through `toStandardJsonSchema()`. The model gets the schema's JSON Schema form (the input side, normalized for every provider), and Sygnal validates the arguments with the schema itself before anything runs. A schema whose root isn't an object (`z.string()`, `z.enum([...])`) is sent as `{ value }`; your reducer still gets the plain value.

Plain JSON Schema goes through `jsonSchema()`, which checks the common keywords itself (`type`, `enum`, `required`, `properties`, `minLength`, `pattern`, ...):

```jsx
import { jsonSchema } from 'sygnal/ai'

const input = jsonSchema({ type: 'object', properties: { text: { type: 'string', minLength: 1 } }, required: ['text'] })
```

A schema with no JSON Schema form at all (a Zod `z.date()`, a `refine` on the root) is [SYG240](/reference/errors/#syg240): the tool isn't offered, and `t.tools()` lists it with its `error`. A schema that converts with losses (a refinement inside an object) is [SYG243](/reference/errors/#syg243): the model doesn't see that part, but it is still checked.

In TypeScript, on a component typed with its actions ([TypeScript](/integration/typescript/)), `input` is required for an action that takes data, and its schema's output must fit that data.

## What agents see

**Tools.** One per listed action, plus `<name>_read` when the declaration has a `read`. The todo app above offers:

| Tool | Input | Hints |
|---|---|---|
| `todos_read` | none | read-only |
| `todos_add` | `{ value: string }` | |
| `todos_set_filter` | `{ value: 'all' \| 'active' \| 'done' }` | |
| `todos_clear_done` | none; only while a todo is done | consequential |
| `todo_toggle`, `todo_remove` | `{ id }`, from `TodoItem`'s declaration ([below](#collection-items)) | `todo_remove`: consequential |

Only the components on the page count: a component that isn't rendered (a hidden [Switchable](/guide/switchable/) page, a closed panel) offers no tools. The list follows the app after every render.

**State.** The `read` projections, kept current after every render. The research behind this feature measured why it matters: two small local models operating a todo app through validated tools got **0 of 10** tasks right without the state and **10 of 10** with it. Without the ids in front of it, a model guesses them. Each consumer delivers the projections in its own way: the `chat` behavior sends them with every request, WebMCP has the read tool plus a summary in the tool descriptions, and the command bar puts them in its decision.

## The call rules

Every call, from any kind of agent, goes through the same steps:

1. **Validation.** The arguments are checked against `input` before anything runs. A failure comes back to the model as `{ ok: false, error, issues }` and never reaches a reducer. Before validating, numeric and boolean strings are repaired where the schema says number, integer or boolean (`"3"` → `3`), since small models often send them.
2. **Availability.** A tool whose `when` is false now gets `{ ok: false, error: 'todos_clear_done is not available now' }`.
3. **Confirmation.** A `consequential` action waits for the user (each consumer asks in its own way). A declined call is `{ ok: false, error: 'the user declined' }`. The target and `when` are checked again after the answer.
4. **Dispatch.** The action runs with `cause: 'agent'`, through the same queue, reducers and render as a click. It shows in `t.actions`, the DevTools action log and the dev MCP endpoint's `recent_actions` with that cause.
5. **The result**, after the render: `{ ok: true, state }`, where `state` is the nearest `read` projection (the component's, or for an item, its own or its list's).

**No-op detection.** A call succeeds when one of the action's handlers had an effect: a reducer changed the state, a driver sink got a value, or an `EFFECT` ran. A call that changed nothing is reported as a failure, not a false success. Here, `SET_FILTER` to the filter already set, on an action without `idempotent`:

```text
{ ok: false, error: 'SET_FILTER changed nothing (already so, or the input matched nothing)', state: {…} }
```

A model that toggled the wrong id learns about it this way. For an action where "already so" is fine (setting a filter to its current value), mark it `idempotent: true`, and the call is `{ ok: true, unchanged: true, state }`.

**Refusals.** A reducer that returns `ABORT` changes nothing, so the call reports "changed nothing". To tell the model why, return `abort(reason)` instead: the action is aborted as with `ABORT`, and the reason goes to the model.

```jsx
import { abort } from 'sygnal'

TodoApp.model = {
  ADD: (state, text) => state.todos.length >= 50
    ? abort('the list is full (50 todos); remove some first')
    : { ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 },
}
// → { ok: false, error: 'ADD was refused: the list is full (50 todos); remove some first', state }
```

A refusal is reported even on an `idempotent` action.

**One at a time.** Calls run serially, in the order the model made them, so each one sees the previous one's result. A model that sends three calls at once gets three results computed in sequence.

## Collection items

An item component's actions don't become one tool per item. They become one tool per action, with a parameter that names the item: an enum of the live keys (the items' `id`s), routed to the item with that key.

```jsx live-file=./TodoItem.jsx
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
  name: 'todo',                        // todo_toggle({ id }), todo_remove({ id })
  description: 'One todo',
  label: (state) => state.text,        // the model sees "1: buy milk; 2: water plants"
  actions: {
    TOGGLE: { description: 'Mark the todo done, or not done again' },
    REMOVE: { description: 'Delete the todo', consequential: true },
  },
}
```

(This block is a module the demos on this page import, `./TodoItem.jsx`.)

- The parameter is `id`, or `item` when the action's input has its own `id` field.
- `label(state)` labels each key in the parameter's description, so a model can map "the milk one" to `1`.
- The keys come from the items' `state.id`. Items without ids, or two items with one id, are [SYG441](/reference/errors/#syg441).
- An unknown key gets the list of live keys back: `{ ok: false, error: 'no todo with id 7; ids: 1 (buy milk), 2 (water plants)', keys: [1, 2] }`.

**Items hidden by a filter.** A `<Collection filter={...}>` doesn't render the items it filters out, so they have no instance and no tool. A call for one gets `the todo with id 3 is hidden by the current filter`. When agents should reach every item whatever the filter shows, give the list owner a by-id action:

```jsx
import { z } from 'zod'
import { abort } from 'sygnal'

TodoApp.model = {
  SET_DONE: (state, { id, done }) => state.todos.some((t) => t.id === id)
    ? { ...state, todos: state.todos.map((t) => (t.id === id ? { ...t, done } : t)) }
    : abort(`no todo with id ${id}`),
}

TodoApp.agent = {
  name: 'todos',
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })), filter: state.filter }),
  actions: {
    SET_DONE: {
      description: 'Mark a todo done or not done, including todos the filter hides',
      input: z.object({ id: z.number().int(), done: z.boolean() }),
    },
  },
}
```

The owner's `read` lists every todo, so the model has the ids either way.

## An in-app assistant: `chat`

The `chat` behavior is an assistant that operates the component it is used in. It sends the conversation to the chat driver with the `agent` tools of its host and of the host's descendants on the page, runs the model's tool calls through the [call rules](#the-call-rules), sends the results back, and repeats until the model answers without a tool call.

The demo below asks its first question as soon as it shows. The "model" is the demo server's `POST /v1/responses` route, which answers in the Open Responses format a real model streams. It reads the app state the behavior sends and picks a tool by keyword: no LLM, no key. Ask it to `add call mom`, to mark something done, or to `remove buy milk` (consequential: you get Allow and Deny).

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

const words = (text) => text.match(/\S+\s*/g)
const reply = (chunks) => ({ sse: encodeOpenResponses(chunks), delayMs: 300, chunkMs: 40 })
const textOf = (item) => (typeof item.content === 'string' ? item.content : (item.content ?? []).map((c) => c.text).join(''))

export default {
  'POST /v1/responses': ({ json }) => {
    const last = json.input.at(-1)
    // a tool ran: answer with its result
    if (last.type === 'function_call_output') {
      const result = JSON.parse(last.output)
      if (!result.ok) return reply(words(`That did not work: ${result.error}.`))
      const open = (result.state?.items ?? []).filter((t) => !t.done).length
      return reply(words(`Done. ${open} todo(s) still open.`))
    }
    // the app state: a message the chat behavior sends before the user's, JSON between <app-state> tags
    const stateMessage = json.input.find((item) => textOf(item).includes('<app-state>'))
    const app = JSON.parse(textOf(stateMessage).split('<app-state>')[1].split('</app-state>')[0])
    const asked = textOf(last)
    const named = app.todos.items.find((t) => asked.toLowerCase().includes(t.text.toLowerCase()))
    if (/^add /i.test(asked)) return reply([{ toolCall: { name: 'todos_add', input: { value: asked.slice(4) } } }])
    if (named && /remove|delete/i.test(asked)) return reply([{ toolCall: { name: 'todo_remove', input: { id: named.id } } }])
    if (named) return reply([{ toolCall: { name: 'todo_toggle', input: { id: named.id } } }])
    return reply(words('Try "add call mom", "buy milk is done" or "remove buy milk".'))
  },
}
```

```jsx live live-height=380
import { z } from 'zod'
import { Collection } from 'sygnal'
import { chat, messageText } from 'sygnal/ai'
import TodoItem from './TodoItem.jsx'

// the tools a message used, after its text
const toolsOf = (m) => m.parts.filter((p) => p.type.startsWith('tool-')).map((p) => ` [${p.type.slice(5)}]`).join('')

// The assistant's markup: a plain function the view calls, so the behavior's selectors
// (.ask, .prompt, .approve, ...) are in the host's own view
function assistantPanel(a) {
  const busy = a.status === 'submitted' || a.status === 'streaming'
  return (
    <aside className="assistant">
      <ol className="conversation" aria-live="polite">
        {a.messages.map((m, i) => <li key={i} className={m.role}><b>{m.role}:</b> {messageText(m)}{toolsOf(m)}</li>)}
        {a.draft && <li className="assistant"><b>assistant:</b> {a.draft}</li>}
      </ol>
      {a.pending && (
        <div role="alertdialog" aria-label="Confirm">
          <p>The assistant wants to: {a.pending.description} ({a.pending.label})</p>
          <button type="button" className="approve">Allow</button>
          <button type="button" className="deny">Deny</button>
        </div>
      )}
      {a.error && <p role="alert">{a.error}</p>}
      <form className="ask">
        <label>Ask <input className="prompt" value={a.prompt} /></label>
        <button type="submit" disabled={busy}>Send</button>
        <button type="button" className="stop" hidden={!busy}>Stop</button>
      </form>
    </aside>
  )
}

function TodoApp({ state }) {
  return (
    <main>
      <ul className="todos"><Collection of={TodoItem} from="todos" /></ul>
      {assistantPanel(state.assistant)}
    </main>
  )
}

TodoApp.initialState = {
  todos: [{ id: 1, text: 'buy milk', done: false }, { id: 2, text: 'water plants', done: false }],
  nextId: 3,
}

TodoApp.model = {
  // the demo's first question, as soon as it shows
  BOOTSTRAP: { EFFECT: (state, data, next) => next('assistant.SEND', 'water plants is done') },
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 }),
}

TodoApp.agent = {
  name: 'todos',
  description: 'The todo list',
  untrusted: true,
  read: (state) => ({ items: state.todos.map(({ id, text, done }) => ({ id, text, done })) }),
  actions: {
    ADD: { description: 'Add a todo', input: z.string().min(1).describe('The todo text') },
  },
}

TodoApp.uses = {
  assistant: chat({
    form: '.ask', prompt: '.prompt', stop: '.stop', approve: '.approve', deny: '.deny',
    instructions: 'You manage this todo list with the tools. Keep replies short.',
  }),
}

export default TodoApp
```

The demo starts its assistant from `BOOTSTRAP` only so it has something to show; a real assistant waits for the user.

In an app, `main.js` gives the chat driver a transport to a model. Locally, an Ollama model:

```js
import { run } from 'sygnal'
import { makeChatDriver, openResponses } from 'sygnal/ai'
import TodoApp from './TodoApp.jsx'

run(TodoApp, {
  LLM: makeChatDriver({ transport: openResponses({ baseURL: 'http://localhost:11434/v1', model: 'qwen3:8b' }) }),
})
```

In production the provider key belongs on your server: `makeChatDriver({ transport: uiMessageStream('/api/chat') })` talks to an AI SDK route. Pick a model that is good at tool calls; the smallest local models often aren't.

### Options and state

`chat(options)`:

| Option | Default | What it does |
|---|---|---|
| `form` | | The form whose submit sends the prompt |
| `prompt` | | The prompt field (its input sets `prompt`) |
| `stop`, `approve`, `deny`, `regenerate` | | Buttons: their clicks dispatch `STOP`, `APPROVE`, `DENY`, `REGENERATE` |
| `instructions` | | System instructions: your app's own text |
| `agent` | the host's and its shown descendants' | Whose declarations become tools: `false` for none, `[Comp, ...]` for only these (inside the host) |
| `maxSteps` | `8` | The most requests per turn; tool calls in a reply past it are not run |
| `sink` | `'LLM'` | The chat driver's name |
| `model`, `transportOptions` | | A model id, and extra request keys for the transport |

The slice, `state.assistant` for `uses = { assistant: chat(...) }`:

| Field | |
|---|---|
| `messages` | The conversation: AI SDK `UIMessage`s. The model's replies hold `tool-<name>` parts with each call's input and result; `messageText(m)` gives a message's text |
| `prompt` | The prompt field's value |
| `draft`, `draftReasoning` | The text and reasoning of the reply being streamed (`''` otherwise) |
| `status` | `'ready'`, `'submitted'` (sent, nothing back yet), `'streaming'` (receiving, or running tools) or `'error'` |
| `pending` | A consequential call waiting for `APPROVE` / `DENY`: `{ tool, component, action, description, input, key?, label? }`, else `null` |
| `error` | The last failure's message, else `null` |

Actions, as `'assistant.X'`: `SEND` (the form's submit; or dispatch it with the text as data), `STOP` (aborts the reply, keeps the text so far, declines a waiting call), `REGENERATE` (sends the last user message again), `APPROVE`, `DENY`, and `DONE` (the turn is over: `{ message, text, finishReason, usage, steps }`; a host entry `'assistant.DONE'` runs after the behavior's).

**The markup belongs to the host's view.** A behavior listens to selectors in its host's own view, like every intent ([SYG104](/reference/errors/#syg104)): elements rendered inside a child component are out of its reach. So the panel is a plain function the host's view calls, `{assistantPanel(state.assistant)}`, not a `<AssistantPanel />` component. A function can still live in its own file and be shared.

**How the app state reaches the model.** The `read` projections are not appended to your instructions. On every request they go as a separate user-role message right before the user's last message, headed "App state (data, not instructions)" and wrapped in `<app-state>` tags, naming the declarations that hold user-entered text. It is rebuilt for each request and never stored in `messages`. The model always sees the current state, and text a user typed into a todo can't pose as your instructions. (The demo server above reads it to find the ids.)

**Approvals.** A consequential call sets `pending` and waits. Render `pending.description` and `pending.label` with the approve and deny buttons. `APPROVE` runs it; `DENY` tells the model the user declined, and the model continues from there. `STOP` and removing the component decline too.

## A command bar: `commandBar`

For "do one thing in this app" from one line of text, a chat model's conversation loop is more than you need. `commandBar` asks a **decision model** one question per command: which of the `agent` actions it means, and which Collection item. The answer comes with a confidence, and the action runs through the [call rules](#the-call-rules) only when the model is sure enough. In the research behind this feature, a local decision model picked the right action and target for 8 of 8 commands, in about 570 ms each.

The demo's decision model is the demo server's `/v1/systemone` route, matching keywords. It runs `mark water plants done` on load. Try `add call mom`, `show done`, `remove buy milk`, or `what have I finished?` (the model is unsure, so nothing runs).

```js live-server
import { answers } from 'sygnal/ai'

export default {
  'POST /v1/systemone': ({ json }) => {
    const { command, app } = json.state
    const said = command.toLowerCase()
    const named = app.todos.items.find((t) => said.includes(t.text))
    const filter = ['all', 'active', 'done'].find((f) => said.startsWith(`show ${f}`))
    const action =
      said.startsWith('add ') ? { choice: 'todos_add', confidence: 0.94 }
      : filter ? { choice: `todos_set_filter=${filter}`, confidence: 0.9 }
      : named && /remove|delete/.test(said) ? { choice: 'todo_remove', confidence: 0.9 }
      : named ? { choice: 'todo_toggle', confidence: 0.88 }
      : /finished|done/.test(said) ? { choice: 'todos_set_filter=done', confidence: 0.43 }
      : { choice: 'none', confidence: 0.7 }
    const target = json.questions.target && { choice: named ? String(named.id) : 'none', confidence: 0.9 }
    // answers(): the reply a decision model sends for these questions
    return { delayMs: 400, json: answers(json.questions, { action, ...(target && { target }) }, { model: json.model }) }
  },
}
```

```jsx live live-height=300
import { z } from 'zod'
import { Collection } from 'sygnal'
import { commandBar } from 'sygnal/ai'
import TodoItem from './TodoItem.jsx'

function outcome(cmd) {
  if (cmd.status === 'deciding') return 'Deciding…'
  if (cmd.unsure) return `Not sure what "${cmd.unsure.command}" means (best guess: ${cmd.unsure.description ?? 'none'}, ${Math.round(cmd.unsure.confidence * 100)}%). Nothing ran.`
  if (cmd.error) return `Failed: ${cmd.error}`
  if (cmd.result) return cmd.result.ok ? `"${cmd.result.command}" ran ${cmd.result.tool}.` : `"${cmd.result.command}": ${cmd.result.error}`
  return ''
}

function Commands({ state }) {
  const cmd = state.cmd
  return (
    <main>
      <form className="command-form">
        <label>Command <input className="command" value={cmd.text} /></label>
        <button type="submit" disabled={cmd.status !== 'ready'}>Run</button>
      </form>
      <p className="outcome" aria-live="polite">{outcome(cmd)}</p>
      {cmd.pending && (
        <div role="alertdialog" aria-label="Confirm">
          <p>Run "{cmd.pending.description}" on {cmd.pending.label}?</p>
          <button type="button" className="cmd-approve">Allow</button>
          <button type="button" className="cmd-deny">Deny</button>
        </div>
      )}
      <p>Showing: {state.filter}</p>
      <ul className="todos">
        <Collection of={TodoItem} from="todos" filter={(t) => state.filter === 'all' || t.done === (state.filter === 'done')} />
      </ul>
    </main>
  )
}

Commands.initialState = {
  todos: [{ id: 1, text: 'buy milk', done: false }, { id: 2, text: 'water plants', done: false }],
  filter: 'all',
  nextId: 3,
}

Commands.model = {
  // the demo's first command, as soon as it shows
  BOOTSTRAP: { EFFECT: (state, data, next) => next('cmd.RUN', 'mark water plants done') },
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 }),
  SET_FILTER: (state, filter) => ({ ...state, filter }),
}

Commands.agent = {
  name: 'todos',
  description: 'The todo list',
  untrusted: true,
  read: (state) => ({ items: state.todos.map(({ id, text, done }) => ({ id, text, done })), filter: state.filter }),
  actions: {
    ADD: { description: 'Add a todo', input: z.string().min(1).describe('The todo text') },
    SET_FILTER: { description: 'Which todos to show', input: z.enum(['all', 'active', 'done']), idempotent: true },
  },
}

Commands.uses = {
  cmd: commandBar({
    input: '.command', form: '.command-form', approve: '.cmd-approve', deny: '.cmd-deny',
    decide: { url: '/v1/systemone', model: 'nimble' },
  }),
}

export default Commands
```

What it asks the decision model, as one `decide()` request through the app's `HTTP` driver:

- **action**: a `choice` over the offered actions, described by their `description`s, plus `none`. An action whose input is one enum (or a boolean) becomes one option per value (`todos_set_filter=done`), so the model picks the argument too.
- **target**, when an item action is offered: a `choice` over the live Collection keys, described by `agent.label`, plus `none`.
- The decision's `state` is `{ command, app }`, `app` being the `read` projections.

`commandBar(options)`:

| Option | Default | What it does |
|---|---|---|
| `input` | required | The command field. Enter runs it, unless `form` is given |
| `form` | | A form whose submit runs the command |
| `run` | | A button whose click runs the field's command (a Go button) |
| `decide` | required | The decision request: `{ url, model }` (plus any [`makeFetchDriver`](/guide/http/) request keys), or a function `(q) => decide.openai({ ...q, url, model })` |
| `below` | `0.6` | Below this confidence (the action's, and the target's for an item action) nothing runs |
| `escalate` | | The `uses` key of a `chat` behavior on the same host: an unsure command goes to its `SEND` |
| `approve`, `deny` | | Buttons for a consequential action |
| `freeText` | a heuristic | `(command, tool) => string \| undefined`: the text argument of an action whose input is one string |
| `agent` | the host's and its shown descendants' | `[Comp, ...]`: only these components' actions |
| `sink` | `'HTTP'` | The fetch driver's name |

The slice, `state.cmd`: `text` (the field; cleared after a command ran), `status` (`'ready'`, `'deciding'`, `'running'`, `'error'`), `command`, `pending`, `unsure`, `result` and `error`. `unsure` says why nothing ran: `{ command, reason, tool, description, target, label, confidence }`, with `reason` one of `'confidence'`, `'no-action'` (the model picked none), `'target'` (no clear item) or `'input'` (the action needs an argument the bar can't fill). Actions: `cmd.RUN` (with a string as data, it runs that command), `cmd.APPROVE`, `cmd.DENY` and `cmd.DONE` (a command ran; a host `'cmd.DONE'` entry runs after it).

**Escalating to a chat model.** With a `chat` behavior on the same component, `escalate` hands every command the bar isn't sure about to the assistant, which can ask back or fill arguments:

```jsx
TodoApp.uses = {
  assistant: chat({ form: '.ask', prompt: '.prompt', instructions: 'You manage this todo list with the tools.' }),
  cmd: commandBar({ input: '.command', decide: { url: '/api/decide', model: 'jev-latest' }, below: 0.6, escalate: 'assistant' }),
}
```

`result` is then `{ command, escalated: 'assistant', reason, ... }`.

**Free text is a heuristic.** A decision model picks among options; it doesn't write text. For an action whose input is one string (`ADD`'s todo text), the bar takes the text from the command: a quoted part if there is one (`add "call mom"`), otherwise the command minus its first word (`add call mom` → `call mom`). That is naive for commands such as `remind me to call mom` (→ `me to call mom`). Pass `freeText` to do better, return `undefined` when you can't tell (the command escalates, or is `unsure` with reason `'input'`), or rely on `escalate`. Actions with other inputs (numbers, several fields) always escalate when picked: filling them is a chat model's job.

The `decide` URL is your server's route that holds the decision service's key, or a local Ollama (`http://localhost:11434/v1/systemone`, model `nimble`).

## Security

Treat every tool call as untrusted input from someone holding the user's session, because that is what it is.

- **Only declared actions are tools.** An action without an `agent.actions` entry can't be called, by any consumer. Declare the few actions an agent needs, not every action the component has. A narrow tool can do less harm when a model is fooled.
- **Agents see projections, not state.** `read` decides what leaves the app. Leave out tokens, other users' data, and anything the task doesn't need.
- **Tools run with the user's authority.** A call is the same as the user's click: the same reducers, the same requests with the same session. Your server must authorize every request as it already should; nothing about an agent call is privileged, and nothing is safer than a click.
- **Confirm what is hard to undo.** Mark deletes, payments, sends and anything irreversible `consequential: true`. The `chat` behavior and the command bar wait for `APPROVE`; WebMCP shows a dialog. Keep the confirmation in your app: browsers may ignore the hint ([WebMCP](/guide/webmcp/#hints)).
- **No user text in descriptions or instructions.** Models follow what tool descriptions and system instructions say. Write `description`s and `instructions` as fixed app text; never build them from state, and never put text a user (or another user) typed in them. Sygnal keeps its own channels clean the same way: the `chat` behavior sends the projections as a framed data message, not in the instructions, and WebMCP describes an untrusted projection by its structure only (counts and ids, no text) and leaves `label`s out of untrusted tools' schemas. One exception to know about: for the `chat` behavior and the command bar, `label(state)` text goes into the item tool's parameter description. When labels are text other people typed (a shared list), leave `label` out; the model still finds the ids in the app state.
- **Mark user text.** `untrusted: true` on a declaration whose `read` returns text users typed. The chat behavior names it as untrusted in the app-state message, and WebMCP sets `untrustedContentHint` on its tools. Unset, Sygnal infers it from the projection: any string counts as user text, except values under keys named `id`, `status`, `type` or `kind` and values that are one of the declaration's input enum values (WebMCP reports the inference as [SYG244](/reference/errors/#syg244)). Declare it either way to be explicit: `untrusted: false` when the strings are all your own.
- **Offer tools only while they make sense.** `when` takes a tool away when it can't do anything, so a model can't call it by mistake.

Prompt injection is not solved by any framework: a model that reads text written to manipulate it may do what that text says, within the tools you offered. These rules keep the damage within what one confirmed action can do.

## Testing

`renderComponent` ([Testing](/integration/testing/)) runs agent calls as an agent does, with no model:

```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import TodoApp from './TodoApp.jsx'

let t
afterEach(() => t?.dispose())

it('is operable by agents', async () => {
  t = renderComponent(TodoApp, { initialState: { todos: [{ id: 1, text: 'buy milk', done: false }], filter: 'all', nextId: 2 } })
  await t.ready()

  // the offered tools: name, description, inputSchema, annotations
  expect(t.tools().map((tool) => tool.name)).toEqual(['todos_read', 'todos_add', 'todos_set_filter', 'todo_toggle', 'todo_remove'])
  // what the model sees
  expect(t.agentContext()).toEqual({ todos: { todos: [{ id: 1, text: 'buy milk', done: false }], filter: 'all' } })

  expect(await t.callTool('todos_add', { value: 'walk the dog' })).toMatchObject({ ok: true })
  expect(await t.callTool('todos_add', { value: 42 })).toMatchObject({ ok: false, issues: expect.any(Array) })
  expect(await t.callTool('todo_toggle', { id: 1 })).toMatchObject({ ok: true })
  expect(await t.callTool('todo_toggle', { id: 9 })).toMatchObject({ ok: false, keys: [1, 2] })

  // a consequential tool needs an answer: { confirm: true | false | (info) => boolean }
  expect(await t.callTool('todos_clear_done', {}, { confirm: false })).toEqual({ ok: false, error: 'the user declined' })
  expect(await t.callTool('todos_clear_done', {}, { confirm: true })).toMatchObject({ ok: true })

  expect(t.actions.filter((a) => a.cause === 'agent').map((a) => a.type)).toEqual(['ADD', 'TOGGLE', 'CLEAR_DONE'])
})
```

- `t.tools()` lists the offered tools, plus any declared tool that can't be offered (SYG240) with its `error`.
- `t.callTool(name, args, { confirm })` resolves with the [call result](#the-call-rules) after the render. A consequential tool without `confirm` throws, so a test can't approve one by accident.
- `t.agentContext()` returns the `read` projections by declaration name; an item declaration's is an array, each entry with its `id`.

To test the assistant itself, drive the `LLM` fake: `t.stream('LLM', [{ toolCall: { name: 'todo_toggle', input: { id: 1 } } }])` makes the model call a tool, and the behavior runs it through the same rules.

## Related

- [WebMCP](/guide/webmcp/): the same tools for the browser's agent (experimental)
- [MCP Apps](/guide/mcp-apps/): your app inside Claude, ChatGPT or VS Code, with its tools
- [Building with AI Agents](/integration/agents/): coding agents, `sygnal-check` and the dev server endpoint
- [Accessibility](/guide/accessibility/): browser agents that read the page use the accessibility tree
