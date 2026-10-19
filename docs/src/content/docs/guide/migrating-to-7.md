---
title: Migrating to 7.0
description: Output sinks see the state after STATE, the timing audit that finds the reducers to check, and child lifetimes that follow their state binding
---

Sygnal 7.0 has two breaking changes:

1. **Reducer timing.** The output sinks of an action (EFFECT, EVENTS, PARENT, HTTP, ...) get the
   state after the action's STATE update. In 6.x every reducer of an action got the state from
   before it.
2. **Binding lifetimes.** When a child's `state` binding points at a different record, Sygnal
   replaces the child with a new instance. In 6.x the child kept the record it was mounted with
   until its key changed.

Nothing else in the 6.x API changes. The [timing audit](#step-by-step) points at the
reducers to check. There is no switch for the old timing: an app moves to 7.0 as a whole. If you
are not ready, [stay on 6.x](#not-ready-yet).

## Reducer timing

### What changed

In every model entry, STATE runs first, whatever the order of the keys. Every other sink
(EFFECT, EVENTS, PARENT, ELEMENT, HTTP and any other driver) then gets the committed state,
calculated fields included, as its first argument and as `props.state`. The fourth argument's
`previousState` is the state from before the action.

| Reducer | `state` in 6.x | `state` in 7.0 | `props.previousState` (7.0) |
|---|---|---|---|
| STATE | before the action | before the action | before the action |
| every other sink | before the action | after STATE | before the action |

When STATE returns `ABORT`, returns the same object or throws, the other sinks still run, with
`state === previousState`. `ABORT` means "no state change", not "cancel the action". Effects
still run synchronously inside the action, and the DOM patch follows it.

The tradeoff: payloads get simpler, because an output reads the value STATE just stored instead
of computing it a second time. A guard that decides whether the action may start reads
`previousState` instead of `state`.

### A value computed twice

An output that computed the new value itself now applies the update twice. A counter that
tells its parent about the new count:

```jsx
// 6.x: PARENT got the old count and added 1 itself
Counter.model = {
  INC: {
    STATE: (state) => ({ ...state, count: state.count + 1 }),
    PARENT: (state) => ({ count: state.count + 1 }),
  },
}
```

On 7.0 that sends 2 after the first click. Read the stored value instead:

```jsx
// 7.0: STATE has already incremented count
Counter.model = {
  INC: {
    STATE: (state) => ({ ...state, count: state.count + 1 }),
    PARENT: (state) => ({ count: state.count }),
  },
}
```

Look for the same pattern in requests that append a message, increment a request id or build a
record alongside STATE.

### A value STATE clears

The opposite case: STATE clears a field and the output needs what was there. In 6.x the output
read `state.draft`; on 7.0 that is the empty string. Read it from `previousState`:

```jsx
Editor.model = {
  SAVE: {
    STATE: (state) => ({ ...state, draft: '' }),
    HTTP: (state, data, next, { previousState }) => ({
      url: '/api/drafts', method: 'POST', json: { text: previousState.draft }, ok: 'SAVED',
    }),
  },
}
```

### Deleting

A component that removes its own state (STATE returns `undefined`: a Collection item removing
itself, or a child bound with `state="draft"` or `byId()` deleting its record) has no new state
to give its outputs. They get its last state, as both `state` and `previousState`, so the 6.x
form keeps working unchanged:

```jsx
import { event } from 'sygnal'

TodoItem.model = {
  REMOVE: {
    STATE: () => undefined,
    EVENTS: event('TODO_REMOVED', (state) => state.id),
  },
}
```

A parent that deletes a record from its own list does get its new state, without the record.
An output that needs the deleted record finds it in `previousState`:

```jsx
import { event } from 'sygnal'

TodoList.model = {
  DELETE: {
    STATE: (state, id) => ({ ...state, todos: state.todos.filter(t => t.id !== id) }),
    EVENTS: event('TODO_DELETED', (state, id, next, { previousState }) =>
      previousState.todos.find(t => t.id === id)),
  },
}
```

### Loading and admission guards

A guard that decides whether an action may start must read the state from before the action.
Repeating `state.status !== 'working'` in both STATE and HTTP now blocks the first request:
STATE has already set `status` to `'working'` when HTTP runs. Keep the output guard, and test
`previousState`:

```jsx
import { ABORT } from 'sygnal'

Worker.model = {
  START: {
    STATE: (state) => (state.status !== 'working' ? { ...state, status: 'working' } : ABORT),
    HTTP: (state, data, next, { previousState }) =>
      previousState.status !== 'working' ? { url: '/api/work', ok: 'DONE' } : ABORT,
  },
  DONE: (state) => ({ ...state, status: 'idle' }),
}
```

The first START sends a request; START actions while it works send none. Don't remove the HTTP
guard: STATE returning `ABORT` does not cancel the other sinks, so without it every START would
send a request. The same applies to loading flags, toggles and any output that should run only
when STATE admitted the action. `sygnal-check` reports [SYG256](/reference/errors#syg256) when
it can prove that an output guard contradicts the same action's literal STATE write, as `HTTP`
testing `state.status` would here. It can't prove every case, so check these guards during the
migration even without a warning.

### Behaviors

A behavior's model handlers follow the same contract: the first argument is the slice after
STATE, `props.state` the host's state after STATE, and `props.previousState` the host's state
from before the action. The slice from before the action is `props.previousState[key]`, with
`key` the sixth argument:

```js
import { defineBehavior } from 'sygnal'

const drafts = defineBehavior({
  initialState: { draft: '' },
  model: {
    SAVE: {
      STATE: (slice) => ({ ...slice, draft: '' }),
      HTTP: (slice, data, next, props, options, key) => ({
        url: '/api/drafts',
        method: 'POST',
        json: { text: props.previousState[key].draft },
        ok: key + '.SAVED',
      }),
    },
  },
})
```

Every built-in behavior (form, chat, compose, commandBar, undo, pager, selection, sortable and
the `sygnal/ui` parts) is on this contract. A host entry next to a behavior's action, such as
`'chat.DONE'`, follows the same rules.

### Libraries for both 6 and 7

A component or behavior published for both versions reads old values as
`props.previousState ?? state`: 6.x has no `previousState`, and there `state` is the old value.
Compute new values from the old ones, as 6.x code did; that gives the same result on both:

```jsx
Counter.model = {
  INC: {
    STATE: (state) => ({ ...state, count: state.count + 1 }),
    PARENT: (state, data, next, props) => {
      const before = props.previousState ?? state
      return { count: before.count + 1 }
    },
  },
}
```

## Step by step

1. **Upgrade** `sygnal` and `sygnal-check` together: `npm install sygnal@7 sygnal-check@latest`.

2. **Turn on the timing audit.** It reports [SYG257](/reference/errors#syg257) when an output
   sink reads a top-level state field that the same action's STATE changed: the reads whose
   value changed with 7.0. Turn it on in tests with the `renderComponent()` option, and in the
   dev server with the Vite plugin's:

   ```js
   const t = renderComponent(App, { timingAudit: true })
   ```

   ```js
   // vite.config.js
   import { defineConfig } from 'vite'
   import sygnal from 'sygnal/vite'

   export default defineConfig({
     plugins: [sygnal({ diagnostics: { timingAudit: true } })],
   })
   ```

   To turn it on for a whole test file or setup file, call `configureTimingAudit(true)` from
   `'sygnal/diagnostics'`; `globalThis.__SYGNAL_TIMING_AUDIT__ = true` does the same before the
   app starts. The audit is part of the dev diagnostics and adds nothing to production builds.

3. **Run the test suite and use the app in dev.** Each report names the component, action, sink
   and field, once each:

   ```text
   [Sygnal SYG257] Counter's 'INC' PARENT read 'count', which the same action's STATE changed:
   since 7.0 it gets the new value (6.x: the old one)
   ```

4. **Decide each report.** If the output wants the new value (a payload built from what STATE
   stored), keep reading `state`, and remove any update the output repeats, as in the counter
   above. If it wants the old value (a cleared field, a deleted record, a guard that admits the
   action), read `props.previousState.<field>`. A nested read reports its top-level field: a read
   of `state.form.values` reports `form`.

5. **Run `sygnal-check`** and fix any [SYG256](/reference/errors#syg256).

6. **Turn the audit off** when the reports are resolved. It is opt-in because in code written
   for 7.0, reading the new value is the intent, and the reports would be noise.

Components and behaviors from other packages count too: check that each supports Sygnal 7, or
run the audit over the screens that use them.

## Binding lifetimes

### What changed

In 6.x a child kept the record it was mounted with until its key changed, so a selection needed
`key={selected.id}`. In 7.0, when the record a child's `state` binding points at changes, Sygnal
disposes the old child and mounts a new one. This applies to:

- a child's `state="path"` when the path changes, and `state={byId(field, id, idKey)}` when the
  field, id or idKey changes;
- a Collection's or VirtualCollection's `from`;
- a Switchable's `state`.

```jsx
// 6.x needed key={selected.id}; 7.0 follows the selection by itself
<Workspace state={byId('projects', selected.id)} />
```

The old child gets its `DISPOSE` action with its last state. Its pending requests, delayed
`next()` actions and subscriptions are cancelled, and every component inside it is disposed. The
new child starts from scratch: `INITIALIZE` and `BOOTSTRAP` run again and its local state
starts from its defaults. Collection items and Switchable pages of the old target are disposed
too, even when the new target has items with the same ids.

**The child's DOM is replaced.** Focus, caret position, scroll position and any text being typed
inside it are lost. Keep an input the user may be typing in while the selection changes outside
the replaced child, or keep its value in the parent's state.

### Deleting the bound record

When the record is deleted (the `byId()` arguments stay the same but the record is gone), the
old child is disposed as well, after the deleting action finishes, so that action's outputs
still run. Its `DISPOSE` gets its last state; a `STATE` change from `DISPOSE` can't bring the
deleted record back. A record added again later with the same id gets a new child, not the old
child's pending work. Children inside a hidden Switchable page are disposed the same way; their
replacements mount when the page is shown again.

### What doesn't replace a child

- A new `byId()` call with the same arguments on every render.
- Editing the record's fields, or reordering the array it's in.
- Switching a Switchable's active page with the same `state` target.

### Keys

You can drop a `key` that only worked around `byId()` selection. A key still resets a child whose
target hasn't changed: change the key and the child starts over.

**A stable key no longer keeps a child across a target change.** In 6.x
`<Editor key="editor" state={byId('docs', id)} />` kept one editor while `id` changed; in 7.0 the
editor is replaced. To keep something across the change (an open panel, a scroll position, a
half-written comment), lift it into the parent's state.

### Custom lenses

Sygnal can't tell whether a new `{ get, set }` lens object points at a different record, so a
child with a custom lens keeps the binding it was mounted with. Give it a key tied to the
selected record, and render it only while that record exists (or include availability in the
key):

```jsx
{doc && <Editor key={doc.id} state={docLens(doc.id)} />}
```

See [Changing the selected record](/guide/state/#changing-the-selected-record).

## Not ready yet?

Stay on 6.x (`npm install sygnal@^6`) until the test suite passes on 7.0 with the audit's reports
resolved. There is no per-component switch for the old timing or the old lifetimes. The current
`sygnal-check` supports both: on 6.x it still reports
[SYG454](/reference/errors/#syg454) for a `byId()` selection without a key.
