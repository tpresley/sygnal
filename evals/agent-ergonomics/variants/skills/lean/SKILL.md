---
name: sygnal-dev
description: >
  Build, change, test, and debug apps written with Sygnal, the reactive JSX component
  framework built on Cycle.js (Model-View-Intent, xstream streams, one state tree,
  driver-based side effects). Use it whenever a project depends on `sygnal`, imports from
  'sygnal', uses `.intent` / `.model` / `.initialState` on components, or the user asks to
  create a Sygnal app, add a feature or component, wire events or drivers, write Sygnal
  tests, or fix a `[Sygnal SYGnnn]` diagnostic.
---

# Sygnal Dev

This skill has the workflow, the canonical forms, the examples most tasks need and the testing recipe. Every other API fact is in **`node_modules/sygnal/llms.txt`** (the normative spec, 250 lines, §1–§7; index in §7 below): print the one section you need, e.g. `sed -n '/^## 4\./,/^## 5\./p' node_modules/sygnal/llms.txt`. Don't search `dist/` for behavior: it is bundled output, and the questions that usually lead there (`next()` timing, Collection keys and sorting, wrapper elements) are answered below.

**Write only the canonical forms shown here.** Other forms still run, but `sygnal-check --strict` flags them (SYG5xx).

## 1. Workflow
**Add a feature**, in this order:
1. **State**: add the fields to the root `initialState` (children get state from their parent).
2. **Intent**: name the action and its trigger (`DOM.click('.save')`, `EVENTS.select('X')`, `CHILD.select(Child)`, a driver source).
3. **Model**: one entry per action; one function per sink (`STATE`, `EVENTS`, `PARENT`, `EFFECT`, drivers).
4. **View**: render from `state` / `context`; add the class names the intent selects.
5. **Test** (§6), run `npm test`, then `npx --no-install sygnal-check --strict` (skip it if not installed).

**Debugging**: read every `[Sygnal SYGnnn]` line (tests, console); `npx --no-install sygnal-check explain SYGnnn` gives the fix. A silent no-op (a click does nothing) is almost always a wiring rule in §4.

## 2. Component anatomy
```jsx
import { ABORT } from 'sygnal'

function Counter({ state, context, label }) {  // 1st arg: parent props + state, context, children, slots
  return (
    <div className="counter">
      <span>{label} {state.count} (x2 = {state.double})</span>
      <input className="step" value={state.step} />
      <button className="inc">+</button>
      <button className="reset">reset</button>
    </div>
  )
}
Counter.initialState = { count: 0, step: '1' }           // root only: a child gets state from its parent (SYG405)
Counter.calculated = { double: state => state.count * 2 } // read as state.double
Counter.context = { total: state => state.count }        // all descendants: ({ context }) => context.total
Counter.intent = ({ DOM }) => ({                          // sources: DOM STATE EVENTS CHILD props$ commands$ + drivers
  STEP:  DOM.input('.step').value(),                      // a bound value={...} needs an input listener (SYG111)
  INC:   DOM.click('.inc'),
  RESET: DOM.click('.reset'),
})
Counter.model = {
  STEP:  (state, step) => ({ ...state, step }),
  INC:   (state, data, next, props) => ({ ...state, count: state.count + Number(state.step) }),
  RESET: (state) => (state.count === 0 ? ABORT : { ...state, count: 0 }),   // "no change" is ABORT
}
export default Counter
```
- Reducer `(state, data, next, props)`: `data` is the action stream's value; `props` holds the parent's props plus `state`, `context`, `children`. `next('ACTION', data?, delayMs = 10)` dispatches another action of this component `delayMs` after the call, whenever it is called (also later, from a callback).
- Model entry: a function is the STATE reducer. An object `{ STATE, EVENTS, PARENT, EFFECT, <DRIVER>: fn }` sends each function's return value to that sink. **Every sink of one entry sees the state from before this action**: compute new values from `(state, data)`.
- Built-in actions (model only): `BOOTSTRAP` (after mount), `DISPOSE` (unmount).
- Enriched DOM streams: `.value()`, `.checked()`, `.key()`, `.data('id', Number)` (reads `data-id`; JSX `data={{ id }}`). `DOM.<event>('.sel')` works for every event name; `DOM.focusout('.form')` bubbles, `DOM.blur('.field')` also works.

