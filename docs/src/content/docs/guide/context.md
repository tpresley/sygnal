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

Context values are automatically recalculated when the source component's state changes.

## Vike Integration

When using Sygnal with [Vike](/integration/vike/), page data, route params, and the URL pathname are automatically injected into the page component's context. See the [Vike data fetching docs](/integration/vike/#accessing-data-in-sub-components) for details.
