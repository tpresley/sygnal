---
title: Building with AI Agents
description: llms.txt, the sygnal-dev skill, sygnal-check, the MCP servers and inspect
---

Sygnal ships tooling for coding agents (Claude Code, Cursor, Codex and others). Its goal is that an agent never has to guess: one reference that shows only the canonical forms, checks that turn silent wiring bugs into coded messages, and a graph of the app it can read instead of the source. Everything here is also useful without an agent.

| Tool | What it gives the agent |
|---|---|
| [`llms.txt`](#llmstxt) | A compact reference of the canonical forms, in one file |
| [`sygnal-dev` skill](#the-sygnal-dev-skill) | The same knowledge as a Claude Code skill, with a workflow |
| [`sygnal-check`](#sygnal-check) | Static wiring checks, strict mode, `--fix`, the app graph, `explain` |
| [MCP server](#mcp-server) | `check`, `graph` and `explain` as tools |
| [Dev server MCP endpoint](#dev-server-mcp-endpoint) | The running app in the open page: state, actions, diagnostics, its agent tools |
| [`inspect()`](#inspect) | The runtime app graph, in the browser or in a test |

This page is about agents that **build** your app. For agents that **operate** it (an in-app assistant, the browser's agent, an MCP host), see [Agents operating your app](#agents-operating-your-app).

## llms.txt

[`/llms.txt`](/llms.txt) is a single plain-text reference written for language models: the mental model, the anatomy of a component, one canonical example per concept, the wiring rules, an RxJS-to-xstream cheat sheet, how to read diagnostics, and how to test a change. It only uses the [canonical forms](/guide/strict-mode/), so code an agent copies from it passes `sygnal-check --strict`.

Point your agent at it, for example in your project's `AGENTS.md` or `CLAUDE.md`:

```markdown
This project uses Sygnal. Read https://sygnal.js.org/llms.txt before writing components.
Run `npx --no-install sygnal-check --strict` after every change and fix every warning.
```

The same file ships in the npm package (`node_modules/sygnal/llms.txt`), so agents can read it offline, and is in the root of the Sygnal repository.

Projects created with `create-sygnal-app` (without prompts: `npm create sygnal-app@latest my-app -- --template vite --js --install`) already include an `AGENTS.md` (and a `CLAUDE.md` that imports it) with these instructions, the test and check commands, and the testing recipe.

## The sygnal-dev skill

The repository's `skills/sygnal-dev/` folder is a Claude Code skill for building Sygnal apps. Copy the folder into your project's `.claude/skills/` (or `~/.claude/skills/` to use it in every project). Claude Code then loads it whenever it works on Sygnal code. The skill carries the workflow (scaffold, write, test, check, inspect) and points to `llms.txt` for the API.

## sygnal-check

`sygnal-check` is a separate package that reads your source with a parser and never runs it. Projects created with `create-sygnal-app` already have it as a dev dependency. In any other project, install it:

```bash
npm install -D sygnal-check
```

The commands below use `npx --no-install`, which runs only the copy installed in the project and never downloads one from the registry. Agent instructions use the same form: when `sygnal-check` isn't installed, the agent skips the step and relies on the runtime diagnostics in the tests (`renderComponent(C, { strict: true })` and `t.expectNoDiagnostics()`).

| Command | Does |
|---|---|
| `npx --no-install sygnal-check` | Check `./src`; pass files, directories or globs instead (a Vike app: `npx --no-install sygnal-check pages`) |
| `npx --no-install sygnal-check --strict` | Also run the [strict-mode](/guide/strict-mode/) rules (SYG501-507) |
| `npx --no-install sygnal-check --fix` | Rewrite SYG504/505/506 into the canonical form in place, then check |
| `npx --no-install sygnal-check --graph [--json]` | Print the app graph (components, actions, events, selectors, findings) |
| `npx --no-install sygnal-check explain SYG104` | What a code means and how to fix it (`--json`, `--all`) |
| `npx --no-install sygnal-check --json` | Findings as JSON |
| `npx --no-install sygnal-check mcp` | Start the [MCP server](#mcp-server) |

Output looks like this:

```text
src/App.jsx:24:21 SYG104 App: selector '.remove' targets .remove, which is only rendered inside child component <TodoItem>; parents can't see DOM events inside child components (handle it in <TodoItem> and send it up via PARENT or EVENTS)

sygnal-check: 1 warning
```

It exits with code 1 on a warning or error (`--fail-on=error|never` changes that), 2 on a usage error. Info findings are hidden unless you pass `--verbose`. Check the whole app, not one folder: the EVENTS rule (SYG105) and the child-component rule (SYG104) need every file.

To silence one finding, put `// sygnal-ignore SYG110` on the line or the line above.

For apps that use `sygnal/ai`, it also checks the [`agent` static](/guide/agent/) (an action with no model entry SYG150, a misspelled `agents` / `tools` SYG151, duplicate names SYG440, Collection items without ids SYG441, inputs with no JSON Schema form SYG240 / SYG243), LLM requests without an `ok` action (SYG152) and a bare `toolname` on a `<form>` (SYG153), plus two accessibility rules for agents that read the page: hover-only actions (SYG730) and toggled state shown only by a class (SYG731). `--graph` lists the `agent` declarations.

The [Vite plugin](/integration/bundler-config/#plugin-options) runs `sygnal-check` in the dev server when it is installed.

## MCP server

`sygnal-check mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio, so an agent can call the checker as tools:

| Tool | Arguments | Returns |
|---|---|---|
| `check` | `{ paths?: string[], strict?: boolean }` | `{ diagnostics, summary: { error, warn, info } }` |
| `graph` | `{ paths?: string[], strict?: boolean }` | the app graph (`InspectGraph`) |
| `explain` | `{ code: string }` | the code's title, severity, explanation, fix and docs link |

Paths resolve against the server's working directory (start it in the project root). The default is `["src"]`.

Claude Code, from the project root:

```bash
claude mcp add sygnal-check -- npx --no-install sygnal-check mcp
```

Any client that takes a JSON config (`.mcp.json`, Claude Desktop, Cursor, …):

```json
{
  "mcpServers": {
    "sygnal-check": { "command": "npx", "args": ["--no-install", "sygnal-check", "mcp"] }
  }
}
```

## Dev server MCP endpoint

`sygnal-check mcp` reads your source. The dev server endpoint reads the app while it runs: with `mcp: true`, the [Vite plugin](/integration/bundler-config/#plugin-options) serves an MCP endpoint at `/__sygnal/mcp` (streamable HTTP), and an agent can look at the open page and act on it.

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal({ mcp: true })],
})
```

Start the dev server, open the app in a browser, and point the agent at the endpoint. Claude Code reads `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "sygnal-dev": { "type": "http", "url": "http://localhost:5173/__sygnal/mcp" }
  }
}
```

The same from the command line: `claude mcp add --transport http sygnal-dev http://localhost:5173/__sygnal/mcp`. Use your dev server's port if it isn't 5173.

| Tool | Arguments | Returns |
|---|---|---|
| `get_state` | `{ component?, path? }` | an instance's state (the root by default; every instance of a Collection item); `path` reads one field (`'todos.0.text'`) |
| `dispatch` | `{ component?, action, data? }` | sends the action as if the intent had (recorded with cause `'agent'`), waits for the render, returns the new state |
| `component_tree` | `{ component? }` | the [`inspect()`](#inspect) graph of the running app |
| `recent_actions` | `{ limit?, component?, type?, cause? }` | the DevTools action log, newest last |
| `get_diagnostics` | `{ code?, severity?, limit? }` | the runtime diagnostics, each with its `docsUrl` |
| `copy_as_test` | `{ component?, componentImport? }` | DevTools' Copy as test: a `renderComponent` test of the session |
| `agent_tools` | `{ call?, input?, all? }` | the page's own agent tools (the `agent` statics) and their context; with `call`, runs one |
| `tabs` | `{}` | the connected pages |
| `check`, `graph`, `explain` | as [above](#mcp-server) | `sygnal-check` on your source, when it is installed |

`component` is a component name or an instance id from `component_tree`. With several tabs open, the page that loaded or was focused last answers, and each result names it in `tab`; pass `tab` (an id from `tabs`) to choose. An `agent_tools` call follows the same rules as any other caller: the input is validated, `when` is checked, and a consequential tool asks the person in the page first (`mcp: { confirm: true }` runs it without asking, `false` declines it).

It is a development tool only:

- It exists only in `vite` / `vite dev`. A production build (and `vite preview`) has no endpoint and no page code for it.
- It answers only requests from the same machine, with a local `Host` (`localhost`, `*.localhost`, a loopback address, or a name in Vite's `server.allowedHosts`). A request with an `Origin` header from any other site gets 403, so a web page can't reach it, also through DNS rebinding. With `vite --host` the dev server is on your network, but the endpoint still refuses other machines.
- `dispatch` runs any action of any component. Don't turn it on in a dev server you share.

## inspect

`inspect()` returns the same graph shape as `sygnal-check --graph --json`, built from the running app: real component instances, which selectors matched rendered elements, which EVENTS were emitted, and the runtime diagnostics. Use it:

- in a test: `t.inspect()` on a [`renderComponent()`](/integration/testing/#inspect) result;
- in the browser console of a dev app: `window.__SYGNAL_DEVTOOLS__.inspect()`;
- from code: `import { inspect } from 'sygnal/diagnostics'`.

See [Diagnostics](/guide/diagnostics/#inspect) for the fields and what to look for.

## The agent loop

A loop that works well for agents (and people):

1. **Orient.** Run `npx --no-install sygnal-check --graph --json` (or the `graph` tool) to see the components, their actions, state, context, EVENTS and children before editing. With the [dev server endpoint](#dev-server-mcp-endpoint), `component_tree` and `get_state` show the running app.
2. **Write** the change in the canonical forms (`llms.txt`).
3. **Test it** with `renderComponent`: drive it with real DOM events, wait, assert, and check for diagnostics.

   ```javascript
   import 'sygnal/diagnostics'
   import { renderComponent } from 'sygnal'
   import { test, expect } from 'vitest'
   import TodoList from './TodoList.jsx'

   test('adds a todo', async () => {
     const t = renderComponent(TodoList, { initialState: { items: [], draft: '' } })
     t.simulateEvent('.new-todo', 'input', { value: 'Write docs' })
     t.simulateEvent('.add', 'click')
     const state = await t.next(s => s.items.length === 1)
     expect(state.items[0].text).toBe('Write docs')
     t.expectNoDiagnostics()
     t.dispose()
   })
   ```

4. **Read the SYG codes.** A failing `expectNoDiagnostics()`, the console, or `sygnal-check` names a code.
5. **Explain** any code you don't know: `npx --no-install sygnal-check explain SYG104` (or the `explain` tool), or the [Error Reference](/reference/errors/).
6. **Inspect** when the cause isn't obvious: `t.inspect()` shows which selector didn't match (`matched: false`, `isolationHit`), which action has no sinks, and which event has no listener.
7. **Fix**, then run `npx --no-install sygnal-check --strict` and the tests again until both are clean.

## Agents operating your app

Everything above helps an agent write the app. The same app can also be operated by an agent while it runs, through the actions you allow:

- The [`agent` static](/guide/agent/) declares which actions an LLM may run, with input schemas, and what it sees of the state (`read`). Only declared actions are tools.
- The [`chat` behavior](/guide/agent/#an-in-app-assistant-chat) is an in-app assistant that operates the component it lives in; [`commandBar`](/guide/agent/#a-command-bar-commandbar) runs one command picked by a decision model.
- [WebMCP](/guide/webmcp/) (experimental) offers the same tools to the browser's own agent, and turns `form`s into declarative tools.
- [MCP Apps](/guide/mcp-apps/) put your app inside Claude, ChatGPT or VS Code as a tool's view.
- The [dev server endpoint](#dev-server-mcp-endpoint)'s `agent_tools` tool calls them from a coding agent, and [`t.callTool()`](/guide/agent/#testing) from a test.

Browser agents that don't use WebMCP read the accessibility tree, so an accessible app is also an operable one: see [Agents that read the page](/guide/webmcp/#agents-that-read-the-page).

## How we measure it

The Sygnal repository has an evaluation harness (`evals/agent-ergonomics/`) that gives coding agents the same small feature and bug-fix tasks in a Sygnal app and an equivalent React app, scores each run with hidden acceptance tests, and records wall time, build/test iterations and edit rounds. The baseline run (before this tooling existed) is in `evals/agent-ergonomics/results/BASELINE.md`.
