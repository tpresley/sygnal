---
title: Components
description: Creating and composing Sygnal components
---

A Sygnal component is a function with optional static properties attached to it. At minimum, a component is just a function that returns JSX:

```jsx
function MyComponent() {
  return <div>Hello World</div>
}
```

To make a component interactive, attach `.initialState`, `.intent`, and `.model` properties:

```jsx
function Counter({ state }) {
  return (
    <div>
      Count: {state.count}
      <button className="btn">+1</button>
    </div>
  )
}

Counter.initialState = { count: 0 }

Counter.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.btn').events('click')
})

Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 })
}
```

## Component Properties Summary

| Property | Type | Description |
|----------|------|-------------|
| `.initialState` | Object | The starting state for the component |
| `.intent` | Function | Maps driver sources to named action streams |
| `.model` | Object | Defines what happens for each action |
| `.calculated` | Object | Derived state fields computed from base state |
| `.context` | Object | Values passed down to all descendants |
| `.peers` | Object | Sibling components that share the same sources |
| `.components` | Object | Named child components |
| `.onError` | Function | Error boundary handler — receives `(error, { componentName })`, returns fallback VNode |
| `.isolatedState` | Boolean | Required when a sub-component has `.initialState` (prevents accidental parent state overwrite) |
| `.storeCalculatedInState` | Boolean | Whether calculated fields are stored in state (default: `true`) |
| `.debug` | Boolean | Enable debug logging for this component |
| `.DOMSourceName` | String | Custom name for the DOM driver (default: `'DOM'`) |
| `.stateSourceName` | String | Custom name for the state driver (default: `'STATE'`) |

## View (The Component Function)

The component function is the view. It receives a single object where props from the parent are spread at the top level alongside `state`, `children`, and `context`:

```jsx
function MyComponent({ state, className, children, context }) {
  return (
    <div className={className}>
      <h1>{state.title}</h1>
      {children}
    </div>
  )
}
```

### View Parameters

| Parameter | Description |
|-----------|-------------|
| `state` | The current component state |
| `children` | Child elements passed between the component's opening and closing tags |
| `slots` | Named content regions passed with `<Slot>` (see [Slots](/advanced/slots/)) |
| `context` | Values from ancestor components' `.context` definitions |
| Named peers | Any peer components defined in `.peers` are available by name |
| Individual props | Props from the parent (e.g., `title`, `className`) are spread at the top level |

> Props are **not** nested under a `props` key. If a parent renders `<MyChild title="Hello" />`, the child destructures `title` directly: `function MyChild({ title, state }) { ... }`.

The view function must be **pure**: it should only use the values it receives to produce virtual DOM. Never perform side effects (API calls, direct DOM manipulation, etc.) inside the view.

Always read everything from the first argument. The view is technically also called with `state` and `context` as positional arguments, but that form is non-canonical (see [Alternative Forms](/advanced/alternative-forms/#positional-view-arguments)).

### Reserved Prop Names

Because the view's first argument also carries `state`, `children`, `slots`, `context` and `peers`, a parent prop with one of these names is overwritten (Sygnal warns with [SYG106](/reference/errors/#syg106), an error in [strict mode](/guide/strict-mode/)). The `state` prop is special: it selects the child's [state slice](/guide/state/#passing-state-to-child-components). Name data props something else, such as `item` or `contextValue`.
