---
title: Agent UI
description: Render a Sygnal app for an LLM agent with sygnal/agent-ui. An accessibility snapshot to read, tool calls to act, an MCP server, and how it fits with the agent declarations of sygnal/ai
---

`sygnal/agent-ui` renders a Sygnal app for an **LLM agent**. The agent's screen is a text snapshot of the UI's accessibility tree, and its input is tool calls: `ui_click`, `ui_type`, `ui_press`, `ui_select` and `ui_check`. Each call becomes the same DOM events a person's click or typing makes. The app doesn't change, and no browser is involved.

```jsx
// mcp.jsx
import { runAgentUI, serveMcp } from 'sygnal/agent-ui'
import Groceries from './Groceries.jsx'

const { ui } = runAgentUI(Groceries)
serveMcp(ui, { name: 'groceries', version: '1.0.0' })   // MCP over stdio
```

```
- main:
  - heading "Groceries" [level=1]
  - textbox "Item" [ref=e1]
  - combobox "Aisle" [ref=e2]: "produce":
    - option "produce" [selected]
    - option "dairy"
  - button "Add" [ref=e3]
  - list:
    - listitem:
      - checkbox "Apples" [ref=e4]
      - text: produce
      - button "Remove Apples" [ref=e5]
  - text: 1 to buy
```

## What "agent UI" means here

An **agent UI** is a renderer target whose output is meant for a model, not a person: a snapshot in the format browser agents already read, plus tools for the actions a person takes. That's a deliberate definition, and the reasons are:

- **It's the interface agents already use.** Browser automation for agents (Playwright's MCP server, browser extensions' `read_page`) works on accessibility snapshots with element refs, and models are good at it. `sygnal/agent-ui` produces the same shape, so an agent needs no new skills.
- **It needs no browser.** The app runs in Node on a [host tree](/renderers/custom-targets/), so there's no Chromium, no screenshots and no pixel coordinates. It's text in, text out: cheap in tokens, deterministic, and easy to run on a server or in CI.
- **Sygnal knows more than a browser does.** Intents are selectors, so the renderer knows exactly which elements the app responds to. A `<label>` with a `DOM.dblclick` intent shows up as `generic "Write the spike" [ref=e10] [on=dblclick]`, which no browser accessibility tree would reveal. Sygnal also knows when the app has finished updating, so every tool call answers with the snapshot *after* the action, without the agent having to poll.
- **It's the user's path, not a side door.** Tool calls go through the same intents, models and validation as a person's input. There's no second API to maintain, and the agent can't do anything a user couldn't.

### Agent UI and the agent declarations

