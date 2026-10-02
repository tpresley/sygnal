# sygnal-check

A static checker for [Sygnal](https://sygnal.js.org) apps. It finds the string-wiring bugs that fail silently at runtime: an intent selector that matches nothing, an intent action with no model entry, an EVENTS type nobody listens to, and similar.

```bash
npx sygnal-check                 # checks ./src
npx sygnal-check src/components  # files, directories or globs
npx sygnal-check "src/**/*.tsx" --json
npx sygnal-check --graph --json  # the app graph: components, actions, events, selectors, findings
npx sygnal-check explain SYG104  # what a diagnostic code means and how to fix it
npx sygnal-check mcp             # MCP server (stdio) with check, graph and explain tools
```

It parses JS, JSX, TS and TSX with `@babel/parser`. It never runs your code and doesn't depend on `sygnal`.

## Output

```
src/App.jsx:20:15 SYG110 App: selector '.add-todo-button' targets .add-todo-button, but App's view never renders that class, so this action never fires (did you mean '.add-todo-btn'? The view renders className="add-todo-btn")
src/App.jsx:24:21 SYG104 App: selector '.remove' targets .remove, which is only rendered inside child component <TodoItem>; parents can't see DOM events inside child components (handle it in <TodoItem> and send it up via PARENT or EVENTS)

sygnal-check: 2 warnings
```

Each line has the form `file:line:col CODE [severity] Component: message (fix)`. The severity tag only appears for non-warnings. Info-level findings are hidden unless you pass `--verbose`.

## Options

| Option | |
|---|---|
| `--json` | Print an array of diagnostics (see below) |
| `--fail-on=warn\|error\|never` | Exit with code 1 when a diagnostic at this level or above exists. The default is `warn`. Info never fails the run |
| `--verbose` | Also print info-level findings |
| `--include-tests` | Also scan `*.test.*` / `*.spec.*` files found through directories or globs (skipped by default; a file named explicitly is always scanned) |
| `--strict` | Also run the strict-mode canonical-form rules (SYG501-507, see [Strict mode](#strict-mode)) |
| `--fix` | Apply the mechanical canonical-form rewrites in place, then check (implies `--strict`) |
| `--graph` | Print the [app graph](#app-graph---graph) instead of the findings list; with `--json`, as JSON. Exits 0 (findings are part of the graph). Combines with `--strict`, not with `--fix` |

Exit codes: `0` clean, `1` findings at or above `--fail-on`, `2` usage error (bad option, no files, unknown code for `explain`).

Subcommands: [`sygnal-check explain <code>`](#explaining-a-code) and [`sygnal-check mcp`](#mcp-server).

## Rules

The codes are the same as Sygnal's runtime diagnostics (`https://sygnal.js.org/reference/errors#sygNNN`).

| Code | Severity | Finds |
|---|---|---|
| SYG110 | warn | An intent selector (`DOM.select('.x')`, `DOM.click('.x')` or any other shorthand) whose class or id the component's own view never renders. The view is read from static `className`/`class`/`id` strings, `classes()`/`clsx()` calls, template literals, `+` concatenation, conditionals, `[..].join(' ')`, local and module-level consts, module-level render helpers, `h()` and hyperscript helpers, and the `className` of `<Collection>`/`<Switchable>`. The fix suggests the closest class the view does render. The finding is downgraded to **info** when a dynamic className (e.g. `` `tab-${kind}` `` or `props.className`) might produce the class, or when the selector itself isn't a static string. |
| SYG111 | warn | A controlled field: an `<input>`/`<textarea>`/`<select>` whose `value` (or a checkbox/radio whose `checked`) is bound to an expression, while the component's intent has no `input`/`change`/`keyup`/`keydown` listener on that element or an ancestor (a `keydown`/`keyup` listener that is immediately filtered on a key, such as Enter, doesn't count; `processForm` counts). Sygnal writes the bound value back on every render, so a re-render while the user types resets the text. Fix: update the state on `input`, or drop the `value` prop and read the value on blur/submit. A **literal** `value` on a text-like field (`value=""`, `value="default"`) or a literal `checked` on a checkbox/radio is reported too, since Sygnal controls literals as well: every re-render resets the field to the literal. Fix: drop the prop (uncontrolled), or move the value into state and update it on `input`/`change`. Stays quiet for readOnly/disabled/hidden/file fields, a `<select>` with a literal `value`, `value={null}`, dynamic selectors, and DOM selectors handed to helpers. |
| SYG104 | warn | The class or id is rendered, but only inside a **child** component, i.e. in the child's JSX, in JSX passed into it as children or slots, or in a `<Collection of={X}>`/`<Switchable of={{…}}>` child, resolved through imports. Child components are isolated, so the parent never sees those events. |
| SYG101 | warn | An intent action with no model entry. `'ACTION \| SINK'` shorthand keys are expanded first. |
| SYG102 | warn | A model entry nothing can trigger: no intent action, not a built-in (`BOOTSTRAP`, `INITIALIZE`, `DISPOSE`, `READY`; `HYDRATE` is an ordinary action since 6.0), never named by a routed request (`ok: 'X'` / `error: 'X'` returned by a driver sink) or a `connections` entry (`message`/`open`/`close`/`error`), and never the target of a `next('X')` string literal. This is downgraded to info when the model calls `next()`, or a request names its action, with a non-literal name. |
| SYG112 | error | A routed request names a reply action the component has no model entry for, so the reply is dropped: a string literal `ok`/`error` in an object a driver sink returns (`HTTP: (s) => ({ url, ok: 'LOADED', error: 'FIALED' })`; not STATE/EFFECT/EVENTS/PARENT/READY), or a `message`/`open`/`close`/`error` name in a `connections` static. The fix names the closest model key. Only UPPER_SNAKE_CASE names, or names close to a model key, are reported (a custom driver's `error: 'Not found'` field is data). |
| SYG105 | warn | An EVENTS type that is selected (`EVENTS.select('X')`) but never emitted, or emitted (`emit('X')`, `event('X')`, or `{ type: 'X' }` returned from an `EVENTS` sink) but never selected, anywhere in the scanned files. Only string literals are matched. This is downgraded to info when non-literal emits or selects exist. |
| SYG401 | warn | `<Collection from="x">` where `x` isn't a key of the component's `initialState` (or `calculated`), or its initial value is a literal that isn't an array. This is only checked when `initialState` is statically known. |
| SYG900 | warn | A file couldn't be parsed, or a rule crashed. |

## Strict mode

`--strict` adds one rule per row of Sygnal's canonical-forms table: code that works, but isn't written the one blessed way. Each message shows the canonical rewrite of the offending code. Without `--strict` these rules don't run.

| Code | Severity | Canonical form | Flags | `--fix` |
|---|---|---|---|---|
| SYG501 | warn | `function C({ state, context, ...props })` | a view (any component, or a function rendered as a component tag) with a 2nd/3rd parameter, i.e. the positional `(props, state, context)` arguments | no |
| SYG502 | warn | `return ABORT` for "no change" in a STATE reducer | `return state` / `cond ? next : state` (`state` = the first parameter), a bare `return;`, or a block body that can end without returning. An explicit `undefined` isn't flagged (a Collection item removes itself that way) | no |
| SYG503 | warn | `ACTION: { EFFECT: (state, data, next) => { … } }` | heuristic: a STATE reducer with a call statement whose result is unused (`cmd.send()`, `next()`, `console.log()`) on the path to a `return ABORT` | no |
| SYG504 | warn | `ACTION: { SINK: fn }` | `'ACTION \| SINK'` shorthand keys | yes, unless another entry handles the same action (merge by hand) |
| SYG505 | warn | `ACTION: { EVENTS: event('TYPE', (state, data) => payload) }` | `ACTION: emit('TYPE', fn)`, `{ …, ...emit('TYPE', fn) }`, and a raw `EVENTS: s => ({ type: 'TYPE', data })` with a static type | yes (emit forms; raw arrows with an expression body) |
| SYG506 | warn | `CHILD.select(ChildFn)` | `CHILD.select('ChildName')` (breaks under minification) | yes, when a binding with that name is in scope |
| SYG507 | info | `.context` for top-down data | a component that receives prop `p` and passes it on unchanged to its own child component (`<A>` → `<X>` → `<Y>`, 3 levels) | no |
| SYG508 | warn | a routed request, `LOAD: { HTTP: (state) => ({ url, ok: 'LOADED', error: 'FAILED' }) }` | `X.select('c')` / `X.errors('c')` in an intent when the same component's model sends sink `X` an object with `category: 'c'` (or driverFromAsync's `selector` property) and no `ok`/`error`, and `X` is a routing driver: `makeFetchDriver()`/`driverFromAsync()`/`makeSocketDriver()` under that key somewhere in the scanned files, or `HTTP` not registered as another `…Driver()` | no |

`--fix` adds `event` to the file's existing `import { … } from 'sygnal'` when a rewrite needs it (and skips the rewrite when there is no such import, or `event` is bound to something else), and removes an `emit` import the rewrite left unused. It re-checks after every pass; running it again changes nothing. Review the diff: it rewrites source files in place.

The runtime has a matching opt-in strict mode for the rules it can detect reliably (SYG501, SYG502, SYG504): `import { configureStrict } from 'sygnal/diagnostics'; configureStrict(true)`, or `renderComponent(C, { strict: true })` in tests.

### What counts as a component

A component is any function that gets an `.intent`, `.model`, `.initialState`, `.context` or `.calculated` assignment (or `Object.assign(X, {…})`). That covers function declarations, `const X = () => …`, `const X: Component<…> = function …`, `export default X`, and components declared inside other functions.

### Known limits

- Only the `DOM` source name is recognized (`DOMSourceName` overrides aren't).
- Selectors under `DOM.select('document' | 'body')` aren't checked, since they're page-wide by design.
- SYG105 only sees the files you scan. Check the whole app (`src`), not one folder of it.
- Classes added outside JSX (`innerHTML`, third-party widgets, `element.classList`) are invisible. An `innerHTML` prop or a `{...spread}` on an element makes the component's checks fall back to info.

## App graph (`--graph`)

`--graph` answers "what is this app's structure, and what's wrong with it?" in one result. `--graph --json` prints an `InspectGraph`: the same shape the runtime produces (`inspect()` from `sygnal/diagnostics`, `getDevTools().inspect()`, `renderComponent(...).inspect()`). The JSON Schema is [`schema/inspect.schema.json`](schema/inspect.schema.json) (`sygnal-check/schema/inspect.schema.json`), and the TypeScript type is `InspectGraph`, exported from `sygnal` and `sygnal/diagnostics`.

```jsonc
{
  "version": 1,
  "source": "static",
  "components": [{
    "name": "RootComponent", "id": "src/RootComponent.jsx:12", "parentId": null,
    "file": "src/RootComponent.jsx", "kind": "root",
    "actions": [{ "name": "ADD_LANE", "trigger": "intent", "sinks": ["STATE"] }],
    "stateKeys": ["lanes", "dragging", "draggingLane", "nextId"], "calculated": [],
    "contextProvides": ["draggingTaskId", "draggingLaneId"], "contextConsumes": [],
    "eventsEmitted": [], "eventsSelected": ["DELETE_LANE"],
    "children": [{ "name": "LaneComponent", "via": "collection", "from": "lanes" }],
    "selectors": [{ "selector": ".add-lane-btn", "events": ["click"], "matched": true, "isolationHit": null }],
    "diagnostics": []
  }],
  "events": { "DELETE_LANE": { "emitters": ["LaneComponent"], "selectors": ["RootComponent"] } },
  "diagnostics": []
}
```

| Field | Static (`--graph`) | Runtime (`inspect()`) |
|---|---|---|
| `id` / `parentId` | `file:line` of the definition / `null` (see the parents' `children`) | instance number / the parent instance |
| `kind` | `root` when no scanned component renders it, else how it's first rendered | how the instance was created (`child` = by tag) |
| `actions[].trigger` | `intent`, `builtin` (BOOTSTRAP/INITIALIZE/DISPOSE/READY), `routed` (an `ok`/`error` literal in a request, or a `connections` name), `next` (a `next('X')` literal), else `unknown` | the same; `routed` = named by a request the instance was seen sending; `next` = a model-only action whose STATE reducer was seen running. The core adds `INITIALIZE` to every model |
| `stateKeys` | `initialState` keys | current state keys |
| `contextConsumes` | context fields the view reads | `null` |
| `children[].via` | `tag`, `collection` (with `from`), `switchable`, `slot` (passed into a child as children/slots) | `tag`, `collection`, `switchable`, plus `count` |
| `selectors[]` | intent DOM selectors; `matched`/`isolationHit` from SYG110/SYG104 (`null` for `document`, dynamic selectors) | real DOM: what the DOM checks saw, `events: null`; `renderComponent`: matched against the mock DOM, with event types |
| `diagnostics` | the rule findings (strict ones with `--strict`), with `file`/`line`/`column` | collected diagnostics, by component name |

Without `--json`, `--graph` prints a compact per-component summary.

## Explaining a code

```
$ sygnal-check explain SYG104
SYG104: Intent selector crosses an isolation boundary
  severity: warn
  reported by: the 'sygnal/diagnostics' dev checks, the Sygnal runtime, sygnal-check
  …explanation…
  Fix:
    …
  https://sygnal.js.org/reference/errors#syg104
```

`explain` accepts `SYG104`, `syg104` or `104`; `--json` prints the entry as JSON, and `explain --all [--json]` prints every code. The table covers every code Sygnal reports (runtime, dev checks and static), lives in `src/explanations.js`, and is published as [`explanations.json`](explanations.json) (`import 'sygnal-check/explanations.json'`). It is the source of the docs' error reference page. A drift test keeps it in sync with the runtime registry; after editing the table, regenerate the JSON with `node bin/sygnal-check.js explain --all --json > explanations.json`.

## MCP server

`sygnal-check mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio, so an agent can call the checker as tools. Paths are resolved against the server's working directory (start it in the project root); the default is `["src"]`.

| Tool | Arguments | Returns |
|---|---|---|
| `check` | `{ paths?: string[], strict?: boolean }` | `{ diagnostics, summary: { error, warn, info } }` |
| `graph` | `{ paths?: string[], strict?: boolean }` | the `InspectGraph` |
| `explain` | `{ code: string }` | `{ code, title, severity, staticSeverity?, strict, reportedBy, explanation, fix, docsUrl }` |

Results come back as `structuredContent` and as JSON text. A bad path or an unknown code is a tool result with `isError: true`.

Claude Code (from the project root):

```bash
claude mcp add sygnal-check -- npx sygnal-check mcp
```

Any MCP client that takes a JSON config (`.mcp.json`, Claude Desktop, Cursor, …):

```json
{
  "mcpServers": {
    "sygnal-check": { "command": "npx", "args": ["--no-install", "sygnal-check", "mcp"] }
  }
}
```

The server is a minimal hand-written JSON-RPC 2.0 implementation (initialize, ping, tools/list, tools/call; protocol versions 2025-06-18, 2025-03-26 and 2024-11-05), so it adds no dependencies.

## How an agent should use inspect, check and explain

1. **Orient with the graph before editing.** Run `sygnal-check --graph --json` (or the `graph` tool) on `src`. It lists every component with its actions and what triggers them, its state keys, context, EVENTS traffic, children and DOM selectors. Use it instead of reading every file to find where an action, event or child lives.
2. **Make the change, then check.** Run `sygnal-check` (or the `check` tool) on `src`, not one folder: SYG105 (EVENTS) and SYG104 (child components) need the whole app. Add `--strict` to keep new code in the canonical forms. Treat every `warn` as a bug to fix. `info` findings are hints that need a judgment call.
3. **Look up any code you don't know.** Use `sygnal-check explain SYGnnn` (or the `explain` tool) for what triggers the code, why it fails silently, and the fix. Don't guess from the code number.
4. **Verify at runtime in a test.** With `import 'sygnal/diagnostics'` in the test (or in vitest `setupFiles`), use `const t = renderComponent(App)`. Drive it with `t.simulateEvent('.btn', 'click')`, then call `t.expectNoDiagnostics()`. Call `t.inspect()` to get the same graph for the rendered tree, with real instances, which selectors actually matched rendered elements (`matched`, `isolationHit`), which EVENTS were emitted, and the runtime diagnostics. In a running dev app (Vite plugin, diagnostics on), `window.__SYGNAL_DEVTOOLS__.inspect()` returns the live graph.
5. **Read the graph's red flags.** Look for:
   - a selector with `matched: false`, which means the action never fires (fix the class, or handle it in the child named by `isolationHit`);
   - an action with `sinks: []` (no model entry), or with trigger `unknown` and no `next()` call to it;
   - an `events` entry with no emitters or no selectors;
   - a non-empty `diagnostics` array.

## Suppressing a finding

Put a comment on the same line or on the line above:

```js
// sygnal-ignore SYG110
CLOSE: DOM.click('.injected-by-widget'),
OPEN: DOM.click('.other'), // sygnal-ignore
```

Without codes, the comment suppresses every code on that line.

## Programmatic API

```js
import { check } from 'sygnal-check'

const diagnostics = check(['src'], { cwd: process.cwd() })
// [{ code, severity, component, message, fix, docsUrl, text, data?, file, line, column }]
```

This is the runtime `Diagnostic` shape plus `file`, `line` and `column` (1-based), without `timestamp`.

`check(inputs, options)` takes:

- `inputs`: a path, directory or glob, or an array of them.
- `options.cwd`: the base for relative inputs and reported paths.
- `options.ignore`: codes to drop, e.g. `['SYG105']`.
- `options.includeTests`: also scan test and spec files.
- `options.strict`: also run the strict-mode rules (SYG501-507).

- `options.rules`: a custom rule list.

`fixFiles(absPaths, { cwd })` applies the `--fix` rewrites in place and returns `{ fixed, files, passes }`. A strict diagnostic that can be fixed mechanically carries its text edits on a non-enumerable `edits` property (`[{ file, start, end, text }]`).

`graph(inputs, options)` returns the [app graph](#app-graph---graph) (`InspectGraph`). It takes the same options as `check()`. `buildGraph(project, diagnostics)` does the same for an already built project. `validateSchema(schema, value)` is the small JSON Schema validator the tests use.

`getExplanation(code)`, `listExplanations()`, `formatExplanation(entry)` and the raw `EXPLANATIONS` table back `explain`. The MCP server lives in `src/mcp.js` (`createMcpServer({ cwd }).handle(message)`, `runMcpServer({ stdin, stdout, cwd })`).

For tooling, `buildProject(files)` returns the intermediate project model the rules query: components, intents, models, view classes and ids, child usages, collections, and events.

## Writing a rule

Each rule is a module in `src/rules/` that is registered in `src/rules/index.js`:

```js
export default {
  id: 'my-rule',
  codes: ['SYG1xx'],
  description: '…',
  run(project, report) {
    for (const comp of project.components) {
      report({ code: 'SYG1xx', component: comp.name, file: comp.file, node: comp.node, message: '…', fix: '…' })
    }
  },
}
```

Strict-mode rules go in `src/rules/strict/`, with `strict: true`; a report may carry `edits: [{ file, start, end, text }]` (absolute path, source offsets) for `--fix`. Every code must exist, with the same title, in Sygnal's runtime registry (`src/extra/diagnostics/codes.ts`). `test/codes.vtest.js` enforces this.

## Development

```bash
cd sygnal-check && npm install && npm test
```

Tests are named `*.vtest.js` so that the repo root's config-less `vitest run` doesn't pick them up.
