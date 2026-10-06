---
title: "Server-Side Rendering"
description: "Render Sygnal components to HTML strings on the server"
---

`renderToString()` renders a Sygnal component to an HTML string without a browser DOM. Use it for server-rendered pages, static site generation, or any environment where you need HTML output from your components.

```ts
import { renderToString } from 'sygnal'

const html = renderToString(App, { state: { count: 0 } })
// → '<div class="counter" data-sygnal-ssr=""><h1>Count: 0</h1><button>+</button></div>'
```

The root element carries an empty `data-sygnal-ssr` attribute. It marks the markup as Sygnal's server HTML, so the client can tell it from other content in the mount point (a [persisted](/guide/persistence/#server-rendering-hydrate) app restores its saved state after the first render instead of before it). The first client render removes it.

## Basic Usage

Pass a component function and optional state:

```jsx
function Greeting({ state }) {
  return <div className="greeting">Hello, {state.name}!</div>
}

Greeting.initialState = { name: 'World' }

// Uses component's initialState
renderToString(Greeting)
// → '<div class="greeting" data-sygnal-ssr="">Hello, World!</div>'

// Override state
renderToString(Greeting, { state: { name: 'Alice' } })
// → '<div class="greeting" data-sygnal-ssr="">Hello, Alice!</div>'
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
// → '<ul data-sygnal-ssr=""><div><li>Buy milk</li><li>Write docs</li></div></ul>'
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
// → '<div class="theme-dark" data-sygnal-ssr="">Hello</div>'
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
// → '<div class="error" data-sygnal-ssr="">Something went wrong in Fragile</div>'
```

To report these errors, pass the [app-level error hook](/advanced/error-boundaries/#app-level-error-hook): `renderToString(App, { onError })`. It is called with the phase `'view'`, after the boundary picked the fallback.

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

### What the first client render keeps

`run()` doesn't clear the mount point. Its first render patches the server's markup in place and **adopts** each element that matches what the client renders at the same position (the same tag; keyed children such as component roots and `Collection` items match by key). An adopted element stays the same DOM node, so everything the user did before the app started is kept: the focus, text typed into an uncontrolled field, a checked box, the scroll position. The same applies to [Astro islands](/integration/astro/) and [Vike pages](/integration/vike/), which both hydrate this way.

| Server markup | First client render |
|---|---|
| An element the client renders with the same tag | Adopted: the same node. Its attributes become the client's: the ones the client also renders keep the server's value (nothing is written again, so an `iframe` or `img` doesn't reload), and attributes the client doesn't render are removed |
| `class` and `id` | Kept when the client's are the same, changed or removed when they aren't |
| `style` | Written again from the client's `style`: a declaration only the server wrote goes |
| `data-*` | Kept when the client renders them (as `data-*` props or in `attrs`), removed when it doesn't; `data-sygnal-ssr` (the root's marker) goes |
| `open` on a `<details>` or `<dialog>` the client renders without `open` | Kept: the user may have opened it before start-up. When the client renders `open`, its value wins |
| A text node | Kept, its text set to the client's |
| A `<textarea>`'s text (`renderToString` writes its `value` as text) | The text node goes; the field keeps its value (the server's text, or what the user typed) |
| A component that returns a fragment (`<>…</>`), or a `false` / `null` child (`{cond && <X />}`) | A fragment's elements are adopted one by one, a `false` / `null` child takes no element: the elements after them are still adopted |
| Whitespace and comments where the client renders no text (a page template's indentation) | Removed |
| An element with another tag, or text where the client renders an element | Replaced in place by the client's element; the elements around it are still adopted |
| An element whose vnode has an `insert` hook and no `postpatch` hook: a `<Transition>`'s child (its enter runs), a `<VirtualCollection>` row (measured when inserted), the `<Toaster>` region, a `lazy()` placeholder, an element with your own `hook={{ insert }}` (also with a `ref` or `autoFocus`) | Made again in place, as a fresh render makes it: its `insert` runs |
| An element with a `create` or `init` hook (a `thunk`) | Made again in place; its hooks run |
| An element whose hyperscript selector has a class or id (`h('p.card')`; JSX never makes one), and a `<Portal>`'s placeholder | Made again in place (patching never changes a selector's class or id) |
| An element with a `ref`, `autoFocus`, a widget, or your own hook with both `insert` and `postpatch` | Adopted: `ref` points at the server's element, `autoFocus` focuses it, a widget mounts on it. A hook's `postpatch` runs; its `insert` doesn't |
| A `<Portal>`'s content (the server renders it inline) | Replaced by the Portal's placeholder; the content renders in the target |
| A custom element that builds its own light DOM (children the client doesn't render), already upgraded before start-up | Adopted, but those children are removed (they aren't the client's) and its `connectedCallback` doesn't run again. Wrap such an element in [`<ClientOnly>`](/integration/vike/#clientonly) (`sygnal/vike/ClientOnly`) so the client makes it |
| The mount point's own attributes (`<div id="app" class="shell" data-theme="dark">`) | Kept: they aren't the app's (when the app's root element is the mount point itself, its props are written over them) |

Form fields follow the usual rule for [controlled fields](/guide/forms/): a field with a `value` (or `checked`) prop shows the state, so the client's value replaces what the user typed or picked before start-up (an `input`, a `textarea` and a `select` alike); a field without one keeps it.

When the server's markup differs from what the client renders (other state, a mismatched template), the page ends up as a fresh client render would make it. This also holds when the mount point holds something else before start-up (a loading spinner): it is patched into the app. The exceptions are the user's changes listed above: an uncontrolled field's value, an `open` the client doesn't render.

## Stable ids: uid

[`uid()`](/guide/forms/#labels-and-ids-uid) ids come from each component's position in the tree, not from a counter, so `renderToString` and the client produce the same ids and hydration keeps the server's `for` / `id` pairs. Both start from the root `u`. When a page has more than one app, give each its own root, and the same one on both sides:

```jsx
// server
const html = renderToString(Signup, { uid: 'signup' })

// client, hydrating that markup
run(Signup, {}, { mountPoint: '#signup', uid: 'signup' })
```

The ids then start with `signup-` (`signup-email`). In [Astro](/integration/astro/#props), pass a `uid` prop to the island; in [Vike](/integration/vike/), the Page, Layouts and Wrappers get matching ids on both sides without any option.

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
| `head` | `any[]` | — | Receives each rendered component's `head` static ([HEAD driver](/guide/head/)) |
| `cache` | `QueryCache` | — | A seeded `queryCache()`: `resources` found in it render as `'success'` with their data, others as `'loading'` ([Server rendering](/guide/resources/#server-rendering)) |
| `onError` | `(error, info) => void` | — | [App-level error hook](/advanced/error-boundaries/#app-level-error-hook), called with the phase `'view'` |
| `uid` | `string` | `'u'` | The root of the [`uid()`](#stable-ids-uid) ids; use the same value as `run()`'s `uid` on the client |

## Limitations

- **Intent and Model are skipped** — SSR is render-only. Event handlers, streams, and state reducers don't run on the server.
- **No requests** — drivers don't run, so `resources` render as `'loading'` unless the `cache` option has them; seed it in a loader with `cache.set(request, data)` and send `cache.dehydrate()` to the client ([Server rendering](/guide/resources/#server-rendering)).
- **Refs are not populated** — No DOM exists, so `createRef()` objects remain `{ current: null }`.
- **Lazy components** — `lazy()` wrappers render their loading placeholder. For SSR, import components directly instead.
