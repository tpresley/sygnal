# Core rewrite 5: migration guide draft (PLAN-4.6 R0)

A draft of the 6.0 migration notes for the PLAN-4.6 removals (D162–D164) and timing changes (D165), plus the D166/D168/D169 additions. R5 writes the real docs page (and the llms.txt/skill updates) from it.

**Flagged today** names the check that finds the old form in 5.x code before upgrading:
- strict codes run under `sygnal-check --strict`, `configureStrict(true)` or `renderComponent({ strict: true })`;
- other codes are runtime diagnostics or `sygnal-check` rules.

"None" means nothing flags it today. R5 should add a `sygnal-check` rule (or a `--migrate` hint) for those rows; see §4.

## 1. Summary

| Change | Decision | Flagged today |
|---|---|---|
| `DOMSourceName` / `stateSourceName` removed: sources are always `DOM` and `STATE` | D162 | None |
| `component({...})` options factory removed: use a function component, or `defineComponent(opts)` | D162 | None |
| `sources` / `isolateOpts` options and the `sygnalFactory` / `sygnalOptions` vnode props removed | D162 | SYG413 (a factory vnode prop that resolves to nothing), runtime only |
| `.components` registry, string JSX tags and `<Collection of="Name">` removed | D163 | SYG414 (a string tag or name not found), runtime only |
| `CHILD.select('Name')` removed: use `CHILD.select(Component)` | D163 | **SYG506** (strict) |
| `'ACTION \| SINK'` model keys removed | D164 | **SYG504** (strict); SYG605 for a `\|` in an intent name |
| Positional view arguments `view(props, state, context, peers)` removed | D164 | **SYG501** (strict) |
| `.peers` removed | D164 | None |
| `hmrActions` removed | D164 | SYG604 (an invalid value only) |
| `storeCalculatedInState: false` removed (calculated fields are always stored) | D164 | None |
| Undocumented leftovers removed: single-stream intent, `.label` as a component name, Collection `idfield`, string/`true` context entries, `CHILD.select()` with no argument, `__SYGNAL_HMR_*` declarations | D164 | SYG403 (a non-function context entry), runtime only |
| STATE reducers apply synchronously; INITIALIZE at construction; BOOTSTRAP a microtask after the first render (not 10 ms) | D165 | None (timing) |
| Context changes re-render only components that read a changed key | D168 | None (fewer renders) |
| New `<Switchable lazy>` | D166 | n/a (new) |
| Id-less Collection items under filter/sort keyed by raw index; duplicate ids warn | D169 | new dev warning |

## 2. Removals (D162–D164)

### 2.1 `DOMSourceName` / `stateSourceName` (D162)

`run()` always wired `STATE` and `DOM` at the root, so a renamed source only ever worked under the low-level `component()` factory.

```js
// before
const Card = component({ view, intent: ({ DOM2 }) => ({ CLICK: DOM2.click('.x') }), DOMSourceName: 'DOM2' })
// after
function Card({ state }) { /* view */ }
Card.intent = ({ DOM }) => ({ CLICK: DOM.click('.x') })
```

### 2.2 The `component({...})` factory, `sources`, `isolateOpts` (D162)

Use a function component with statics. Code that builds components from an options object (generators, wrappers) uses `defineComponent(opts)`. It returns an ordinary function component with the statics assigned, and has no separate instantiation path.

```js
// before
import { component } from 'sygnal'
const Counter = component({ name: 'Counter', view, intent, model, initialState: { n: 0 } })

// after (preferred)
function Counter({ state }) { /* view */ }
Counter.intent = intent
Counter.model = model
Counter.initialState = { n: 0 }

// after (when the options come from data)
import { defineComponent } from 'sygnal'
const Counter = defineComponent({ name: 'Counter', view, intent, model, initialState: { n: 0 } })
```

`component({ sources })` (instantiate immediately) and `isolateOpts` have no replacement:
- render the component with `run()`;
- or test it with `renderComponent()`.

