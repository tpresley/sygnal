# Agent instructions

This project uses **Sygnal**, a reactive JSX component framework built on Cycle.js (Model-View-Intent, xstream streams, one state tree). It is not React: there are no hooks and no `onClick` handlers.

**Read `node_modules/sygnal/llms.txt` first** (online: https://sygnal.js.org/llms.txt). It is the normative spec: canonical forms, API facts, wiring rules, diagnostics, and the testing recipe. If you have the `sygnal-dev` skill, use it too.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Runs the Vitest tests (`*.test.js` / `*.test.ts` next to the components) |
| `npx sygnal-check --strict` | Static check for wiring bugs and non-canonical forms; must report nothing (if npx can't find it: `npm i -D sygnal-check`) |
| `npx sygnal-check explain SYG104` | Explains a `[Sygnal SYGnnn]` diagnostic and how to fix it |
| `npx sygnal-check --graph --json` | The app graph: components, actions, selectors, EVENTS |
| `npm run dev` / `npm run build` | Dev server (prints runtime diagnostics) / production build |

## Workflow
Add a feature in this order: state (`initialState`) → intent (`ACTION: DOM.click('.x')`) → model (`ACTION: (state, data) => ({ ...state, ... })`) → view → test. Finish with `npm test` and `npx sygnal-check --strict`, both clean.

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
- Every intent action needs a model entry with the same name, and the reverse.
- `event('X')` and `EVENTS.select('X')` must use the same type string.
- `<Collection of={Item} from="items" />`: `from` names an array field of the state.
- An input with `value={state.x}` needs `X: DOM.input('.x').value()` in the intent.
