---
title: State Management
description: Managing component and application state
---

## Monolithic State

Sygnal uses a single, monolithic state tree for the entire application. Every component shares this state, though each component typically works with just a slice of it.

Benefits:
- Trivial undo/redo — just restore a previous state snapshot
- Easy debugging — inspect the entire app state in one place
- No state synchronization bugs between components

## Setting Initial State

Set `.initialState` on your root component:

```jsx
RootComponent.initialState = {
  user: { name: 'Alice', age: 30 },
  items: [],
  settings: { theme: 'light' }
}
```

## State in Reducers

Reducers receive the current state and must return the **complete** new state. The return value replaces the state entirely — there is no automatic merging of partial updates:

```jsx
// If state is { count: 0, name: 'World' }
MyComponent.model = {
  // WRONG — this would lose the 'name' property!
  // INCREMENT: (state) => ({ count: state.count + 1 })

  // CORRECT — spread the existing state and override what changed
  INCREMENT: (state) => ({ ...state, count: state.count + 1 })
  // Result: { count: 1, name: 'World' }
}
```

## What every function gets

Every function you write over state takes the same shape: `(subject, …its own arguments, bag)`.

- **The subject** is the state the function is about: the component's state, a behavior's slice, a wizard step's view, or a Collection item.
- **The bag** always comes last. It is the object the view gets: `{ ...props, state, context, uid }`. `bag.state` is the component's whole state; in a behavior's or a wizard step's function, it is the host's.

```jsx
TaskList.resources = {
  tasks: (state, { projectId }) => `/api/projects/${projectId}/tasks?page=${state.page}`,
}
TaskList.context = {
  canEdit: (state, { context }) => context.user.role !== 'viewer',
}
TaskList.model = {
  RENAME: (state, name, next, { previousState, now }) => ({ ...state, name, renamedAt: now() }),
}
```

