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
- **Components with READY model entries** start as not-ready and must explicitly signal readiness:

```jsx
function DataLoader({ state }) {
  return <div>{state.data ? JSON.stringify(state.data) : 'Waiting...'}</div>
}

DataLoader.intent = ({ DOM }) => ({
  DATA_LOADED: /* stream from API driver */,
})

DataLoader.model = {
  DATA_LOADED: {
    STATE: (state, data) => ({ ...state, data }),
    READY: () => true,  // Signal ready to parent Suspense
  },
}
```

Suspense boundaries can be nested — inner `<Suspense>` catches its own not-ready children without triggering the outer boundary.