## 3. Canonical examples
### EVENTS between any two components; child → parent; Collection
```jsx
import { Collection, event } from 'sygnal'

function TaskItem({ state }) {
  return (
    <li className="task" data={{ id: state.id }}>
      {state.title} <button className="pick">pick</button> <button className="remove">x</button>
    </li>
  )
}
TaskItem.intent = ({ DOM }) => ({ PICK: DOM.click('.pick'), REMOVE: DOM.click('.remove') })
TaskItem.model = {
  PICK: {
    PARENT: (state) => ({ taskId: state.id }),                     // the parent receives exactly this value
    EVENTS: event('TASK_PICKED', (state) => ({ title: state.title })), // global bus: any component can listen
  },
  REMOVE: () => undefined,                                         // a Collection item removes itself
}

function TaskList({ state }) {
  return <div><p className="picked">{state.picked}</p><Collection of={TaskItem} from="tasks" className="tasks" /></div>
}
TaskList.initialState = { picked: null, tasks: [{ id: 1, title: 'Write' }, { id: 2, title: 'Test' }] }
TaskList.intent = ({ CHILD }) => ({ PICKED: CHILD.select(TaskItem) })  // the function, not a string
TaskList.model = { PICKED: (state, { taskId }) => ({ ...state, picked: taskId }) }

function Toast({ state }) { return <p className="toast">{state.lastPicked}</p> }
Toast.intent = ({ EVENTS }) => ({ PICKED: EVENTS.select('TASK_PICKED') })  // emits the payload only
Toast.model = { PICKED: (state, { title }) => ({ ...state, lastPicked: title }) }
```
- Child props: `<Rating name="food" value={state.food} />` → `function Rating({ state, name, value })`; reducers read `props.name`. `state="key"` gives a child that slice; without it the child shares the parent's whole state.
- Collection: items are keyed by `.id` (an item without one is keyed by its index); `filter={t => !t.done}`; `sort="title"`, `{ title: 'desc' }`, an array of those or a compare function. Sorting never reorders the state array, and item edits are written back by key. The items render inside one `<div>`; `className` sets its class. An item edits its own element (`{ ...state, done: true }`).
- A component adds no wrapper element and no attributes, so moving markup into a child keeps the HTML identical.

### Async work in a driver
```jsx
function Quote({ state }) {
  return <div><button className="load">Load</button><p className="text">{state.error || state.text}</p></div>
}
Quote.initialState = { id: 1, text: '', error: null }
Quote.intent = ({ DOM, QUOTE }) => ({
  LOAD:   DOM.click('.load'),
  LOADED: QUOTE.select('quote'),   // { category: 'quote', value }
  FAILED: QUOTE.errors('quote'),   // { error, category, request }
})
Quote.model = {
  LOAD:   { QUOTE: (state) => ({ category: 'quote', value: state.id }) },
  LOADED: (state, { value }) => ({ ...state, text: value.text, error: null }),
  FAILED: (state, { error }) => ({ ...state, error: String(error) }),
}
```
```js
// main.js. A request { category, value } calls fn(value); the reply is { category, value: result }
import { run, driverFromAsync } from 'sygnal'
import Quote from './Quote.jsx'
run(Quote, { QUOTE: driverFromAsync(id => fetch(`/api/quotes/${id}`).then(r => r.json())) })
```
Latest response only: keep a `reqId` in state, send it with the request, have the driver echo it, `ABORT` replies whose id isn't current (llms.txt §3, last paragraph). Debounce and other operators are xstream, not RxJS (llms.txt §4 has the RxJS → xstream table).

### Extract a component without changing the markup
Pin the HTML first (`expect(t.html()).toMatchSnapshot()` on the unchanged code; run once with `npx vitest run -u`). Move the elements verbatim into the child; inputs come in as props, the user's choice goes out through `PARENT` with an id; the parent drops its old selectors for those elements and listens with `CHILD.select(Child)`. The snapshot must still match.

