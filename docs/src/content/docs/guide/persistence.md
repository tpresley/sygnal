---
title: Persistence
description: Save the root component's state to localStorage and restore it on the next visit with persist()
---

`persist()` saves part of the app's state in the browser's storage and puts it back when the app starts again. You declare it once, on the root component: which keys to keep, under which storage key, and in which version of their shape.

```jsx
// TodoApp.jsx
import { ABORT, controls, persist } from 'sygnal'

const { Draft, Add, ShowAll, ShowOpen, StartOver } = controls({
  Draft: 'input', Add: 'button', ShowAll: 'button', ShowOpen: 'button', StartOver: 'button',
})

export function TodoApp({ state }) {
  const shown = state.filter === 'open' ? state.todos.filter((todo) => !todo.done) : state.todos
  return (
    <main>
      <label>New todo <Draft value={state.draft} /></label>
      <Add>Add</Add>
      <ShowAll>All</ShowAll>
      <ShowOpen>Open</ShowOpen>
      <StartOver>Start over</StartOver>
      <ul>{shown.map((todo) => <li>{todo.title}</li>)}</ul>
    </main>
  )
}

TodoApp.initialState = { todos: [], filter: 'all', draft: '' }

TodoApp.intent = ({ DOM }) => ({
  DRAFT: DOM.input(Draft).value(),
  ADD: DOM.click(Add),
  SHOW_ALL: DOM.click(ShowAll),
  SHOW_OPEN: DOM.click(ShowOpen),
  START_OVER: DOM.click(StartOver),
})

TodoApp.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state) => state.draft
    ? { ...state, todos: [...state.todos, { title: state.draft, done: false }], draft: '' }
    : ABORT,
  SHOW_ALL: (state) => ({ ...state, filter: 'all' }),
  SHOW_OPEN: (state) => ({ ...state, filter: 'open' }),
  START_OVER: {
    STATE: (state) => ({ ...state, todos: [], filter: 'all' }),
    PERSIST: { clear: true },
  },
}

// Version 1 saved { items: ['milk', ...] }; version 2 saves { todos: [{ title, done }], filter }
TodoApp.persist = persist({
  key: 'todo-app',
  pick: ['todos', 'filter'],
  version: 2,
  migrate: (old, fromVersion) => fromVersion === 1
    ? { todos: old.items.map((title) => ({ title, done: false })), filter: 'all' }
    : undefined,
})
```

Reload the page and the todos and the filter are still there; the half-typed `draft` is not, because it isn't picked. **Start over** empties the list and removes the saved copy.

## What is saved

The stored value is JSON, `{ version, state }`, under `key`:

```json
{"version":2,"state":{"todos":[{"title":"milk","done":false}],"filter":"all"}}
```

