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

If you specify a name that doesn't exist on the current state, it gets added when the child first updates.

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

> Use lenses sparingly. In most cases, property-based state passing is sufficient and much easier to debug.

### Sub-Component Initial State (`isolatedState`)

By default, Sygnal throws an error if a sub-component has `.initialState` without explicitly declaring `.isolatedState = true`. This prevents a common bug where a child's initial state silently overwrites the parent's state slice:

```jsx
// This will throw an error:
function Widget({ state }) {
  return <div>Count: {state.count}</div>
}
Widget.initialState = { count: 0 }  // Error! No .isolatedState

// Fix: declare isolated state
Widget.initialState = { count: 0 }
Widget.isolatedState = true  // Explicitly opt in
```

When `isolatedState = true`, the child's `initialState` seeds the parent's state slice if it doesn't already exist. The child component manages its own state independently.
