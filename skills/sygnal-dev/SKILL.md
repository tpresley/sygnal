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

This file is self-sufficient for everyday work: it holds the canonical forms, the API facts, the wiring rules, and the testing recipe.
Full spec: `llms.txt` (in the sygnal package root, `node_modules/sygnal/llms.txt`, or https://sygnal.js.org/llms.txt).
Less common features (Portals, Transitions, Suspense/lazy, Slots, forms, drag-and-drop, PWA, SSR, Astro/Vike, TypeScript) are in `references/component-patterns.md`.

**Write only the canonical forms shown here.** Other forms still run, but `sygnal-check --strict` flags them (SYG5xx).

## 1. Workflow

**New app**: `npm create sygnal-app my-app -- --template vite` (or `vite-pwa`, `vike`, `astro`; add `--ts`). Or add Sygnal to a Vite app: `npm i sygnal`, `npm i -D sygnal-check vitest`, `plugins: [sygnal()]` from `'sygnal/vite'`, and `run(App)` in `src/main.js` (see §9).

**Add a feature** (in this order):
1. **State**: add the fields to the root `initialState` (children get state from their parent).
2. **Intent**: name the action and its trigger (`DOM.click('.save')`, `EVENTS.select('X')`, `CHILD.select(Child)`).
3. **Model**: one entry per action; one function per sink (`STATE`, `EVENTS`, `PARENT`, `EFFECT`, drivers).
4. **View**: render from `state` / `context`; add the class names the intent selects.
5. **Test**: `renderComponent(C, { strict: true })` + `simulateEvent` + `t.next` + `expectNoDiagnostics()` (§7). Run `npm test`, then `npx sygnal-check --strict`. (not installed? `npm i -D sygnal-check`).

**Debugging loop**:
1. Run the tests (`npm test`) and read every `[Sygnal SYGnnn]` line (tests, console, or Vite terminal).
2. `npx sygnal-check explain SYGnnn` says what the code means and how to fix it.
3. Still unclear? Look at the wiring: `t.inspect()` in a test or `npx sygnal-check --graph --json` (components, actions and triggers, selectors with `matched` / `isolationHit`, EVENTS emitters and selectors).
4. Fix, re-run the tests, then `npx sygnal-check --strict` until it reports nothing.
5. Silent no-op (a click does nothing, no error)? It is almost always one of the wiring rules in §5.

## 2. Mental model and component anatomy
- A component is a pure view function plus static properties: `.intent` (WHEN: sources → named action streams), `.model` (WHAT: action → one reducer per sink), `.initialState`.
- There is one state tree. A child sees its parent's whole state, or a slice with `state="key"`. A Collection item sees one array element.
- Every side effect is a sink of a model entry (STATE, EVENTS, PARENT, EFFECT, custom drivers). JSX never has event handlers (`onClick`).
- Streams are xstream, not RxJS. An intent's DOM selectors only see the component's own JSX, never a child component's.

```jsx
import { ABORT } from 'sygnal'

function Counter({ state, context, label }) {  // 1st arg: parent props + state, context, children, slots
  return (
    <div className="counter">
      <span>{label} {state.count} (x2 = {state.double})</span>
      <button className="inc">+</button>
      <button className="reset">reset</button>
    </div>
  )
}
Counter.initialState = { count: 0 }                    // root only: a child gets state from its parent (SYG405)
Counter.calculated = { double: state => state.count * 2 } // or [['count'], fn]; read as state.double
Counter.context = { total: state => state.count }        // all descendants: ({ context }) => context.total
Counter.intent = ({ DOM }) => ({                          // sources: DOM STATE EVENTS CHILD props$ commands$ dispose$ + drivers
  INC:   DOM.click('.inc'),
  RESET: DOM.click('.reset'),
})
Counter.model = {
  INC:   (state, data, next, props) => ({ ...state, count: state.count + 1 }),
  RESET: (state) => (state.count === 0 ? ABORT : { ...state, count: 0 }),
}
Counter.onError = (error, { componentName }) => <div className="error">{componentName} failed</div>
export default Counter
```
- Reducer `(state, data, next, props)`. `data` is the action stream's value. `next('ACTION', data?, delayMs = 10)` dispatches another action. `props` holds the parent's props plus `state`, `context`, `children`, `slots`.
- Model entry: a function is the STATE reducer. An object `{ STATE, EVENTS, PARENT, EFFECT, LOG, <DRIVER>: fn }` maps each sink to a `(state, data, next, props)` function whose return value goes to that sink. `<SINK>: true` forwards `data` as-is.
- Built-in actions (model only): `BOOTSTRAP` (once, just after mount), `INITIALIZE` (automatic: sets initialState), `HYDRATE` (SSR data), `DISPOSE` (unmount).

## 3. Canonical examples
### State update, ABORT, set / toggle, controlled input
```jsx
import { ABORT, set, toggle } from 'sygnal'

function AddTodo({ state }) {
  return (
    <div>
      <input className="draft" value={state.draft} />
      <button className="add">Add</button>
      <button className="help">?</button>
      {state.showHelp && <p className="hint">Type, then Add</p>}
    </div>
  )
}
AddTodo.initialState = { draft: '', todos: [], nextId: 1, showHelp: false }
AddTodo.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.draft').value(),   // a bound value={...} needs an input listener (SYG111)
  ADD:   DOM.click('.add'),
  HELP:  DOM.click('.help'),
})
AddTodo.model = {
  DRAFT: set((state, draft) => ({ draft })),           // merges: ({ ...state, draft })
  ADD: (state) => {
    const text = state.draft.trim()
    if (!text) return ABORT                              // "no change" is ABORT, never `return state`
    return { ...state, draft: '', nextId: state.nextId + 1, todos: [...state.todos, { id: state.nextId, text }] }
  },
  HELP: toggle('showHelp'),
}
```
### Multi-sink entry + EVENTS between non-adjacent components
Siblings and distant components talk through EVENTS; a parent that owns the shared state can instead pass slices down (`state="key"`) and hear children via PARENT.
```jsx
import { event } from 'sygnal'

function SaveButton({ state }) {
  return <button className="save">{state.saving ? 'Saving' : 'Save'}</button>
}
SaveButton.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
SaveButton.model = {
  SAVE: {
    STATE:  (state) => ({ ...state, saving: true }),
    EVENTS: event('DOC_SAVED', (state) => ({ id: state.id })),  // or event('RESET'), event('MODE', 'dark')
  },
}

function Toast({ state }) {   // anywhere in the tree: EVENTS is a global bus
  return <p className="toast">{state.lastSaved}</p>
}
Toast.intent = ({ EVENTS }) => ({ SAVED: EVENTS.select('DOC_SAVED') })  // emits the payload only
Toast.model = { SAVED: (state, payload) => ({ ...state, lastSaved: payload.id }) }
```
`event('TYPE')` with no payload sends `undefined` as the data. A child that only reacts to EVENTS needs no `initialState`; it gets its state from the parent.
### Child → parent (PARENT + CHILD.select), Collection, item removal
```jsx
import { Collection } from 'sygnal'

function TaskItem({ state }) {
  return (
    <li className="task" data={{ id: state.id }}>
      {state.title} <button className="pick">pick</button> <button className="remove">x</button>
    </li>
  )
}
TaskItem.intent = ({ DOM }) => ({ PICK: DOM.click('.pick'), REMOVE: DOM.click('.remove') })
TaskItem.model = {
  PICK:   { PARENT: (state) => ({ taskId: state.id }) },   // the parent receives exactly this value
  REMOVE: () => undefined,                                   // a Collection item removes itself
}

function TaskList({ state }) {
  return (
    <div>
      <p className="picked">{state.picked}</p>
      <Collection of={TaskItem} from="tasks" className="tasks" />
    </div>
  )
}
TaskList.initialState = { picked: null, tasks: [{ id: 1, title: 'Write' }, { id: 2, title: 'Test' }] }
TaskList.intent = ({ CHILD }) => ({ PICKED: CHILD.select(TaskItem) })  // the function, not a string
TaskList.model = { PICKED: (state, { taskId }) => ({ ...state, picked: taskId }) }
```
- `from` names an array field; items are keyed by `.id`. Also `filter={t => !t.done}`, `sort="title"`. An item edits its own element (`{ ...state, done: true }`).
- Switchable: `<Switchable of={{ home: Home, settings: Settings }} current={state.route} />` (optional `state="slice"`).
### Commands (parent → child) + EFFECT
```jsx
import { createCommand } from 'sygnal'

const player = createCommand()

function Player({ state }) {
  return <div className="player">{state.playing ? 'playing' : 'paused'}</div>
}
Player.intent = ({ commands$ }) => ({ PLAY: commands$.select('play') })  // emits send()'s data
Player.model = { PLAY: (state) => ({ ...state, playing: true }) }

function Controls({ state }) {
  return <div><button className="play">Play</button><Player commands={player} state="player" /></div>
}
Controls.initialState = { player: { playing: false } }
Controls.intent = ({ DOM }) => ({ PLAY: DOM.click('.play') })
Controls.model = { PLAY: { EFFECT: () => player.send('play') } }  // EFFECT: side effect only, returns nothing
```
### Drivers (driverFromAsync + errors()), document-level events
```jsx
import { xs } from 'sygnal'

function Quote({ state }) {
  return <div><button className="load">Load</button><p className="text">{state.error || state.text}</p></div>
}
Quote.initialState = { id: 1, text: '', error: null }
Quote.intent = ({ DOM, QUOTE }) => ({
  LOAD:   xs.merge(DOM.click('.load'), DOM.select('document').events('keydown').key().filter(k => k === 'r')),
  LOADED: QUOTE.select('quote'),   // { category: 'quote', value }
  FAILED: QUOTE.errors('quote'),   // { error, category, request }; unheard errors are only console.error'd
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
A driver is any function `sink$ => source`. Page-wide events: `DOM.select('document' | 'body').events(type)`, CSS-filtered with `DOM.select('document').select('.overlay').events('click')`.

## 4. API facts
- **Child props**: `<Rating name="food" value={state.food} />` → `function Rating({ state, name, value })`; reducers read `props.name` (4th arg); intent gets the `props$` stream. Reserved: `state` (lens: `"key"` or `{ get, set }`), `children`, `slots`, `context`, `peers` (SYG106). Without `state=` a child shares its parent's whole state.
- **CHILD.select(Comp)** emits exactly what the child's `PARENT` function returned, for every instance (Collection items too). Put an id in the payload.
- **run(App, drivers = {}, { mountPoint = '#root', diagnostics })** returns `{ sources, sinks, dispose, hmr }`. DOM, EVENTS, LOG and STATE are built in. `app.sources.STATE.stream` is the state stream; `app.dispose()` fires DISPOSE.
- **ABORT**: from a STATE reducer, the state is unchanged; from any other sink, nothing is sent.
- **Focus**: `blur`/`focus` don't bubble, but `DOM.blur('.field')` and `DOM.focus('.field')` work (listener on the element). For any field inside a container use the bubbling `DOM.focusout('.form')` / `DOM.focusin`.
- **Shorthands**: `DOM.<event>('.sel')` = `DOM.select('.sel').events('<event>')` for every event name (`click input change keydown submit dblclick ...`).
- **Enriched streams** (chainable, optional mapper): `.value(fn?)` e.target.value; `.checked(fn?)` boolean; `.key(fn?)` e.key; `.target(fn?)`; `.data('id', Number)` reads `data-id` on the target or its nearest ancestor that has it (JSX: `data={{ id: 7 }}`). camelCase names map to kebab-case attributes: `.data('taskId')` reads `data-task-id`.
- **xstream**: `xs.merge/combine/of/periodic/never/fromPromise`; methods `map mapTo filter startWith fold take drop last endWhen flatten compose remember replaceError debug`. From `'sygnal'`, used with `.compose(...)`: `debounce(ms) throttle(ms) delay(ms) dropRepeats() sampleCombine(other$) flattenConcurrently flattenSequentially`; plus `concat(a$, b$)`.

| RxJS | xstream | RxJS | xstream |
|---|---|---|---|
| `pipe(a, b)` | chain `.a().b()`, `.compose(op)` | `switchMap(f)` | `.map(f).flatten()` |
| `debounceTime(ms)` | `.compose(debounce(ms))` | `throttleTime(ms)` | `.compose(throttle(ms))` |
| `distinctUntilChanged()` | `.compose(dropRepeats())` | `withLatestFrom(b$)` | `.compose(sampleCombine(b$))` |
| `combineLatest(a$, b$)` | `xs.combine(a$, b$)` | `merge(a$, b$)` | `xs.merge(a$, b$)` |
| `scan(f, seed)` | `.fold(f, seed)` | `skip(n)` / `first()` | `.drop(n)` / `.take(1)` |
| `takeUntil(b$)` | `.endWhen(b$)` | `tap(f)` | `.debug(f)` |
| `catchError(f)` | `.replaceError(f)` | `shareReplay(1)` | `.remember()` |
| `mergeMap(f)` | `.map(f).compose(flattenConcurrently)` | `concatMap(f)` | `.map(f).compose(flattenSequentially)` |
(Last row: `import { flattenConcurrently, flattenSequentially, concat } from 'sygnal'`.)

- **Imports** (all from `'sygnal'`): `run ABORT set toggle event createCommand driverFromAsync xs debounce throttle delay dropRepeats sampleCombine classes processForm processDrag makeDragDriver Collection Switchable Portal Transition Slot Suspense lazy createRef createRef$ renderComponent renderToString`; types `Component RootComponent Lens`. Never import the JSX runtime by hand; the Vite plugin configures it.

## 5. Wiring rules (silent failures, and what catches them)
- **Selectors are scoped to the component's own JSX (the isolation trap).** A parent's `DOM.click('.remove')` never fires for `.remove` rendered by a child or a Collection item. Handle the event in the child and send it up with `PARENT` (read with `CHILD.select(Child)`) or `EVENTS`. Caught as SYG104; a selector the view never renders is SYG110.
- **Every intent action needs a model entry (SYG101), and every model entry needs a trigger (SYG102)**: an intent action, a built-in, or `next('X')`. Names match exactly.
- **EVENTS types must match exactly** between `event('X')` and `EVENTS.select('X')` (SYG105).
- **Collection `from` must name an array field of the state** (SYG401).
- **A controlled input needs an input listener**: `value={state.x}` plus `DOM.input('.x').value()`, otherwise a re-render resets the text (SYG111).
- Also: reducers return the complete new state (`{ ...state, ... }`); never mutate; no side effects in views or STATE reducers (use EFFECT or a driver).

## 6. Canonical forms (never write the right-hand column)

| Concept | Write | Never write (strict code) |
|---|---|---|
| View signature | `function C({ state, context, ...props })` | positional `(props, state, context)` (SYG501) |
| No change | `return ABORT` | `return state`, `return;`, or falling off the end (SYG502) |
| Side effect only | `ACTION: { EFFECT: (state, data, next) => { ... } }` | a STATE reducer that does the effect then returns ABORT (SYG503) |
| Any non-STATE sink | object form `ACTION: { SINK: fn }` | `'ACTION \| SINK'` shorthand keys (SYG504) |
| Emit a global event | `EVENTS: event('TYPE', (state, data) => payload)` | `emit(...)`, raw `EVENTS: s => ({ type, data })` (SYG505) |
| Child → parent | child `PARENT: fn`; parent `CHILD.select(ChildFn)` | `CHILD.select('ChildName')` (SYG506) |
| Top-down data | `.context` | drilling a prop through 3+ levels (SYG507) |
| Parent → child call | `createCommand()` as a prop; child `commands$.select('name')` | — |

## 7. Testing your change
```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import TaskList from './TaskList.jsx'

let t
afterEach(() => t?.dispose())

it('picks, then removes a task', async () => {
  t = renderComponent(TaskList, { strict: true })   // also: initialState, drivers, mockConfig, diagnostics
  t.simulateEvent('.pick', 'click')                 // first match; bubbles; reaches child components too
  await t.next(s => s.picked === 1)                 // a state emitted after this call
  t.simulateEvent('.task[data-id="2"] .remove', 'click')
  await t.next(s => s.tasks.length === 1)
  await t.settle()                                  // nothing pending anywhere in the tree
  expect(t.html()).not.toContain('Test')
  t.expectNoDiagnostics()                           // throws on any warn/error diagnostic
})
```
- `simulateEvent(sel, type, init?)`: init `{ value }`, `{ checked }`, `{ key: 'Enter' }`, `{ data: { id: 2 } }`; `'document'` targets `DOM.select('document')` listeners. Calls made before the component is ready are buffered (`await t.ready()` is optional).
- `t.next(pred)` matches only future states. `t.waitForState(pred)` also matches states already recorded (e.g. the initial one), so use it only for a state that can't already exist. Both resolve after the whole tree has rendered. `t.states`, `t.emitted` (EVENTS sent) and `t.sinkValues('PARENT')` are live arrays.
- `t.simulateAction('LOADED', data)` pushes an action straight into intent → model (all sinks run). Use it for actions without a DOM trigger; for drivers prefer `drivers: { QUOTE: driverFromAsync(async () => ({ text: 'hi' })) }`.
- With the Vite plugin, Vitest gets `sygnal/diagnostics` in its setupFiles automatically; otherwise `import 'sygnal/diagnostics'` in the test.
- Full app in jsdom (`npm i -D jsdom`):
```js
// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { run } from 'sygnal'
import Counter from './Counter.jsx'

it('counts in the real DOM', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  const app = run(Counter, {}, { mountPoint: '#root' })
  const tick = () => new Promise(r => setTimeout(r, 30))
  await tick()
  document.querySelector('.inc').click()
  await tick()
  expect(document.querySelector('.counter span').textContent).toContain('1')
  app.dispose()
})
```

## 8. Diagnostics and tools
- Format: `[Sygnal SYG104] Lane: <what is wrong>. <how to fix> https://sygnal.js.org/reference/errors#syg104`. Severities error/warn/info. 1xx wiring, 2xx model/state, 3xx streams (SYG301: RxJS operator on an xstream stream), 4xx components, 5xx strict.
- `npx sygnal-check` (dev dependency `sygnal-check`) checks `src` statically. Use `--strict` for canonical forms, `--fix` to apply the mechanical rewrites (implies `--strict`), and `--json` / `--verbose` for output. `npx sygnal-check explain SYG104` explains a code and its fix. Suppress one line with `// sygnal-ignore SYG110`.
- App graph: `npx sygnal-check --graph --json` (static), `t.inspect()` (test), `getDevTools().inspect()` (running dev app). All return the same `InspectGraph`: components, actions and their triggers, selectors (`matched`, `isolationHit`), EVENTS emitters/selectors, diagnostics.
- Vite plugin in dev (`vite`, never `vite build`): runtime checks print warnings to the console, and sygnal-check runs on start and on every save. Stricter: `sygnal({ diagnostics: { mode: 'error', strict: true }, check: { strict: true } })`.
- Without the plugin: `run(App, drivers, { diagnostics: 'warn' })` and `import 'sygnal/diagnostics'` for the full checks. Runtime strict: `configureStrict(true)` from `'sygnal/diagnostics'`, or `renderComponent(C, { strict: true })`.
- MCP: `claude mcp add sygnal-check -- npx sygnal-check mcp` (tools `check`, `graph`, `explain`).

