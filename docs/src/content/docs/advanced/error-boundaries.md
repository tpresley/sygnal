---
title: "Error Boundaries"
description: "Graceful error handling in components"
---

Catch and recover from errors in component rendering without crashing the entire application.

## The `onError` Static Property

```jsx
function BrokenComponent({ state }) {
  if (state.count > 5) throw new Error('Count too high!')
  return <div>Count: {state.count}</div>
}

BrokenComponent.onError = (error, { componentName }) => (
  <div className="error-fallback">
    <h3>Something went wrong in {componentName}</h3>
    <p>{error.message}</p>
  </div>
)
```

Error boundaries protect three code paths:
- **View errors** — The view function throws. Renders `onError` fallback or an empty `<div data-sygnal-error>`.
- **Reducer errors** — A model reducer throws. Returns the previous state unchanged (no state corruption).
- **Sub-component errors** — A child component fails to instantiate. Replaces with fallback VNode.

Without `onError`, errors are logged to `console.error` and a minimal placeholder is rendered.

Each case is logged with a [diagnostic code](/guide/diagnostics/): a view that throws is [SYG406](/reference/errors/#syg406), a reducer that throws [SYG216](/reference/errors/#syg216), an EFFECT that throws [SYG214](/reference/errors/#syg214), a child that fails to instantiate [SYG408](/reference/errors/#syg408), and an `onError` that throws [SYG407](/reference/errors/#syg407). When the component has an `onError` and its fallback renders, the view error is reported as a warning rather than an error.
