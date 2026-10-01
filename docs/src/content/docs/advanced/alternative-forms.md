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
