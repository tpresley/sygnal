# Agent instructions

This project uses **Sygnal**, a reactive JSX component framework built on Cycle.js (Model-View-Intent, xstream streams, one state tree). It is not React: there are no hooks and no `onClick` handlers.

**Read `node_modules/sygnal/llms.txt` first** (online: https://sygnal.js.org/llms.txt). It is the normative spec: canonical forms, API facts, wiring rules, diagnostics, and the testing recipe. If you have the `sygnal-dev` skill, use it too.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Runs the Vitest tests: the view (`src/App.test.ts`) and the MCP server (`server/server.test.js`) |
| `npx --no-install sygnal-check --strict` | Static check for wiring bugs and non-canonical forms; must report nothing |
| `npx --no-install sygnal-check explain SYG104` | Explains a `[Sygnal SYGnnn]` diagnostic and how to fix it |
| `npx --no-install sygnal-check --graph --json` | The app graph: components, actions, selectors, EVENTS |
| `npm run build` | Builds the view as one HTML file, `dist/index.html` (the MCP server serves it) |
| `npm start` / `npm run serve` | Build, then start the MCP server on http://localhost:3001/mcp / start it without building (`node server/server.js --stdio` for stdio) |
| `npm run dev` | The view alone in a browser, with no host (it stays at "Waiting for the tool call…") |

`sygnal-check` is a dev dependency of this project, so `npm install` installs it and the commands above run the local copy (`--no-install` never downloads one). If it is missing (no `node_modules` yet), run `npm install` first; if it still isn't there, skip these commands and rely on the runtime diagnostics in the tests (`strict: true` + `t.expectNoDiagnostics()`).

## Workflow
Add a feature in this order: state (`initialState`) → intent (`ACTION: DOM.click('.x')`) → model (`ACTION: (state, data) => ({ ...state, ... })`) → view → test. Finish with `npm test` and `npx --no-install sygnal-check --strict`, both clean. Read the whole `npm test` output: each failure prints above the summary, so piping it through `tail` hides the error (to shorten it, use `npm test 2>&1 | grep -A15 -E 'FAIL|Error'`).

## Testing your change
```js
import { renderComponent } from 'sygnal'
const t = renderComponent(App, { strict: true })    // no browser needed
t.simulateEvent('.add', 'click')                    // or ('.field', 'input', { value: 'x' })
await t.next(s => s.items.length === 1)             // waits for a new matching state
t.expectNoDiagnostics(); t.dispose()                // fails on any Sygnal warning
```

## Never use these forms (strict mode flags them)
- `'ACTION | SINK'` shorthand model keys: write `ACTION: { SINK: fn }`.
- `emit(...)` or a raw `EVENTS: s => ({ type, data })`: write `EVENTS: event('TYPE', (state, data) => payload)`.
- `CHILD.select('Name')` with a string: write `CHILD.select(ChildComponent)`.
- Positional views `function C(props, state)`: write `function C({ state, context, ...props })`.
- Side effects inside a STATE reducer or a view: use `ACTION: { EFFECT: (state, data, next) => { ... } }` or a driver.
- `fetch` in a component or EFFECT, or `HTTP.select('x')` reading back your own request: register `run(App, { HTTP: makeFetchDriver() })` and name the reply actions, `LOAD: { HTTP: (state, id) => ({ url: '/api/items/' + id, ok: 'LOADED', error: 'FAILED' }) }` with `LOADED: (state, body) => ...` and `FAILED: (state, { status }) => ...`. Tests answer it with `await t.respond('HTTP', body, 'LOADED')`. WebSocket/SSE: a `connections` static with `makeSocketDriver()` (see llms.txt).

## Wiring rules that fail silently
- A component's intent only sees its own JSX. A parent can't select `.remove` rendered by a child or a Collection item: handle it in the child and send it up with `PARENT` (parent: `CHILD.select(Child)`) or `EVENTS`.
- Every intent action needs a model entry with the same name, and every model entry needs a trigger: an intent action, a built-in, or `next('X')`.
- `event('X')` and `EVENTS.select('X')` must use the same type string.
- `<Collection of={Item} from="items" />`: `from` names an array field of the state.
- An input with `value={state.x}` needs `X: DOM.input('.x').value()` in the intent.
- "No change" is `return ABORT`. Returning nothing is SYG202, and a reducer that mutates `state` and returns it changes nothing (the same object means "no change"; SYG222): return a new object.

## This project: an MCP App
- `src/App.tsx` is the view of the `get_forecast` tool. The host (Claude, ChatGPT, VS Code, ...) shows it in a sandboxed iframe; `src/main.ts` runs it with `makeMcpAppDriver()` from `sygnal/ai` as the `MCP` driver.
- Host → view: `MCP.select('tool-input' | 'tool-input-partial' | 'tool-result' | 'tool-cancelled' | 'host-context-changed' | 'teardown')` in the intent.
- View → host: model entries that return `{ callTool, args, ok, error }` (a server tool; reply actions like `makeFetchDriver`), `{ updateModelContext }`, `{ message }`, `{ openLink }` or `{ displayMode }` on the `MCP` sink.
- `server/server.js` registers the tool with `_meta.ui.resourceUri` and the `ui://` resource (MIME type `text/html;profile=mcp-app`) that serves `dist/index.html`. Rebuild (`npm run build`) after changing the view.
- The view can't load other files or reach the network (the host's sandbox): keep it one file (the Vite build inlines everything) and get data through `callTool`.
- Tests: the MCP events are actions (`t.simulateAction('INPUT', { city: 'Oslo' })`); `t.requests('MCP')` lists what the view sent and `await t.respond('MCP', result, 'RESULT')` answers a `callTool`.
