---
title: Alternative Forms
description: Non-canonical forms Sygnal still accepts, and their canonical equivalents
---

:::caution[Non-canonical forms]
Everything on this page works and is supported, but it is **not** the canonical way to write Sygnal code. The rest of the documentation only uses the canonical forms. You'll find these forms in older code; [strict mode](/guide/strict-mode/) flags most of them, and `sygnal-check --fix` rewrites most of them automatically.
:::

Sygnal 6.0 removed several forms that used to be listed here: `'ACTION | SINK'` model keys, positional view arguments, `CHILD.select('Name')`, `.components` and string tags, `.peers`, the `component({ ... })` factory and a few more. They no longer work; [Migrating to 6.0](/guide/migrating-to-6/) shows how to rewrite each one.

| Alternative form | Canonical form | Strict code | `--fix` |
|---|---|---|---|
| [`emit('TYPE', fn)`](#emit) | `ACTION: { EVENTS: event('TYPE', fn) }` | SYG505 | yes |
| [Raw `{ type, data }` from an EVENTS sink](#raw-events-objects) | `EVENTS: event('TYPE', fn)` | SYG505 | yes (expression bodies) |
| [`return state` for "no change"](#returning-the-unchanged-state) | `return ABORT` | — (SYG502 retired in 6.0) | no |
| [Side effect in a STATE reducer + `ABORT`](#side-effects-in-a-state-reducer) | `ACTION: { EFFECT: fn }` | SYG503 | no |
| [`HTTP.select()`/`errors()` reading back your own request](#selecterrors-round-trip) | `{ url, ok: 'LOADED', error: 'FAILED' }` | SYG508 | no |
| [Model-sent `{ connections }`](#model-sent-connections) | the `connections` static | — | no |
| [`driverFromAsync` around `fetch`](#driverfromasync-for-http) | `makeFetchDriver()` | — | no |
| [Controls](#controls-instead-of-class-selectors) (`controls()`, `<Add>`, `DOM.click(Add)`) | class and attribute selectors: `<button className="add">`, `DOM.click('.add')` | — | the other way: `--fix --controls` converts selectors to controls (opt-in) |

## emit()

`emit(type, payload?)` builds a whole model entry `{ EVENTS: fn }`:

```jsx
// Alternative
Lane.model = {
  DELETE_LANE: emit('DELETE_LANE', (state) => ({ laneId: state.id })),
  ARCHIVE: { ...emit('ARCHIVED', (state) => state.id), STATE: (state) => ({ ...state, archived: true }) },
}

// Canonical
Lane.model = {
  DELETE_LANE: {
    EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })),
  },
  ARCHIVE: {
    STATE:  (state) => ({ ...state, archived: true }),
    EVENTS: event('ARCHIVED', (state) => state.id),
  },
}
```

`event()` returns just the sink function, so it composes with other sinks without spreading. Both helpers take the same arguments: a function `(state, data, next, props) => payload`, a static payload (`event('SET_MODE', 'dark')`), or nothing (`event('RESET')`), and both are type-checked against the [`SygnalEvents` registry](/integration/typescript/#typed-events). `emit()` is a supported alias and isn't deprecated.

## Raw EVENTS objects

An `EVENTS` sink can return the `{ type, data }` object itself:

```jsx
// Alternative
Publisher.model = {
  NOTIFY: {
    EVENTS: (state) => ({ type: 'NOTIFICATION', data: { message: state.message } }),
  },
}

// Canonical
Publisher.model = {
  NOTIFY: {
    EVENTS: event('NOTIFICATION', (state) => ({ message: state.message })),
  },
}
```

With `event()` the event name sits next to the call, where `sygnal-check` and the type checker can read it.

## Returning the unchanged state

Since 6.0, a STATE reducer that returns the state object it received means "no change", exactly like `ABORT`: no state is emitted and nothing re-renders.

```jsx
// Also "no change" since 6.0
RENAME: (state, title) => title ? { ...state, title } : state

// The form the docs use
RENAME: (state, title) => title ? { ...state, title } : ABORT
```

Both are fine, and strict mode flags neither (SYG502, which flagged `return state` before 6.0, is retired). The rest of the docs write `ABORT` because it says "no change" explicitly. Changing the state in place and then returning it is a bug, not an alternative: the change is ignored, and the dev checks report [SYG222](/reference/errors/#syg222).

## Side effects in a STATE reducer

Before the `EFFECT` sink existed, a side-effect-only entry was a STATE reducer that returned `ABORT`:

```jsx
// Alternative
PLAY: () => {
  playerCmd.send('play')
  return ABORT
}

// Canonical
PLAY: {
  EFFECT: () => playerCmd.send('play'),
}
```

See [Effect Handlers](/advanced/effect/).

## select/errors round trip

Before reply actions, a component tagged its request with a `category` and read the reply back in its own intent:

```jsx
// Alternative
Quote.intent = ({ DOM, HTTP }) => ({
  LOAD:   DOM.click('.get'),
  LOADED: HTTP.select('quote'),
  FAILED: HTTP.errors('quote'),
})
Quote.model = {
  LOAD:   { HTTP: () => ({ category: 'quote', url: '/api/quote' }) },
  LOADED: (state, { value }) => ({ ...state, quote: value }),
  FAILED: (state, { status }) => ({ ...state, status }),
}

// Canonical
Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.get') })
Quote.model = {
  LOAD:   { HTTP: () => ({ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }) },
  LOADED: (state, quote) => ({ ...state, quote }),        // the parsed body
  FAILED: (state, { status }) => ({ ...state, status }),
}
```

The reply-action form puts the request and the place its reply goes on one line, drops the category string and the intent lines, and delivers the reply to exactly the sending instance. Strict mode flags the round trip as [SYG508](/reference/errors/#syg508). `select()` and `errors()` remain valid, and are not flagged, for requests without reply actions whose replies another component reads, for custom drivers without reply actions, and for stream-level composition (combining replies with other streams in the intent). With `latest: true`, a request without reply actions is superseded per category (`{ category, abort: true }` cancels), one with reply actions per key (`{ abort: 'LOADED' }`). See [HTTP](/guide/http/#requests-without-reply-actions-select-and-errors).

## Model-sent connections

A model entry can send the `{ connections }` value to a `makeSocketDriver()` sink itself, instead of declaring a `connections` static:

```jsx
// Alternative
Chat.model = {
  JOIN: {
    STATE: (state, room) => ({ ...state, room }),
    WS:    (state, room) => ({ connections: { room: { socket: `/ws/rooms/${room}`, message: 'RECEIVED' } } }),
  },
  LEAVE: {
    STATE: (state) => ({ ...state, room: null }),
    WS:    () => ({ connections: {} }),
  },
}

// Canonical
Chat.connections = (state) => ({
  room: state.room && { socket: `/ws/rooms/${state.room}`, message: 'RECEIVED' },
})
Chat.model = {
  JOIN:  (state, room) => ({ ...state, room }),
  LEAVE: (state) => ({ ...state, room: null }),
}
```

The static is derived from state, so every action that changes the room keeps the connection right, and it is sent once at startup. Each `{ connections }` value is the instance's whole set, so **don't use both in one component**: the static and a model-sent value replace each other's connections. See [Sockets](/guide/sockets/).

## driverFromAsync for HTTP

`driverFromAsync` around `fetch` works, but it can't cancel a request, so it has no `latest` or abort-on-unmount, and every component re-implements status handling and parsing:

```jsx
// Alternative
// main.js: run(App, { API: driverFromAsync(async (url) => (await fetch(url)).json()) })
Quote.model = {
  LOAD:   { API: (state) => ({ value: `/api/quotes/${state.id}`, ok: 'LOADED', error: 'FAILED' }) },
}

// Canonical
// main.js: run(App, { HTTP: makeFetchDriver() })
Quote.model = {
  LOAD:   { HTTP: (state) => ({ url: `/api/quotes/${state.id}`, ok: 'LOADED', error: 'FAILED', latest: true }) },
}
```

`makeFetchDriver()` also turns non-2xx responses into failures with `status` and `body`, handles timeouts, query strings and JSON bodies, and is faked in tests. Keep `driverFromAsync` for promise APIs that aren't HTTP. See [HTTP](/guide/http/).

## Controls instead of class selectors

`controls()` names an element with an identifier instead of a class string. The view renders the control as a tag, and the intent, behaviors, element commands and tests take the same identifier:

```jsx
// Alternative
import { controls } from 'sygnal'

const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })

function AddTodo({ state }) {
  return <div><label>New todo <Draft value={state.draft} /></label><Add>Add</Add></div>
}
AddTodo.intent = ({ DOM }) => ({ DRAFT: DOM.input(Draft).value(), ADD: DOM.click(Add) })
// tests: t.simulateEvent(Add, 'click'); behaviors: pager({ next: Newer }); commands: { focus: Draft }

// Canonical
function AddTodo({ state }) {
  return <div><label>New todo <input className="draft" value={state.draft} /></label><button className="add">Add</button></div>
}
AddTodo.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), ADD: DOM.click('.add') })
// tests: t.simulateEvent('.add', 'click'); behaviors: pager({ next: '.newer' }); commands: { focus: '.draft' }
```

A control renders its element with a `data-control` attribute and resolves to `[data-control="Add"]` wherever a selector is accepted. Both forms behave the same: isolation, Collections, SSR and hydration are unchanged, and no strict rule flags either. Controls help when you want the link between a view and its intent checked by identifier: a renamed or misspelled control is a reference error or a [SYG110](/reference/errors/#syg110) finding, where a misspelled class silently matches nothing, and the types follow the element (`t.query(Draft)` is an `HTMLInputElement`). They are also the extension point for widget libraries (spec objects). In the 6.0 A/B eval they didn't pay for themselves as the default: a smaller model read a control's name as the button's label (`<Pin>📌</Pin>`) and imported one component's controls into a sibling, so selectors stay canonical. See [Controls](/guide/controls/).