`state` has the top-level keys listed in `pick`, or, with `omit` instead, every key except those. [Calculated fields](/guide/calculated-fields/) are never saved: they are computed again from the restored state. Pick what has to survive a reload (the user's data, a chosen view) and leave out what doesn't (drafts, loading flags, server data you fetch again, an undo history).

Values must survive `JSON.stringify`: plain objects, arrays, strings, numbers, booleans and `null`. A `Date` comes back as a string, and a `Map` or `Set` as `{}`.

## When it is restored

When the app starts, the root component reads the stored entry synchronously, before its first state, and merges the saved keys into `initialState`. The first render already shows the saved todos, and the `INITIALIZE` action carries them: there is no separate "load" step and no flash of the empty list.

`persist` works on the **root component** only, the one passed to `run()`. It saves and restores the app's whole state tree, and a sub-component's state is a slice of it: to save a child's state, pick the key the root keeps it under. On any other component the static is ignored, which is [SYG224](/reference/errors/#syg224) in development and in `sygnal-check`.

## When it is saved

A write happens after the state stops changing for `debounceMs` (100 ms by default), so typing or a burst of actions makes one write. A pending write is also made at once when the page is hidden for good (the `pagehide` event: closing the tab, navigating away) and when the app is disposed. Nothing is written while the picked keys are unchanged, and the initial state is not written back.

## Versions and migrate

`version` (default 1) is saved with the state. When the stored entry has another version, `migrate(old, fromVersion)` turns the old `state` into this version's keys; the result is merged into `initialState` like any restore and saved under the new version on the next write. When `migrate` returns nothing (`undefined` or `null`), or there is no `migrate`, the stored entry is ignored and the app starts from `initialState`.

Bump `version` whenever the shape of a picked key changes, and keep the `migrate` branches for the versions your users may still have.

## Clearing

`PERSIST: { clear: true }` in a model entry removes the stored copy. Like other sinks it can be a function of `(state, data)` that returns the command, or `ABORT` to do nothing:

```jsx
Account.model = {
  LOG_OUT: {
    STATE: (state) => ({ ...state, user: null, cart: [] }),
    PERSIST: { clear: true },
  },
}
```

The state the same action produces isn't saved; the next change is. `PERSIST` needs no driver.

## Several tabs: sync

With `sync: true`, a write made in another tab (or window) of the same site is applied in this one, as a built-in `RESTORE` action whose data is the saved keys. The default `RESTORE` merges them into the state; a `RESTORE` entry in your model replaces it:

```jsx
TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'], version: 2, migrate, sync: true })
```

Clearing in another tab doesn't reset this one: it keeps its state and saves it again on its next change.

## Storage

`storage` is `'local'` (`localStorage`, the default), `'session'` (`sessionStorage`: one tab, until it closes) or an object with synchronous `getItem`, `setItem` and `removeItem`. With `sync`, an object can also have `subscribe(fn)`: call `fn(key, newValue)` when another writer changes a key, and return a function that unsubscribes.

```jsx
const memory = new Map()

export const memoryStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => { memory.set(key, value) },
  removeItem: (key) => { memory.delete(key) },
}
```

Asynchronous storages (IndexedDB, a server) don't fit the synchronous restore. Load from those with a request in `BOOTSTRAP` and save with [`STATE.watch`](/guide/intent/#reacting-to-state-changes-statewatch) instead.

During server rendering nothing is read or written: `renderToString` runs views only.

## Server rendering: hydrate

When the client starts from server-rendered HTML (the [`hydrateState`](/integration/ssr/) state), restoring before the first render would make that render differ from the server's markup. With `hydrate: true` the first render uses the server's state, and the saved keys follow in a `RESTORE` action once it is on the page:

```jsx
App.persist = persist({ key: 'app', pick: ['theme'], hydrate: true })
App.initialState = window.__SYGNAL_STATE__ || App.initialState

run(App, {}, { mountPoint: '#app' })
```

## With undo

Keep an [undo history](/advanced/undo/) out of the saved state: pick the document, not `history`. After a reload the document is back and the history starts empty.

## Diagnostics

| Code | When |
|---|---|
| [SYG642](/reference/errors/#syg642) (warning) | The stored entry isn't JSON, `migrate` threw, or a write failed (the storage is full or blocked). The app continues: from `initialState` after a failed restore, unsaved after a failed write. Printed in production too |
| [SYG223](/reference/errors/#syg223) (warning) | A `pick` or `omit` key that isn't a key of `initialState` (a typo) |
| [SYG224](/reference/errors/#syg224) (error) | `persist` on a component that isn't the root |

## Testing

`renderComponent` gives a persisting root a fake storage. The `storage` option fills it (key to stored entry, or a raw string), `t.storage(key)` reads an entry, and `t.settle()` makes the pending writes:

```jsx
// TodoApp.test.jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { TodoApp } from './TodoApp.jsx'

it('restores version 1 todos and saves version 2', async () => {
  const t = renderComponent(TodoApp, {
    storage: { 'todo-app': { version: 1, state: { items: ['milk'] } } },
  })
  await t.ready()
  expect(t.state.todos).toEqual([{ title: 'milk', done: false }])

  t.simulateAction('DRAFT', 'eggs')
  t.simulateAction('ADD')
  await t.settle()
  expect(t.storage('todo-app')).toEqual({
    version: 2,
    state: { todos: [{ title: 'milk', done: false }, { title: 'eggs', done: false }], filter: 'all' },
  })
  t.dispose()
})
```

The object you pass is used as the storage, not copied: writes land in it, and two `renderComponent` calls given the same object share it, so `sync: true` can be tested with two instances. The fake serves `'local'` and `'session'` alike; a component whose `storage` is an object uses that object.

## Options

| Option | Default | |
|---|---|---|
| `key` | (required) | The storage key |
| `pick` | all keys | The top-level state keys to save |
| `omit` | `[]` | The top-level state keys not to save (instead of `pick`) |
| `version` | `1` | Saved with the state; another stored version goes through `migrate` |
| `migrate` | none | `(old, fromVersion) => keys` for a stored entry of another version; nothing discards it |
| `storage` | `'local'` | `'local'`, `'session'` or a synchronous `{ getItem, setItem, removeItem, subscribe? }` |
| `sync` | `false` | Apply other tabs' writes (a `RESTORE` action) |
| `hydrate` | `false` | Restore after the first render (in `RESTORE`), for server-rendered HTML |
| `debounceMs` | `100` | Wait this long without a state change before writing |

In TypeScript, `pick` and `omit` are checked against the root component's state keys.
