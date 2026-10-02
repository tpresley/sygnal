# Agent instructions

This project uses **Sygnal**, a reactive JSX component framework built on Cycle.js (Model-View-Intent, xstream streams, one state tree). It is not React: there are no hooks and no `onClick` handlers.

**Read `node_modules/sygnal/llms.txt` first** (online: https://sygnal.js.org/llms.txt). It is the normative spec: canonical forms, API facts, wiring rules, diagnostics, and the testing recipe. If you have the `sygnal-dev` skill, use it too.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Runs the Vitest tests (`*.test.js` / `*.test.ts` next to the components) |
| `npx --no-install sygnal-check --strict` | Static check for wiring bugs and non-canonical forms; must report nothing |
| `npx --no-install sygnal-check explain SYG104` | Explains a `[Sygnal SYGnnn]` diagnostic and how to fix it |
| `npx --no-install sygnal-check --graph --json` | The app graph: components, actions, selectors, EVENTS |
| `npm run dev` / `npm run build` | Dev server (prints runtime diagnostics) / production build |

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
- `return state` (or returning nothing) for "no change": write `return ABORT`.
- Side effects inside a STATE reducer or a view: use `ACTION: { EFFECT: (state, data, next) => { ... } }` or a driver.

## Wiring rules that fail silently
- A component's intent only sees its own JSX. A parent can't select `.remove` rendered by a child or a Collection item: handle it in the child and send it up with `PARENT` (parent: `CHILD.select(Child)`) or `EVENTS`.
- Every intent action needs a model entry with the same name, and every model entry needs a trigger: an intent action, a built-in, or `next('X')`.
- `event('X')` and `EVENTS.select('X')` must use the same type string.
- `<Collection of={Item} from="items" />`: `from` names an array field of the state.
- An input with `value={state.x}` needs `X: DOM.input('.x').value()` in the intent.
