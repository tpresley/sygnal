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

## App-level error hook

A component's `onError` decides what to render. To *report* errors, for example to an error tracker, give the whole app one hook with `run()`'s `onError` option:

```jsx
import { run } from 'sygnal'
import App from './App.jsx'
import { tracker } from './tracker.js'

run(App, {}, {
  onError: (error, { componentName, action, phase, driver }) => {
    tracker.captureException(error, { tags: { componentName, action, phase, driver } })
  },
})
```

The hook is for reporting only. It is called once per error, after the component's own `onError` (if any) has picked the fallback, and in every diagnostics mode, production included. Its second argument says where the error happened:

| `phase` | When | Also set |
|---|---|---|
| `'view'` | A view threw (the boundary's fallback, or the empty `<div data-sygnal-error>`, renders) | `componentName` |
| `'reducer'` | A STATE reducer or another sink's reducer threw; the state is unchanged | `componentName`, `action` |
| `'effect'` | An `EFFECT` threw, or the promise it returned rejected | `componentName`, `action` |
| `'intent'` | An intent stream errored; it stops emitting (the error is also logged) | `componentName`, `action` (the stream's action) |
| `'context'` | A `.context` entry threw; the entry keeps its last value ([SYG404](/reference/errors/#syg404)) | `componentName` |
| `'declaration'` | A static declaration a driver reads from the component (`connections`, `resources`, a router's `route`, `head`) threw; nothing is sent for it | `componentName` |
| `'instantiate'` | A child component failed to instantiate (reported after the parent's boundary) | `componentName` (the parent) |
| `'driver'` | A driver threw while handling a value sent to it; the error is still thrown afterwards, as before | `driver` (the sink name) |
| `'dispose'` | A stream's `stop()` threw while a removed component's streams were stopped; the other streams still stop (it is also logged) | `componentName` |
| `'widget'` | Reserved for third-party widgets; Sygnal itself doesn't report it yet | |

`'driver'` only covers a driver that throws synchronously while it receives a sink value. Errors inside a driver's own streams, or error events on its sources, are not reported there: handle them where the driver reports them (for HTTP, the `error` [reply action](/guide/http/)).

Each `run()` has its own hook, so two apps on one page report separately. If the hook itself throws, the error is logged once with `console.error` and swallowed; the app keeps running. Without the option nothing changes: errors are logged as before.

### Vike

In a [Vike](/integration/vike/) app, the hook is the `sygnalOnError` config: define it in `+sygnalOnError.js` (or in `+config.js`). It is passed to `renderToString` on the server and to `run()` in the browser. (Vike's own `onError` is a different hook: server-only, called with `(error, pageContext)` for any error during rendering.)

```js
// pages/+sygnalOnError.js: used by renderToString on the server and by run() in the browser
export default function sygnalOnError(error, { componentName, action, phase }) {
  console.error('[' + phase + ']', componentName, action, error)
}
```

### Astro

The [Astro](/integration/astro/) integration takes the path of a module whose default export is the hook. It is used when islands render on the server and when they start in the browser:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

export default defineConfig({
  integrations: [sygnal({ onError: './src/onError.js' })],
})
```

### renderToString

[`renderToString`](/integration/ssr/) takes the same option. On the server only views run, so every report has the phase `'view'`:

```js
import { renderToString } from 'sygnal'

const html = renderToString(Page, {
  onError: (error, info) => logger.error({ ...info, message: error.message }),
})
```

### Tests

`renderComponent` takes it too, to assert on what would be reported:

```jsx
const reported = []
const t = renderComponent(Checkout, { onError: (error, info) => reported.push(info) })
t.simulateAction('PAY')
await t.settle()
expect(reported).toEqual([{ componentName: 'Checkout', action: 'PAY', phase: 'reducer' }])
t.dispose()
```
