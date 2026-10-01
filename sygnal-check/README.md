# sygnal-check

A static checker for [Sygnal](https://sygnal.js.org) apps. It finds the string-wiring bugs that fail silently at runtime: an intent selector that matches nothing, an intent action with no model entry, an EVENTS type nobody listens to, and similar.

```bash
npx sygnal-check                 # checks ./src
npx sygnal-check src/components  # files, directories or globs
npx sygnal-check "src/**/*.tsx" --json
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
| `--graph` | Print the app graph. **Not implemented yet** |

Exit codes: `0` clean, `1` findings at or above `--fail-on`, `2` usage error (bad option, no files, `--graph`).

## Rules

The codes are the same as Sygnal's runtime diagnostics (`https://sygnal.js.org/reference/errors#sygNNN`).

| Code | Severity | Finds |
|---|---|---|
| SYG110 | warn | An intent selector (`DOM.select('.x')`, `DOM.click('.x')` or any other shorthand) whose class or id the component's own view never renders. The view is read from static `className`/`class`/`id` strings, `classes()`/`clsx()` calls, template literals, `+` concatenation, conditionals, `[..].join(' ')`, local and module-level consts, module-level render helpers, `h()` and hyperscript helpers, and the `className` of `<Collection>`/`<Switchable>`. The fix suggests the closest class the view does render. The finding is downgraded to **info** when a dynamic className (e.g. `` `tab-${kind}` `` or `props.className`) might produce the class, or when the selector itself isn't a static string. |
| SYG111 | warn | A controlled field: an `<input>`/`<textarea>`/`<select>` whose `value` (or a checkbox/radio whose `checked`) is bound to an expression, while the component's intent has no `input`/`change`/`keyup`/`keydown` listener on that element or an ancestor (a `keydown`/`keyup` listener that is immediately filtered on a key, such as Enter, doesn't count; `processForm` counts). Sygnal writes the bound value back on every render, so a re-render while the user types resets the text. Fix: update the state on `input`, or drop the `value` prop and read the value on blur/submit. A **literal** `value` on a text-like field (`value=""`, `value="default"`) or a literal `checked` on a checkbox/radio is reported too, since Sygnal controls literals as well: every re-render resets the field to the literal. Fix: drop the prop (uncontrolled), or move the value into state and update it on `input`/`change`. Stays quiet for readOnly/disabled/hidden/file fields, a `<select>` with a literal `value`, `value={null}`, dynamic selectors, and DOM selectors handed to helpers. |
| SYG104 | warn | The class or id is rendered, but only inside a **child** component, i.e. in the child's JSX, in JSX passed into it as children or slots, or in a `<Collection of={X}>`/`<Switchable of={{…}}>` child, resolved through imports. Child components are isolated, so the parent never sees those events. |
| SYG101 | warn | An intent action with no model entry. `'ACTION \| SINK'` shorthand keys are expanded first. |
| SYG102 | warn | A model entry nothing can trigger: no intent action, not a built-in (`BOOTSTRAP`, `INITIALIZE`, `HYDRATE`, `DISPOSE`, `READY`), and never the target of a `next('X')` string literal. This is downgraded to info when the model calls `next()` with a non-literal name. |
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

`--fix` adds `event` to the file's existing `import { … } from 'sygnal'` when a rewrite needs it (and skips the rewrite when there is no such import, or `event` is bound to something else), and removes an `emit` import the rewrite left unused. It re-checks after every pass; running it again changes nothing. Review the diff: it rewrites source files in place.

The runtime has a matching opt-in strict mode for the rules it can detect reliably (SYG501, SYG502, SYG504): `import { configureStrict } from 'sygnal/diagnostics'; configureStrict(true)`, or `renderComponent(C, { strict: true })` in tests.

### What counts as a component

A component is any function that gets an `.intent`, `.model`, `.initialState`, `.context` or `.calculated` assignment (or `Object.assign(X, {…})`). That covers function declarations, `const X = () => …`, `const X: Component<…> = function …`, `export default X`, and components declared inside other functions.

### Known limits

- Only the `DOM` source name is recognized (`DOMSourceName` overrides aren't).
- Selectors under `DOM.select('document' | 'body')` aren't checked, since they're page-wide by design.
- SYG105 only sees the files you scan. Check the whole app (`src`), not one folder of it.
- Classes added outside JSX (`innerHTML`, third-party widgets, `element.classList`) are invisible. An `innerHTML` prop or a `{...spread}` on an element makes the component's checks fall back to info.

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

`fixFiles(absPaths, { cwd })` applies the `--fix` rewrites in place and returns `{ fixed, files, passes }`. A strict diagnostic that can be fixed mechanically carries its text edits on a non-enumerable `edits` property (`[{ file, start, end, text }]`).
- `options.rules`: a custom rule list.

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
