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

`lazy()` starts the import when it is called, so the chunk downloads at once, in the background. A component used in a [Suspense](/advanced/suspense/) boundary shows the boundary's fallback until it has loaded.

## Loading when visible or idle

For a component far down the page, or one nobody needs right away, the `when` option waits before starting the import:

```jsx
import { lazy, Suspense } from 'sygnal'

// imported when its placeholder scrolls into view (the placeholder is 320 px tall meanwhile)
const SalesChart = lazy(() => import('./SalesChart.jsx'), { when: 'visible', rootMargin: '200px', placeholderHeight: 320 })
// imported once the browser is idle after the page has rendered
const HelpPanel = lazy(() => import('./HelpPanel.jsx'), { when: 'idle' })

export function Dashboard({ state }) {
  return (
    <main>
      <h1>{state.title}</h1>
      <a className="sales-link" href="#sales">Sales chart</a>
      <HelpPanel />
      <Suspense fallback={<div className="chart-skeleton">Loading chart…</div>}>
        <SalesChart />
      </Suspense>
    </main>
  )
}

Dashboard.initialState = { title: 'Sales' }
```

| `when` | The import starts |
|---|---|
| `'visible'` | When a placeholder of the component enters the viewport (`IntersectionObserver`; `rootMargin: '200px'` starts it 200 px before). Without `IntersectionObserver`, as soon as the placeholder is on the page |
| `'idle'` | When the browser is idle after a placeholder is on the page (`requestIdleCallback`, at most 2 s later; a short timeout where there is none, as in Safari) |

Until then the placeholder is `<div data-sygnal-lazy="deferred" data-sygnal-when="visible">` (or `"idle"`), in the component's own place. A Suspense boundary doesn't wait for a placeholder whose import hasn't started: it shows its content, with the placeholder where the component will be, so the placeholder can scroll into view on its own. Once the import starts, the boundary shows its fallback until the component is there. `placeholderHeight` (a number in px, or a CSS length) gives the placeholder a minimum height: give it the size the component will have, so the page doesn't jump when it loads, and so that several empty placeholders in a row are not all in view at once. Every use of the component shares one import, started by whichever placeholder triggers first.

`load()` starts the import at once, for example to preload on hover:

```jsx
Dashboard.intent = ({ DOM }) => ({ PRELOAD: DOM.mouseenter('.sales-link') })
Dashboard.model = {
  PRELOAD: { EFFECT: () => { SalesChart.load() } },
}
```

`renderToString` renders the placeholder and never starts a deferred import, so the server output doesn't depend on timing; the import starts in the browser after hydration. `renderComponent`'s mock DOM doesn't run the placeholder's hooks either, so a test that needs the component calls `await SalesChart.load()` and then `await t.settle()`.