The `sygnalFactory` / `sygnalOptions` vnode props were internal; a hand-built vnode that used them renders the component with JSX instead.

### 2.3 `.components`, string tags, `of="Name"`, `CHILD.select('Name')` (D163)

Reference components by function everywhere.

```jsx
// before
Page.components = { Badge, Row }
function Page() { return <div><Badge /><Collection of="Row" from="rows" /></div> } // or h('Badge')
Page.intent = ({ CHILD }) => ({ PICK: CHILD.select('Row') })

// after
import Badge from './Badge'
import Row from './Row'
function Page() { return <div><Badge /><Collection of={Row} from="rows" /></div> }
Page.intent = ({ CHILD }) => ({ PICK: CHILD.select(Row) })
```

**Flagged:** SYG506 (strict) for `CHILD.select('Row')`; SYG414 at runtime for a string tag that isn't registered.

### 2.4 `'ACTION | SINK'` model keys (D164)

```js
// before
App.model = { 'SAVE | EFFECT': (s, d) => save(d), 'PING | EVENTS': () => ({ type: 'PING' }) }
// after
App.model = {
  SAVE: { EFFECT: (s, d) => save(d) },
  PING: { EVENTS: event('PING') },
}
```

**Flagged:** SYG504 (strict); `sygnal-check --strict --fix` rewrites it.

### 2.5 Positional view arguments (D164)

```js
// before
function Lane(props, state, context) { return <h2>{props.title}: {state.count} {context.theme}</h2> }
// after
function Lane({ state, context, ...props }) { return <h2>{props.title}: {state.count} {context.theme}</h2> }
```

**Flagged:** SYG501 (strict). SSR already called views with one argument, so a positional view rendered differently on the server.

### 2.6 `.peers` (D164)

A peer was a sibling component that received the parent's sources and was passed to its view. Render it as a sibling instead.
- It shares state through the `state` prop.
- It reports to the parent through PARENT and `CHILD.select`.

```jsx
// before
App.peers = { Sidebar }
function App({ state }, _s, _c, peers) { return <main>{peers.Sidebar}<Content /></main> }

// after
function App({ state }) { return <main><Sidebar state="sidebar" /><Content /></main> }
App.intent = ({ CHILD }) => ({ NAV: CHILD.select(Sidebar) })
```

**Flagged:** nothing today (R5: a `sygnal-check` rule for `.peers`).

### 2.7 `hmrActions` (D164)

HMR keeps the state (`sygnal/vite`); actions to replay after a hot swap go in the model's `BOOTSTRAP`, which runs once after the swapped app mounts.

```js
// before
App.hmrActions = ['RELOAD_CONFIG']
// after
App.model = { BOOTSTRAP: { EFFECT: (s, d, next) => next('RELOAD_CONFIG') }, RELOAD_CONFIG: /* ... */ }
```

**Flagged:** SYG604 only for an invalid value.

### 2.8 `storeCalculatedInState: false` (D164)

Calculated fields are always stored in the component's state; they were by default.
- Code that needs a value only in the view computes it there.
- Code that serializes state skips the calculated keys; `persist()` already does.

**Flagged:** nothing today.

### 2.9 Undocumented leftovers (D164)

| Before | After |
|---|---|
| `C.intent = (s) => xs.merge(...).map(e => ({ type, data }))` (one stream of `{type, data}`) | `C.intent = (s) => ({ TYPE: stream$ })` |
| `C.label = 'Name'` as the component's name | the function's name, or `C.componentName = 'Name'` |
| `<Collection idfield="key">` | items with an `id` field (or map them to one) |
| `C.context = { user: 'user', all: true }` | `C.context = { user: (s) => s.user }` (SYG403 flags the old form at runtime) |
| `CHILD.select()` (every child) | one `CHILD.select(Child)` per child, merged |
| `window.__SYGNAL_HMR_STATE`, `__SYGNAL_HMR_UPDATING` | nothing (already dead) |

