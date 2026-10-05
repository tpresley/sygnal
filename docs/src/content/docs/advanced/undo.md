---
title: Undo and Redo
description: Undo history for part of the state with the undo behavior or undoable()
---

Sygnal records undo history for one key of a component's state. Each change to `state[key]` pushes the previous value onto `state.history.past`; undo moves it back, redo forward again. There are two ways to add it:

- the **`undo` [behavior](/guide/behaviors/)**: `uses = { history: undo({ key: 'doc' }) }`, with `canUndo` / `canRedo` in the state and buttons wired through its options;
- the **`undoable()` model wrapper**: `model = undoable({ … }, { key: 'doc' })`, when you want `UNDO` and `REDO` as plain actions of the component.

Both take the same options and keep the same history.

## The undo behavior

```jsx
import { undo } from 'sygnal'

export function Editor({ state }) {
  return (
    <div>
      <label>Note <textarea className="note" value={state.doc.text} /></label>
      <button className="undo" disabled={!state.history.canUndo}>Undo</button>
      <button className="redo" disabled={!state.history.canRedo}>Redo</button>
    </div>
  )
}

Editor.initialState = { doc: { text: '' } }
Editor.uses = { history: undo({ key: 'doc', coalesceMs: 500, undo: '.undo', redo: '.redo' }) }
Editor.intent = ({ DOM }) => ({ TYPE: DOM.input('.note').value() })
Editor.model = {
  TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }),
}
```

`state.history` is `{ past, future, canUndo, canRedo }`. A click on `Undo` dispatches `history.UNDO`, which puts the newest snapshot from `past` back into `state.doc` and moves the current value to `future`. Any new change clears `future`.

`coalesceMs: 500` joins the changes one action makes less than 500 ms apart into a single step, so typing "hello" quickly is undone at once rather than letter by letter. Without it every change is its own step.

### Grouping only some actions

`coalesceMs` alone joins quick repeats of *any* action: two fast clicks on a Larger button would also become one step. To group only typing, list the actions that may join in `coalesce`. Every other action is then always its own step:

```jsx
import { undo } from 'sygnal'

export function Poster({ state }) {
  return (
    <div>
      <label>Headline <input className="headline" value={state.poster.headline} /></label>
      <button className="larger">Larger</button>
      <button className="undo" disabled={!state.history.canUndo}>Undo</button>
      <button className="redo" disabled={!state.history.canRedo}>Redo</button>
      <h1 style={{ fontSize: `${state.poster.size}px` }}>{state.poster.headline}</h1>
    </div>
  )
}

Poster.initialState = { poster: { headline: '', size: 24 } }
Poster.uses = { history: undo({ key: 'poster', coalesce: ['HEADLINE'], coalesceMs: 1000, undo: '.undo', redo: '.redo' }) }
Poster.intent = ({ DOM }) => ({
  HEADLINE: DOM.input('.headline').value(),
  LARGER: DOM.click('.larger'),
})
Poster.model = {
  HEADLINE: (state, headline) => ({ ...state, poster: { ...state.poster, headline } }),
  LARGER: (state) => ({ ...state, poster: { ...state.poster, size: state.poster.size + 4 } }),
}
```

Typing "Sale" and then clicking Larger twice quickly makes three steps: the typing, and each click. A `HEADLINE` change joins only the previous change when that was a `HEADLINE` change too, less than `coalesceMs` earlier; a click in between starts a new step. With `coalesce`, `coalesceMs` defaults to 500.

### Keyboard shortcuts

A host intent action with a behavior action's name replaces the behavior's trigger. To undo with Ctrl+Z (⌘Z) as well as the button, leave out the `undo` / `redo` options and trigger the actions from the host:

```jsx
import { undo, xs } from 'sygnal'

export function Editor({ state }) {
  return (
    <div>
      <label>Note <textarea className="note" value={state.doc.text} /></label>
      <button className="undo" disabled={!state.history.canUndo}>Undo</button>
      <button className="redo" disabled={!state.history.canRedo}>Redo</button>
    </div>
  )
}

const keys = (DOM, shift) => DOM.select('document').events('keydown')
  .filter(e => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey === shift)

Editor.initialState = { doc: { text: '' } }
Editor.uses = { history: undo({ key: 'doc', coalesceMs: 500 }) }
Editor.intent = ({ DOM }) => ({
  TYPE: DOM.input('.note').value(),
  'history.UNDO': xs.merge(DOM.click('.undo'), keys(DOM, false)),
  'history.REDO': xs.merge(DOM.click('.redo'), keys(DOM, true)),
})
Editor.model = {
  TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }),
}
```