[`sygnal/ai`'s agent declarations](/guide/agent/) are the other way to let an agent work in your app: **semantic tools** (`todos_add`, `todo_toggle`) that you declare on components, with input schemas and confirmation rules. The two fit together:

| | Agent declarations (`agent` statics) | Agent UI |
|---|---|---|
| what the agent calls | your app's actions, by name | clicks, typing, keys on the screen |
| you write | a declaration per component | nothing (optionally a stylesheet) |
| covers | what you declared | everything a person can do |
| best for | precise, frequent operations | everything else, exploration, apps without declarations |

You can serve both from one MCP server. Pass `agentTools(app)` as `tools`, and the agent gets the semantic tools next to the UI tools:

```jsx
// mcp.jsx
import { agentTools } from 'sygnal/ai'
import { runAgentUI, serveMcp } from 'sygnal/agent-ui'
import Groceries from './Groceries.jsx'

const { app, ui } = runAgentUI(Groceries)
serveMcp(ui, { name: 'groceries', tools: agentTools(app) })
```

The neighbours, briefly: [WebMCP](/guide/webmcp/) offers the semantic tools to the agent *in the user's browser tab*, and [MCP Apps](/guide/mcp-apps/) show your UI to *a person* inside an agent's chat. The agent UI is for the agent itself using your app, outside any browser.

## The snapshot

`ui.snapshot()` returns the text, and `ui.tree()` returns the same data as objects (`{ role, name, ref, value, states, on, children }`).

- **Roles and names** follow the browser's rules: a `<button>`'s text, a field's `<label>` (even a visually hidden one), `aria-label`, `aria-labelledby`, `alt`, a placeholder as a last resort. Generic containers (`div`, `span`, `section`) are flattened, and their text becomes `- text:` lines. Landmarks (`main`, `nav`, a labelled `section`) and lists keep their structure.
- **States**: `[checked]`, `[disabled]`, `[expanded]`, `[pressed]`, `[selected]`, `[required]`, `[focused]`, `[level=n]`. A text field's value and a combobox's choice follow a colon.
- **`[ref=e12]`** marks each element the agent can act on: form controls, buttons, links, `[tabindex]` elements, and elements your intents listen to clicks on.
- **`[on=…]`** lists the events the app handles on a non-native element.
- **What's hidden** is left out: `hidden`, `aria-hidden="true"`, inline `display: none`, and the `styles` rules you pass. CSS doesn't reach the agent UI, so pass the rules for the parts of your CSS that hide things:

```js
// agent-styles.js
export const todoStyles = [
  ['.todo .edit', { display: 'none' }],
  ['.todo.editing .edit', { display: 'inline' }],
  ['.todo.editing .view', { display: 'none' }],
]
```

## The tools

| Tool | Input | What happens |
|---|---|---|
| `ui_snapshot` | | nothing (read-only) |
| `ui_click` | `ref`, `double?` | a click with its default action (a checkbox toggles, a link navigates, a submit button submits); `double: true` for a double click |
| `ui_type` | `ref`, `text`, `append?`, `submit?` | replaces a field's value (`input`, then `change`), or types it key by key with `append`; `submit` presses Enter after |
| `ui_press` | `key`, `ref?` | a key (`"Enter"`, `"Escape"`, `"Control+s"`) on an element, or on the focused element or the whole app |
| `ui_select` | `ref`, `option` | chooses a combobox option by label or value |
| `ui_check` | `ref`, `checked` | checks or unchecks a checkbox or radio (nothing when it already is) |

Each call waits for the app to settle (its flush, then `quietMs` of quiet, 20 ms by default, which covers `next()`'s default delay) and answers `{ ok: true, snapshot }`. An error answers `{ ok: false, error, snapshot }` with a message that says what to do, for example "no element with ref "e40": take a new ui_snapshot".

```js
// agent.test.js
import { it, expect } from 'vitest'
import { runAgentUI } from 'sygnal/agent-ui'
import Groceries from './Groceries.jsx'

const refOf = (snapshot, text) => new RegExp(`${text}.*?\\[ref=(e\\d+)\\]`).exec(snapshot)[1]

it('an agent adds an item', async () => {
  const { app, ui } = runAgentUI(Groceries)
  await ui.settle()
  const screen = ui.snapshot()
  await ui.call('ui_type', { ref: refOf(screen, 'textbox "Item"'), text: 'Eggs', submit: true })
  expect(ui.snapshot()).toContain('checkbox "Eggs"')
  app.dispose()
})
```

## Serving over MCP

`serveMcp(ui, options)` runs a Model Context Protocol server on stdio (newline-delimited JSON-RPC, no dependencies). It answers both the `initialize` revisions (2024-11-05 to 2025-11-25) and the stateless 2026-07-28 revision. Its tool results carry the snapshot as text, and the result object as `structuredContent`.

| Option | |
|---|---|
| `name`, `version` | the server's name and version |
| `instructions` | what the agent reads first (the default explains snapshot → ref → act) |
| `tools` | more tools: `agentTools(app)`, or any `{ list(), call(name, args) }` |
| `input`, `output` | default `process.stdin` / `process.stdout` |

Build the server (the [example](https://github.com/tpresley/sygnal/tree/main/examples/renderer-targets) bundles its JSX with Vite), then register it with your client:

```bash
claude mcp add groceries -- node /path/to/dist-node/mcp.js
```

## In your own agent loop

Without MCP, give a model `ui.tools()` (name, description, JSON Schema input: the same shape as `agentTools`) and run its calls with `ui.call(name, input)`. For a [`sygnal/ai` chat driver](/guide/ai-chat/#tools), `ui.chatTools()` returns the tools as a request's `tools`. Your app runs each call (`await ui.call(...)`) and answers the model with the result, as with any other tool.

## Safety

The agent can do whatever a user of that app instance can, nothing more. That still includes the consequential actions, such as deleting or sending, and there's no confirmation step in the UI tools. For actions that need one, declare them as [agent actions](/guide/agent/#the-call-rules) with `consequential: true` and a `confirm` policy, and serve those alongside. Run the agent UI on its own state (its own drivers, a sandbox account), and treat the snapshot as **untrusted content**: it contains whatever text your users wrote, which a model may read as instructions.
