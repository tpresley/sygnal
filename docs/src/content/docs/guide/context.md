---
title: Context
description: Top-down data propagation
---

Context lets you pass values to all descendant components regardless of depth, without threading them through every intermediate component.

## Defining Context

Set `.context` on any component. Each key maps to a function that derives a value from state:

```jsx
RootComponent.context = {
  theme: (state) => state.settings.theme,
  currentUser: (state) => state.auth.user
}
```

## Using Context in the View

```jsx
function DeepChild({ state, context }) {
  return (
    <div className={context.theme === 'dark' ? 'dark-mode' : ''}>
      Welcome, {context.currentUser.name}
    </div>
  )
}
```

## Using Context in Reducers

Context is available on the fourth argument (`extra`) of any reducer:

```jsx
DeepChild.model = {
  SOME_ACTION: {
    LOG: (state, data, next, extra) => {
      return `Current theme: ${extra.context.theme}`
    }
  }
}
```

## A Component's Own Context

A component's view and reducers see its own `.context` entries too, merged over its ancestors' (an entry of the same name replaces the ancestor's for the component and its descendants):

```jsx
function Cart({ state, context }) {
  return <p>{context.itemCount} items for {context.currentUser.name}</p>
}
Cart.context = { itemCount: (state) => state.items.length }
```

## Testing a Component That Reads Context

`renderComponent(DeepChild, { context: { theme: 'dark', currentUser: { name: 'Ada' } } })` gives the component the context its ancestors would ([Testing](/integration/testing/#context)).

## Recalculation

Context values are automatically recalculated when the source component's state changes, and see its current [calculated fields](/guide/calculated-fields/), also after a child or Collection item writes through a lens.

## Vike Integration

When using Sygnal with [Vike](/integration/vike/), page data, route params, and the URL pathname are automatically injected into the page component's context. See the [Vike data fetching docs](/integration/vike/#accessing-data-in-sub-components) for details.
