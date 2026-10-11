# sygnal-check

A static checker for [Sygnal](https://sygnal.js.org) apps. It finds the string-wiring bugs that fail silently at runtime: an intent selector that matches nothing, an intent action with no model entry, an EVENTS type nobody listens to, and similar.

```bash
npx sygnal-check                 # checks ./src
npx sygnal-check src/components  # files, directories or globs
npx sygnal-check "src/**/*.tsx" --json
npx sygnal-check --graph --json  # the app graph: components, actions, events, selectors, findings
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
| `--graph` | Print the [app graph](#app-graph---graph) instead of the findings list; with `--json`, as JSON. Exits 0 (findings are part of the graph). Combines with `--strict`, not with `--fix` |
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
| SYG110 | warn | An intent selector (`DOM.select('.x')`, `DOM.click('.x')` or any other shorthand) whose class or id the component's own view never renders. The view is read from static `className`/`class`/`id` strings, `classes()`/`clsx()` calls, template literals, `+` concatenation, conditionals, `[..].join(' ')`, local and module-level consts, module-level render helpers, `h()` and hyperscript helpers, and the `className` of `<Collection>`/`<Switchable>`. The fix suggests the closest class the view does render. The finding is downgraded to **info** when a dynamic className (e.g. `` `tab-${kind}` `` or `props.className`) might produce the class, or when the selector itself isn't a static string. |
| SYG111 | warn | A controlled field: an `<input>`/`<textarea>`/`<select>` whose `value` (or a checkbox/radio whose `checked`) is bound to an expression, while the component's intent has no `input`/`change`/`keyup`/`keydown` listener on that element or an ancestor (a `keydown`/`keyup` listener that is immediately filtered on a key, such as Enter, doesn't count; `processForm` counts). Sygnal writes the bound value back on every render, so a re-render while the user types resets the text. Fix: update the state on `input`, or drop the `value` prop and read the value on blur/submit. A **literal** `value` on a text-like field (`value=""`, `value="default"`) or a literal `checked` on a checkbox/radio is reported too, since Sygnal controls literals as well: every re-render resets the field to the literal. Fix: drop the prop (uncontrolled), or move the value into state and update it on `input`/`change`. Stays quiet for readOnly/disabled/hidden/file fields, a `<select>` with a literal `value`, `value={null}`, dynamic selectors, and DOM selectors handed to helpers. |
| SYG104 | warn | The class or id is rendered, but only inside a **child** component, i.e. in the child's JSX, in JSX passed into it as children or slots, or in a `<Collection of={X}>`/`<Switchable of={{…}}>` child, resolved through imports. Child components are isolated, so the parent never sees those events. The same for a control (`DOM.click(Remove)` where only a child renders `<Remove>`). |
| SYG101 | warn | An intent action with no model entry. `'ACTION \| SINK'` shorthand keys are expanded first. |
| SYG102 | warn | A model entry nothing can trigger: no intent action, not a built-in (`BOOTSTRAP`, `INITIALIZE`, `DISPOSE`, `READY`; `HYDRATE` is an ordinary action since 6.0), never named as a reply action (`ok: 'X'` / `error: 'X'` returned by a driver sink), a `connections` entry (`message`/`open`/`close`/`error`) or a timer action (`{ every: 100, action: 'TICK' }`, `{ frame: 'FRAME' }` in a `timers` static), never the target of a `next('X')` string literal, and not an `agent.actions` key. An LLM request's `delta` / `tool` keys name reply actions too, also when a local helper builds the request. This is downgraded to info when the model calls `next()`, or a request names its action, with a non-literal name. |
| SYG112 | error | A request names a reply action the component has no model entry for, so the reply is dropped: a string literal `ok`/`error` in an object a driver sink returns (`HTTP: (s) => ({ url, ok: 'LOADED', error: 'FIALED' })`; not STATE/EFFECT/EVENTS/PARENT/READY), a `message`/`open`/`close`/`error` name in a `connections` static, or a timer action in a `timers` static. The `ELEMENT` sink's options (`block: 'nearest'`) are not reply names. The fix names the closest model key. Only UPPER_SNAKE_CASE names, or names close to a model key, are reported (a custom driver's `error: 'Not found'` field is data). |
| SYG105 | warn | An EVENTS type that is selected (`EVENTS.select('X')`) but never emitted, or emitted (`emit('X')`, `event('X')`, or `{ type: 'X' }` returned from an `EVENTS` sink) but never selected, anywhere in the scanned files. Only string literals are matched. This is downgraded to info when non-literal emits or selects exist. |
| SYG110 (control) | warn | The intent listens to a [control](#controls) (`DOM.click(Add)`) that the component's view never renders as `<Add>`. |
| SYG124 | error | A component passed where a control or selector is expected: `DOM.click(TodoItem)`, `DOM.select(Badge)`. A component is a function or class with statics, or a capitalised function. The fix names both ways out: `PARENT` + `CHILD.select(TodoItem)`, or a parent-owned control around the child. |
| SYG125 | error | A control given `.intent`, `.model` or `.initialState` (`Add.intent = …`, `C.Add.model = …`, `Object.assign(Add, {…})`). Controls are elements, not components. |
| SYG126 | info | A component renders a control its intent never listens to (also counts `DOM.select('document').select(Add)`) and its model sends no element command to (`ELEMENT: { showModal: HelpDialog }` uses the dialog). Not reported when the intent can't be read statically. |
| SYG128 | error | Two `controls()` calls in one file declare the same key, or one call repeats a key: both render `data-control="Key"`. |
| SYG127 | error | A [behavior](#behaviors) `uses` entry the core skips (an object literal, an uncalled factory: `uses = { pager }`), a `uses` key the component's `initialState` already has, or an option the behavior never reads (a typo: `pager({ nxt: Newer })`, with the closest option suggested). |
| SYG226 | warn | `undoable(model, { track, resetOn })` or `undo({ track, resetOn })` names an action with no model entry (for `undo()`, the host's actions, including other behaviors' `'pager.NEXT'`). |
| SYG422 | error | A literal timer spec in a `timers` static that `makeTimerDriver()` can't run: `every` not a positive number (`0`, `-5`, `NaN`), a negative `after`, both `every` and `after`, neither, no or an empty `action`, a `frame` that isn't an action name. Values computed from state are left to the runtime. |
| SYG640 | warn | An element command (`ELEMENT: { focus: Email }`, a literal command object) whose target control, or static class/id selector, the sending component's view never renders, or renders only inside a child component: a command reaches only its sender's own elements. |
| SYG641 | error | The method (first key) of a literal element command: a slip of a documented command (`focus`, `blur`, `select`, `click`, `scrollIntoView`, `showModal`, `show`, `close`, `showPopover`, `hidePopover`, `togglePopover`) or of the control's spec `commands` (`{ fokus: Email }`: did you mean 'focus'), or a method that changes the DOM Sygnal renders (`remove`, `append`, `setAttribute`...). Other element methods (`play`, `requestSubmit`, a custom element's own) are fine. |
| SYG643 | warn | A component declares `timers`, `connections` or `resources`, and the app's `run(App, drivers)` call renders it but registers no `makeTimerDriver()`, `makeSocketDriver()` or `makeFetchDriver()`. Only when the `run()` call is in the scanned files and its drivers are an object literal the checker can list (a driver from a package, a spread or a local driver that may wrap one makes it say nothing). |
| SYG609 | warn | A model entry sends to a sink (`HTTP`, `WS`, any name the core doesn't handle) of a component that the app's `run(App, drivers)` call renders, and that call registers no driver under that name, so every value sent there is dropped (`renderComponent()` fakes the sink, so tests pass). Only when the `run()` call is in the scanned files and its drivers are an object literal (or absent); `STATE`, `EFFECT`, `EVENTS`, `PARENT`, `READY`, `DOM`, `CHILD`, `ELEMENT`, `PERSIST` and `LOG` need no driver. |
| SYG129 | warn | `CHILD.select(TaskRow)` in a component whose view doesn't render `TaskRow`, while a component it renders does (a grandchild, e.g. a Collection item inside a child): `PARENT` reaches only the direct parent, so it never fires. The message names the chain and the fix relays the value through the component in between. Quiet when the view renders it itself, mentions it some other way, or has a Collection/Switchable target the checker can't resolve. |
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
| `actions[].trigger` | `intent`, `builtin` (BOOTSTRAP/INITIALIZE/DISPOSE/READY), `reply` (an `ok`/`error` literal in a request, a `connections` name or a timer action), `next` (a `next('X')` literal), `agent` (only an `agent` declaration's action), else `unknown` | the same; `reply` = named by a request the instance was seen sending; `next` = a model-only action whose STATE reducer was seen running. The core adds `INITIALIZE` to every model |
| `stateKeys` | `initialState` keys | current state keys |
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

`sygnal-check lsp` runs a [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) server on stdio. An editor gets the checker's findings as you type, a hover with the `explain` entry for each code, quick fixes, and go to definition / find references for actions and EVENTS types. It is part of the package, hand-written like the MCP server, so it adds no dependency, and it runs the same rules as the CLI: with no unsaved buffers, it reports what `sygnal-check` reports for the same settings.

**Wiring it into an editor.** Any LSP client that starts a server over stdio can run it. Use this command, from the project or with the workspace as its working directory:

```bash
npx --no-install sygnal-check lsp
```

Give it the languages `javascript`, `javascriptreact`, `typescript` and `typescriptreact`, and the workspace folder(s) as its root. The server exits when its stdin closes, so the client doesn't need to send `exit`. `createLspServer({ input, output })` in the programmatic API runs it on any pair of streams.

### Capabilities

| | |
|---|---|
| Lifecycle | `initialize`, `initialized`, `shutdown`, `exit`; `$/cancelRequest` (a cancelled request is answered with `-32800`); `$/setTrace`; other `$/` notifications are ignored |
| Workspace | one project per workspace folder (`workspaceFolders`, else `rootUri` / `rootPath`, else the working directory); `workspace/didChangeWorkspaceFolders`. A folder whose files define no Sygnal component gets no diagnostics |
| Documents | full text sync (`didOpen`, `didChange`, `didSave`, `didClose`). Open documents are checked from their unsaved text. Closing a document re-checks it from disk |
| Diagnostics | pushed with `textDocument/publishDiagnostics` (no pull diagnostics) |
| Hover | on a finding: its code, title, explanation, fix and docs URL (Markdown, with the URL itself as the link text so editors that hide link targets still show it; plain text for clients without Markdown) |
| Code actions | `quickfix`, `refactor` / `refactor.rewrite`, `source.fixAll.sygnal` (below) |
| Definition | `textDocument/definition` on an action name or an EVENTS type ([below](#go-to-definition-and-references)) |
| References | `textDocument/references` on the same names; honours `context.includeDeclaration` |
| File watching | when the client supports dynamic registration: `**/*.{js,jsx,ts,tsx,mjs,cjs}`, `**/sygnal-check.config.json`, `**/package.json` |

**When it checks.** A check covers the whole project, because a change in one file can create or clear findings in another (EVENTS, child components, Collections). It runs in a worker thread, so hover and code actions are answered while a check runs.

The server checks at once on `didOpen`, `didSave`, `didClose`, a watched-file event or a settings change. After a `didChange` without a save, it waits about 150 ms for typing to pause. A newer change replaces a check that is still waiting; it doesn't queue another one.

Files that aren't open are read from disk on every check, so a client without file watching still sees changes on disk at the next check.

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

### Settings

| Setting | Type | |
|---|---|---|
| `sygnal.strict` | boolean | also run the strict-mode rules |
| `sygnal.a11y` | `"warn"` \| `"error"` | severity of the a11y findings |
| `sygnal.ignore` | string[] | codes to drop |
| `sygnal.paths` | string[] | files, directories or globs to check, relative to the workspace folder |
| `sygnal.verbose` | boolean | also show info findings (default false) |
| `sygnal.trace.server` | `"off"` \| `"messages"` \| `"verbose"` | what the server logs with `window/logMessage`: errors and warnings; also each check; also each message received |

The server reads settings from two places:

- `initializationOptions`, either flat (`{ "strict": true }`) or under `sygnal` (`{ "sygnal": { "strict": true } }`);
- `workspace/configuration`, section `sygnal`, once per workspace folder, when the client supports it. These values win over `initializationOptions`.

After a `workspace/didChangeConfiguration` the server asks for the configuration again and ignores the notification's own payload.

**Precedence with the config file.** A setting the editor sets overrides the [config file](#configuration) (`sygnal-check.config.json` or the `package.json` key, found from each workspace folder). A setting left unset, or set to `null`, leaves the config file in charge. So with no editor settings, the editor, the CLI and CI all check with the same config. A list setting (`ignore`, `paths`) replaces the file's list; it is not merged with it.

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
| `related` | optional: the other locations of a pair or cross-file finding, `[{ file, line, column, endLine, endColumn, message }]` (same units). SYG104: the child's tag and the element inside it that renders the class, id or control; SYG105: a near-miss event type on the other side (`'DOC_SAVE'` emitted, `'DOC_SAVED'` selected); SYG128: the first declaration of the key; SYG129: the tag that renders the grandchild; SYG440: the other declaration with the name; SYG609 / SYG643: the `run()` call |
| `fixes` | optional: mechanical fixes as text edits, `[{ title, kind, preferred?, fixAll?, edits: [{ file, start, end, line, column, endLine, endColumn, text }] }]`. `kind` is `'quickfix'` or `'refactor'`; `preferred` marks the one obvious fix (a single "did you mean"); `fixAll` marks a rewrite `--fix` applies. Apply all of a fix's edits together: each replaces `start`..`end` of `file` (UTF-16 offsets; the same range as `line`/`column`..`endLine`/`endColumn`, same units as above) with `text`, and they never overlap. An edit can be in another file than the finding. The `fix` field stays the human-readable text |

Which findings have fixes:

| Fix | Codes |
|---|---|
| the "did you mean" name, as a preferred quick fix | SYG110 (the class or id in a literal selector), SYG112 (a reply action), SYG127 (a behavior option key), SYG226 (an undo `track`/`resetOn`/`coalesce` name), SYG140 (a widget's dispatched event), SYG141 (the event listened for), SYG142 and SYG641 (a command key), SYG150 (the `agent.actions` key), SYG151 (`agents` → `agent`), SYG223 (a persist `pick`/`omit` key), SYG707 (an `aria-*` name, a role) |
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
- `options.cache`: a parse cache kept across checks (`createParseCache()` or `new ParseCache()`, both exported), for an editor or a watcher that re-checks the same project. A file whose text (from `sources` or the disk) is unchanged since the last check isn't parsed again; a file that failed to parse keeps reporting the same SYG900. Only the parse is shared: each check builds its own model, so results are the same as without a cache. A check drops the entries the previous check didn't use (a deleted or no longer imported file); `cache.delete(path)` and `cache.clear()` drop entries by hand, and `cache.stats` counts `{ hits, parses }`. Use one cache per project. The CLI doesn't use one; the MCP server keeps one for its life.

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

A rule never writes to an AST node: with a parse cache the AST outlives the check (the cache tests run every rule over frozen ASTs). A module-level cache keyed by AST nodes holds only what the AST alone determines; anything that depends on the project or holds a `FileInfo` is keyed by the project or the `FileInfo` (both are per check).

## Development

```bash
cd sygnal-check && npm install && npm test
```

Tests are named `*.vtest.js` so that the repo root's config-less `vitest run` doesn't pick them up. The language server's latency gate is opt-in: `SYGNAL_CHECK_LATENCY=1 npx vitest run test/lsp-latency.vtest.js`.