In a text field the browser runs its own undo on Ctrl+Z too. To leave undo to the app, prevent the default for those keys: `events('keydown', { preventDefault: (e) => … })` ([Preventing the default action](/guide/intent/#preventing-the-default-action)).

## undoable()

`undoable(model, options)` wraps a model's STATE reducers and adds `UNDO` and `REDO` entries for your intent to trigger. `state.history` is `{ past, future }` (no calculated fields), and it isn't there until the first change, so read it with a default:

```jsx
import { undoable } from 'sygnal'

export function Editor({ state }) {
  const { past, future } = state.history || { past: [], future: [] }
  return (
    <div>
      <label>Note <textarea className="note" value={state.doc.text} /></label>
      <button className="undo" disabled={past.length === 0}>Undo</button>
      <button className="redo" disabled={future.length === 0}>Redo</button>
    </div>
  )
}

Editor.initialState = { doc: { text: '' } }
Editor.intent = ({ DOM }) => ({ TYPE: DOM.input('.note').value(), UNDO: DOM.click('.undo'), REDO: DOM.click('.redo') })
Editor.model = undoable({
  BOOTSTRAP: { HTTP: () => ({ url: '/api/note', ok: 'LOADED' }) },
  LOADED: (state, doc) => ({ ...state, doc }),
  TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }),
}, { key: 'doc', coalesceMs: 500, resetOn: ['LOADED'] })
```

`resetOn: ['LOADED']` clears the history when the note is loaded: undo shouldn't bring back the empty draft from before the load. Actions in `resetOn` are not recorded themselves.

## Options

| Option | Default | |
|---|---|---|
| `key` | (required) | The state key whose value is recorded |
| `limit` | `100` | The most steps kept in `past`; the oldest are dropped |
| `track` | every action with a STATE reducer | Record only these actions' changes. Built-in actions (`INITIALIZE`, `BOOTSTRAP`, …) are recorded only when listed |
| `coalesceMs` | `0` (off); `500` with `coalesce` | Changes by the same action within this many ms join one step |
| `coalesce` | every action | Only these actions' changes join a step (typing); every other action is always its own step |
| `resetOn` | `[]` | Actions that clear the history |
| `undo`, `redo` | — | (`undo()` only) A selector (or a [control](/guide/controls/)) whose clicks dispatch `UNDO` / `REDO` |

A change is a reducer result whose `state[key]` is a different object than before, so reducers that return new objects (as Sygnal reducers do) are recorded. `UNDO` and `REDO` make no change when there is nothing to undo or redo. A model entry of your own for `UNDO` / `REDO` (`'history.UNDO'` with the behavior) runs after the built-in step.

Snapshots are the old values themselves, not copies. Keep `key` on the part of the state the user edits (`doc`), not on the whole state, so the history doesn't hold every loading flag and list position too.

For the same reason, when you save the state, save `state.doc` and leave `history` out. With [`persist()`](/guide/persistence/), pick the document:

```jsx
import { persist } from 'sygnal'

Editor.persist = persist({ key: 'note', pick: ['doc'] })
```

After a reload the note is back and the history starts empty, so the first undo doesn't reach into the previous visit.

## Gestures: one step per drag

A behavior on the same host can mark its actions as one gesture with [`undoStep`](/guide/behaviors/#persisted-state-and-undo-steps). [`sortable`](/guide/drag-and-drop/#undo-and-persist) does: with `undo({ key: 'tasks' })`, a whole drag, pointer or keyboard, is one undo step, recorded when the item is dropped (`sort.DROPPED`). The live keyboard moves and a cancelled drag (Escape, a drop where it started) add no step. While a drag is in progress, `state.history.base` holds the value from before it. This works with `undo()` (the behavior), in either `uses` order; `undoable()` can't see the host's behaviors. With `track`, list the completing action (`'sort.DROPPED'`) to record drags.

## SYG226

A name in `track` or `resetOn` with no model entry is [SYG226](/reference/errors/#syg226) (a warning): its changes are never recorded, or the history is never cleared. It is usually a typo or a renamed action. `sygnal-check` reports it statically; `undoable()` reports it when diagnostics are on, and `undo()` when the component is first created. For `undo()`, the names are the host component's actions, including other behaviors' namespaced ones (`'pager.NEXT'`).
