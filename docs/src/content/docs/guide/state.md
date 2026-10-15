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
