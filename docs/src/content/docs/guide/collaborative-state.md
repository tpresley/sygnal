---
title: Collaborative State (experimental)
description: Share part of the state tree between users through a Yjs document with sygnal/yjs. Reducers stay as they are, remote changes arrive as actions, and undo is per user.
---

`sygnal/yjs` lets several users edit one part of the state at the same time, with or without a connection. A key of your state lives in a [Yjs](https://yjs.dev) document, a CRDT that merges concurrent edits without a server deciding. Your reducers don't change. The driver turns each new value of that key into document operations, and other users' changes come back as an action.

:::caution[Experimental]
`sygnal/yjs` is a dev preview: its API may change in a minor release. It needs `yjs` and `y-protocols`, which are optional peer dependencies:

```bash
npm install yjs y-protocols
```
:::

## Two windows, one list

The two panels below are two users, Ann and Bob, each with their own app and their own Yjs document. On this page every demo gets a `SHARED` driver whose document is a client of one in-memory network (`createNetwork()` from `sygnal/yjs/testing`), so no server is involved. Add an item in one window and it appears in the other. Untick **Online** in one window, edit both lists, then tick it again: the edits merge. **Undo** undoes only that window's own changes.

```jsx live-file=./Board.jsx
// Board.jsx
import { ABORT } from 'sygnal'
import { shared, collection } from 'sygnal/yjs'

export function Board({ state }) {
  const editing = (id) => state.peers.filter((p) => p.editing === id)
  return (
    <section className="board">
      <p className="who">
        <strong>{state.me}</strong>
        <label><input type="checkbox" className="online" checked={state.online} /> Online</label>
        <span>{state.peers.length ? 'Also here: ' + state.peers.map((p) => p.name).join(', ') : 'Nobody else here'}</span>
      </p>
      <label>List <input className="title" value={state.board.title} /></label>
      <ul>
        {state.board.items.map((item) => (
          <li key={item.id} data-id={item.id}>
            <input type="checkbox" className="toggle" checked={item.done} aria-label={'Done: ' + item.text} />
            <input className="text" value={item.text} aria-label="Item" />
            <button className="up" aria-label={'Move up: ' + item.text}>↑</button>
            <button className="remove" aria-label={'Remove: ' + item.text}>✕</button>
            {editing(item.id).map((p) => <em>{p.name} is editing</em>)}
          </li>
        ))}
      </ul>
      <label>New item <input className="draft" value={state.draft} /></label>
      <button className="add">Add</button>
      <button className="undo" disabled={!state.history.canUndo}>Undo</button>
      <button className="redo" disabled={!state.history.canRedo}>Redo</button>
    </section>
  )
}

// state.board is shared; draft, peers, history and online are this window's own
Board.uses = {
  board: shared({
    presence: 'peers',
    history: 'history',
    shape: { title: 'text', items: collection({ text: 'text' }) },
  }),
}

Board.initialState = {
  me: 'Ann',
  board: {
    title: 'Groceries',
    items: [{ id: 'milk', text: 'Milk', done: false }, { id: 'eggs', text: 'Eggs', done: true }],
  },
  draft: '',
  online: true,
  peers: [],
  history: { canUndo: false, canRedo: false },
}

const idOf = (e) => e.target.closest('li').dataset.id

Board.intent = ({ DOM }) => ({
  TITLE: DOM.input('.title').value(),
  EDIT: DOM.input('.text').map((e) => ({ id: idOf(e), text: e.target.value })),
  TOGGLE: DOM.change('.toggle').map(idOf),
  UP: DOM.click('.up').map(idOf),
  REMOVE: DOM.click('.remove').map(idOf),
  FOCUS: DOM.focusin('.text').map(idOf),
  BLUR: DOM.focusout('.text'),
  DRAFT: DOM.input('.draft').value(),
  // ids are made in the intent: a reducer stays pure
  ADD: DOM.click('.add').map(() => crypto.randomUUID()),
  UNDO: DOM.click('.undo'),
  REDO: DOM.click('.redo'),
  ONLINE: DOM.change('.online').map((e) => e.target.checked),
})

const items = (state, f) => ({ ...state, board: { ...state.board, items: f(state.board.items) } })

Board.model = {
  TITLE: (state, title) => ({ ...state, board: { ...state.board, title } }),
  EDIT: (state, { id, text }) => items(state, (xs) => xs.map((x) => (x.id === id ? { ...x, text } : x))),
  TOGGLE: (state, id) => items(state, (xs) => xs.map((x) => (x.id === id ? { ...x, done: !x.done } : x))),
  UP: (state, id) => {
    const xs = state.board.items, i = xs.findIndex((x) => x.id === id)
    if (i < 1) return ABORT
    return items(state, () => [...xs.slice(0, i - 1), xs[i], xs[i - 1], ...xs.slice(i + 1)])
  },
  REMOVE: (state, id) => items(state, (xs) => xs.filter((x) => x.id !== id)),
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state, id) => state.draft.trim()
    ? { ...items(state, (xs) => [...xs, { id, text: state.draft.trim(), done: false }]), draft: '' }
    : ABORT,
  // the driver's commands: this user's undo, presence, the connection
  UNDO: { SHARED: { undo: 'board' } },
  REDO: { SHARED: { redo: 'board' } },
  BOOTSTRAP: { SHARED: (state) => ({ presence: { name: state.me, editing: null } }) },
  FOCUS: { SHARED: (state, id) => ({ presence: { editing: id } }) },
  BLUR: { SHARED: () => ({ presence: { editing: null } }) },
  ONLINE: {
    STATE: (state, online) => ({ ...state, online }),
    SHARED: (state, online) => ({ connect: online }),
  },
}
```

```jsx live
// Ann's window
import { Board } from './Board.jsx'

export default Board
```

```jsx live
// Bob's window: his own copy of Board.jsx (each run evaluates it anew), with his name
import { Board } from './Board.jsx'

Board.initialState = { ...Board.initialState, me: 'Bob' }
export default Board
```

Nothing in the model knows about Yjs. `ADD` returns a new `board` as it would in any Sygnal app; the driver writes the difference to the document.

## The pieces

**`makeYjsDriver({ doc, provider })`** owns the document. Sygnal ships no network code: the app creates the document and its provider (the connection), and passes both in.

```js
// main.js
import { run } from 'sygnal'
import { makeYjsDriver } from 'sygnal/yjs'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Board } from './Board.jsx'

const doc = new Y.Doc()
const provider = new WebsocketProvider('wss://collab.example.com', 'groceries', doc)

run(Board, { SHARED: makeYjsDriver({ doc, provider }) })
```

Any Yjs provider works: y-websocket, Hocuspocus, y-webrtc, Liveblocks' Yjs provider, or y-indexeddb for offline persistence. The driver takes the provider's `awareness` for presence and waits for its first sync before seeding (below).

**`shared(options)`** goes in `uses` under the key it shares: `uses = { board: shared() }` shares `state.board`. Only that key is shared; the rest of the state stays local to each user. Unlike other behaviors, `shared()` adds no state of its own: `state.board` starts from the component's `initialState`.

| Option | |
|---|---|
| `presence: 'peers'` | `state.peers` gets the other users' presence states (`[{ id, name, editing }]`) |
| `history: 'history'` | `state.history` gets `{ canUndo, canRedo }` of this user's own changes |
| `shape` | how fields are stored (below); fields it leaves out are inferred |
| `seed` | `'whenSynced'` (default) or `'ifEmpty'` (below) |
| `driver` | the driver's name, `'SHARED'` by default |

## How changes travel

Every new value of `state.board` goes to the driver as the action `board.LOCAL`, once per render: a burst of actions in one tick becomes one document transaction. The driver compares it with the previous value and writes only what changed: a toggle is about 30 bytes on the wire, however long the list is.

A change from another user arrives as `board.REMOTE` with `{ value, base }`. It applies only while `state.board` is still `base`, the value the driver last saw from this app. If this user has edited the board in the meantime, the remote value is dropped, the local edit is written to the document first, and a fresh `board.REMOTE` brings back the merged result. A remote change never overwrites an edit that hasn't reached the document yet.

`board.LOCAL` and `board.REMOTE` are built-in actions: DevTools' Actions panel hides them with `INITIALIZE` unless you show built-in actions. Everything else about them is ordinary. A reducer for `board.REMOTE` in your own model runs after the built-in one, so you can react to remote changes.

## Shape

By default the driver infers how each field is stored from its value:

- an object becomes a map of fields: two users changing different fields both win;
- an array of objects that all have an `id` becomes a **collection**: items stored by id, with an order key each. Concurrent adds, edits, moves and removes of different items all survive. A moved item that someone else edited keeps the edit, and an item moved to two places by two users ends up in one;
- any other array becomes a list of plain values;
- anything else is a single value: the last write wins.

A string is a single value too, so when two users type in the same field at once, one of them wins. Declare it `'text'` and their typing merges character by character, as `title` and each item's `text` do in the demo:

```js
shared({ shape: { title: 'text', items: collection({ text: 'text' }), tags: 'list' } })
```

The kinds are `'text'`, `'list'`, `'collection'` (or `collection({ ...item fields })`), `'map'` (or an object of fields) and `'value'`. Declare an empty array: it could become a collection or a list, so without a shape the driver guesses a collection and reports [SYG261](/reference/errors#syg261) in development.

## The first value

With `seed: 'whenSynced'`, the default, the app shows its `initialState` and the driver waits for the provider's first sync. Then:

- if the document is empty (a new room), it is filled from `state.board`;
- otherwise the document's content replaces `state.board`, and any edits the user made before the sync are written on top of it.

Use `seed: 'ifEmpty'` for a document no provider syncs (a local-only document, a test): it is filled at once if it is empty.

Two clients that each fill an empty document before they ever synced (both offline from the start) merge their two first values: items with the same `id` become one, and an item one of them removed before its first sync is still in the other's, so it stays.

## Undo is per user

`UNDO: { SHARED: { undo: 'board' } }` undoes this user's last change to `state.board`, through a `Y.UndoManager` that tracks only this client's changes. If Bob edits an item after Ann adds one, Ann's undo removes her item and keeps Bob's edit. Edits within half a second form one step (`makeYjsDriver({ captureTimeout })`).

Don't put [`undo()`](/guide/behaviors) on a shared key: it restores snapshots of the whole slice, which would take back other users' changes too. In development Sygnal and sygnal-check report it as [SYG260](/reference/errors#syg260).

## Presence

Presence is who is here and what they are doing: names, cursors, the item someone is editing. It is not shared state: it never enters the document and disappears when a user leaves. Send this user's presence as data, `{ SHARED: { presence: { editing: id } } }` (merged into what was sent before), and read everyone else's from `state.peers` with `shared({ presence: 'peers' })`.

## Commands

| Model value for `SHARED` | |
|---|---|
| `{ undo: 'board' }`, `{ redo: 'board' }` | this user's own undo and redo for that key |
| `{ presence: { ... } }` | this user's presence, merged |
| `{ connect: false }`, `{ connect: true }` | the provider's `disconnect()` / `connect()`: work offline and merge later |

## Testing

`createNetwork()` from `sygnal/yjs/testing` connects documents in memory. Each test client is a `renderComponent` with its own driver:

```js
// Board.test.js
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { makeYjsDriver } from 'sygnal/yjs'
import { createNetwork } from 'sygnal/yjs/testing'
import { Board } from './Board.jsx'

const client = (net) => {
  const peer = net.join()
  const t = renderComponent(Board, { drivers: { SHARED: makeYjsDriver({ doc: peer.doc, provider: peer }) } })
  return { t, peer }
}

it('edits made offline merge when both users are back', async () => {
  const net = createNetwork()
  const ann = client(net), bob = client(net)
  // both have the list, then Ann loses her connection
  await ann.t.settle()
  await bob.t.settle()
  ann.peer.offline()
  ann.t.simulateAction('TOGGLE', 'milk')
  bob.t.simulateAction('REMOVE', 'eggs')
  await ann.t.settle()
  await bob.t.settle()
  ann.peer.online()
  await ann.t.waitForState((s) => s.board.items.length === 1)
  await bob.t.waitForState((s) => s.board.items[0].done)
  expect(ann.t.state.board).toEqual(bob.t.state.board)
})
```

A peer has `offline()` and `online()` (reconnecting syncs the way y-websocket does), `leave()`, and `net.bytes` counts what crossed the network. Without the `SHARED` driver, `renderComponent(Board)` still runs every reducer: the driver's values are recorded like any other sink's (`t.sinkValues('SHARED')`).

## Limits

- Only top-level keys can be shared, one `shared()` per key.
- A move is a new order key for the moved item: two users moving the same item at once end with one of the two moves.
- Merging concurrent typing in one `'text'` field is exact when the edits don't overlap; overlapping edits in the same characters are merged approximately.
- Fields are named by their path in the document: avoid `.` and `#` in the keys of a shared object.
- Rooms, authentication and persistence are the provider's job.
