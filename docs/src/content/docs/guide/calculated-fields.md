---
title: Calculated Fields
description: Derived state with automatic dependency tracking
---

Calculated fields are derived values computed from the current state. They're added to the state object automatically and available in both the view and reducers.

## Defining Calculated Fields

Each calculated field is a function that receives the current state and returns the derived value:

```jsx
UserProfile.calculated = {
  fullName: (state) => `${state.firstName} ${state.lastName}`,
  isAdult: (state) => state.age >= 18,
  itemCount: (state) => state.items.length
}

function UserProfile({ state }) {
  return (
    <div>
      <h1>{state.fullName}</h1>
      <p>{state.isAdult ? 'Adult' : 'Minor'}</p>
      <p>Items: {state.itemCount}</p>
    </div>
  )
}
```

## Dependency Tracking

By default, calculated fields recalculate on every state change. To skip unnecessary recalculations, declare dependencies using the tuple form `[depsArray, fn]`:

```jsx
OrderSummary.calculated = {
  // Only recalculates when state.items changes
  subtotal: [['items'], (state) => state.items.reduce((sum, i) => sum + i.price, 0)],

  // Only recalculates when subtotal changes
  tax: [['subtotal'], (state) => state.subtotal * 0.08],

  // Only recalculates when subtotal or tax changes
  total: [['subtotal', 'tax'], (state) => state.subtotal + state.tax],

  // No deps — always recalculates (original behavior)
  label: (state) => `${state.items.length} items`,
}
```

Dependencies can reference both base state keys and other calculated field names. When a dependency names another calculated field, that field is guaranteed to be computed first.

An empty deps array `[[], fn]` means the field computes once and never recalculates — useful for constant derived values.

## Calculated Fields Depending on Other Calculated Fields

Calculated fields can depend on other calculated fields. The framework automatically determines the correct computation order using a topological sort at component creation time:

```jsx
Component.calculated = {
  doubled:    [['value'],     (state) => state.value * 2],
  quadrupled: [['doubled'],   (state) => state.doubled * 2],
  octupled:   [['quadrupled'], (state) => state.quadrupled * 2],
}
```

Circular dependencies are detected at component creation time and throw an error:

```jsx
// This throws: "Circular calculated dependency: a → b → a"
Component.calculated = {
  a: [['b'], (state) => state.b + 1],
  b: [['a'], (state) => state.a + 1],
}
```

## Controlling Storage

By default, calculated fields are stored in the actual state. To prevent this:

```jsx
UserProfile.storeCalculatedInState = false
```

When set to `false`, calculated fields are still available in the view and reducers but don't persist in the state tree. This is useful when calculated values are expensive or transient.

## Name Collision Warning

If a calculated field has the same name as a key in `initialState`, a warning is logged at component creation time. The calculated field will always overwrite the base state value, so the `initialState` entry is effectively dead.
