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
import { controls, undo } from 'sygnal'

const { Note, Undo, Redo } = controls({ Note: 'textarea', Undo: 'button', Redo: 'button' })

export function Editor({ state }) {
  return (
    <div>
      <label>Note <Note value={state.doc.text} /></label>
      <Undo disabled={!state.history.canUndo}>Undo</Undo>
      <Redo disabled={!state.history.canRedo}>Redo</Redo>
    </div>
  )
}

Editor.initialState = { doc: { text: '' } }
Editor.uses = { history: undo({ key: 'doc', coalesceMs: 500, undo: Undo, redo: Redo }) }
Editor.intent = ({ DOM }) => ({ TYPE: DOM.input(Note).value() })
Editor.model = {
  TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }),
}
```

`state.history` is `{ past, future, canUndo, canRedo }`. A click on `Undo` dispatches `history.UNDO`, which puts the newest snapshot from `past` back into `state.doc` and moves the current value to `future`. Any new change clears `future`.

`coalesceMs: 500` joins the changes one action makes less than 500 ms apart into a single step, so typing "hello" quickly is undone at once rather than letter by letter. Without it every change is its own step.

### Keyboard shortcuts

A host intent action with a behavior action's name replaces the behavior's trigger. To undo with Ctrl+Z (⌘Z) as well as the button, leave out the `undo` / `redo` options and trigger the actions from the host:

```jsx
import { controls, undo, xs } from 'sygnal'

const { Note, Undo, Redo } = controls({ Note: 'textarea', Undo: 'button', Redo: 'button' })

export function Editor({ state }) {
  return (
    <div>
      <label>Note <Note value={state.doc.text} /></label>
      <Undo disabled={!state.history.canUndo}>Undo</Undo>
      <Redo disabled={!state.history.canRedo}>Redo</Redo>
    </div>
  )
}

const keys = (DOM, shift) => DOM.select('document').events('keydown')
  .filter(e => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey === shift)

Editor.initialState = { doc: { text: '' } }
Editor.uses = { history: undo({ key: 'doc', coalesceMs: 500 }) }
Editor.intent = ({ DOM }) => ({
  TYPE: DOM.input(Note).value(),
  'history.UNDO': xs.merge(DOM.click(Undo), keys(DOM, false)),
  'history.REDO': xs.merge(DOM.click(Redo), keys(DOM, true)),
})
Editor.model = {
  TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }),
}
```

## undoable()

`undoable(model, options)` wraps a model's STATE reducers and adds `UNDO` and `REDO` entries for your intent to trigger. `state.history` is `{ past, future }` (no calculated fields), and it isn't there until the first change, so read it with a default:

```jsx
import { controls, undoable } from 'sygnal'

const { Note, Undo, Redo } = controls({ Note: 'textarea', Undo: 'button', Redo: 'button' })

export function Editor({ state }) {
  const { past, future } = state.history || { past: [], future: [] }
  return (
    <div>
      <label>Note <Note value={state.doc.text} /></label>
      <Undo disabled={past.length === 0}>Undo</Undo>
      <Redo disabled={future.length === 0}>Redo</Redo>
    </div>
  )
}

Editor.initialState = { doc: { text: '' } }
Editor.intent = ({ DOM }) => ({ TYPE: DOM.input(Note).value(), UNDO: DOM.click(Undo), REDO: DOM.click(Redo) })
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
| `coalesceMs` | `0` (off) | Changes by the same action within this many ms join one step |
| `resetOn` | `[]` | Actions that clear the history |
| `undo`, `redo` | — | (`undo()` only) A control or selector whose clicks dispatch `UNDO` / `REDO` |

A change is a reducer result whose `state[key]` is a different object than before, so reducers that return new objects (as Sygnal reducers do) are recorded. `UNDO` and `REDO` make no change when there is nothing to undo or redo. A model entry of your own for `UNDO` / `REDO` (`'history.UNDO'` with the behavior) runs after the built-in step.

Snapshots are the old values themselves, not copies. Keep `key` on the part of the state the user edits (`doc`), not on the whole state, so the history doesn't hold every loading flag and list position too. For the same reason, when you save the state (to a server or to storage), save `state.doc` and leave `history` out.

## SYG226

A name in `track` or `resetOn` with no model entry is [SYG226](/reference/errors/#syg226) (a warning): its changes are never recorded, or the history is never cleared. It is usually a typo or a renamed action. `sygnal-check` reports it statically; `undoable()` reports it when diagnostics are on, and `undo()` when the component is first created. For `undo()`, the names are the host component's actions, including other behaviors' namespaced ones (`'pager.NEXT'`).
