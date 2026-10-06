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

Canonical forms, API facts, wiring rules and testing for everyday work. This file is the overview; the details are in `references/` (table below), one file per topic. Full spec: `node_modules/sygnal/llms.txt`. **Write only the canonical forms shown here**: `sygnal-check --strict` flags the others (SYG5xx).

## Reference files: read the ones your task needs before writing code

Each file is complete on its topic (1–5 KB). Read the whole file (`Read`, no offset) for every row that matches the task.

| File | Read it when the task… |
|---|---|
| [references/components.md](references/components.md) | has a child component, props, a list of items (`Collection`: keys, removal, filter/sort), tabs/pages (`Switchable`), extracting a component, or a parent calling a child (`createCommand`) |
| [references/model-and-sinks.md](references/model-and-sinks.md) | updates state (`ABORT`, `set`, `toggle`, controlled inputs), sends EVENTS between components, needs EFFECT, focus/scroll/`showModal` (`ELEMENT`), repeating or delayed actions (`timers`), saving to localStorage (`persist`), or reacting to a state change (`STATE.watch`) |
| [references/intent-and-streams.md](references/intent-and-streams.md) | listens to keys, focus/blur, `preventDefault`, document-wide events, reads `data-*`/`value`/`checked` from events, or uses stream operators (debounce, throttle, RxJS → xstream) |
| [references/behaviors-and-forms.md](references/behaviors-and-forms.md) | has a form with validation or server errors (`form` behavior), paging, selection, undo/redo, or reusable state + actions (`uses`, `defineBehavior`) |
| [references/widgets-and-ui.md](references/widgets-and-ui.md) | wraps a third-party widget (chart, date picker, editor: `defineWidget`), uses a web component, a dialog/popover/tooltip/tabs/menu/select/combobox/toast (`sygnal/ui`), React or Zag components, drag to reorder (`sortable`), a long (1k+ rows) list (`VirtualCollection`), visibility/size/media/network sources, or lazy loading |
| [references/http.md](references/http.md) | sends HTTP requests or handles their replies (`makeFetchDriver`, `ok`/`error` actions, `latest`, abort), or wraps another promise API (`driverFromAsync`) |
| [references/resources.md](references/resources.md) | loads data that follows state (`resources`), refreshes it, caches it (`queryCache`), or refetches after a save |
| [references/sockets.md](references/sockets.md) | uses a WebSocket or SSE (`makeSocketDriver`, `connections`) |
| [references/router-and-head.md](references/router-and-head.md) | has URLs/routes, links, route guards, unsaved-change blocking, or sets the document title/meta |
| [references/testing.md](references/testing.md) | writes or fixes tests beyond the basic example below: waiting for state, fake timers, the action log, HTTP/resource/socket/router fakes, TypeScript tests, real-DOM tests (focus, typing) |
| [references/diagnostics.md](references/diagnostics.md) | must interpret a `[Sygnal SYGnnn]` message, SYG code ranges, `sygnal-check` flags, or dev-mode diagnostics settings |
| [references/project-setup.md](references/project-setup.md) | creates or configures a project (Vite config, `main.js`, `run()` options), uses TypeScript types, or needs a feature not covered here (SSR, Astro/Vike, Portals, Transitions, `defineElement`, error-boundary phases) |

## 1. Workflow

**New app** (no prompts): `npm create sygnal-app@latest my-app -- --template vite --js --install` (templates `vite`, `vite-pwa`, `vike`, `astro`; `--ts` for TypeScript). Or in a Vite app: `npm i sygnal`, `npm i -D vitest`, `plugins: [sygnal()]` from `'sygnal/vite'`, and `run(App)` in `src/main.js` (references/project-setup.md).

**The task text is the spec**: copy labels, messages and punctuation verbatim (`Search failed.` keeps its period) and implement it; don't stop to explain or ask. Re-read the task itself, not a summary of it (such as the arguments you passed to this skill).

