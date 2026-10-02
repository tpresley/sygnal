---
title: Alternative Forms
description: Non-canonical forms Sygnal still accepts, and their canonical equivalents
---

:::caution[Non-canonical forms]
Everything on this page works and is supported, but it is **not** the canonical way to write Sygnal code. The rest of the documentation only uses the canonical forms. You'll find these forms in older code; [strict mode](/guide/strict-mode/) flags each of them, and `sygnal-check --fix` rewrites most of them automatically.
:::

| Alternative form | Canonical form | Strict code | `--fix` |
|---|---|---|---|
| [`'ACTION \| SINK'` shorthand keys](#model-shorthand) | `ACTION: { SINK: fn }` | SYG504 | yes |
| [`emit('TYPE', fn)`](#emit) | `ACTION: { EVENTS: event('TYPE', fn) }` | SYG505 | yes |
| [Raw `{ type, data }` from an EVENTS sink](#raw-events-objects) | `EVENTS: event('TYPE', fn)` | SYG505 | yes (expression bodies) |
| [Positional view arguments](#positional-view-arguments) | `function C({ state, context, ...props })` | SYG501 | no |
| [`CHILD.select('Name')`](#childselect-with-a-string) | `CHILD.select(ChildFn)` | SYG506 | yes, when the name is in scope |
| [`return state` for "no change"](#returning-the-unchanged-state) | `return ABORT` | SYG502 | no |
| [Side effect in a STATE reducer + `ABORT`](#side-effects-in-a-state-reducer) | `ACTION: { EFFECT: fn }` | SYG503 | no |
| [`HTTP.select()`/`errors()` reading back your own request](#selecterrors-round-trip) | `{ url, ok: 'LOADED', error: 'FAILED' }` | SYG508 | no |
| [Model-sent `{ connections }`](#model-sent-connections) | the `connections` static | — | no |
| [`driverFromAsync` around `fetch`](#driverfromasync-for-http) | `makeFetchDriver()` | — | no |

## Model shorthand

A model key can name the action and a single sink, separated by `|`:

```jsx
// Alternative
App.model = {
  'PLAY | EFFECT':  () => playerCmd.send('play'),
  'DELETE | PARENT': (state) => ({ taskId: state.id }),
  'LOADED | READY':  () => true,
  'FETCH | HTTP':    (state) => ({ url: `/api/items/${state.id}` }),
}

// Canonical
App.model = {
  PLAY:   { EFFECT: () => playerCmd.send('play') },
  DELETE: { PARENT: (state) => ({ taskId: state.id }) },
  LOADED: { READY: () => true },
  FETCH:  { HTTP: (state) => ({ url: `/api/items/${state.id}` }) },
}
```

Details, for reading existing code:

- The key is `'ACTION | SINK'`: an action name, `|`, and a sink name, with optional whitespace. It must be quoted. It works with every sink, built-in or custom.
- Shorthand and object-form entries can be mixed in one model. If both define the same action and sink, both reducers run and Sygnal warns ([SYG213](/reference/errors/#syg213)).
- A key that doesn't split into exactly two non-empty parts throws ([SYG211](/reference/errors/#syg211)).
- Because `|` is reserved for this syntax, an intent action name containing `|` throws ([SYG605](/reference/errors/#syg605)).

The object form keeps every sink an action drives in one place, so adding a second sink later doesn't mean rewriting the key.

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

## Positional view arguments

The view is called as `view(props, state, context, peers)`, so the second and third arguments can be read positionally:

```jsx
// Alternative
const Tile = (props, state) => <div className="tile">{state.value}</div>

// Canonical
function Tile({ state }) {
  return <div className="tile">{state.value}</div>
}
```

The first argument already contains `state`, `context`, `children`, `slots` and the props, so destructuring it gives every view the same signature.

## CHILD.select with a string

`CHILD.select()` also accepts the child component's name:

```jsx
// Alternative
Lane.intent = ({ CHILD }) => ({
  DELETE_TASK: CHILD.select('TaskCard').map(p => p.taskId),
})

// Canonical
import TaskCard from './TaskCard.jsx'

Lane.intent = ({ CHILD }) => ({
  DELETE_TASK: CHILD.select(TaskCard).map(p => p.taskId),
})
```

Name matching breaks when a minifier renames the function, and the parent silently stops receiving the child's events in production. If the child can't be imported (a component resolved at runtime), set a stable name on it: `TaskCard.componentName = 'TaskCard'`.

## Returning the unchanged state

A STATE reducer can signal "no change" by returning the state it received:

```jsx
// Alternative
RENAME: (state, title) => title ? { ...state, title } : state

// Canonical
RENAME: (state, title) => title ? { ...state, title } : ABORT
```

`ABORT` says explicitly that nothing changes, and skips the state update entirely.

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

Before routed requests, a component tagged its request with a `category` and read the reply back in its own intent:

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

The routed form puts the request and the place its reply goes on one line, drops the category string and the intent lines, and delivers the reply to exactly the sending instance. Strict mode flags the round trip as [SYG508](/reference/errors/#syg508). `select()` and `errors()` remain valid, and are not flagged, for unrouted requests whose replies another component reads, for custom drivers that don't route, and for stream-level composition (combining replies with other streams in the intent). With `latest: true`, an unrouted request is superseded per category (`{ category, abort: true }` cancels), a routed one per key (`{ abort: 'LOADED' }`). See [HTTP](/guide/http/#unrouted-requests-select-and-errors).

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