## 9. Project setup (Vite)
```
my-app/  index.html (<div id="root"></div>, <script type="module" src="/src/main.js">)
         vite.config.js   src/main.js   src/App.jsx   src/App.test.js   src/components/
```
```js
// vite.config.js: the plugin sets up JSX, HMR, dev diagnostics and Vitest
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({ plugins: [sygnal()] })
```
```js
// src/main.js
import { run } from 'sygnal'
import App from './App.jsx'

run(App)   // mounts on #root; pass drivers as the 2nd argument
```
Conventions: PascalCase component files, ALL_CAPS action names, `$` suffix for streams, class-name selectors, `classes()` for conditional class names, root state in one `initialState`, `state="key"` to give a child a slice.

## 10. Where to look next
- `references/component-patterns.md`: Switchable routing, forms (`processForm`), Portals, Transitions, Slots, Suspense/lazy, refs, drag-and-drop, PWA helpers, SSR/hydration, Astro, Vike, TypeScript.
- Full spec: `node_modules/sygnal/llms.txt` / https://sygnal.js.org/llms.txt.
- Error reference (every SYG code): https://sygnal.js.org/reference/errors (or `npx sygnal-check explain SYGnnn`).
- Guides: https://sygnal.js.org/guide/components/, testing: https://sygnal.js.org/integration/testing/, API: https://sygnal.js.org/reference/api/.