**Add a feature** (in this order):
1. **State**: add the fields to the root `initialState` (children get state from their parent).
2. **Intent**: name the action and its trigger (`DOM.click('.save')`, `EVENTS.select('X')`, `CHILD.select(Child)`).
3. **Model**: one entry per action; one function per sink (`STATE`, `EVENTS`, `PARENT`, `EFFECT`, drivers).
4. **View**: render from `state` / `context`; add the class names the intent selects.
5. **Test**: `renderComponent(C, { strict: true })` + `simulateEvent` + `t.next` + `expectNoDiagnostics()` (references/testing.md). Run `npm test`, then `npx --no-install sygnal-check --strict` (Vike: `npx --no-install sygnal-check pages --strict`; a dev dependency of `create-sygnal-app` projects, elsewhere `npm i -D sygnal-check`; not installed? rely on the tests' runtime diagnostics).

**Debugging loop**: run `npm test` and read every `[Sygnal SYGnnn]` line; `npx --no-install sygnal-check explain SYGnnn` says what it means and how to fix it. Unclear? `t.actions` shows whether an action ran and what it produced (references/testing.md); check the wiring with `t.inspect()` or `npx --no-install sygnal-check --graph --json` (triggers, selectors' `matched` / `isolationHit`, EVENTS). Fix, re-run, then `--strict` until clean. A silent no-op (a click does nothing, no error) is almost always a §3 wiring rule.

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
Counter.context = { total: state => state.count }        // itself + descendants: ({ context }) => context.total
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
- Reducer `(state, data, next, props)`. `data` is the action stream's value. `next('ACTION', data?, delayMs = 10)` dispatches another action of this component, also later (repeating: the `timers` static, references/model-and-sinks.md). HTTP goes through `makeFetchDriver` (references/http.md), not `fetch` + `next()`. `props`: as the view's 1st arg.
- Model entry: a function is the STATE reducer. An object `{ STATE, EVENTS, PARENT, EFFECT, LOG, <DRIVER>: fn }` maps each sink to a `(state, data, next, props)` function whose return value goes to that sink (`<SINK>: true` forwards `data`).
- **Every sink of one entry sees the state from before this action**: EVENTS, PARENT, EFFECT and drivers never see what STATE returns. Compute the new value from `(state, data)` inside the sink: `INC: { STATE: s => ({ ...s, n: s.n + 1 }), PARENT: s => ({ n: s.n + 1 }) }`.
- Built-in actions (model only): `BOOTSTRAP` (once, just after mount), `INITIALIZE` (sets initialState), `DISPOSE` (unmount). No `HYDRATE` (6.0): SSR data comes from Vike `+data` / `hydrateState`.
- Declaration statics (`connections`, `resources`, `route`, `head`, `timers`) are computed from state and work with or without a model. `uses`, `persist`, `viewTransitions` are reserved too.
- **Imports** (all from `'sygnal'`): `run ABORT set toggle event createCommand makeFetchDriver queryCache makeSocketDriver makeRouter makeHeadDriver makeTimerDriver makeViewTransitionDOMDriver persist defineBehavior pager selection isSelected undo undoable form defineWidget sortable focusWithin makeBrowserDriver driverFromAsync xs debounce throttle delay dropRepeats sampleCombine classes processForm processDrag makeDragDriver Collection VirtualCollection Switchable Portal Transition Slot Suspense lazy createRef createRef$ renderComponent renderToString`; types `Component RootComponent Lens Resource RenderResult`. Never import the JSX runtime by hand; the Vite plugin configures it.

## 3. Wiring rules (silent failures, and what catches them)
- **Selectors are scoped to the component's own JSX (the isolation trap).** A parent's `DOM.click('.remove')` never fires for `.remove` rendered by a child or a Collection item: handle it in the child and send it up with `PARENT` (`CHILD.select(Child)`) or `EVENTS` (SYG104; a selector the view never renders is SYG110). Events still bubble: a listener on an element the parent rendered (`DOM.click('.slot')` around `<Child />`) hears clicks inside the child, after the child's own.
- **Every intent action needs a model entry (SYG101), and every model entry needs a trigger (SYG102)**: an intent action, a built-in, a reply action, or `next('X')`. Names match exactly.
- **EVENTS types must match exactly** between `event('X')` and `EVENTS.select('X')` (SYG105). `event()` is the sink entry itself: `EVENTS: () => event('X')` sends a function, which nothing receives (SYG116).
- **Collection `from` must name an array field of the state** (SYG401). Over a calculated field the list is read-only: item writes and removal (`() => undefined`) are discarded, so use `from="items"` with `sort=`/`filter=`.
- **A controlled input needs an input listener**: `value={state.x}` plus `DOM.input('.x').value()`, otherwise a re-render resets the text (SYG111). `value={null}` clears the field; leaving `value` out makes it uncontrolled.
- Also: reducers return the complete new state (`{ ...state, ... }`); never mutate (a mutated `state` returned as-is is ignored: SYG222); no side effects in views or STATE reducers (use EFFECT or a driver).

## 4. Canonical forms (never write the right-hand column)

| Concept | Write | Never write (strict code) |
|---|---|---|
| View signature | `function C({ state, context, ...props })` | positional `(props, state, context)` (SYG501) |
| No change | `return ABORT` (the same `state` object works too) | mutating `state` and returning it (ignored: SYG222); `return;` or falling off the end (SYG202) |
| Side effect only | `ACTION: { EFFECT: (state, data, next) => { ... } }` | a STATE reducer that does the effect then returns ABORT (SYG503) |
| Any non-STATE sink | object form `ACTION: { SINK: fn }` | `'ACTION \| SINK'` shorthand keys (SYG504) |
| Emit a global event | `EVENTS: event('TYPE', (state, data) => payload)` | `emit(...)`, raw `EVENTS: s => ({ type, data })` (SYG505) |
| Child → parent | child `PARENT: fn`; parent `CHILD.select(ChildFn)` | `CHILD.select('ChildName')` (SYG506) |
| HTTP reply | `HTTP: s => ({ url, ok: 'LOADED', error: 'FAILED' })` | `HTTP.select('cat')` / `errors('cat')` for your own request (SYG508); `fetch` in an EFFECT |
| Top-down data | `.context = { total: (state) => … }` (an object of functions) | drilling a prop through 3+ levels (SYG507); `.context = (state) => ({ … })` (SYG402) |
| Parent → child call | `createCommand()` as a prop; child `commands$.select('name')` | — |

## 5. Basic test (more: references/testing.md)
```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import TaskList from './TaskList.jsx'
let t
afterEach(() => t?.dispose())
it('picks, then removes a task', async () => {
  t = renderComponent(TaskList, { strict: true })   // also: initialState, drivers, timeoutMs
  t.simulateEvent('.pick', 'click')                 // first match; bubbles; reaches child components too
  await t.next(s => s.picked === 1)                 // a state emitted after this call
  t.simulateEvent('.task[data-id="2"] .remove', 'click')
  await t.next(s => s.tasks.length === 1)
  await t.settle()                                  // nothing pending anywhere in the tree
  expect(t.html()).not.toContain('Test')
  t.expectNoDiagnostics()                           // throws on any warn/error diagnostic
})
```
