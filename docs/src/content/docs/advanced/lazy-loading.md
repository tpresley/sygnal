---
title: "Lazy Loading"
description: "Code splitting with dynamic imports"
---

Code-split components that load on demand:

```jsx live
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

The lazily loaded module is an ordinary component module; `lazy()` renders its default export:

```jsx live-file=./HeavyChart.jsx
// HeavyChart.jsx
const VALUES = [3, 7, 4, 9]

export default function HeavyChart() {
  return (
    <svg width="160" height="90" role="img" aria-label="A bar chart">
      {VALUES.map((v, i) => <rect x={i * 40 + 5} y={90 - v * 10} width="30" height={v * 10} fill="currentColor" />)}
    </svg>
  )
}
```

While loading, a `<div data-sygnal-lazy="loading">` placeholder is rendered. Once the import resolves, the real component renders and receives all its static properties (intent, model, etc.).

The import starts the first time the component renders, as with `React.lazy`: a table of lazy pages downloads only the page that is shown, and each other page when it is first shown. Every use of the component shares one import. A component used in a [Suspense](/advanced/suspense/) boundary shows the boundary's fallback until it has loaded. To download a chunk before it renders, call its `load()` (below). On a server, where there is no `document`, the import starts when `lazy()` is called, so a server render made after it has loaded renders the component.

Before Sygnal 7.3, the import always started when `lazy()` was called. To keep that for one component, call `load()` right after defining it: `const HeavyChart = lazy(…); HeavyChart.load()`.

## Loading when visible or idle

For a component far down the page, or one nobody needs right away, the `when` option waits before starting the import:

```jsx live
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

The two modules it loads:

```jsx live-file=./SalesChart.jsx
// SalesChart.jsx
export default function SalesChart() {
  return <div style={{ height: '320px' }}>The sales chart, loaded when it scrolled into view.</div>
}
```

```jsx live-file=./HelpPanel.jsx
// HelpPanel.jsx
export default function HelpPanel() {
  return <aside>Help, loaded once the browser was idle.</aside>
}
```

| `when` | The import starts |
|---|---|
| `'render'` (the default) | The first time the component renders |
| `'visible'` | When a placeholder of the component enters the viewport (`IntersectionObserver`; `rootMargin: '200px'` starts it 200 px before). Without `IntersectionObserver`, as soon as the placeholder is on the page |
| `'idle'` | When the browser is idle after a placeholder is on the page (`requestIdleCallback`, at most 2 s later; a short timeout where there is none, as in Safari) |

Until then the placeholder is `<div data-sygnal-lazy="deferred" data-sygnal-when="visible">` (or `"idle"`), in the component's own place. A Suspense boundary doesn't wait for a placeholder whose import hasn't started: it shows its content, with the placeholder where the component will be, so the placeholder can scroll into view on its own. Once the import starts, the boundary shows its fallback until the component is there. `placeholderHeight` (a number in px, or a CSS length) gives the placeholder a minimum height: give it the size the component will have, so the page doesn't jump when it loads, and so that several empty placeholders in a row are not all in view at once. Every use of the component shares one import, started by whichever placeholder triggers first.

`load()` starts the import at once, for example to preload on hover. It can be called any number of times; every call returns the same import:

```jsx
Dashboard.intent = ({ DOM }) => ({ PRELOAD: DOM.mouseenter('.sales-link') })
Dashboard.model = {
  PRELOAD: { EFFECT: () => { SalesChart.load() } },
}
```

`renderToString` renders the placeholder and never starts a deferred import, so the server output doesn't depend on timing; the import starts in the browser after hydration.

In tests, `renderComponent` starts every import, deferred ones too, when the component renders, and `t.settle()` waits until they have loaded: render the real root, `await t.settle()`, and the lazy pages are there.

## When the import fails

A failed import (a network error, or a chunk that a newer deploy removed, which then returns 404) renders the owner's [error fallback](/advanced/error-boundaries/) in the component's place: the `onError` of the component whose view uses it, called with the import's error and the component name `'lazy'`. Without an `onError`, the place shows the default error `<div data-sygnal-error="lazy">`, and the error is reported as [SYG406](/reference/errors/#syg406), to `run()`'s `onError` too.

The failure isn't kept. `load()` tries the import again, and so does the next mount of the component (after it left the page, or in an owner rendering it for the first time); a render of the same owner doesn't. When the retry succeeds, the component replaces the fallback:

```jsx
function Shell({ state }) {
  return <main><Outlet of={PAGES} current={state.page} /></main>
}
Shell.onError = (error, { componentName }) => componentName === 'lazy'
  ? <p>This page could not load. <button className="retry">Try again</button> <button className="reload">Reload</button></p>
  : <p>Something went wrong.</p>
Shell.intent = ({ DOM }) => ({ RETRY: DOM.click('.retry'), RELOAD: DOM.click('.reload') })
Shell.model = {
  RETRY: { EFFECT: (state) => { PAGES[state.page].load() } },
  RELOAD: { EFFECT: () => { location.reload() } },
}
```
