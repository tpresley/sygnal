---
title: "Suspense"
description: "Loading states for async components"
---

Show fallback UI while child components signal they're not ready:

```jsx
import { Suspense } from 'sygnal'

<Suspense fallback={<div className="loading">Loading...</div>}>
  <SlowComponent />
</Suspense>
```

## The READY Sink

Components control Suspense visibility through the built-in `READY` sink:

- **Components without explicit READY model entries** automatically emit `READY: true` on instantiation — they're immediately ready.
- **Components with READY model entries** start as not-ready and must explicitly signal readiness. In this demo, a stand-in server answers after two seconds:

```js live-server
export default {
  'GET /api/data': () => ({ json: { items: 3 }, delayMs: 2000 }),
}
```

```jsx live=App
import { Suspense } from 'sygnal'

function DataLoader({ state }) {
  return <div>{state.data ? JSON.stringify(state.data) : 'Waiting...'}</div>
}

DataLoader.model = {
  BOOTSTRAP: {
    HTTP: () => ({ url: '/api/data', ok: 'DATA_LOADED' }),   // makeFetchDriver(): the reply is DATA_LOADED
  },
  DATA_LOADED: {
    STATE: (state, data) => ({ ...state, data }),
    READY: () => true,  // Signal ready to parent Suspense
  },
}

function App() {
  return (
    <Suspense fallback={<div className="loading">Loading...</div>}>
      <DataLoader />
    </Suspense>
  )
}
```

Suspense boundaries can be nested — inner `<Suspense>` catches its own not-ready children without triggering the outer boundary.

## The `data-sygnal-ready` Attribute

While a sub-component is not ready, its root element carries `data-sygnal-ready="false"`; that is how a `<Suspense>` boundary finds pending children. Once the component is ready, the attribute is removed, so ready components render exactly the markup their view returns (extracting markup into a child component doesn't change the DOM).