## 3. Behaviour changes

### 3.1 Synchronous reducers, startup without timers (D165)

| | 5.x | 6.0 |
|---|---|---|
| STATE reducer | applied in a microtask after the action | applied when the action is processed |
| INITIALIZE | a 0 ms timer | at construction (synchronous) |
| intent | subscribed after a 1 ms timer | at creation (an `xs.of(...)` emission is applied before the first render) |
| BOOTSTRAP | 10 ms after mount | a microtask after the first render |
| first render of a new child | gated until its intent listened (D153) | same flush as its creation |
| render loop guard | timers | a `MessageChannel` hop; no timers |

What can break (all in tests, none in documented app behaviour):
- **Tests that advanced fake timers to start an app.** With raw `run()` and `vi.useFakeTimers()`:
  ```js
  // before
  run(App); await vi.advanceTimersByTimeAsync(10) // INITIALIZE, intent, BOOTSTRAP
  // after: nothing to advance
  run(App); await Promise.resolve()
  ```
  `renderComponent`'s waits (`ready`, `next`, `settle`) hid this, so tests using them don't change.
- **Code that read `STATE.stream._v` (or a listener's last value) between an action and the next microtask.** It now sees the new state immediately.
- **Tests that `await`ed one microtask "for the reducer"** still pass; the await is unnecessary.
- **More than 100 renders under never-advanced fake timers** (G-284) no longer stall.

Every non-STATE sink still sees the state from before the action (the documented rule). Sinks of one action reach their drivers in model order, statics first (D170/Q21, undocumented).

### 3.2 Context read-tracking (D168)

A context change re-renders only the components whose view read a changed key. This only affects a view that relied on being re-rendered for a side effect, which isn't supported (views are pure).

```jsx
function Badge({ context }) { return <b>{context.user.name}</b> } // re-renders when `user` changes, not when `theme` does
```

### 3.3 `<Switchable lazy>` (D166, new)

```jsx
<Switchable of={{ list: List, settings: Settings }} current={state.tab} lazy />
```

Hidden pages without `lazy` render at mount, as before. With `lazy`, a hidden page's view first runs when the page is first shown. Its intent, actions and `background: true` statics run from mount.

### 3.4 Collection keys (D169)

Items without an `id` under `filter`/`sort` are now keyed by their index in the state array, not in the filtered or sorted list (G-291). Showing or hiding an item no longer re-creates the items after it. Two items with the same `id` warn in development (SYG424); only the first renders (D177); give them unique ids.

An item without an `id` still sees its index as `state.id`, as before. Writing it back no longer stores that index as an `id` (G-306: today a write-back adds it, which later collides with a sibling's index after a removal). Known limit (G-321): an id-less item's reducer that sets `id` to the item's own current index (`{...s, id: 0}` on the first item) can't be told from the copy it got, so that `id` isn't stored either. Assign ids when the items are created (in the parent), not from the item.

`uid()` in an id-less item uses `_i<index>` for its part (G-322): an item with `id: 0` and the id-less first item no longer render the same DOM ids.

## 4. For R5

- Add `sygnal-check` rules (or a `--migrate` mode) for the forms nothing flags: `DOMSourceName`/`stateSourceName`, `component(` imported from `sygnal`, `.components =`, `.peers =`, `storeCalculatedInState`, `idfield`, `.label =`, and a single-stream intent.
- Promote SYG501/504/506 from strict-only to always-on in `sygnal-check` for 6.0 (the forms no longer work).
- Decide what the new core does when it meets a removed form at runtime: ignore it silently, or report a SYG error naming the migration (recommended: a one-time dev error with a docs link; nothing in production builds).
- Retire the codes that only described removed forms (SYG413, SYG414, SYG604), keeping their numbers reserved and their docs entries as "removed in 6.0".
