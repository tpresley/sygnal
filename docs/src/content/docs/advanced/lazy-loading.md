---
title: "Lazy Loading"
description: "Code splitting with dynamic imports"
---

Code-split components that load on demand:

```jsx
import { lazy } from 'sygnal'

const HeavyChart = lazy(() => import('./HeavyChart.jsx'))

// Use like any other component
function Dashboard({ state }) {
  return (
    <div>
      <h1>Dashboard</h1>
      <HeavyChart />
    </div>
  )
}
```

While loading, a `<div data-sygnal-lazy="loading">` placeholder is rendered. Once the import resolves, the real component renders and receives all its static properties (intent, model, etc.).
