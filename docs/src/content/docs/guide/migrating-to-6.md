---
title: Migrating to 6.0
description: The forms Sygnal 6.0 removed, how to rewrite each one, and the timing and behaviour changes of the new core
---

Sygnal 6.0 runs every component on a new, smaller core: one state store per app, actions that run to completion in order, and one DOM patch per update. The canonical forms (the ones the rest of these docs use) work exactly as before. This page covers what changed:

- [Removed forms](#removed-forms): a few alternative and undocumented forms are gone, each with its rewrite.
- [Timing](#timing): reducers apply synchronously and startup uses no timers. Only tests that drove the clock by hand notice.
- [Behaviour changes](#behaviour-changes): `isolatedState` keeps its parent's data (new `resetState` prop), Collection keys, context tracking.

**Finding the old forms.** In development, the dev checks (`sygnal/diagnostics`, which `sygnal/vite` loads) report each removed form they meet at run time as [SYG612](/reference/errors/#syg612), once per form and component, with a link to its section below. `sygnal-check` reports most of them statically, and `--fix` rewrites some:

```bash
npx sygnal-check src            # SYG612: statics, factory imports, <Collection of="Name">, idfield
npx sygnal-check --strict src   # also SYG501 (positional views), SYG504 ('A | SINK' keys), SYG506 (CHILD.select('Name'))
npx sygnal-check --strict --fix src
```

## Removed forms

| Removed | Use instead | Flagged by |
|---|---|---|
| [String tags, `.components`](#string-tags) | import the component and use it as a JSX tag | SYG612 (dev, static) |
| [`<Collection of="Name">`](#collection-of-name) | `<Collection of={Item}>` | SYG612 (dev, static) |
| [`CHILD.select('Name')`](#child-select-name) | `CHILD.select(Child)` | SYG612 (dev), SYG506 (`--strict --fix`) |
| [`'ACTION \| SINK'` model keys](#pipe-keys) | `ACTION: { SINK: fn }` | SYG612 (dev), SYG504 (`--strict --fix`) |
| [Positional view arguments](#positional-views) | `function C({ state, context, ...props })` | SYG612 (dev), SYG501 (`--strict`) |
| [`.peers`](#peers) | render the peer as a sibling | SYG612 (dev, static) |
| [`hmrActions`](#hmractions) | `BOOTSTRAP` in the model | SYG612 (dev, static) |
| [`DOMSourceName` / `stateSourceName`](#source-names) | the sources are always `DOM` and `STATE` | SYG612 (dev, static; `--fix` for default values) |
| [`storeCalculatedInState`](#storecalculatedinstate) | nothing: calculated fields are always stored | SYG612 (dev, static; `--fix`) |
| [`component({ ... })`, `collection()`, `switchable()`](#component-factory) | a function component, or `defineComponent(opts)` | SYG612 (static: the import) |
| [Undocumented leftovers](#leftovers) | see the table | partly SYG612 / SYG403 |

<a id="string-tags"></a><a id="components"></a>

### String tags and `.components`

A component was registered in its parent's `.components` and rendered by name (`<Badge />` resolved as a string, or `h('Badge')`). In 6.0 a component is always referenced by its function, which also keeps the pragma's fast path. A leftover string tag renders as a plain element.

<!-- docs-check: skip -->
```jsx
// before
Page.components = { Badge }
function Page() { return <div>{h('Badge')}</div> }
```

```jsx
// after
import Badge from './Badge'

function Page() {
  return <div><Badge /></div>
}
```

<a id="collection-of-name"></a>

### `<Collection of="Name">`

`of` takes the item component itself:

<!-- docs-check: skip -->
```jsx
// before
List.components = { Row }
function List() { return <ul><Collection of="Row" from="rows" /></ul> }
```

```jsx
// after
import Row from './Row'

function List() {
  return <ul><Collection of={Row} from="rows" /></ul>
}
```

<a id="child-select-name"></a>

### `CHILD.select('Name')`

<!-- docs-check: skip -->
```jsx
// before
Page.intent = ({ CHILD }) => ({ PICK: CHILD.select('Row') })
```

```jsx
// after
import Row from './Row'

Page.intent = ({ CHILD }) => ({ PICK: CHILD.select(Row) })
```

`sygnal-check --strict --fix` replaces the string with the identifier when that name is in scope (SYG506). `CHILD.select()` with no argument (every child) is gone too: select each child component and merge the streams.

<a id="pipe-keys"></a>

### `'ACTION | SINK'` model keys

<!-- docs-check: skip -->
```jsx
// before
App.model = {
  'SAVE | EFFECT': (state, data) => save(data),
  'PING | EVENTS': () => ({ type: 'PING' }),
}
```

```jsx
// after
App.model = {
  SAVE: { EFFECT: (state, data) => save(data) },
  PING: { EVENTS: event('PING') },
}
```

`sygnal-check --strict --fix` rewrites them (SYG504) when no other entry handles the same action. With the keys gone, `|` is no longer reserved in action names ([SYG605](/reference/errors/#syg605) is retired), and two entries for the same action and sink can't happen ([SYG213](/reference/errors/#syg213) is retired).

<a id="positional-views"></a>

### Positional view arguments

A view is called with one argument. `state`, `context` and the props are its fields:

<!-- docs-check: skip -->
```jsx
// before
function Lane(props, state, context) {
  return <h2>{props.title}: {state.count} {context.theme}</h2>
}
```

```jsx
// after
function Lane({ state, context, ...props }) {
  return <h2>{props.title}: {state.count} {context.theme}</h2>
}
```

`renderToString` already called views with one argument, so a positional view rendered differently on the server.

### `.peers`

A peer was a sibling component that got the parent's sources and was passed to its view as `peers.Name`. Render it as a sibling: it shares state through the `state` prop and reports to the parent through `PARENT` and `CHILD.select`.

<!-- docs-check: skip -->
```jsx
// before
App.peers = { Sidebar }
function App({ state, peers }) { return <main>{peers.Sidebar}<Content /></main> }
```

```jsx
// after
function App({ state }) {
  return <main><Sidebar state="sidebar" /><Content /></main>
}
App.intent = ({ CHILD }) => ({ NAV: CHILD.select(Sidebar) })
```

The view no longer gets a `peers` field.

### `hmrActions`

`sygnal/vite` keeps the app's state across a hot update. An action to run after the swapped app mounts goes in the model's `BOOTSTRAP`:

<!-- docs-check: skip -->
```jsx
// before
App.hmrActions = ['RELOAD_CONFIG']
```

```jsx
// after
App.model = {
  BOOTSTRAP: { EFFECT: (state, data, next) => next('RELOAD_CONFIG') },
  RELOAD_CONFIG: (state) => ({ ...state, configVersion: state.configVersion + 1 }),
}
```

[SYG604](/reference/errors/#syg604) (an invalid `hmrActions` value) is retired.

<a id="source-names"></a>

### `DOMSourceName` / `stateSourceName`

`run()` always wired the root's sources as `DOM` and `STATE`, so a renamed source only ever worked with the `component()` factory. Remove the statics and read `DOM` and `STATE` in the intent. `sygnal-check --fix` deletes them when they name the default (`'DOM'`, `'STATE'`).

### `storeCalculatedInState`

Calculated fields are always part of the component's state, as they were by default. A value only the view needs is computed in the view; code that serializes state skips the calculated keys (`persist()` already does). `sygnal-check --fix` deletes the static.

<a id="component-factory"></a>

### The `component({ ... })` factory, `collection()`, `switchable()`

The options factory and its `sources` / `isolateOpts` options are gone, and so are the low-level `collection()` and `switchable()` helpers. Write a function component with statics, and render `<Collection>` / `<Switchable>` in a view:

<!-- docs-check: skip -->
```jsx
// before
import { component } from 'sygnal'
const Counter = component({ name: 'Counter', view, intent, model, initialState: { n: 0 } })
```

```jsx
// after
function Counter({ state }) {
  return <button className="inc">{state.n}</button>
}
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (state) => ({ ...state, n: state.n + 1 }) }
Counter.initialState = { n: 0 }
```

Code that builds components from data (generators, wrappers) uses `defineComponent(opts)`. It returns an ordinary function component that calls `view`, with the other options as its statics, and `name` as its `componentName`:

```jsx
import { defineComponent } from 'sygnal'

const Counter = defineComponent({
  name: 'Counter',
  view: ({ state }) => <button className="inc">{state.n}</button>,
  intent: ({ DOM }) => ({ INC: DOM.click('.inc') }),
  model: { INC: (state) => ({ ...state, n: state.n + 1 }) },
  initialState: { n: 0 },
})
```

`component({ sources })` (instantiate at once) has no replacement: start the component with `run()`, or test it with `renderComponent()`. The `sygnalFactory` / `sygnalOptions` vnode props were internal: a component vnode now carries the component function (`data.c`); render components with JSX. [SYG413](/reference/errors/#syg413), [SYG414](/reference/errors/#syg414), [SYG419](/reference/errors/#syg419), [SYG601](/reference/errors/#syg601), [SYG607](/reference/errors/#syg607) and [SYG903](/reference/errors/#syg903) described these paths and are retired.

<a id="leftovers"></a>

### Undocumented leftovers

| Before | After |
|---|---|
| `C.intent = (s) => xs.merge(...).map(e => ({ type, data }))` (one stream of `{ type, data }`) | `C.intent = (s) => ({ TYPE: stream$ })` |
| `C.label = 'Name'` as the component's name | the function's name, or `C.componentName = 'Name'` |
| `<Collection idfield="key">` | items with an `id` field (or map them to one) |
| `C.context = { user: 'user', all: true }` | `C.context = { user: (state) => state.user }` ([SYG403](/reference/errors/#syg403) flags the old form) |
| `CHILD.select()` (every child) | one `CHILD.select(Child)` per child, merged |
| `window.__SYGNAL_HMR_STATE`, `__SYGNAL_HMR_UPDATING` | nothing (already unused) |

The types follow: a calculated or context entry is a function (no `boolean` / string entries), and `Component` has no `peers`, `components`, `label`, `storeCalculatedInState` or source-name statics.

## Timing

The 6.0 core has one clock: actions are queued and run to completion in order, and a state change schedules one render a microtask later, which patches the DOM once.

| | 5.x | 6.0 |
|---|---|---|
| STATE reducer | applied in a microtask after the action | applied when the action is processed |
| `INITIALIZE` | a 0 ms timer | at construction (synchronous) |
| intent | subscribed after a 1 ms timer | at creation: an `xs.of(...)` emission is applied before the first render |
| `BOOTSTRAP` | 10 ms after mount | a microtask after the first render |
| a new child's first render | waited until its intent listened | the same render as its creation |
| render loop guard | timers | a `MessageChannel` hop; no timers |
| an action dispatched while another runs (a driver answering at once, an EFFECT's `next()`) | could interleave | runs after the current action and everything it queued (FIFO) |

What can break (in tests; no documented app behaviour changes):

- **Tests that advanced fake timers to start an app.** With raw `run()` and `vi.useFakeTimers()` there is nothing to advance:

  ```js
  // 5.x
  run(App); await vi.advanceTimersByTimeAsync(10) // INITIALIZE, intent, BOOTSTRAP
  // 6.0
  run(App); await Promise.resolve()
  ```

  `renderComponent`'s waits (`ready`, `next`, `settle`) hid the startup timers, so tests using them don't change.
- **Code that read `STATE.stream`'s last value between an action and the next microtask** now sees the new state at once.
- **Tests that awaited one microtask "for the reducer"** still pass; the await is no longer needed.
- **More than 100 renders under fake timers that are never advanced** no longer stall.

Every non-STATE sink still sees the state from before the action's reducer, as documented in [Model](/guide/model/).

## Behaviour changes

### `isolatedState` keeps its parent's data; `resetState`

An `isolatedState` child bound to a slice of its parent (`<Editor state="doc" />` or a lens) seeds the slice with its `initialState` only while the slice is `undefined`. In 5.x it always overwrote the slice when the child was created, so a parent's data was lost each time the child mounted. To start the child from its `initialState` on every mount, add `resetState`:

```jsx
function Page({ state }) {
  return (
    <div>
      <Editor state="draft" />
      <Editor state="scratch" resetState />
    </div>
  )
}
```

`resetState` is read when the child is created, like `state`, and is never a prop of the child. In development, [SYG425](/reference/errors/#syg425) warns when a kept slice lacks keys the child's `initialState` defines, so a field the view reads would be missing. An `isolatedState` child without a `state` prop keeps a state of its own, as before. See [State Management](/guide/state/#isolated-state).

### Collection keys

- Items without an `id` under `filter` or `sort` are keyed by their index in the state array, not in the filtered or sorted list. Showing or hiding an item no longer re-creates the items after it.
- Two items with the same `id`: only the first renders, and [SYG424](/reference/errors/#syg424) warns in development. Give items unique ids.
- An item without an `id` still sees its index as `state.id`, but writing its state back no longer stores that index as an `id` (in 5.x it did, and the stored id later collided with a sibling's index after a removal). Known limit: an id-less item's reducer that sets `id` to the item's own current index (`{ ...state, id: 0 }` on the first item) can't be told apart from the copy it got, so that `id` isn't stored either. Assign ids when the parent creates the items.
- `uid()` in an id-less item uses `_i<index>` for its part, so an item with `id: 0` and the first id-less item no longer render the same DOM ids.
- A Collection whose `from` key is missing when it is created renders once the key appears ([SYG401](/reference/errors/#syg401) still warns). In 5.x it rendered nothing for its whole life.

### Context changes re-render only the components that read them

A view's context reads are recorded, and a context change re-renders only the components whose view read a changed key. This only affects a view that relied on being re-rendered for a side effect, which views shouldn't have. In development, the dev checks re-run a sample of the skipped views and report [SYG423](/reference/errors/#syg423) when one would have rendered differently (for example a view that read the context through a value kept from an earlier render).

### Unchanged

- **Switchable**: a hidden page still renders when it is first shown, as in 5.x.
- **Every canonical form**: components, intent, model, Collections, Switchable, Portals, Transitions, Suspense, `lazy`, statics, behaviors, persistence, the drivers, `renderComponent` and `renderToString`.
