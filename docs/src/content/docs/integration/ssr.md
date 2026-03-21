---
title: "Server-Side Rendering"
description: "Render Sygnal components to HTML strings on the server"
---

`renderToString()` renders a Sygnal component to an HTML string without a browser DOM. Use it for server-rendered pages, static site generation, or any environment where you need HTML output from your components.

```ts
import { renderToString } from 'sygnal'

const html = renderToString(App, { state: { count: 0 } })
// → '<div class="counter"><h1>Count: 0</h1><button>+</button></div>'
```

## Basic Usage

Pass a component function and optional state:

```jsx
function Greeting({ state }) {
  return <div className="greeting">Hello, {state.name}!</div>
}

Greeting.initialState = { name: 'World' }

// Uses component's initialState
renderToString(Greeting)
// → '<div class="greeting">Hello, World!</div>'

// Override state
renderToString(Greeting, { state: { name: 'Alice' } })
// → '<div class="greeting">Hello, Alice!</div>'
```

## Sub-Components

Sub-components are rendered recursively. State lensing works the same as in the browser — pass `state="propName"` to scope child state:

```jsx
function App({ state }) {
  return (
    <div>
      <Header state="header" />
      <Content state="content" />
    </div>
  )
}

App.initialState = {
  header: { title: 'My App' },
  content: { body: 'Welcome' },
}

renderToString(App)
// Renders both Header and Content with their scoped state
```

## Collections

Collections render each item from the state array:

```jsx
function TodoItem({ state }) {
  return <li>{state.text}</li>
}

function TodoList({ state }) {
  return (
    <ul>
      <Collection of={TodoItem} from="items" />
    </ul>
  )
}

TodoList.initialState = {
  items: [
    { id: 1, text: 'Buy milk' },
    { id: 2, text: 'Write docs' },
  ],
}

renderToString(TodoList)
// → '<ul><div><li>Buy milk</li><li>Write docs</li></div></ul>'
```

## Context

Component context is computed from state and propagated to descendants:

```jsx
function App({ state, context }) {
  return <div className={`theme-${context.theme}`}>{state.label}</div>
}

App.initialState = { label: 'Hello', darkMode: true }
App.context = { theme: (state) => state.darkMode ? 'dark' : 'light' }

renderToString(App)
// → '<div class="theme-dark">Hello</div>'
```

## Error Boundaries

Error boundaries work during SSR. Components with `onError` render fallback content; those without render an empty `<div data-sygnal-error>`:

```jsx
function Fragile({ state }) {
  throw new Error('Oops')
}

Fragile.onError = (err, { componentName }) => (
  <div className="error">Something went wrong in {componentName}</div>
)

renderToString(Fragile)
// → '<div class="error">Something went wrong in Fragile</div>'
```

## Special Components

| Component | SSR Behavior |
|-----------|-------------|
| **Portal** | Children rendered inline (no target container on server) |
| **Transition** | Unwrapped to child element (no animation) |
| **Suspense** | Always renders children (not fallback) |
| **Slot** | Unwrapped to children |
| **Collection** | Items rendered from state array |
| **Switchable** | Active component rendered based on state |

## Client Hydration

Embed serialized state in a `<script>` tag for client-side rehydration:

```jsx
const html = renderToString(App, {
  state: { count: 5 },
  hydrateState: true,
})
// Appends: <script>window.__SYGNAL_STATE__={"count":5}</script>
```

Use a custom variable name:

```jsx
renderToString(App, {
  state: { count: 5 },
  hydrateState: '__MY_APP_STATE__',
})
// Appends: <script>window.__MY_APP_STATE__={"count":5}</script>
```

:::caution[Multiple apps on one page]
If you render more than one Sygnal app on the same page, use unique variable names to avoid collisions:

```jsx
renderToString(Header, { state: headerState, hydrateState: '__HEADER_STATE__' })
renderToString(Sidebar, { state: sidebarState, hydrateState: '__SIDEBAR_STATE__' })
```

`hydrateState: true` writes to `window.__SYGNAL_STATE__`, which is fine for single-app pages but will collide if used twice. This does not apply to Astro — each island hydrates independently through Astro's own mechanism.
:::

On the client, read the embedded state to hydrate:

```jsx
import { run } from 'sygnal'

const initialState = window.__SYGNAL_STATE__ || App.initialState

run(App, '#app', { initialState })
```

## Astro Integration

The Astro server renderer uses `renderToString` internally. When using the Sygnal Astro integration, SSR happens automatically:

```astro
---
import Counter from '../components/Counter.jsx'
---
<Counter client:load />
```

## API

```typescript
function renderToString(
  component: ComponentFunction,
  options?: RenderToStringOptions
): string
```

### RenderToStringOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `state` | `any` | Component's `.initialState` | State for the root component |
| `props` | `Record<string, any>` | `{}` | Props to pass to the component |
| `context` | `Record<string, any>` | `{}` | Parent context to merge with |
| `hydrateState` | `boolean \| string` | — | Embed state in `<script>` tag |

## Limitations

- **Intent and Model are skipped** — SSR is render-only. Event handlers, streams, and state reducers don't run on the server.
- **Refs are not populated** — No DOM exists, so `createRef()` objects remain `{ current: null }`.
- **Lazy components** — `lazy()` wrappers render their loading placeholder. For SSR, import components directly instead.
- **Factory components** — Components created via the `component()` factory (with `isSygnalComponent`) render a placeholder `<div>` since the view function can't be extracted from the wrapped factory.
