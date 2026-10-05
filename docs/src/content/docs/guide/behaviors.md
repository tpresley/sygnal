---
title: Behaviors
description: Reusable state, intent and model with defineBehavior and the uses static
---

A **behavior** is a piece of state, intent and model that several components share: a pager, a selection, an undo history, a disclosure. A component lists the behaviors it uses in its `uses` static, each under a state key. The behavior then runs on that slice of the component's state, and its actions are named after the key (`pager.NEXT`).

Sygnal ships four behaviors: [`pager`](#pager), [`selection`](#selection), [`undo`](/advanced/undo/) and [`form`](/guide/forms/). You write your own with [`defineBehavior`](#writing-a-behavior). The [UI parts](/ui/overview/) in `sygnal/ui` (dialog, popover, tooltip, tabs, accordion, disclosure) are behaviors too.

## Using a behavior

`uses` maps a state key to a behavior, called with its options:

```jsx
TaskList.uses = { pager: pager({ pageSize: 10, next: '.newer', prev: '.older' }) }
```

This gives the component:

- **state** at `state.pager`: the behavior's own state (`{ page, pageSize, total }`), with its calculated fields (`offset`, `pages`, `hasPrev`, `hasNext`) stored on the slice;
- **actions** `pager.NEXT`, `pager.PREV`, `pager.GOTO` and `pager.SET_TOTAL`, which change only `state.pager`;
- **triggers**: the behavior's intent listens to what its options name. Here a click on the `Newer` button dispatches `pager.NEXT`.

The options that tell a behavior what to listen to take a CSS selector: `next: '.newer'` listens to clicks on the view's `<button className="newer">`. They take a [control](/guide/controls/) too.

Options that name a key of the behavior's state (`pageSize` here) set its starting value.

### Pager

A page cursor over a list. The view slices the list with the calculated `offset`, and the buttons disable at the ends:

```jsx
import { pager } from 'sygnal'

export function TaskList({ state }) {
  const { offset, pageSize, page, pages, hasPrev, hasNext } = state.pager
  return (
    <div>
      <ul>
        {state.tasks.slice(offset, offset + pageSize).map(task => <li>{task.title}</li>)}
      </ul>
      <nav>
        <button className="older" disabled={!hasPrev}>Older</button>
        <span className="page">Page {page + 1} of {pages}</span>
        <button className="newer" disabled={!hasNext}>Newer</button>
      </nav>
    </div>
  )
}

TaskList.initialState = { tasks: [] }
TaskList.uses = { pager: pager({ pageSize: 10, next: '.newer', prev: '.older' }) }
TaskList.model = {
  BOOTSTRAP: { HTTP: () => ({ url: '/api/tasks', ok: 'LOADED' }) },
  LOADED: (state, tasks) => ({ ...state, tasks, pager: { ...state.pager, total: tasks.length } }),
}
```

| | |
|---|---|
| Options | `pageSize` (20), `page` (0), `total` (`null`: unknown), `next` and `prev` (what to listen to for clicks) |
| State | `page`, `pageSize`, `total`; calculated `offset`, `pages` (`null` while `total` is unknown), `hasPrev`, `hasNext` |
| Actions | `NEXT`, `PREV` (no change at the first and last page), `GOTO` (a page number, kept in range), `SET_TOTAL` (the item count) |

Without a `total`, `NEXT` has no upper bound. Set it with an option, with `pager.SET_TOTAL`, or, as the `LOADED` reducer above does, by writing `state.pager.total` from a host reducer: the calculated fields follow.

### Selection

Single or multiple selection over a list, with a select-all toggle:

```jsx
import { selection, isSelected } from 'sygnal'

export function Inbox({ state }) {
  const { count } = state.sel
  return (
    <div>
      <label>
        <input className="pick-all" type="checkbox" checked={count > 0 && count === state.mails.length} /> Select all
      </label>
      <button className="archive" disabled={count === 0}>Archive ({count})</button>
      <ul>
        {state.mails.map(mail => (
          <li>
            <label>
              <input className="pick" type="checkbox" data-id={mail.id} checked={isSelected(state.sel, mail.id)} /> {mail.subject}
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

Inbox.initialState = {
  mails: [{ id: 1, subject: 'Lunch?' }, { id: 2, subject: 'Invoice' }, { id: 3, subject: 'Re: plans' }],
}
Inbox.uses = { sel: selection({ multi: true, item: '.pick', all: '.pick-all', from: 'mails' }) }
Inbox.intent = ({ DOM }) => ({ ARCHIVE: DOM.click('.archive') })
Inbox.model = {
  ARCHIVE: (state) => ({
    ...state,
    mails: state.mails.filter(mail => !isSelected(state.sel, mail.id)),
    sel: { ...state.sel, selected: [] },
  }),
}
```

| | |
|---|---|
| Options | `multi` (false: a click replaces the selection; true: it toggles the item), `item` (a selector for the element on each item), `attr` (the item element's attribute that holds its id, default `data-id`), `all` (a select-all toggle), `clear`, `from` (the host state key of the list, for select-all), `idField` (`'id'`) |
| State | `selected` (the ids, as strings, in selection order); calculated `count` |
| Actions | `SELECT` (an id, or a click on an item), `SELECT_ALL` (an array of ids, or every id of `state[from]`), `TOGGLE_ALL` (all selected → none, else all), `CLEAR` |

Read the selection with `isSelected(state.sel, id)`. Ids compare as strings, so `isSelected(state.sel, 1)` and `isSelected(state.sel, '1')` agree.

### Undo

`undo({ key: 'doc' })` records the changes to `state.doc` and adds `history.UNDO` and `history.REDO`. See [Undo and Redo](/advanced/undo/).

### Sortable

`sortable({ from: 'tasks', item: '.task', handle: '.grip' })` reorders `state.tasks` by mouse, touch and keyboard, announces each step in `state.sort.message` for a live region, and dispatches `sort.DROPPED` once per completed move. See [Drag and Drop](/guide/drag-and-drop/#sortable-lists).

### Form

`form(schema, { values, submit })` is a form with validation: `state.form` holds the values, errors and touched fields, the fields inside the form element are matched by `name`, and a valid submit dispatches the `submit` action with the validated values. See [Forms](/guide/forms/).

## Writing a behavior

`defineBehavior()` takes the same parts as a component, without a view: `initialState`, `intent`, `model`, `calculated` and `timers`. It returns a factory: call it with the options of one use.

```jsx
// behaviors/disclosure.js
import { ABORT, defineBehavior } from 'sygnal'

export const disclosure = defineBehavior({
  initialState: { open: false },
  intent: ({ DOM }, { toggle }) => ({ TOGGLE: DOM.click(toggle) }),
  model: {
    TOGGLE: (slice) => ({ ...slice, open: !slice.open }),
    CLOSE:  (slice) => (slice.open ? { ...slice, open: false } : ABORT),
  },
  calculated: {
    label: (slice) => (slice.open ? 'Hide details' : 'Show details'),
  },
})
```

- `initialState` is the slice a host starts with.
- `intent` receives the host's sources (its DOM, `STATE`, `EVENTS`, `CHILD` and drivers) and the options. Name the actions without the key: the host sees `TOGGLE` as `more.TOGGLE` when it uses the behavior under `more`.
- The `model` reducers receive the slice, not the host's state, and return the new slice. `ABORT` (or the slice itself) means no change. `next('CLOSE')` inside the behavior names its own action.
- `calculated` fields are computed on the slice and stored on it (`state.more.label`).
- A behavior's entries can use every sink a component can: `EVENTS`, `PARENT`, `EFFECT`, drivers.

A host uses it like a first-party behavior:

```jsx
// Product.jsx
import { disclosure } from './behaviors/disclosure.js'

export function Product({ state }) {
  return (
    <section>
      <h2>{state.name}</h2>
      <button className="toggle" aria-expanded={String(state.more.open)}>{state.more.label}</button>
      {state.more.open && <p>{state.description}</p>}
    </section>
  )
}

Product.initialState = { name: 'Desk lamp', description: 'Warm light, three brightness levels.' }
Product.uses = { more: disclosure({ toggle: '.toggle' }) }
```

`state.more` is `{ open: false, label: 'Show details' }` to begin with, and a click on the `.toggle` button dispatches `more.TOGGLE`. To start it open, pass the state key as an option: `disclosure({ toggle: '.toggle', open: true })`.

Two components can use the same behavior, and so can every item of a [Collection](/guide/collections/): each instance gets its own slice. In a Collection item (or any child that gets its state from its parent), `state[key]` reads as the behavior's initial state until the first action writes it.

### Options, the key, host state and timers

Every model handler of a behavior gets the use's options and its key after the usual arguments: `(slice, data, next, props, options, key)`, and the intent gets `(sources, options, key)`. `props.state` is the host's whole state.

Two more parts are for behaviors that reach past their slice:

- **`HOST`**: a model entry `{ HOST: (state, data, next, props, options, key) => newState }` is a reducer on the host's whole state, for a behavior that edits a host field (reordering `state[options.from]`, say). `ABORT`, or the same state, means no change. An entry can have both: `STATE` runs first (on the slice), then `HOST` gets the whole state with that update applied; an `ABORT` from one keeps the other's change.
- **`timers: (slice, options, key) => ({ name: spec })`** declares [timers](/guide/timers/) for the host, as the `timers` static does (the app needs `makeTimerDriver()`). The host sees them as `'<key>.<name>'`; a spec whose `action` names one of the behavior's actions is sent to that action (`'SHOW'` arrives as `'tip.SHOW'`), any other action name goes to the host as written. They run alongside the host's own `timers`.

```jsx
// behaviors/hoverDelay.js
import { defineBehavior } from 'sygnal'

export const hoverDelay = defineBehavior({
  initialState: { pending: false, open: false },
  intent: ({ DOM }, { target }) => ({ ENTER: DOM.mouseenter(target), LEAVE: DOM.mouseleave(target) }),
  timers: (slice, { delay = 300 }) => ({ show: slice.pending && { after: delay, action: 'SHOW' } }),
  model: {
    ENTER: (slice) => ({ ...slice, pending: true }),
    LEAVE: (slice) => ({ ...slice, pending: false, open: false }),
    SHOW: (slice) => ({ ...slice, pending: false, open: true }),
  },
})
```

`Card.uses = { tip: hoverDelay({ target: '.help', delay: 500 }) }` opens `state.tip.open` half a second after the pointer enters `.help`. A behavior that sends a driver request names its [reply actions](/guide/http/) with the key, so they reach its own model: `ok: key + '.LOADED'`.

## Extending a behavior's actions

The host can trigger a behavior action, and add its own entry for one. Both use the namespaced name:

```jsx
// Faq.jsx
import { ABORT } from 'sygnal'
import { disclosure } from './behaviors/disclosure.js'

export function Faq({ state }) {
  return (
    <section>
      <button className="toggle" aria-expanded={String(state.answer.open)}>{state.answer.label}</button>
      {state.answer.open && <p>{state.text}</p>}
      <p className="opened">Opened {state.opened} times</p>
    </section>
  )
}

Faq.initialState = { text: 'Yes, returns are free for 30 days.', opened: 0 }
Faq.uses = { answer: disclosure({ toggle: '.toggle' }) }
Faq.intent = ({ DOM }) => ({
  // a behavior action triggered by the host: Escape closes the answer
  'answer.CLOSE': DOM.keydown('document').key().filter(key => key === 'Escape'),
})
Faq.model = {
  // runs after the behavior's own TOGGLE, on the full state with its update applied
  'answer.TOGGLE': (state) => (state.answer.open ? { ...state, opened: state.opened + 1 } : ABORT),
}
```

The merge rules:

| Host adds | Effect |
|---|---|
| An intent action with a behavior's name (`'answer.CLOSE'`) | Triggers that action. If the behavior has its own trigger for it, the host's replaces it (see [keyboard shortcuts for undo](/advanced/undo/#keyboard-shortcuts)). |
| A STATE reducer for a behavior action (`'answer.TOGGLE'`) | Runs after the behavior's, on the full state with the behavior's update applied. Its `ABORT` keeps that update. |
| An `EFFECT` for a behavior action | Runs after the behavior's `EFFECT`. |
| A value sink (`EVENTS`, `PARENT`, a driver) for a behavior action | Replaces the behavior's value for that sink. |
| A reducer for another action that changes `state[key]` | The slice's calculated fields are recomputed. |

A behavior's [reply actions](/guide/http/) (`ok: 'LOADED'` on a request it sends) arrive under the name it gives; to reach its own model, it names them with its key (`ok: key + '.LOADED'`, see above).

## Testing

`simulateAction` takes the namespaced name, and [`t.actions`](/integration/testing/#action-log-tactions-and-texplain) lists behavior actions under it. A click on a behavior's trigger has the cause `'behavior'`:

```jsx
import { expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Faq } from './Faq.jsx'

const t = renderComponent(Faq)
t.simulateAction('answer.TOGGLE')
await t.next(s => s.answer.open)
expect(t.state.opened).toBe(1)
expect(t.actions.at(-1)).toMatchObject({ type: 'answer.TOGGLE', cause: 'simulateAction', component: 'Faq' })
t.dispose()
```

## SYG127

A `uses` entry that can't work is [SYG127](/reference/errors/#syg127), an error:

- the host's `initialState` already has the key (`initialState = { pager: … }` with `uses = { pager: … }`): set the behavior's values through its options instead;
- the value isn't a behavior: a plain object, or the factory without the call (`uses = { pager }` instead of `pager()`);
- an option the behavior never reads, usually a typo (`pager({ nxt: '.newer' })`). Only `sygnal-check` reports this one.

`sygnal-check` follows `uses` entries to their `defineBehavior()` call in the same file or a relative import, and knows the first-party behaviors (the `sygnal/ui` parts too: an option typo such as `dialog({ clse: '.close' })` is SYG127), so its other rules ([SYG101](/reference/errors/#syg101), [SYG102](/reference/errors/#syg102), …) see the behavior's actions too. A behavior imported from a package is not checked. The dev checks report SYG127 once per component definition.

## TypeScript

`UsesState<typeof uses>` is the state a `uses` object adds and `UsesActions<typeof uses>` its namespaced actions, for a component's state and action types: `type State = { tasks: Task[] } & UsesState<typeof uses>`.