| Function | Gets | Kind |
|---|---|---|
| Model handlers (`model`, a behavior's `model`) | `(state, data, next, bag)` | handler |
| `resources`, `timers`, `connections`, `head`, `browser`, `route` | `(state, bag)` | derivation |
| `.context` entries | `(state, bag)`, `bag.context` the parent's | derivation |
| A behavior's `calculated`, `timers` | `(slice, bag)`, `(slice, options, key, bag)` | derivation |
| `wizard()`: `valid`, `when`, `label`, `dialog`, `visit`, a step's `discard` / `dirty` | `(step, bag)` / `(step, stepName, bag)` | derivation |
| `wizard()`: `draft`, `key`, `url.from` / `resetTo`, `discard` | `(hostState, bag)` / `(slice, bag)` | derivation |
| `form()`: the schema function, `values`, `dynamic` / `request` | `(hostState, bag)` / `(data, hostState, bag)` | derivation |
| `agent`: `read`, `when`, `until` / `queries.run`; `chat({ model })` | `(state, bag)` / `(state, input, bag)` | derivation |

**Handlers** run once per event, so their bag also has `previousState`, `children`, `slots`, `now()` / `random()` / `uuid()` (and `signal` in an EFFECT). **Derivations** are computed again when what they read changes, so they get the bag without those. A declaration static is recomputed when the state, the context or a prop (compared shallowly) changes.

Some functions keep their arguments, on purpose:

- **`calculated` fields, lenses** and a behavior's read-time normalizer belong to the state cell, which instances with different props can share, so they see the state only.
- **A Collection's `filter` / `sort`, `estimateSize` and a lens prop** are written in the view, so they close over everything it has.
- **`intent`** works on sources; **`onError`** on the error.

Where a field can't be known yet, the bag has less: a behavior's start slice gets `{ state: undefined }`; what the wizard and the form watch in their intent (the flow key, the leave guard, a form's `dynamic` fields) has the host's props and state, not its context or uid.

Before 7.2 a declaration static's second argument was the context. `(state, { route })` still reads a context field until 8.0, with a dev warning ([SYG458](/reference/errors/#syg458)), and a prop of the same name wins; `sygnal-check --fix` rewrites it to `(state, { context: { route } })`.

## Passing State to Child Components

### Property-Based (Simple)

Pass a state property name as a string:

```jsx
function RootComponent({ state }) {
  return (
    <div>
      {/* UserProfile sees state.user as its root state */}
      <UserProfile state="user" />

      {/* ItemList sees state.items as its root state */}
      <ItemList state="items" />
    </div>
  )
}

RootComponent.initialState = {
  user: { name: 'Alice' },
  items: [{ text: 'First' }]
}
```

If the child updates its state, the change flows back up to the correct property on the parent state.

While the property is `undefined`, the child renders nothing; it appears once the parent sets the property. An [`isolatedState`](#isolated-state) child is the exception: it renders from its own `initialState`, and its first update adds the property.

### Path-Based (Nested State)

To bind a child to state deeper down, give the path, with a `.` between the property names (since 6.5.0):

```jsx
function SettingsPage({ state }) {
  return (
    <div>
      {/* RulesPanel sees state.settings.rules */}
      <RulesPanel state="settings.rules" />

      {/* an array position: boards.0.title, or boards[0].title */}
      <BoardTitle state="boards[0].title" />
    </div>
  )
}

SettingsPage.initialState = {
  settings: { rules: [], theme: 'dark' },
  boards: [{ title: 'Inbox' }],
}
```

When the child updates its state, Sygnal copies only the objects and arrays on the path, so `settings.theme` and the other boards keep their identity, the same as a hand-written lens would. A missing level on the way is created as an object when an [`isolatedState`](#isolated-state) child first writes.

For an item of a list, prefer [`byId`](/reference/api/#byid): `boards.0` follows a position, which moves when the list is reordered, while `byId('boards', id)` follows the item. A `<Collection from>` takes a path too (`from="board.cards"`).

A key that itself contains a `.` can't be named this way: before 6.5.0, `state="a.b"` meant the key `"a.b"`, and the development build reports [SYG428](/reference/errors/#syg428) when the state still has such a key. Use a lens for it.

### Changing the Selected Record

**A child belongs to the record its `state` points at.** When the binding points at a different
record (a changed path, or a `byId()` with a different field, id or idKey), Sygnal disposes the
old child and mounts a new one:

```jsx
<ProjectWorkspace state={byId('projects', selected.id)} />
```

The old child's `DISPOSE` runs with its last state, and its pending requests, delayed `next()`
actions and subscriptions are cancelled. The new child starts over: initialization runs again
and its local state starts from its defaults. Its DOM is new too, so focus, caret position,
scroll position and text being typed inside it are lost.

What keeps the child: a new `byId()` call with the same arguments on every render, edits to the
record's fields, and reordering the array (`byId()` follows the record, not its position).

**Deleting the record** disposes the child as well, even though the `byId()` arguments haven't
changed. That happens after the deleting action finishes, so its outputs still run, and before
any later action of the old child. `DISPOSE` gets the last state; a STATE change from it can't
bring the record back. A record added again with the same id gets a new child, without the old
one's pending work. Children inside a hidden Switchable page are disposed the same way; their
replacements mount when the page is shown again.

The same applies to a Collection's or VirtualCollection's `from` and a Switchable's `state`:
when it points at a different record or array, every item or page is disposed before the new
ones mount, even when ids overlap.

**Keys.** A `key` still resets a child whose binding hasn't changed: change the key and the
child starts over. A key that stays the same doesn't keep a child across a binding change; keep
anything that must survive the change (an open panel, a half-written comment) in the parent's
state. Sygnal can't tell whether a new [custom lens](#lens-based-advanced) points at a different
record, so a lens-bound child keeps its binding until its key changes: give it a key tied to the
record (`key={doc.id}`), and render it only while that record exists.

In **6.x**, a child kept the record it was mounted with: pair a changing selection with
`key={selected.id}`. sygnal-check reports [SYG454](/reference/errors/#syg454) for a `byId()`
selection without a key when Sygnal 6 is installed. See [Migrating to 7.0](/guide/migrating-to-7/#binding-lifetimes).

### Lens-Based (Advanced)

For more control over how state maps between parent and child, use a lens:

```jsx
const userLens = {
  get: (parentState) => ({
    name: parentState.userName,
    email: parentState.userEmail
  }),
  set: (parentState, childState) => ({
    ...parentState,
    userName: childState.name,
    userEmail: childState.email
  })
}

function RootComponent() {
  return <UserForm state={userLens} />
}
```

The `get` function extracts child state from parent state. The `set` function merges child state updates back into parent state.

> Use lenses sparingly. In most cases, a property name or a path is sufficient and much easier to debug.

<a id="isolated-state"></a>

### Sub-Component Initial State (`isolatedState`)

A sub-component's state comes from its parent, so a sub-component with `.initialState` must also declare `.isolatedState = true`. Without it, Sygnal reports [SYG405](/reference/errors/#syg405) and the parent renders its error fallback in the child's place, because the child's initial state would silently overwrite the state the parent passes in:

```jsx
function Widget({ state }) {
  return <div>Count: {state.count}</div>
}
Widget.initialState = { count: 0 }
Widget.isolatedState = true  // required with initialState on a sub-component
```

What `isolatedState` does depends on how the parent renders the child:

- **Bound to a slice** (`<Widget state="counter" />`, or a lens): the child reads and writes that slice of the parent's state. Its `initialState` seeds the slice only while the slice is `undefined`; a slice the parent already has is kept, so the parent's data survives the child being unmounted and mounted again. In development, [SYG425](/reference/errors/#syg425) warns when the kept slice lacks keys the child's `initialState` defines. Add the **`resetState`** prop to replace the slice with `initialState` every time the child is created:

  ```jsx
  function Page({ state }) {
    return (
      <div>
        <Widget state="counter" />
        <Widget state="scratch" resetState />
      </div>
    )
  }
  ```

  `resetState` is read when the child is created, like `state`, and is never a prop of the child.
- **No `state` prop** (`<Widget />`): the state is local to that instance, starts from `initialState`, and is never written to the parent. Each instance has its own.

(Before 6.0 a bound child's `initialState` always overwrote the slice; see [Migrating to 6.0](/guide/migrating-to-6/#behaviour-changes).)

#### A widget used several times

A child with no `state` prop and no `isolatedState` gets its parent's **whole** state. A small stateful widget written that way, such as a hint that opens on click, shares one `open` field between every copy: opening one opens them all, and the field is written into the parent's state next to its own data. Give the widget its own state with `isolatedState`:

```jsx
function Hint({ state, text }) {
  return <span><button className="toggle">?</button>{state.open && text}</span>
}
Hint.initialState = { open: false }
Hint.isolatedState = true   // each <Hint /> has its own open flag, kept out of the parent's state
Hint.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
Hint.model = {
  TOGGLE: (state) => ({ ...state, open: !state.open }),
}

function SignupForm() {
  return (
    <form>
      <label>Email <Hint text="We never share it." /></label>
      <label>Password <Hint text="At least 12 characters." /></label>
    </form>
  )
}
```

When the parent needs to read the flag (to close every hint at once, say), bind each copy to its own slice instead: `<Hint state="emailHint" />`.
