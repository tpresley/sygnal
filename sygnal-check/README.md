# sygnal-check

A static checker for [Sygnal](https://sygnal.js.org) apps. It finds the string-wiring bugs that fail silently at runtime: an intent selector that matches nothing, an intent action with no model entry, an EVENTS type nobody listens to, and similar.

```bash
npx sygnal-check                 # checks ./src
npx sygnal-check src/components  # files, directories or globs
npx sygnal-check "src/**/*.tsx" --json
npx sygnal-check --graph --json  # the app graph: components, actions, events, selectors, findings
npx sygnal-check --graph=html    # the app graph as an interactive page (--watch: live)
npx sygnal-check explain SYG104  # what a diagnostic code means and how to fix it
npx sygnal-check mcp             # MCP server (stdio) with check, graph and explain tools
npx sygnal-check lsp             # language server (stdio) for editors
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
| `--json` | Print an array of diagnostics (see [JSON output](#json-output)) |
| `--fail-on=warn\|error\|never` | Exit with code 1 when a diagnostic at this level or above exists. The default is `warn`. Info never fails the run |
| `--verbose` | Also print info-level findings |
| `--include-tests` | Also scan `*.test.*` / `*.spec.*` files found through directories or globs (skipped by default; a file named explicitly is always scanned) |
| `--strict` | Also run the strict-mode canonical-form rules (SYG501, SYG503-508, see [Strict mode](#strict-mode)) |
| `--a11y=<level>` | Severity of the [a11y lane](#accessibility-syg7xx) (SYG701-708, 722, 724, 730, 731): `warn` (default, also with `--strict`) or `error` |
| `--fix` | Apply the mechanical canonical-form rewrites in place, then check (implies `--strict`) |
| `--controls` | With `--fix` (implied): also convert single-class intent selectors into [controls](#controls) |
| `--keep-classes` | With `--controls` (implied): keep every converted class on its element |
| `--graph[=<format>]` | Print the [app graph](#app-graph---graph) instead of the findings list. Formats: `text` (the default), `json` (the same as `--graph --json`), `html` (an [interactive page](#the-graph-page---graphhtml)) and `mermaid` (a [flowchart](#mermaid---graphmermaid)). Exits 0 (findings are part of the graph). Combines with `--strict`, not with `--fix`; `--json` with `html` or `mermaid` exits 2 |
| `--out <file>` | With `--graph` (any format): write the output to this file. For `html`, the page isn't opened unless `--open` is given |
| `--open`, `--no-open` | With `--graph=html`: open the page in the default browser, or don't. It never opens when `CI` is set or stdout is not a terminal |
| `--editor <name>` | With `--graph=html`: where the page's file links open by default: `vscode` (the default), `cursor`, `windsurf`, `idea` or `none` |
| `--watch` | With `--graph=html`: serve the page live and update it on every save (see [Live](#live---watch)). Not with `--out` or `--base` |
| `--poll[=<ms>]` | With `--watch`: look for changes every `<ms>` milliseconds (20 to 60000, default 200) instead of file-system events |
| `--port <n>` | With `--watch`: listen on this port (default: a free one) |
| `--events=false` | With `--graph=mermaid`: leave out the EVENTS edges |
| `--base <ref>` | With `--graph` (any format): compare the app graph with a git ref (branch, tag or commit), read with git, no checkout. See [Comparing with a git ref](#comparing-with-a-git-ref---base) |
| `--config <file>` | Read this JSON [config file](#configuration) instead of looking for `sygnal-check.config.json` / the `package.json` key (also `--config=<file>`; a missing file exits 2) |
| `--no-config` | Ignore config files: flags and defaults only |

Flags override the [config file](#configuration). With no paths on the command line, the config's `paths` are checked (else `src`).

Exit codes: `0` clean, `1` findings at or above `--fail-on`, `2` usage error (bad option, no files, unknown code for `explain`).

Subcommands: [`sygnal-check explain <code>`](#explaining-a-code) and [`sygnal-check mcp`](#mcp-server).

## Configuration

Put the project's settings in `sygnal-check.config.json` at the project root, so the CLI, the MCP server, the editor and the [Vite plugin](https://sygnal.js.org/integration/bundler-config/) all check with them:

```json
{
  "strict": true,
  "a11y": "error",
  "ignore": ["SYG105"],
  "paths": ["src", "pages"],
  "includeTests": false
}
```

Or under the `"sygnal-check"` key of `package.json`:

```json
{
  "name": "my-app",
  "sygnal-check": { "strict": true }
}
```

| Key | Type | Default | |
|---|---|---|---|
| `strict` | boolean | `false` | Also run the [strict-mode](#strict-mode) rules (`--strict`) |
| `a11y` | `"warn"` \| `"error"` | `"warn"` | Severity of the [a11y lane](#accessibility-syg7xx) (`--a11y`) |
| `ignore` | string[] | `[]` | Codes to drop entirely, e.g. `["SYG105"]` |
| `paths` | string[] | `["src"]` | Files, directories or globs to check when none are given, relative to the config file |
| `includeTests` | boolean | `false` | Also scan `*.test.*` / `*.spec.*` files (`--include-tests`) |
| `replyKeys` | array, or object of arrays | none | Request keys a custom driver replies with (`makeReplies()`), beside `ok` / `error` / `progress`: `["cancelled"]` for every sink, or `{ "UPLOAD": ["progress", "cancelled"] }` per sink. Their actions are triggers for SYG102 and checked by SYG112. Without it, a request key the checker doesn't know whose value names a model entry (`cancelled: 'UP_CANCELLED'`) makes that entry's SYG102 info, with this setting as the fix |

`$schema` is allowed and ignored. Settings are taken from, highest first:

1. explicit options: command-line flags, the API's options, the MCP tools' arguments, editor settings, the Vite plugin's `check` options;
2. `sygnal-check.config.json`;
3. the `"sygnal-check"` key in `package.json`;
4. the defaults above.

The project root is found from the working directory upwards: the first directory with a `sygnal-check.config.json` or a `package.json`. The search stops there, so a config file above the nearest `package.json` is never used. If that directory has both the file and the `package.json` key, the file wins and an info finding says the key is ignored. An explicit option replaces the config's value (an `ignore` list is not merged).

The config is JSON only; sygnal-check never runs a JS config. Mistakes are findings on the config file, never crashes: an unknown key or a value of the wrong type is a SYG900 warning with a "did you mean" (the value is ignored), and malformed JSON is one SYG900 finding at the parser's position (the file is then ignored and the defaults apply).

## Rules

The codes are the same as Sygnal's runtime diagnostics (`https://sygnal.js.org/reference/errors#sygNNN`).

| Code | Severity | Finds |
|---|---|---|
| SYG256 | warn | A same-action STATE literal field write makes an output's simple field comparison or boolean guard return imported `ABORT`. Only on an installed Sygnal 7+, where every non-STATE sink gets the committed state; silent on 6.x and when the installed version is unknown. Retains STATE branch conditions and skips guards already known to reject before STATE, behaviors, calculated state and ambiguous writes; a call inside another field's value (`edit: { ...s.edit, [keyOf(s)]: data }` beside `dirty: true`) doesn't hide the literal write, a call anywhere else in the reducer or any assignment does. Use `previousState` for admission guards and updated state for payloads; keep the output guard because STATE's `ABORT` does not cancel other sinks. No autofix. |
| SYG454 | warn | A component given a dynamic `byId()` selection without a `key`. Only on an installed Sygnal 6, where the binding is fixed at mount (Sygnal 7 remounts on a changed target); silent when the installed version is unknown. |
| SYG258 | warn | A STATE reducer calls `Date.now()`, `new Date()` with no arguments, `Math.random()` or `crypto.randomUUID()` (also through `globalThis.`/`window.`/`self.`) directly in its body, so replaying its actions can give a different state. Take `now()`, `random()`, `uuid()` from the reducer's 4th argument: `ADD: (state, title, next, { now, uuid }) => …`. Nested functions, views and intents are not checked. Under `--strict` it is reported as SYG509 instead. |
| SYG110 | warn | An intent selector (`DOM.select('.x')`, `DOM.click('.x')` or any other shorthand) whose class or id the component's own view never renders. The view is read from static `className`/`class`/`id` strings, `classes()`/`clsx()` calls, template literals, `+` concatenation, conditionals, `[..].join(' ')`, local and module-level consts, module-level render helpers, `h()` and hyperscript helpers, and the `className` of `<Collection>`/`<Switchable>`. The fix suggests the closest class the view does render. The finding is downgraded to **info** when a dynamic className (e.g. `` `tab-${kind}` `` or `props.className`) might produce the class, or when the selector itself isn't a static string. |
| SYG111 | warn | A controlled field: an `<input>`/`<textarea>`/`<select>` whose `value` (or a checkbox/radio whose `checked`) is bound to an expression, while the component's intent has no `input`/`change`/`keyup`/`keydown` listener on that element or an ancestor (a `keydown`/`keyup` listener that is immediately filtered on a key, such as Enter, doesn't count; `processForm` counts). Sygnal writes the bound value back on every render, so a re-render while the user types resets the text. Fix: update the state on `input`, or drop the `value` prop and read the value on blur/submit. A **literal** `value` on a text-like field (`value=""`, `value="default"`) or a literal `checked` on a checkbox/radio is reported too, since Sygnal controls literals as well: every re-render resets the field to the literal. Fix: drop the prop (uncontrolled), or move the value into state and update it on `input`/`change`. Stays quiet for readOnly/disabled/hidden/file fields, a `<select>` with a literal `value`, `value={null}`, dynamic selectors, and DOM selectors handed to helpers. |
| SYG104 | warn | The class or id is rendered, but only inside a **child** component, i.e. in the child's JSX, in JSX passed into it as children or slots, or in a `<Collection of={X}>`/`<Switchable of={{…}}>` child, resolved through imports. Child components are isolated, so the parent never sees those events. The same for a control (`DOM.click(Remove)` where only a child renders `<Remove>`). |
| SYG101 | warn | An intent action with no model entry. `'ACTION \| SINK'` shorthand keys are expanded first. |
| SYG117 | warn | A string literal `next('X')` in a model (a module-level reducer it references, or a helper it passes `next` to: `advance(state, next)`, imported or not, 3 calls deep, reported in the helper's file) where the same component has no model entry `X`: `next()` reaches only its own component, so the action does nothing. When a component that renders it (or one above) has the entry, the message names it and the fix is to send the action up with `PARENT` (read with `CHILD.select`) or `EVENTS`; otherwise did-you-mean with a rename fix. Not reported for a model with spreads, an unresolved behavior, or a behavior's own actions. The dev checks report the same at run time. |
| SYG102 | warn | A model entry nothing can trigger: no intent action, not a built-in (`BOOTSTRAP`, `INITIALIZE`, `DISPOSE`, `READY`; `HYDRATE` is an ordinary action since 6.0), never named as a reply action (`ok: 'X'` / `error: 'X'` returned by a driver sink), a `connections` entry (`message`/`open`/`close`/`error`) or a timer action (`{ every: 100, action: 'TICK' }`, `{ frame: 'FRAME' }` in a `timers` static), never the target of a `next('X')` string literal (also in a helper the model passes `next` to, imported or not; a helper the checker can't read makes the findings info), and not an `agent.actions` key. An LLM request's `delta` / `tool` keys name reply actions too, also when a local helper builds the request. This is downgraded to info when the model calls `next()`, or a request names its action, with a non-literal name. |
| SYG112 | error | A request names a reply action the component has no model entry for, so the reply is dropped: a string literal `ok`/`error` in an object a driver sink returns (`HTTP: (s) => ({ url, ok: 'LOADED', error: 'FIALED' })`; not STATE/EFFECT/EVENTS/PARENT/READY), in a const the sink returns (`HTTP: () => SNAP`), or in an object argument of a call the sink returns (`req('/a', { ok: 'GOT' })`, `api.get_run(args, { ok: 'RUN' })`: any callee, when the object has a reply key), a `message`/`open`/`close`/`error` name in a `connections` static (specs and `events` maps in consts are followed), or a timer action in a `timers` static. The `ELEMENT` sink's options (`block: 'nearest'`) are not reply names. The fix names the closest model key. Only UPPER_SNAKE_CASE names, or names close to a model key, are reported (a custom driver's `error: 'Not found'` field is data). |
| SYG105 | warn | An EVENTS type that is selected (`EVENTS.select('X')`) but never emitted, or emitted (`emit('X')`, `event('X')`, or `{ type: 'X' }` returned from an `EVENTS` sink) but never selected, anywhere in the scanned files. Only string literals are matched. This is downgraded to info when non-literal emits or selects exist. |
| SYG110 (control) | warn | The intent listens to a [control](#controls) (`DOM.click(Add)`) that the component's view never renders as `<Add>`. |
| SYG124 | error | A component passed where a control or selector is expected: `DOM.click(TodoItem)`, `DOM.select(Badge)`. A component is a function or class with statics, or a capitalised function. The fix names both ways out: `PARENT` + `CHILD.select(TodoItem)`, or a parent-owned control around the child. |
| SYG125 | error | A control given `.intent`, `.model` or `.initialState` (`Add.intent = …`, `C.Add.model = …`, `Object.assign(Add, {…})`). Controls are elements, not components. |
| SYG126 | info | A component renders a control its intent never listens to (also counts `DOM.select('document').select(Add)`) and its model sends no element command to (`ELEMENT: { showModal: HelpDialog }` uses the dialog). Not reported when the intent can't be read statically. |
| SYG128 | error | Two `controls()` calls in one file declare the same key, or one call repeats a key: both render `data-control="Key"`. |
| SYG127 | error | A [behavior](#behaviors) `uses` entry the core skips (an object literal, an uncalled factory: `uses = { pager }`), a `uses` key the component's `initialState` already has, or an option the behavior never reads (a typo: `pager({ nxt: Newer })`, with the closest option suggested). |
| SYG226 | warn | `undoable(model, { track, resetOn })` or `undo({ track, resetOn })` names an action with no model entry (for `undo()`, the host's actions, including other behaviors' `'pager.NEXT'`). |
| SYG302 | info | `import xs from 'xstream'` (a default import). xstream is CommonJS; under Node ESM and Vite 8 in a `"type": "module"` package the default import is the module object, so `xs.create` is undefined. Use `import { xs } from 'sygnal'`; `--fix` rewrites an import whose only specifier is the default one (into the file's existing `import { … } from 'sygnal'` when there is one). |
| SYG422 | error | A literal timer spec in a `timers` static that `makeTimerDriver()` can't run: `every` not a positive number (`0`, `-5`, `NaN`), a negative `after`, both `every` and `after`, neither, no or an empty `action`, a `frame` that isn't an action name. Values computed from state are left to the runtime. |
| SYG640 | warn | An element command (`ELEMENT: { focus: Email }`, a literal command object) whose target control, or static class/id selector, the sending component's view never renders, or renders only inside a child component: a command reaches only its sender's own elements. |
| SYG641 | error | The method (first key) of a literal element command: a slip of a documented command (`focus`, `blur`, `select`, `click`, `scrollIntoView`, `showModal`, `show`, `close`, `showPopover`, `hidePopover`, `togglePopover`) or of the control's spec `commands` (`{ fokus: Email }`: did you mean 'focus'), or a method that changes the DOM Sygnal renders (`remove`, `append`, `setAttribute`...). Other element methods (`play`, `requestSubmit`, a custom element's own) are fine. |
| SYG643 | warn | A component declares `timers`, `connections` or `resources`, and the app's `run(App, drivers)` call renders it but registers no `makeTimerDriver()`, `makeSocketDriver()` or `makeFetchDriver()`. Only when the `run()` call is in the scanned files and its drivers are an object literal the checker can list (a driver from a package, a spread or a local driver that may wrap one makes it say nothing). |
| SYG609 | warn | A model entry sends to a sink (`HTTP`, `WS`, any name the core doesn't handle) of a component that the app's `run(App, drivers)` call renders, and that call registers no driver under that name, so every value sent there is dropped (`renderComponent()` fakes the sink, so tests pass). Only when the `run()` call is in the scanned files and its drivers are an object literal (or absent); `STATE`, `EFFECT`, `EVENTS`, `PARENT`, `READY`, `DOM`, `CHILD`, `ELEMENT`, `PERSIST` and `LOG` need no driver. |
| SYG129 | warn | `CHILD.select(TaskRow)` in a component whose view doesn't render `TaskRow`, while a component it renders does (a grandchild, e.g. a Collection item inside a child): `PARENT` reaches only the direct parent, so it never fires. The message names the chain and the fix relays the value through the component in between. Quiet when the view renders it itself, mentions it some other way, or has a Collection/Switchable target the checker can't resolve. |
| SYG170 | warn | A component reads `context.x` (view or reducer) that neither it nor any component above it has in its `.context`, so it is `undefined`. Reported only when every way up ends at a `run()` / `defineElement()` entry; quiet for a root nothing scanned starts, a Vike page, JSX passed into another component, or a `.context` it can't read. Names the chain and a near-miss field. |
| SYG171 | warn | A component's model sends to `PARENT`, but none of the components that render it reads `CHILD.select(It)`, so the value goes nowhere. Quiet when no scanned component renders it (catalog parts, `defineElement()` elements), when it is passed into another component, when any intent selects it (SYG129 for the wrong level), or when a parent's intent can't be read fully (`uses`, a sources rest pattern, `CHILD` passed to a helper). |
| SYG405 | error | A component with an `initialState` (and no `isolatedState = true`) that a view renders, reported at the `initialState`: it would replace the state its parent passes in, and the runtime throws for a tag (`<Stopwatch state="stopwatch" />` or `<Stopwatch />`). A **warning** when it is a Collection item or Switchable target (the runtime warns). |
| SYG401 | warn | `<Collection from="x">` where `x` isn't a key of the component's `initialState` (or `calculated`), or its initial value is a literal that isn't an array. This is only checked when `initialState` is statically known. |
| SYG150 | warn | An `agent.actions` key (`sygnal/ai`) with no model entry and no behavior action of that name: every agent call dispatches an action nothing handles. Suggests the closest model entry. Only literal declarations and models (no spreads). |
| SYG151 | warn | A misspelled agent static on a component: `agents`, `tools`, `Agent`, ... ("did you mean `agent`?"). The agent layer reads only `agent`. |
| SYG152 | warn | An LLM request (an object a sink returns with `messages`, no `url`, no `abort`) without an `ok` reply action: the finished reply only arrives as `ok`. Requests built by a local helper are followed; a request with a spread is not reported. |
| SYG153 | warn | A WebMCP form attribute written as a bare JSX attribute: `toolname` / `tooldescription` / `toolautosubmit` on a `<form>`, `toolparamdescription` on any element. The pragma makes it a DOM property; write `attrs-toolname="..."`. |
| SYG240 | error | An `agent.actions` entry's `input` with no Standard JSON Schema form: a Valibot schema not wrapped with `toStandardJsonSchema()`, a Zod Mini schema, or a raw JSON Schema object not wrapped with `jsonSchema()` (followed through consts and imports). The runtime leaves the tool out. |
| SYG243 | warn | A `Date` in an `input` (`z.date()`, `z.coerce.date()`, `v.date()`, ArkType `'Date'`): JSON can't carry it. Use an ISO string schema. |
| SYG440 | warn | Two `agent` declarations with the same tool-name prefix (`agent.name`, else the component name) where one component renders both. |
| SYG441 | warn | A Collection item component with an `agent` whose items have no `id`: an object literal without `id` in the parent's `initialState` array, or appended by its model (`[...state.todos, { text }]`). |
| SYG162 | error | A `defineCatalog({...})` part (`sygnal/ai`) with neither `component` nor `render`: it renders nothing. The catalog checks run on literal declarations (an object literal, or a `const` bound to one in the same module) with `defineCatalog` imported from `sygnal` / `sygnal/ai`. |
| SYG161 | error | A catalog container whose `render` is a component with `.model`, `.intent`, `.initialState` or `.uses` (followed through imports, or `defineComponent({ model })`): it is called as a view, its model never runs. |
| SYG450 | warn | A part's or container's `in` naming an unknown container, an unknown slot (`'tabs:setings'`) or the built-in `row`; a container `min` / `max` that isn't a non-negative integer, `min` above `max`, `accepts` other than `'leaves'`. Quiet when the containers can't all be listed (a spread). |
| SYG250 | warn | A part's `companions` entry that is not a part of the catalog (or the part itself). |
| SYG253 | warn | A misspelled key in a catalog, part, container or param declaration (`descrption`, `compnent`, `deafult`, `maxuses`), with a rename quick fix. Other unknown keys (an app's own data) are left alone. |
| SYG254 | info | The catalog description lint: two parts whose descriptions share a phrase (two adjacent content words: "monthly revenue" on the KPI and on the chart), a part description naming one of its own param values ("over the last 12 months" on a part with a `range` param), options of two params of one part sharing a word ("all tickets" / "any priority"). Kind words (card, chart, table, ...), filler and the part's own name don't count; parts in one `group` may overlap. Printed with `--verbose`. |
| SYG680 | info | A part with a `required` text or list param and no `default`, in a catalog passed to `compose(catalog, { backend: compose.decisions(...) })` in the scanned files: the decision backend never places it (LLM-only). |
| SYG900 | warn | A file couldn't be parsed, or a rule crashed. |

### Accessibility (SYG7xx)

The a11y lane runs by default, also in the Vite plugin's dev checker. It reports **warnings**, also under `--strict`: strict mode is about canonical forms, and upgrading an existing app shouldn't fail on markup nobody touched. `--a11y=error` (`check(…, { a11y: 'error' })`, or `check: { a11y: 'error' }` in the Vite plugin, where errors open the overlay) makes them **errors**. Each rule stays quiet when it can't see enough: spread props, dynamic values, child components that might render a label or a button.

| Code | Finds |
|---|---|
| SYG701 | A click listener (`DOM.click('.card')`, `DOM.select('.card').events('click')`, or a control declared `'div'`) on a `div`, `span`, `li`, `p`, `img` or other non-interactive element with no `role` and `tabIndex`. Crosses intent and view like SYG110. Not reported when the element contains a button, link, form field or child component (a click there bubbles to the listener). |
| SYG702 | An `<input>` (not hidden/submit/reset/button/image), `<select>` or `<textarea>` with no label: no wrapping `<label>` (followed through helpers and component usages), no `<label for>` matching its id (a literal, or the same `uid('x')` call), no `aria-label`/`aria-labelledby`/`title`/`placeholder`. Names an unlinked sibling `<label>` when there is one. |
| SYG703 | An `<img>` without `alt` (`alt=""` is fine). |
| SYG704 | A click listener on an `<a>` without `href`. |
| SYG705 | A `<button>` with no text, `aria-label`, `aria-labelledby` or `title` (literal children only: `{state.label}` or a child component means no finding). |
| SYG706 | `tabIndex` greater than 0. |
| SYG707 | An `aria-*` attribute that isn't in WAI-ARIA, or a `role` that isn't a WAI-ARIA role (typos, abstract roles); `doc-*` and `graphics-*` roles are accepted. |
| SYG708 | `<label for>`, `aria-describedby` or `aria-labelledby` naming an id nothing renders. Literal ids may be rendered in any scanned file (not checked when some id is dynamic); `uid('x')` needs `id={uid('x')}` in the same file. |
| SYG730 | An intent action whose stream comes only from `mouseenter` / `mouseover` (`pointerenter` / `pointerover`) listeners, that nothing else sends (no other DOM event in the stream, `next()`, reply, connection, timer or behavior) and whose entry changes the state. Streams with local variables or other sources are skipped. |
| SYG731 | A click target whose class follows a state field (`className={{ on: state.on }}`, a conditional class) that the click's own reducer toggles (`on: !state.on`) or, for a comparison (`state.filter === 'done'`), sets, with no `aria-pressed` / `aria-checked` / `aria-expanded` / `aria-selected` / `aria-current`. Native stateful controls (checkbox, `select`, `details`, ...) are fine. |

## Strict mode

`--strict` adds one rule per row of Sygnal's canonical-forms table: code that works, but isn't written the one blessed way. Each message shows the canonical rewrite of the offending code. Without `--strict` these rules don't run.

| Code | Severity | Canonical form | Flags | `--fix` |
|---|---|---|---|---|
| SYG501 | warn | `function C({ state, context, ...props })` | a view (any component, or a function rendered as a component tag) with a 2nd/3rd parameter, i.e. the positional `(props, state, context)` arguments | no |
| SYG502 | — | retired in 6.0, never reported | since 6.0 a STATE reducer that returns the object it got means "no change", the same as `ABORT` (a mutated-then-returned state is SYG222 in the dev entry) | — |
| SYG503 | warn | `ACTION: { EFFECT: (state, data, next) => { … } }` | heuristic: a STATE reducer with a call statement whose result is unused (`cmd.send()`, `next()`, `console.log()`) on the path to a `return ABORT` | no |
| SYG504 | warn | `ACTION: { SINK: fn }` | `'ACTION \| SINK'` shorthand keys | yes, unless another entry handles the same action (merge by hand) |
| SYG505 | warn | `ACTION: { EVENTS: event('TYPE', (state, data) => payload) }` | `ACTION: emit('TYPE', fn)`, `{ …, ...emit('TYPE', fn) }`, and a raw `EVENTS: s => ({ type: 'TYPE', data })` with a static type | yes (emit forms; raw arrows with an expression body) |
| SYG506 | warn | `CHILD.select(ChildFn)` | `CHILD.select('ChildName')` (breaks under minification) | yes, when a binding with that name is in scope |
| SYG507 | info | `.context` for top-down data | a component that receives prop `p` and passes it on unchanged to its own child component (`<A>` → `<X>` → `<Y>`, 3 levels) | no |
| SYG508 | warn | reply actions, `LOAD: { HTTP: (state) => ({ url, ok: 'LOADED', error: 'FAILED' }) }` | `X.select('c')` / `X.errors('c')` in an intent when the same component's model sends sink `X` an object with `category: 'c'` (or driverFromAsync's `selector` property) and no `ok`/`error`, and `X` is a reply-action driver: `makeFetchDriver()`/`driverFromAsync()`/`makeSocketDriver()` under that key somewhere in the scanned files, or `HTTP` not registered as another `…Driver()` | no |
| SYG509 | warn | `now()` / `random()` / `uuid()` from the handler's 4th argument: `SAVE: { EFFECT: (state, data, next, { now }) => … now() … }` | `Date.now()`, `new Date()` with no arguments, `Math.random()`, `crypto.randomUUID()` called directly in a model handler (STATE, EFFECT, another sink, an `event()` payload); replaces the default-mode SYG258 under `--strict` | yes, in JavaScript handlers whose 4th parameter is missing, a name or a destructuring pattern (no rest parameter, no name it would shadow) |

`--fix` adds `event` to the file's existing `import { … } from 'sygnal'` when a rewrite needs it (and skips the rewrite when there is no such import, or `event` is bound to something else), and removes an `emit` import the rewrite left unused. It also deletes the SYG612 statics that only need deleting (`storeCalculatedInState`, a source name set to its default). It re-checks after every pass; running it again changes nothing. Review the diff: it rewrites source files in place. Each rewrite is also in the finding's `fixes` (marked `fixAll`, see [JSON output](#json-output)), so an editor applies the same edits.

The runtime has a matching opt-in strict mode for the rules it can detect reliably (SYG501, SYG504): `import { configureStrict } from 'sygnal/diagnostics'; configureStrict(true)`, or `renderComponent(C, { strict: true })` in tests.

### Controls

A control comes from `controls({ Key: 'tag' })` (`import { controls } from 'sygnal'`) and renders its element with `data-control="Key"`; anywhere a selector is accepted, it resolves to `[data-control="Key"]`. The checker follows controls declared as `const { Add } = controls({…})`, `const C = controls({…})` (used as `<C.Add>` / `DOM.click(C.Add)`), and imported from a relative module, including `export { Add } from './controls'` and `export * from './controls'` re-exports. A control tag renders in the component's own scope (it is not a child component), and a control in a template-string selector (`` `li ${Done}` ``) counts as listened to.

`--fix --controls` (or `--controls`) converts a selector such as `DOM.click('.add')` into a control when the class is on exactly one intrinsic element of the component's own view as a static `className` string, and nowhere else: no other element (or dynamic className, spread, `<Collection className>`) that might produce it, no child view, no JSX passed in, and no other selector in the project (compound, `document`/`body`). It adds the key (the class in PascalCase, numbered when the name is taken) to the file's `const { … } = controls({ … })` or adds one after the imports, replaces the tag and every `'.add'` selector of that intent, and adds `controls` to the file's `import { … } from 'sygnal'`. The class stays on the element when a CSS/SCSS/Less/HTML file in the project mentions `.add`, a string in another source file does (a test's `simulateEvent('.add', …)`), or `--keep-classes` is set. An element whose rendered markup a string asserts (`toContain('<button class="add">')`) is left alone, since the control adds `data-control` to it. Running it again changes nothing. It is opt-in: controls are an alternative form in 6.0, and class selectors stay canonical (PLAN-4 D141). `controlFixes(absPaths, { cwd, sources?, keepClasses? })` returns the same conversions one class at a time, as editor refactors located at the selector (see [Programmatic API](#programmatic-api)).

### Behaviors

A component's `uses` static (`List.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }`) is resolved to the behaviors it names: a `defineBehavior({ … })` factory in the same file or a relative module (also through re-exports and an options const), or the first-party `pager`, `selection` and `undo` from `'sygnal'`, which the checker knows. The behavior's actions join the component's under their namespaced names (`'pager.NEXT'`): SYG101 and SYG102 see them, so a host model entry `'pager.NEXT'` counts as handled and `'pager.NXT'` is SYG102 naming the behavior's actions; a behavior's `next('X')` targets and reply actions count as triggers. What its intent listens to through an option (`DOM.click(next)`, with `next: Newer` at the `uses` site) is checked like the host's own intent selectors: SYG110 when the view never renders `<Newer>`, SYG104 when only a child does, and it counts as listened for SYG126 and SYG111. A behavior intent action with no model entry (in the behavior or as `'key.ACTION'` on the host) is SYG101 at the `uses` entry. A `uses` value that calls anything else (a package's behavior, a wrapper) is opaque: nothing is reported about it, controls passed to it count as listened, and the host's model is not checked for unreachable entries. `undoable(model, options)` as a `model` is read as the model plus `UNDO` and `REDO`.

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
    "actions": [{ "name": "ADD_LANE", "trigger": "intent", "sinks": ["STATE"], "writes": ["nextId", "lanes"] }],
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
| `actions[].trigger` | `intent`, `builtin` (BOOTSTRAP/INITIALIZE/DISPOSE/READY), `reply` (an `ok`/`error` literal in a request, a `connections` name or a timer action), `next` (a `next('X')` literal), `agent` (only an `agent` declaration's action), else `unknown` | the same; `reply` = named by a request the instance was seen sending; `next` = a model-only action whose STATE reducer was seen running. The core adds `INITIALIZE` to every model |
| `stateKeys` | `initialState` keys | current state keys |
| `actions[].writes` | on actions with a STATE sink: the top-level state keys the reducer may write (`({ ...state, cart })`, `set({ a })`, `toggle('a')`, a behavior's slice); `[]` when it never changes the state; `null` when unknown (a dynamic key, another spread, a call it can't follow). `removes: true`: it may return `undefined` (removes a Collection item) | not produced |
| `stateReads` | the top-level state keys the view reads literally (`state.x`, `{ state: { x } }`, through local helpers given the state), the literal lenses it gives children (`state="user"`, `from="items"`), and its calculated / context functions' reads; `stateReadsPartial: true` when the list may be incomplete (omitted when empty / complete) | not produced |
| `contextConsumes` | context fields the view reads | `null` |
| `children[].via` | `tag`, `collection` (with `from`), `switchable`, `slot` (passed into a child as children/slots) | `tag`, `collection`, `switchable`, plus `count` |
| `selectors[]` | intent DOM selectors; `matched`/`isolationHit` from SYG110/SYG104 (`null` for `document`, dynamic selectors); `control` names a control selector (`selector` is then `[data-control="Add"]`) | real DOM: what the DOM checks saw, `events: null`; `renderComponent`: matched against the mock DOM, with event types |
| `controls[]` | the controls the view renders: `{ name, element, kind?, listened }` (omitted when none) | not produced yet |
| `uses[]` | the `uses` entries: `{ key, behavior, status }` (`resolved`, `opaque` or `invalid`; omitted when none). Behavior-owned actions are in `actions` with `behavior: key`, and what a behavior listens to through a control option is in `selectors` with `behavior: key` | not produced |
| `commands[]` | the `ELEMENT` commands the model sends: `{ action, method, target, control?, triggers? }` (literal command objects; `triggers`: the intent actions listening on the target for a native event the command causes, `close` → `DOM.close(HelpDialog)`; omitted when none) | not produced |
| `agent` | the `agent` declaration (sygnal/ai): `{ name, tools, description, read, actions: [{ name, consequential, input }], partial? }` (`tools`: the tool-name prefix; omitted when none). Actions only an agent dispatches have trigger `agent` | not produced |
| `timers[]` | the `timers` static's literal specs: `{ name, every?, after?, frame?, action?, background? }` (omitted when none). Timer actions are in `actions` with trigger `reply` | not produced |
| `recentActions` | — | with `inspect({ actions })`: the latest actions, `{ type, data, component, instance, sinks, cause, at }` |
| `diagnostics` | the rule findings (strict ones with `--strict`), with `file`/`line`/`column` | collected diagnostics, by component name |

| `key` | `file#name` (a second component of the same name in a file: `file#name#2`), stable when lines move | the same key when `sygnal/vite`'s dev server stamped the component function, else absent |
| `entry` | `true` on the components `run()`, `defineElement()` or a Vike `+Page` / `+Layout` / `+Wrapper` starts; `'unknown'` on the other roots when an entry call's component can't be resolved | `true` on an app's root instance |
| `viewOnly` | `true` on a component rendered as a tag (or started as an entry) that has no statics | the same |
| `route` / `routes` / `routeDynamic` | Vike: a `+Page`'s route (a `+Layout`'s / `+Wrapper`'s URL prefix); `routes` when several `+Page` files export one component; `routeDynamic` for a Route Function (`route: null`) | not produced |
| `children[].id` / `.ids` | `id`: the rendered component's id, resolved through the import (`null` when it isn't in the graph); also `state` (a literal lens), `external` (the package of the tag) and `widget`; `via: 'layout'` for Vike's layout → page edges | `ids`: the live instances' ids |
| `childSelects` | each `CHILD.select(Child)` in the intent: `{ child, id, actions, line, column }` (`actions`: the intent actions it feeds, the receivers of the child's `PARENT` sink) | not produced |
| `events[type].emitterIds` / `.selectorIds` | every emitting / selecting component's id (independent of the names, which are listed once each) | every instance's id |
| locations | `line` / `column` (and `file` when it isn't the component's) on actions (`modelAt`: the model entry), selectors, children, controls, commands, timers, agent actions, `contextEntries` and `eventSites`; diagnostics have `componentId` | not produced; runtime diagnostics have a `timestamp` |
| `app` / `shown` | not produced | the instance's `run()` (its root's index among the live roots); `shown: false` on a hidden Switchable page and below it |

Without `--json`, `--graph` prints a compact per-component summary.

### The graph page (`--graph=html`)

`--graph=html` writes the graph as one self-contained HTML page, `<os temp dir>/sygnal-graph-<project>.html` (`<project>` from the nearest `package.json` `name`), prints the path and opens it in the default browser. `--out <file>` writes it elsewhere and doesn't open it unless `--open` is given; nothing opens when `CI` is set or stdout isn't a terminal. The page shows the components as cards with what renders what (tag, Collection, Switchable, Vike layout), EVENTS, context and `PARENT` overlays, a health list (the findings grouped by code, plus the checks only the whole graph shows), a detail panel with line links into your editor (`--editor`), a trace of any event, context field, action or state key, search, filters, an EVENTS table, and SVG / JSON / Mermaid export. Large apps are grouped by directory and folded above 150 components.

The page loads nothing and connects nowhere (its CSP is `default-src 'none'` with inline style and script), works offline and from `file://`, and runs none of your code. It contains the graph and the project's absolute path (for editor links). The docs page [The App Graph](https://sygnal.js.org/guide/app-graph/) describes it in full.

### Live (`--watch`)

`--graph=html --watch` serves the page on `127.0.0.1` (a random port unless `--port`; a random token in the URL; the `Host` header checked), prints the URL, opens it once, and sends the page a new graph (server-sent events) after every saved change to a scanned file, a file they import or the config file. The page keeps its view, selection and trace, and marks what changed. `--poll` checks for changes on a timer instead of file-system events. Ctrl-C stops it. `sygnal/vite` serves the same live page in its dev server at `/__sygnal/graph`.

### Mermaid (`--graph=mermaid`)

`--graph=mermaid` prints a `flowchart TD`: render edges solid (Collections labelled `[from]`, Switchables `switch`), EVENTS edges dotted (`--events=false` leaves them out). GitHub renders it in a README or a pull request description inside a `mermaid` code fence. The page's Copy as Mermaid gives the same text.

### Comparing with a git ref (`--base`)

`--graph --base <ref>` compares the app graph of the working tree with the one at `<ref>` (`main`, `HEAD~1`, a tag or a commit). The base graph is built from the commit's files through git (`git ls-tree`, `git cat-file --batch`): nothing is checked out and the working tree is not touched. The same paths are scanned on both sides, test files are left out unless configured, and the base reads the config file as it is at the ref (flags still win). Components are matched by their `key` (`file#name`), so an edit that only moves a component down the file is not a change, and a renamed or moved file shows as a removal plus an addition.

```
$ sygnal-check --graph --base main
app graph: main (3f2a9c1e07) → working tree
+ New  src/New.jsx
- Old  src/Old.jsx
~ Header: +action CLOSE, +action OPEN, -action TOGGLE  src/Header.jsx
~ Item: +emits REMOVED, -emits SAVED  src/Item.jsx
EVENTS: +REMOVED
1 added, 1 removed, 2 changed
```

`--graph --json --base <ref>` prints the diff (for a CI comment), not the graph:

```json
{
  "base": "main",
  "head": "working tree",
  "commit": "3f2a9c1e07…",
  "added": ["src/New.jsx#New"],
  "removed": ["src/Old.jsx#Old"],
  "changed": [
    { "key": "src/Header.jsx#Header", "fields": { "actions": { "added": ["CLOSE", "OPEN"], "removed": ["TOGGLE"] } } }
  ],
  "events": { "added": ["REMOVED"], "removed": [] }
}
```

`added` and `removed` are component keys, sorted. A changed component lists only the fields that changed. List fields are `{ added, removed }` of strings: `actions` (names), `sinks` (`ACTION:SINK`, for actions on both sides), `stateKeys`, `calculated`, `stateReads`, `contextProvides`, `contextConsumes`, `eventsEmitted`, `eventsSelected`, `selectors` (the selector, or `control Name`), `children` (the child's key, else its name; `package:Name` for a package component; ` (collection)`, ` (switchable)`, ` (slot)` or ` (layout)` after it when it isn't a plain tag) and `diagnostics` (`CODE message`, without the line). The scalar fields `kind`, `entry` and `route` are `{ base, head }`. `events` compares the EVENTS types.

`--graph=mermaid --base <ref>` draws the working tree's graph plus the removed components, with the classes `added`, `removed` and `changed` and a `linkStyle` for the added and removed edges. `--graph=html --base <ref>` opens the page with the changes drawn on it: added components and edges in green, removed ones as faded red dashed cards in their old place, changed ones with an amber mark (a folded group shows how many of its components changed), a Changes list in the sidebar, what changed in the selected component's panel, and a "Changes only" filter.

`--base` exits 2 when the directory isn't in a git repository, the ref doesn't name a commit, or a scanned path is outside the repository. A path that doesn't exist at the ref is fine: everything in it counts as added. It can't be combined with `--watch`.

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

`sygnal-check mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio, so an agent can call the checker as tools. Paths are resolved against the server's working directory (start it in the project root); the default is the [config file](#configuration)'s `paths`, else `["src"]`. `check` and `graph` apply the config file found from that directory (re-read on every call); a tool's `strict` / `a11y` / `paths` arguments win over it.

| Tool | Arguments | Returns |
|---|---|---|
| `check` | `{ paths?: string[], strict?: boolean, a11y?: 'warn' \| 'error' }` | `{ diagnostics, summary: { error, warn, info } }` |
| `graph` | `{ paths?: string[], strict?: boolean, a11y?: 'warn' \| 'error' }` | the `InspectGraph` |
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

The server is a minimal hand-written JSON-RPC 2.0 implementation, so it adds no dependencies. It speaks both protocol eras on the same process, chosen per request:

- **2026-07-28** (stateless): no `initialize`. Each request carries `_meta["io.modelcontextprotocol/protocolVersion"]` and `_meta["io.modelcontextprotocol/clientCapabilities"]`; the server answers `server/discover`, `tools/list` and `tools/call`, with `resultType: "complete"` and its name and version in each result's `_meta`. On stdio this metadata lives only in the message body (there are no `MCP-Protocol-Version` / `Mcp-Method` headers). A client that speaks both eras probes with `server/discover` and stays on 2026-07-28.
- **2024-11-05 to 2025-11-25**: the `initialize` handshake, then `tools/list`, `tools/call` and `ping`.

A protocol version it doesn't know gets the spec's "unsupported protocol version" error (`-32022`) listing the versions it speaks; a 2026-07-28 request without client capabilities gets `-32602`.

## Language server

`sygnal-check lsp` runs a [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) server on stdio. An editor gets the checker's findings as you type, a hover with the `explain` entry for each code, quick fixes, completions for the names Sygnal wires by string, go to definition / find references for actions and EVENTS types, code lenses that say what each action does and what triggers it, highlights of the wiring (semantic tokens), and a rename that refuses when it can't find every use. It is part of the package, hand-written like the MCP server, so it adds no dependency, and it runs the same rules as the CLI: with no unsaved buffers, it reports what `sygnal-check` reports for the same settings.

**Wiring it into an editor.** Any LSP client that starts a server over stdio can run it. Use this command, from the project or with the workspace as its working directory:

```bash
npx --no-install sygnal-check lsp
```

Give it the languages `javascript`, `javascriptreact`, `typescript` and `typescriptreact`, and the workspace folder(s) as its root. The server exits when its stdin closes, so the client doesn't need to send `exit`. `createLspServer({ input, output })` in the programmatic API runs it on any pair of streams.

### Capabilities

| | |
|---|---|
| Lifecycle | `initialize`, `initialized`, `shutdown`, `exit`; `$/cancelRequest` (a cancelled request is answered with `-32800`); `$/setTrace`; other `$/` notifications are ignored |
| Workspace | the workspace folders (`workspaceFolders`, else `rootUri` / `rootPath`, else the working directory); `workspace/didChangeWorkspaceFolders`. One project per [project root](#project-roots) inside them, so a monorepo's apps are checked apart. A project whose files define no Sygnal component gets no diagnostics |
| Documents | full text sync (`didOpen`, `didChange`, `didSave`, `didClose`). Open documents are checked from their unsaved text. Closing a document re-checks it from disk |
| Diagnostics | pushed with `textDocument/publishDiagnostics` (no pull diagnostics) |
| Hover | on a finding: its code, title, explanation, fix and docs URL (Markdown, with the URL itself as the link text so editors that hide link targets still show it; plain text for clients without Markdown) |
| Code actions | `quickfix`, `refactor` / `refactor.rewrite`, `source.fixAll.sygnal` (below) |
| Definition | `textDocument/definition` on an action name or an EVENTS type ([below](#go-to-definition-and-references)) |
| References | `textDocument/references` on the same names; honours `context.includeDeclaration` |
| Completion | `textDocument/completion`, trigger characters `'` `"` `` ` `` `.` `#`; items only in Sygnal contexts ([below](#completions)) |
| Code lens | `textDocument/codeLens` on intent keys, model keys and EVENTS selects / emits ([below](#code-lens)); `workspace/executeCommand` for its jump command `sygnal.goTo`; `workspace/codeLens/refresh` when the client supports it |
| Highlights | `textDocument/semanticTokens/full` (custom token types) for action names, EVENTS types, intent selectors, the view tokens they target and selected child components; `sygnal/highlights` for the decoded tokens ([below](#highlights)); `workspace/semanticTokens/refresh` when the client supports it |
| Rename | `textDocument/prepareRename` and `textDocument/rename` for actions, EVENTS types, class / id names, state keys and context entries; refuses when it can't find every use ([below](#rename)) |
| App graph | `sygnal/graph` (params: `{ root }` (a URI or absolute path), `{ uri }` or `{ textDocument }`; none for the only root) → `{ root, version, graph }`: the InspectGraph of `--graph --json` for that project root, from the open documents as they are; then the notification `sygnal/graphChanged` `{ root, version }` after each check that changed that root's graph. The VS Code extension's App graph panel uses it |
| File watching | when the client supports dynamic registration: `**/*.{js,jsx,ts,tsx,mjs,cjs}`, `**/sygnal-check.config.json`, `**/package.json` |

**When it checks.** A check covers the whole project, because a change in one file can create or clear findings in another (EVENTS, child components, Collections). It runs in a worker thread, so hover, code actions and completions are answered while a check runs.

The server checks at once on `didOpen`, `didSave`, `didClose`, a watched-file event or a settings change. After a `didChange` without a save, it waits about 150 ms for typing to pause. A newer change replaces a check that is still waiting; it doesn't queue another one.

Files that aren't open are read from disk on every check, so a client without file watching still sees changes on disk at the next check.

### Project roots

A workspace folder can hold several Sygnal apps: a monorepo, or a repository with example apps. The server checks each app as its own project, with its own config file and `paths`.

**The rule.** A file belongs to its nearest ancestor directory, up to and including the workspace folder, that is a Sygnal project. A directory is a Sygnal project when it contains:

- a `sygnal-check.config.json`; or
- a `package.json` that lists `sygnal` or `sygnal-check` in `dependencies`, `devDependencies` or `peerDependencies`, or has a `"sygnal-check"` key.

Directories inside `node_modules`, `dist`, `build` and the other skipped directories, and dot directories, never count. When no directory qualifies, the file belongs to the workspace folder itself, so a plain folder is checked as one project.

Each root's config is the [config file](#configuration) found from the root, and its `paths` (default `["src"]`) are relative to the root. A root's check leaves out the files of roots nested inside it: each file is checked once, by its nearest root.

**When each root is checked:**

- The workspace folder's own root is checked at startup. The exception is a folder that isn't a Sygnal project itself but has Sygnal projects below it, like the Sygnal repository or a monorepo whose root `package.json` doesn't depend on Sygnal. Its root is then checked like the nested ones.
- Any other root is checked from the first time you open one of its files. After that it stays checked: changes, saves and file events inside it re-check it, even with none of its files open, until its workspace folder is removed.
- A change to a `sygnal-check.config.json` or `package.json` (seen through file watching, a save, or the next opened document) finds the roots again and re-checks every root. A directory that stops being a project hands its files back to the root above it.

A file outside every workspace folder isn't checked.

**When a file isn't checked.** The server says so once, with `window/showMessage` (Info) and a warning in its log:

- **The file is outside its project's `paths`.** This applies when the file looks like Sygnal source (it imports from `sygnal`, or sets component statics). Test files left out by `includeTests`, config files and files under skipped directories don't count. The message is said once per project and directory, for example: *examples/foo/app.tsx isn't checked: it's outside sygnal-check's paths (src) for examples/foo. Add its folder to "paths" in sygnal-check.config.json.*
- **The project's `paths` match no source file at all.** This is said once per project, when one of its files is open, for example: *sygnal-check found no source files in src for examples/todomvc; set "paths" in sygnal-check.config.json.*

A client that advertises no `window` capabilities, like Claude Code, gets the log line only.

### Diagnostics

The server pushes diagnostics only (`textDocument/publishDiagnostics`). It sends a file only when its list changed, and an empty list when a file's findings cleared. It doesn't offer pull diagnostics: an editor offered both would show each finding twice, and pulling only covers open files, which loses the findings a change causes in other files.

Each diagnostic has:

- `range`: the finding's start and end;
- `severity`: error 1, warning 2, information 3;
- `code` (`SYG110`) and `codeDescription.href` (its docs page), the latter only for clients that advertise `codeDescriptionSupport`;
- `source: "sygnal"`;
- `message` in the CLI's form, `Component: message (fix)`, so it makes sense without the link;
- `relatedInformation` for the other side of a pair or cross-file finding (`related` in the JSON output), for clients that advertise `relatedInformation`;
- `data.fixes`: the finding's fixes as LSP edits.

Each file's list is sorted errors first. Info findings are left out unless `sygnal.verbose` is set, as in the CLI.

**Incremental.** Each check after the first reuses the last one's model and per-file findings for the files the change can't affect (the changed files and the files that import them, transitively, are analyzed again; see `options.session`). On a 20k-line project a one-file edit re-checks in about 40 ms instead of 130 ms, with the same findings.

**A file that doesn't parse** (in the middle of an edit) keeps its last findings unchanged until it parses again, and the other files' findings stay as they were. The parse error itself is shown as a SYG900.

**Other findings.** A malformed or unknown key in the config file is a SYG900 on that config file. A rule that crashes is logged with `window/logMessage`, not shown as a diagnostic.

### Code actions

| Action | Kind | What it does |
|---|---|---|
| A finding's fixes | `quickfix` (or `refactor.rewrite` for a removal) | The edits from the finding's `fixes` (see [JSON output](#json-output)): "Change '.incc' to '.inc'", "Add a model entry for 'X'", a canonical-form rewrite. `isPreferred` marks a single unambiguous suggestion. An edit can be in another file |
| Suppress SYGnnn on this line | `quickfix` | Inserts `// sygnal-ignore-next-line SYGnnn` above the finding's first line, with the line's indentation. Inside JSX children it inserts `{/* sygnal-ignore-next-line SYGnnn */}` (see [Suppressing a finding](#suppressing-a-finding)) |
| Fix all auto-fixable Sygnal problems | `source.fixAll.sygnal` | What `--fix` does for the file, on its unsaved text, as one edit. Like `--fix`, it applies the strict-mode rewrites whatever the settings. Offered when `context.only` asks for `source`, `source.fixAll` or `source.fixAll.sygnal` (VS Code: `"editor.codeActionsOnSave": { "source.fixAll.sygnal": "explicit" }`), and in an invoked request without `only` (editors such as Helix never send one) when the cursor is on a finding and the file has an auto-fixable one |
| Convert '.x' to the control X | `refactor.rewrite` | The `--controls` conversion of one selector. Offered only when `context.only` asks for refactors |

Fixes are offered only while the document's text is still the one the findings were computed from. An automatic request with nothing to offer (the editor asks on every cursor move) is answered with `[]` straight from the last results.

### Completions

Completions fill in the names Sygnal connects by string, which TypeScript can't complete (in JavaScript `DOM` is `any`, so nothing completes them there today). The server returns items only at these positions. Everywhere else it answers `null` at once, so TypeScript's own completions stand alone.

| Where the cursor is | What it offers |
|---|---|
| a key of the object the intent returns | model actions nothing triggers yet |
| a key of the model object | actions that are triggered but have no model entry: intent actions, `next()` targets, reply names, `timers`/`browser`/`resources`/`connections`/`route` actions, `agent.actions`; then `BOOTSTRAP`, `INITIALIZE`, `DISPOSE` |
| the selector of `DOM.select('…')` or a shorthand such as `DOM.click('…')` | the component's own view classes (`.x`) and ids (`#x`); after a `.` only classes, after a `#` only ids |
| `EVENTS.select('…')` | EVENTS types emitted anywhere in the project |
| `event('…')` / `emit('…')` | EVENTS types selected anywhere in the project, so an emitter matches its listeners |
| `next('…')`; `ok` / `error` / `delta` / `tool` / `block: '…'` in a request a model entry returns; `action` / `frame` in `timers`, `action` / `error` in `browser`, `ok` / `error` in `resources`, `message` / `open` / `close` / `error` in `connections` | the model's actions |
| `<Collection from="…">` or `from={'…'}` | the `initialState` and `calculated` keys of the component that renders it |

Each item's `detail` says where the name comes from ("intent action · App (no model entry)", "class in App's view", "EVENTS type emitted in TodoItem.jsx"). Its `textEdit` replaces the key or the string contents being typed; for a selector, only the class or id token at the cursor. For a fresh model key (no `:` after it yet), a client that supports snippets gets `NAME: (state, data) => ({ ...state })`.

The names come from the last check, and the position from the document's current text, so a completion needs no check of its own. It also works while you type, when the file doesn't parse: an unterminated string (`DOM.click('.`), a new key without a colon, an open call, or a file cut off after the cursor. The server tries the text as it is, then with a closing suffix at the cursor (a quote, `)`, `: 0,` ...), then reads the text before the cursor on its line against the last check. Names added since the last check (about 150 ms after typing pauses) appear at the next check.

### Go to definition and references

Actions, EVENTS types, class names, state keys and context entries are strings wired by name, so TypeScript can't follow them. The server can, on these names:

- **action names:** an intent key, a model key (for a `'A | SINK'` key, its action part), a `next('X')` argument, a reply name in a request (`ok`, `error`, `delta`, `tool`, `block`, also inside `decide()`), an action named by `connections`, `resources`, `route`, `timers` or `browser`, an `agent.actions` key, a host's `'pager.NEXT'` model key, a `uses` entry key (it stands for the behavior's own actions), and in a user behavior's `defineBehavior({...})` (in its own file) its intent keys, model keys, `next()` and reply names, timer actions, plus an option naming a host action (`form(schema, { submit: 'SIGN_UP' })`);
- **EVENTS types:** an `event('X')` / `emit('X')` argument, a `{ type: 'X' }` an EVENTS sink returns, an `EVENTS.select('X')` argument, and an imported `Toaster` (it selects `TOAST` and `TOAST_DISMISS`);
- **names built from constants:** a computed key (`[ACTIONS.TICK]`), `next(PREFIX + '_DONE')`, `` next(`${PREFIX}_MORE`) ``, `EVENTS.select(SAVED)` with `SAVED` imported, when the value has exactly one definition (string literals, `+`, template literals, `const` declarations across imports, a key of a `const` object literal);
- **class and id names:** each token a view renders (`className` / `class` / `id` strings, template literal parts, `classes()` / `clsx()` arguments and object keys, both sides of `?:`, `&&` and `+`, `h('div.a#b')`, JSX in helper functions the view calls), and each `.x` / `#y` of an intent selector (`'.a .b'` is two names; a behavior option's selector too);
- **controls:** `DOM.click(Add)`, the `controls({ Add: ... })` key, and `<Add>` tags;
- **state:** `initialState` and `calculated` keys, and a Collection's `from="x"` / `from={'x'}`;
- **context:** a `.context` key, and `context.x` / `{ context: { x } }` in a view (also of a plain function rendered as a tag) or `props.context.x` in a reducer;
- **children:** the argument of `CHILD.select(Child)`, a component's name, and the `PARENT` keys of its model.

| From | Definition goes to |
|---|---|
| an intent key, `next('X')`, a reply name, a static's action name, an `agent.actions` key, a `uses` key, a trigger in a behavior definition | the model entry (or entries) handling the action in that component, the behavior definition's included |
| a model key | the intent key(s) triggering it; when no intent key does, its other triggers (`next()`, replies, statics, `agent.actions`, the `uses` key, the behavior's intent) |
| `EVENTS.select('X')` | every emitter of `X` in the project |
| an emitter of `X` | every select of `X` in the project |
| a name built from constants | as above, plus the constants' declarations |
| a selector's `.x` / `#y` | the element(s) rendering it in the component's own view (JSX passed into it included). Rendered only inside a child (SYG104): the child's element, and the trace log says so |
| a class or id the view renders | the selectors using it |
| `DOM.click(Add)` | the `controls()` key and the `<Add>` tags in the view |
| `<Add>` | the `controls()` key |
| `from="x"` | the `initialState` or `calculated` key `x` |
| an `initialState` / `calculated` key | the `from` attributes naming it |
| `context.x` | the nearest component providing `x` on each render path up from the reader (itself first); several paths give several |
| a `.context` key | the readers it reaches |
| `CHILD.select(Child)` | `Child`'s name and the `PARENT` keys of its model |
| a `PARENT` key, a component's name | the `CHILD.select()` calls listening to it |

Several targets come back as a list: a model or intent shared by components gives every component's, and `undoable()`'s `UNDO` and `REDO` point at the `undoable` call. **References** lists every occurrence of the name in its scope: an action in its component, an EVENTS type in the project, a class in the views a selector resolves to (with the selectors on them), a context entry with its providers and their readers. With `includeDeclaration: false` it leaves out the declarations: model keys, emitters, the rendered classes, `controls()` keys, state keys, `.context` keys, component names.

**Limits.** A name the checker can't read gives nothing, never a guess: a value that changes (`let`), a parameter, an intent or model with spreads. A selector whose class the view doesn't render literally gives nothing; when the view has a dynamic className that might produce it (`'tile-' + id`, `{...props}`), the trace log says so (`sygnal.trace.server` at `messages`). A token written across parts (`'a' + 'b'`) or with escapes renders but has no position. A built-in (`BOOTSTRAP`, `INITIALIZE`, ...) has no trigger to go to. A first-party behavior's actions (`pager`, `form`, ...) have no source, so they go to the `uses` key. A Collection item's `from` has no target when the item has no `initialState` (its state comes from its parent). In a file that doesn't parse, nothing navigates until it parses again.

**Freshness.** Each check also indexes these names, so a request is answered at once from the last check when the open documents are still what it checked. After an unsaved change the server builds the model again with the current text (no rules, the parse cache warm) and answers from that: about 5 ms on the examples, 50 ms on a 20,000-line project. Right after a save it waits for the check that the save started.

### Code lens

A line of text above each action and EVENTS name, from the same index as [go to definition](#go-to-definition-and-references):

| On | Lens | Example |
|---|---|---|
| an intent key | the model entry handling it, its sinks (with the EVENTS types it emits and the reply actions its requests name) and its `next()` targets | `handled by model.SAVE · STATE, HTTP → LOADED/FAILED, EVENTS 'SAVED' · next → DONE` |
| | no model entry (exactly when SYG101 reports it) | `no model entry` |
| a model key | what triggers it: `intent`, `reply (HTTP ok from SAVE)`, `next from SAVE`, `agent tool`, `timer`, `connection (message)`, `resource`, `route`, `browser`, `behavior pager`, `persist`, `the core` (a built-in) | `triggered by intent, agent tool` |
| | nothing triggers it (exactly when SYG102 reports it) | `not triggered`, or `not triggered (a dynamic name might)` when SYG102 is info |
| `EVENTS.select('X')` | how many emitters `X` has in the project | `2 emitters`, `no emitters` |
| an emitter of `X` | how many selects `X` has in the project | `1 listener` |

Where the checker can't tell, the lens says so rather than guess: `handler not known statically` (a model with spreads), `trigger not known statically` (an intent it can't list, such as a computed key). A model shared by components gets one lens per component, prefixed with its name; `undoable()`'s `UNDO` and `REDO` are both at the `undoable` call, prefixed with the action.

**Clicking a lens.** The LSP doesn't standardize a command for "show these locations", so the server picks one from the client's capabilities:

- a client that lists `sygnal.showReferences` or `editor.action.showReferences` in `capabilities.experimental.commands.commands` (or in `initializationOptions.clientCommands`) gets that command with `[uri, position, locations]`, the arguments of VS Code's `editor.action.showReferences`. VS Code's own command needs its arguments as VS Code objects, so an extension registers `sygnal.showReferences`, converts the arguments and calls it (it shows the targets in a peek view);
- else a client that advertises `window.showDocument.support` (VS Code and Neovim do) gets the server command `sygnal.goTo`: executing it opens the first target and returns them all;
- else, and for a lens without a target (`no model entry`, `not triggered`), the lens is text only (`command: ""`).

**Client support.** VS Code and LSP4IJ show code lenses. Neovim shows them after `vim.lsp.codelens.refresh()` (for example on `BufEnter`, `CursorHold` and `InsertLeave`). Helix has no code lens.

**Freshness.** As for definition: the last check's index when the open documents are still what it checked, else one built for the request. After a check that changed any lens of the folder (a title or a target), the server sends `workspace/codeLens/refresh` when the client advertises `workspace.codeLens.refreshSupport`, so lenses in other files follow an edit. In a file that doesn't parse there are no lenses until it parses again. `sygnal.codeLens: false` turns them off.

### Highlights

Semantic tokens for Sygnal's wiring, from the same index as [go to definition](#go-to-definition-and-references), so only names the checker resolved get one. The legend has custom types and modifiers, so an editor colors them only when its theme or config maps them:

| Type | On | Modifiers |
|---|---|---|
| `sygnalAction` | an action name: intent key, model key, `next('A')`, reply names, the `connections` / `resources` / `route` / `timers` / `browser` names, behavior options, `agent.actions` keys | `trigger` or `handler` + `declaration` (a model key); `unhandled` on an intent key no model entry handles |
| `sygnalEvent` | an EVENTS type in `EVENTS.select()` or an emitter | `declaration` on an emitter |
| `sygnalSelector` | a class, id or control token of an intent selector (`'.save'` in `DOM.click('.save')`) | `untargeted`: nothing the component (or a child) renders can match it; `unverified`: no static class / id renders it, but a dynamic class name (id) in the view might |
| `sygnalTarget` | a view token (a `className` / `id` token, a control tag) that an intent selector of its scope selects; tokens nothing selects get none | `declaration` |
| `sygnalChild` | a child component: the argument of `CHILD.select(Child)`, `<Child>` and `<Collection of={Child}>` in that component's view, and Child's name (when a parent selects it) | `declaration` on the name |

**VS Code** asks only one semantic token provider per document (the first of the highest-scored group that answers), so the server's would replace TypeScript's semantic highlighting. A client like that passes `initializationOptions.semanticTokens: false` (the server then advertises no provider) and asks `sygnal/highlights` (params: `{ textDocument }`) for the decoded tokens, `[{ line, character, length, type, modifiers }]` (0-based), to draw them itself; with `initializationOptions.highlightsChanged: true` the server sends the notification `sygnal/highlightsChanged` after the first check and after each check that changed the highlights. The VS Code extension does this and draws them as decorations.

**Freshness.** As for code lens: the last check's index when the open documents are still what it checked, else one built for the request (null while a document doesn't parse). After a check that changed the folder's highlights, the server sends `workspace/semanticTokens/refresh` when the client advertises `workspace.semanticTokens.refreshSupport`. `sygnal.highlights: false` turns them off (empty tokens).

### Rename

`textDocument/rename` renames a Sygnal name everywhere it is wired, and `textDocument/prepareRename` says up front whether it can (advertised as `renameProvider: { prepareProvider: true }` to clients that support `prepareRename`). These names are strings, so an occurrence a rename misses is an action that silently never runs, with no type error. The server therefore renames only when it can account for every use, and otherwise refuses with the reason (VS Code shows it, then offers TypeScript's rename if TypeScript has one).

| Renames | What it edits |
|---|---|
| an action | every occurrence in its component: intent key, model key (a `'A \| SINK'` key's action part), `next('A')`, reply names, the `connections` / `resources` / `route` / `timers` / `browser` names, a behavior option naming it, the `agent.actions` key. A model or intent object shared by components: every component sharing it, each edit once. A user behavior's action (`'c.BUMP'`, or `BUMP` in its `defineBehavior()`): the host's keys and the definition, when one host uses the definition under one key |
| an EVENTS type | every emitter and select in the project |
| a class or id | the view tokens and intent selectors of the DOM scope the name resolves to |
| a state key | the `initialState` / `calculated` key and the Collection `from` naming it |
| a context entry | the providers' `.context` keys and every read resolving to them |

An identifier key written shorthand keeps its value (`{ SAVE }` becomes `{ STORE: SAVE }`).

**It refuses** (prepareRename and rename answer with an error, code `-32803`):

| When | Message (example) |
|---|---|
| a built-in or an `undoable()` action | `BOOTSTRAP is built in: its name is fixed`; `UNDO is added by undoable(): its name is fixed` |
| the component's intent or model can't be read in full (spreads, computed keys) | `can't rename INCREMENT: in Counter, its model is built with a spread or computed keys, so not every use can be found` |
| a name built at run time in the component: `next(x)`, a reply, a connection / timer name | `can't rename GO: in C, it calls next() with a name built at run time` |
| a name built from constants (`[ACTIONS.TICK]`, `EVENTS.select(SAVED)`) | `can't rename TICK: it is built from a constant (TICK at Edge.jsx:15) at Edge.jsx:24; rename the constant's value by hand` |
| a first-party behavior's action, a `uses` key | `pages.NEXT belongs to the first-party behavior 'pages': its names are fixed` |
| a user behavior's action when its definition has several hosts or keys | `can't rename c.BUMP: the behavior's definition (src/counter.js:3) is used by 2 hosts or keys, ...` |
| a control or a component name (identifiers) | `<Add> is a control (an identifier): rename it with TypeScript's rename` |
| EVENTS: any select or emit in the project whose type is built at run time, or any intent or model in the project that can't be read in full; Toaster's `TOAST` | `can't rename EVENTS 'SAVED': the project has 1 EVENTS select(s) with a type built at run time, ...` |
| a class or id: the view has dynamic class names (ids); no intent selects it (styling only); it is in a CSS / markup file of the folder or the project uses a stylesheet the server can't read (a package, a remote `<link>`); a module constant holds it; a helper renders it in two views; a behavior option selects it; another DOM scope uses it too; only a child renders it | `can't rename '.save': it is also used in src/app.css:1, which sygnal-check doesn't rename (CSS / markup)` |
| a state key: the `initialState` / `calculated` can't be read; no key declares it (a Collection item's state comes from its parent) | `can't rename 'rows': L's initialState is built in a way sygnal-check can't read` |
| a context entry: a provider's `.context` can't be read; a component reads it with no provider the server can find | `can't rename context 'tone': Lone also reads it (src/Lone.jsx:1) with no provider sygnal-check can find` |
| **any kind:** the name also appears in the project's source as a string, a property key or a member name (`.items`) that isn't one of its known uses | `can't rename GO: 'GO' also appears at src/C.jsx:5 (a string) where sygnal-check can't tell whether it is the same name; rename by hand` |
| any file of the project has a syntax error | `can't rename while src/Other.jsx has a syntax error: its uses can't be found` |

The last guard is what keeps state keys mostly unrenamable: a key is read as code (`state.items`, `{ ...state, items }`), which the server can't tie to the state, so it refuses and points to TypeScript's rename (typed state) or a rename by hand.

**The new name** is checked per kind: an action name must be an identifier (a name that isn't SCREAMING_SNAKE_CASE is allowed, with a note in the log); an EVENTS type any non-empty string without quotes, backslashes or line breaks; a class or id a CSS identifier (a leading `.` / `#` is accepted); state and context keys identifiers. Renaming to an action the component already has, a built-in, an existing EVENTS type, or a class / id already in use is refused.

**Change annotations.** For a client that supports them (`workspace.workspaceEdit.changeAnnotationSupport` with `documentChanges`), two groups need confirmation (`needsConfirmation: true`; VS Code shows the refactor preview):

- **Agent tool name:** an `agent.actions` key, since renaming it changes the tool name an LLM sees. A client without annotations gets these edits anyway (they are part of the action) and a `window/showMessage` note.
- **Test files:** the server also scans the project's test files (`*.test.*` / `*.spec.*`, found under the [project root](#project-roots) even when `includeTests` is off) for the name as a string (`describe('START_EDIT')`, `simulateAction('START_EDIT')`, a word of a test title for a SCREAMING_SNAKE name with an underscore) or a property (`model.START_EDIT`, `{ draggingLaneId: ... }`), and, for an action, state key or context entry, only in test files that import the component's files. A client without annotations gets the code edits only, and a `window/showMessage` warning naming the test files left out: test edits are never applied without a confirmation.

**Freshness.** A rename always runs on the documents as they are: the worker builds the folder with the current unsaved text (never the last check's index), and if a document changes while it does, the request fails with "try again".

**Limits.** Outside the scan: docs samples, other [project roots](#project-roots) (the other packages of a monorepo), files outside the workspace folder, CSS-in-JS and stylesheets from packages (a package stylesheet refuses class renames), TypeScript types that list action or EVENTS names (a `SygnalEvents` registry, an `ActionsOf<>` map: the type checker reports what's left). Devtools, HMR or `sygnal/element` code dispatching an action by name is caught only when the name appears as a string in the project.

### Settings

| Setting | Type | |
|---|---|---|
| `sygnal.strict` | boolean | also run the strict-mode rules |
| `sygnal.a11y` | `"warn"` \| `"error"` | severity of the a11y findings |
| `sygnal.ignore` | string[] | codes to drop |
| `sygnal.paths` | string[] | files, directories or globs to check, relative to each [project root](#project-roots) |
| `sygnal.verbose` | boolean | also show info findings (default false) |
| `sygnal.trace.server` | `"off"` \| `"messages"` \| `"verbose"` | what the server logs with `window/logMessage`: errors and warnings; also each check; also each message received |
| `sygnal.codeLens` | boolean | show [code lenses](#code-lens) (default true); an editor setting only, the config file has no such key |
| `sygnal.highlights` | boolean | send [highlights](#highlights) (default true); an editor setting only, the config file has no such key |

The server reads settings from two places:

- `initializationOptions`, either flat (`{ "strict": true }`) or under `sygnal` (`{ "sygnal": { "strict": true } }`);
- `workspace/configuration`, section `sygnal`, once per [project root](#project-roots), when the client supports it. The request's `scopeUri` is the root, so the editor answers with the settings of the workspace folder that contains it. These values win over `initializationOptions`.

After a `workspace/didChangeConfiguration` the server asks for the configuration again and ignores the notification's own payload.

**Precedence with the config file.** A setting the editor sets overrides the [config file](#configuration) (`sygnal-check.config.json` or the `package.json` key, found from each project root). A setting left unset, or set to `null`, leaves the config file in charge. So with no editor settings, the editor, the CLI and CI all check with the same config. A list setting (`ignore`, `paths`) replaces the file's list; it is not merged with it.

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

A comment matches the line a finding starts on (`line` in the JSON). A few findings underline a narrower part of a multi-line construct than the line they used to start on (SYG731 the `className` attribute, SYG152 the `messages` key, SYG422 the bad timer property or the timer's name); for those a comment above the whole element or object still works.

## Programmatic API

```js
import { check } from 'sygnal-check'

const diagnostics = check(['src'], { cwd: process.cwd() })
// [{ code, severity, component, message, fix, docsUrl, file, line, column, endLine, endColumn, related?, fixes?, data?, text }]
```

This is the runtime `Diagnostic` shape plus the source location, without `timestamp`. `--json` prints the same objects.

`createLspServer({ input, output, worker?, debounce? })` runs the [language server](#language-server) on a pair of streams (`worker: false` checks on the calling thread) and returns `{ done, idle(), dispose() }`; `done` resolves with the exit code.

### JSON output

| Field | |
|---|---|
| `file` | the path, relative to `cwd` |
| `line`, `column` | where the finding starts, 1-based |
| `endLine`, `endColumn` | where it ends: 1-based, `endColumn` **exclusive** (one past the last character). The range is the part an editor underlines: the selector string, the model key, the JSX attribute, `<img` for a missing `alt`. Columns count UTF-16 code units, like Babel's `loc` and LSP's default position encoding, so an LSP range is `line - 1`, `column - 1` .. `endLine - 1`, `endColumn - 1`. A parse error (SYG900) is one character at the parser's position |
| `related` | optional: the other locations of a pair or cross-file finding, `[{ file, line, column, endLine, endColumn, message }]` (same units). SYG104: the child's tag and the element inside it that renders the class, id or control; SYG105: a near-miss event type on the other side (`'DOC_SAVE'` emitted, `'DOC_SAVED'` selected); SYG128: the first declaration of the key; SYG129: the tag that renders the grandchild; SYG171: the tags that render the child; SYG440: the other declaration with the name; SYG609 / SYG643: the `run()` call |
| `fixes` | optional: mechanical fixes as text edits, `[{ title, kind, preferred?, fixAll?, edits: [{ file, start, end, line, column, endLine, endColumn, text }] }]`. `kind` is `'quickfix'` or `'refactor'`; `preferred` marks the one obvious fix (a single "did you mean"); `fixAll` marks a rewrite `--fix` applies. Apply all of a fix's edits together: each replaces `start`..`end` of `file` (UTF-16 offsets; the same range as `line`/`column`..`endLine`/`endColumn`, same units as above) with `text`, and they never overlap. An edit can be in another file than the finding. The `fix` field stays the human-readable text |

Which findings have fixes:

| Fix | Codes |
|---|---|
| the "did you mean" name, as a preferred quick fix | SYG110 (the class or id in a literal selector), SYG112 (a reply action), SYG127 (a behavior option key), SYG226 (an undo `track`/`resetOn`/`coalesce` name), SYG140 (a widget's dispatched event), SYG141 (the event listened for), SYG142 and SYG641 (a command key), SYG150 (the `agent.actions` key), SYG151 (`agents` → `agent`), SYG223 (a persist `pick`/`omit` key), SYG253 (a catalog declaration key), SYG707 (an `aria-*` name, a role) |
| the near-miss event type on the other side, not preferred (either side may be the typo) | SYG105 |
| the `--fix` rewrites (`fixAll`), with the `event` / `emit` import edits | SYG504, SYG505, SYG506, SYG612 (removed statics) |
| "Add a model entry for `X`", a stub `X: (state, data) => state, // TODO` (only when the model is an object literal in the component's file) | SYG101 |
| "Remove the unreachable entry `X`", a refactor, never preferred | SYG102 |

A SYG900 for a rule that crashed has no source location: `file` is `''`, `line` and `column` are 0, and there is no `endLine` / `endColumn`. The text output (`file:line:col CODE ...`) doesn't show ranges, related locations or fixes. The graph's diagnostics (`--graph --json`) carry the same fields, `fixes` included.

`check(inputs, options)` takes:

- `inputs`: a path, directory or glob, or an array of them.
- `options.cwd`: the base for relative inputs and reported paths.
- `options.ignore`: codes to drop, e.g. `['SYG105']`.
- `options.includeTests`: also scan test and spec files.
- `options.strict`: also run the strict-mode rules (SYG501, SYG503-508).
- `options.a11y`: `'warn'` (default) or `'error'`, the severity of the a11y lane (SYG701-708). `strict` doesn't change it.
- `options.rules`: a custom rule list.
- `options.sources`: in-memory file contents, a `Map<path, text>` or a `{ [path]: text }` object (an editor's unsaved buffers; relative paths resolve against `cwd`). A file in it is read from there instead of the disk, and relative imports resolve to its paths, so a new, unsaved file is found. A file that exists only in `sources` is checked when it is named in `inputs`, or when it lies under a directory input (or matches a glob) and passes the same filters as files found on disk (source extension, no `node_modules` or dot directory, tests only with `includeTests`). `fixFiles()` takes it too and then fixes in memory (below).
- `options.config`: `false` to skip the [config file](#configuration) (for callers that resolved the settings already), or a path to read instead of looking for one. By default `check()` reads it from `cwd`, and when `inputs` is left out, checks the config's `paths` (else `src`). Its findings (SYG900) are in the result.
- `options.defaults`: fallbacks for `strict`, `a11y`, `ignore`, `paths` and `includeTests` that sit below the config file (the Vite plugin passes its `diagnostics` settings here).
- `options.cache`: a parse cache kept across checks (`createParseCache()` or `new ParseCache()`, both exported), for an editor or a watcher that re-checks the same project. A file whose text (from `sources` or the disk) is unchanged since the last check isn't parsed again; a file that failed to parse keeps reporting the same SYG900. Only the parse is shared: each check builds its own model, so results are the same as without a cache. A check drops the entries the previous check didn't use (a deleted or no longer imported file); `cache.delete(path)` and `cache.clear()` drop entries by hand, and `cache.stats` counts `{ hits, parses }`. Use one cache per project. The CLI doesn't use one; the MCP server keeps one (and a check session) for its life.
- `options.session`: a check session (`createCheckSession()`) kept across checks of the same files, with a `cache`: incremental checking. Each check reuses the previous one's model (files, components, views) for every file whose text is unchanged and that imports nothing that changed (transitively), and replays the findings of the rules that work file by file (`perFile`, see [Writing a rule](#writing-a-rule)) for those files. Only the changed files and their importers are analyzed again; the rules that need the whole project (EVENTS counterparts, render sites, app roots, labels around a component) run in full on the reused model. The findings are the same as a fresh check's. A different file list, `cwd` or `replyKeys` starts afresh. A disk file whose size, mtime and inode are unchanged isn't read again. The language server and `--watch` use one per project root.

`loadConfig(cwd, { file? })` returns `{ config, file, diagnostics }`: the valid keys found (with `paths` made absolute), the absolute path of the file read (or `null`), and the SYG900 findings. `resolveOptions(options)` returns `{ options, config }`: the options merged in the order above, and `loadConfig`'s result. `checkFiles()` and `graphFiles()`, which take already expanded files, read no config file.

`checkFiles(absPaths, options)` is `check()` for an already expanded list of absolute paths; a path that exists only in `options.sources` is checked too.

`fixFiles(absPaths, { cwd })` applies the `--fix` rewrites (the findings' `fixAll` fixes) in place and returns `{ fixed, files, passes, diagnostics }`; with `{ controls: true, keepClasses? }` it also converts selectors to controls and adds `controls` (how many it made) and `controlFiles`. With `sources` it reads the files from there and writes nothing (unless `write: true`); the result adds `texts` (a `Map` of absolute path → fixed text, for each changed file) and `edits` (one edit per changed file, against its text in `sources`, in the `fixes` edit shape). In one pass it applies every fix that doesn't overlap one already taken (an insertion touching another fix's edit counts as overlapping), then re-checks; the rest wait for the next pass. A fixable diagnostic also keeps its `--fix` edits on a non-enumerable `edits` property (`[{ file, start, end, text }]`, absolute paths).

`controlFixes(absPaths, { cwd, sources?, keepClasses? })` returns the `--controls` conversions as refactors, one per class, under the same conditions: `[{ title, kind: 'refactor', file, line, column, endLine, endColumn, control, class, edits }]`, located at the first selector it rewrites. `applyEdits(text, edits)` applies non-overlapping `{ start, end, text }` edits to a string.

`graph(inputs, options)` returns the [app graph](#app-graph---graph) (`InspectGraph`). It takes the same options as `check()`, `sources` and `cache` included; `graphFiles(absPaths, options)` takes an expanded list. `buildGraph(project, diagnostics)` does the same for an already built project. `validateSchema(schema, value)` is the small JSON Schema validator the tests use.

`getExplanation(code)`, `listExplanations()`, `formatExplanation(entry)` and the raw `EXPLANATIONS` table back `explain`. The MCP server lives in `src/mcp.js` (`createMcpServer({ cwd }).handle(message)`, `runMcpServer({ stdin, stdout, cwd })`).

For tooling, `buildProject(files, { cwd, sources, cache })` returns the intermediate project model the rules query: components, intents, models, view classes and ids, child usages, collections, and events.

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

a11y rules go in `src/rules/a11y/` (registered in `src/rules/a11y/index.js`; they report at warn and are swapped for error-severity copies with `--a11y=error`). Strict-mode rules go in `src/rules/strict/`, with `strict: true`. A report may carry `fixes: [{ title, kind?, preferred?, fixAll?, edits: [{ file, start, end, text }] }]` (absolute path, source offsets; the runner adds the positions and relative paths); `fixAll: true` makes `--fix` apply it. `src/edits.js` has helpers for the common edits (a string literal, an object key). The older `edits: [...]` on a report still works and becomes one `fixAll` fix. Every code must exist, with the same title, in Sygnal's runtime registry (`src/extra/diagnostics/codes.ts`). `test/codes.vtest.js` enforces this.

**`perFile: true`** (incremental checking): declare it when running the rule on a project narrowed to one scanned file (`project.scanned` = that file, `project.components` = its components, everything else as in the project) reports exactly that file's share of the whole run, and that share depends only on the file and what it imports. With a check session the rule then runs only on the files that changed (or import a changed file), and its findings for the others are replayed. A rule that looks at other files' content (who renders a component, every EVENTS emit, the app's `run()` roots, `project.injectedInto`) is not `perFile`. `perFile: (project, file) => key` adds something else the share depends on (`byid-binding`: the installed Sygnal's major). `npm test` runs the suite a second time with `SYGNAL_CHECK_PERFILE=1`, which sends every check through the per-file split, so a rule wrongly marked `perFile` fails its own tests.

A rule never writes to an AST node: with a parse cache the AST outlives the check (the cache tests run every rule over frozen ASTs). A module-level cache keyed by AST nodes holds only what the AST alone determines; anything that depends on the project or holds a `FileInfo` is keyed by the project or the `FileInfo` (both are per check; with a check session an unchanged `FileInfo` is reused, so a cache keyed by it may hold only what the file and its imports determine).

## Development

```bash
cd sygnal-check && npm install && npm test
```

Tests are named `*.vtest.js` so that the repo root's config-less `vitest run` doesn't pick them up. `npm test` runs the suite twice: plainly, then with `SYGNAL_CHECK_PERFILE=1` (`npm run test:perfile` alone; see `perFile` above). The language server's latency gate is opt-in: `SYGNAL_CHECK_LATENCY=1 npx vitest run test/lsp-latency.vtest.js`.