## 4. Wiring rules (silent failures, and what catches them)
- **Selectors only see the component's own JSX.** A parent's `DOM.click('.remove')` never fires for `.remove` rendered by a child or Collection item: handle it in the child and send it up with `PARENT` or `EVENTS` (SYG104; a selector the view never renders is SYG110).
- Every intent action needs a model entry (SYG101); every model entry needs a trigger (SYG102). EVENTS types match exactly (SYG105). Collection `from` names an array field (SYG401).
- A controlled input (`value={state.x}`) needs `DOM.input('.x').value()` (SYG111). `value={null}` clears it.
- Reducers return the complete new state (`{ ...state, ... }`), never mutate, and have no side effects (use EFFECT or a driver).

## 5. Canonical forms (never write the right-hand column)
| Concept | Write | Never write (strict code) |
|---|---|---|
| View signature | `function C({ state, context, ...props })` | positional `(props, state, context)` (SYG501) |
| No change | `return ABORT` | `return state`, `return;`, falling off the end (SYG502) |
| Side effect only | `ACTION: { EFFECT: (state, data, next) => { ... } }` | a STATE reducer that does it and returns ABORT (SYG503) |
| Any non-STATE sink | object form `ACTION: { SINK: fn }` | `'ACTION \| SINK'` keys (SYG504) |
| Emit a global event | `EVENTS: event('TYPE', (state, data) => payload)` | `emit(...)`, raw `{ type, data }` (SYG505) |
| Child → parent | child `PARENT: fn`; parent `CHILD.select(ChildFn)` | `CHILD.select('ChildName')` (SYG506) |
| Top-down data | `.context` | drilling a prop through 3+ levels (SYG507) |

## 6. Testing your change
```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import TaskList from './TaskList.jsx'

let t
afterEach(() => t?.dispose())

it('picks, then removes a task', async () => {
  t = renderComponent(TaskList, { strict: true })   // also: initialState, drivers
  t.simulateEvent('.pick', 'click')                 // first match; bubbles; reaches child components too
  await t.next(s => s.picked === 1)                 // a state emitted after this call
  t.simulateEvent('.task[data-id="2"] .remove', 'click')
  await t.next(s => s.tasks.length === 1)
  await t.settle()                                  // nothing pending anywhere in the tree
  expect(t.html()).not.toContain('Test')
  t.expectNoDiagnostics()                           // throws on any warn/error diagnostic
})
```
- `simulateEvent(sel, type, init?)`: init `{ value }`, `{ checked }`, `{ key: 'Enter' }`; `sel` is a CSS selector (no `:has`, `+`, `~`). A selector that matches nothing fails the test.
- Drivers in tests: `renderComponent(Quote, { drivers: { QUOTE: driverFromAsync(async () => ({ text: 'hi' })) } })`.
- The mock DOM has no real `checked` / `value` / focus; to check those, mount the whole app in jsdom (llms.txt §7, last example). `waitForState`, `t.emitted`, `t.sinkValues`, `simulateAction`, timing: llms.txt §7.

## 7. Where the other facts live (`node_modules/sygnal/llms.txt`)
Print one section: `sed -n '/^## 3\./,/^## 4\./p' node_modules/sygnal/llms.txt` (§7: `sed -n '/^## 7\./,$p'`).
- **§3 Canonical examples**: commands (parent → child calls), document-level events, latest response only, Switchable.
- **§4 API facts**: `run()` options and return value, ABORT in non-STATE sinks, focus events, enriched streams, xstream operators, the RxJS table.
- **§6 Diagnostics**: SYG code ranges, `sygnal-check` flags (`--fix`, `--graph --json`), Vite plugin and runtime modes. **§7 Testing**: every `renderComponent` option and helper, the full-app jsdom test.
- Not in llms.txt (Portal, Transition, Slot, Suspense/lazy, refs, `processForm`, drag-and-drop, SSR, Astro, Vike, TypeScript): https://sygnal.js.org/reference/api/.
