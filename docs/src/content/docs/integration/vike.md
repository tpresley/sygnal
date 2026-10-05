---
title: Vike
description: Using Sygnal with Vike for SSR and file-based routing
---

Sygnal includes a [Vike](https://vike.dev) extension that provides server-side rendering, client-side routing, and automatic hydration with file-based routing.

## Setup

Install dependencies:

```bash
npm install sygnal vike
npm install -D vite
```

Create `vite.config.js`:

```javascript
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
import vike from 'vike/plugin'

export default defineConfig({
  plugins: [
    sygnal({ disableHmr: true }),
    vike(),
  ],
})
```

:::note
HMR is disabled because Vike manages its own module reloading. The Sygnal plugin still handles JSX configuration.
:::

Create `pages/+config.js` to extend the Sygnal config:

```javascript
import vikeSygnal from 'sygnal/config'

export default {
  extends: [vikeSygnal],
}
```

## Pages

Each page is a standard Sygnal component exported as default from a `+Page.jsx` file:

```jsx
// pages/index/+Page.jsx
function Page({ state }) {
  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button className="inc">+</button>
      <button className="dec">-</button>
    </div>
  )
}

Page.initialState = { count: 0 }

Page.intent = ({ DOM }) => ({
  INC: DOM.click('.inc'),
  DEC: DOM.click('.dec'),
})

Page.model = {
  INC: (state) => ({ ...state, count: state.count + 1 }),
  DEC: (state) => ({ ...state, count: state.count - 1 }),
}

export default Page
```

Pages use the same MVI pattern as any Sygnal component — `initialState`, `intent`, `model`, `context`, `calculated`, `onError`, and all other static properties work as expected.

Set per-page metadata in `+config.js`:

```javascript
// pages/index/+config.js
export default {
  title: 'Home',
}
```

## Layouts

Create a `+Layout.jsx` to wrap all pages with shared UI like navigation:

```jsx
// pages/+Layout.jsx
function Layout({ children }) {
  return (
    <div className="layout">
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
      <main>{children}</main>
    </div>
  )
}

Layout.initialState = {}

export default Layout
```

Layouts are **live interactive components** on the client. They participate in the reactive graph alongside the Page — their `intent`, `model`, `context`, and `initialState` all work normally. On the server, the Layout wraps the Page HTML for hydration.

### Interactive Layouts

Layouts can have their own state and event handling, just like any Sygnal component:

```jsx
function Layout({ state, children }) {
  return (
    <div className={`layout ${state.sidebarOpen ? 'sidebar-open' : ''}`}>
      <nav>
        <button className="toggle-sidebar">Menu</button>
        <a href="/">Home</a>
      </nav>
      <aside className="sidebar">{/* sidebar content */}</aside>
      <main>{children}</main>
    </div>
  )
}

Layout.initialState = { sidebarOpen: false }
Layout.intent = ({ DOM }) => ({
  TOGGLE_SIDEBAR: DOM.select('.toggle-sidebar').events('click'),
})
Layout.model = {
  TOGGLE_SIDEBAR: (state) => ({ ...state, sidebarOpen: !state.sidebarOpen }),
}

export default Layout
```

Layout state persists across client-side page navigations. The Layout and Page each manage their own state slice — they are composed into a single reactive graph via a synthetic wrapper component.

:::note
Render the Page where the Layout places `children`, as above: the server puts the Page's HTML there, and on the client the Page is that child in the reactive component tree. (A Layout written for the server only can place the `innerHTML` prop instead; one that renders neither gets the Page after it.)
:::

## Head

Use `+Head.jsx` to inject elements into the document `<head>`:

```jsx
// pages/+Head.jsx
function Head() {
  return <link rel="stylesheet" href="/style.css" />
}

export default Head
```

## Data Fetching

Use Vike's `+data.js` to fetch data on the server. The returned data is merged into the page's `initialState` on the client:

```javascript
// pages/about/+data.js
export function data() {
  return {
    description: 'Fetched on the server',
    renderedAt: new Date().toISOString(),
  }
}
```

```jsx
// pages/about/+Page.jsx
function Page({ state }) {
  return (
    <div>
      <p>{state.description}</p>
      <p>Rendered at: {state.renderedAt}</p>
    </div>
  )
}

Page.initialState = {
  description: '',
  renderedAt: '',
}

export default Page
```

The data fields (`description`, `renderedAt`) are merged into `initialState` when the page loads on the client.

Pages that read with [`resources`](/guide/resources/) can render with data on the server too: the `+data` hook seeds a `queryCache()` and sets `pageContext.queryCache = cache.dehydrate()`, and the extension renders the resources from it and hydrates the client's fetch-driver cache, so the page doesn't fetch again. See [Server rendering with Vike](/guide/resources/#with-vike).

### Accessing Data in Sub-Components

Page data, route params, and the current URL pathname are automatically injected into Sygnal's context system. Any descendant component can access them without prop drilling:

```jsx
function UserProfile({ context }) {
  return (
    <div>
      <p>Viewing: {context.urlPathname}</p>
      <p>User ID: {context.routeParams.id}</p>
      <p>Server data: {context.pageData.username}</p>
    </div>
  )
}
```

The following context values are available in all sub-components:

| Context Key | Type | Description |
|-------------|------|-------------|
| `pageData` | `object` | The data returned by `+data.js` |
| `routeParams` | `object` | Route parameters (e.g. `{ id: '123' }` for `/user/@id`) |
| `urlPathname` | `string` | The current URL pathname |

These values are fixed per navigation and work during both SSR and client-side rendering.

## SPA Mode

Disable server-side rendering for specific pages by setting `ssr: false`:

```javascript
// pages/spa/+config.js
export default {
  title: 'SPA Page',
  ssr: false,
}
```

In SPA mode, the server returns an empty HTML shell and all rendering happens client-side.

## Custom Drivers

Register additional drivers in a `+drivers.js` file. Its default export sets the `drivers` setting; the drivers are merged with the default drivers (DOM, STATE, EVENTS, LOG) and made available to all components:

```javascript
// pages/+drivers.js
import { makeFetchDriver, makeSocketDriver } from 'sygnal'

export default {
  HTTP: makeFetchDriver(),
  WS: makeSocketDriver(),
}
```

`pages/+drivers.js` applies to every page. Don't set `drivers` inside `+config.js`: drivers are runtime values, and Vike only accepts serializable values there, so `vike build` stops with `drivers defined by /pages/+config.js must be defined using a separate file +drivers.js` (in `vike dev` the server render works but the page never hydrates).

Components use them just like in a standalone Sygnal app ([HTTP](/guide/http/), [Sockets](/guide/sockets/)):

```jsx
function Dashboard({ state }) {
  return (
    <div>
      {state.messages.length} messages
      <button className="send-btn">Ping</button>
    </div>
  )
}

Dashboard.initialState = { messages: [] }

Dashboard.connections = () => ({ feed: { socket: '/ws', message: 'NEW_MESSAGE' } })

Dashboard.intent = ({ DOM }) => ({
  SEND: DOM.click('.send-btn'),
})

Dashboard.model = {
  NEW_MESSAGE: (state, msg) => ({ ...state, messages: [...state.messages, msg] }),
  SEND: {
    WS: () => ({ to: 'feed', json: { type: 'ping' } }),
  },
}
```

Drivers are client-only — they are not available during SSR. The same drivers are shared across Wrapper, Layout, and Page components since they all run within a single `run()` call.

## Config Options

These options can be set in any `+config.js` file or in their own `+<option>.js` file (`drivers` only in `+drivers.js`):

| Option | Type | Description |
|--------|------|-------------|
| `title` | `string` | Page title (set on `document.title` during client navigation) |
| `description` | `string` | Meta description for the page |
| `favicon` | `string` | Path to favicon (global) |
| `lang` | `string` | HTML lang attribute |
| `ssr` | `boolean` | Set to `false` for client-only rendering |
| `drivers` | `Record<string, Driver>` | Additional Cycle.js drivers passed to `run()` (client-only; in `+drivers.js`) |
| `Layout` | component | Sygnal component wrapping page content |
| `Head` | component | Component rendered into `<head>` |
| `sygnalOnError` | `(error, info) => void` | [App-level error hook](/advanced/error-boundaries/#vike), passed to `renderToString` on the server and to `run()` in the browser (in `+sygnalOnError.js` or `+config.js`). Not Vike's own `onError` hook, which is server-only and gets `(error, pageContext)` |

## ClientOnly

Some components (charts, maps, rich text editors) require browser APIs and cannot render on the server. Wrap them in `ClientOnly` to skip SSR and render only on the client:

```jsx
import { ClientOnly } from 'sygnal/vike/ClientOnly'

function Dashboard({ state }) {
  return (
    <div>
      <h1>Dashboard</h1>
      <ClientOnly fallback={<div>Loading chart...</div>}>
        <InteractiveChart state="chartData" />
      </ClientOnly>
    </div>
  )
}
```

During SSR, the `fallback` is rendered instead of the children. If no fallback is provided, an empty placeholder `<div>` is used. On the client, children render normally.

## Diagnostics in Dev

With the Sygnal Vite plugin in your `vite.config.js`, `vite dev` gets the same [diagnostics](/guide/diagnostics/) as any Sygnal app, even though the app is started by Sygnal's own Vike client entry (`sygnal/vike/onRenderClient`), which your code never imports: in dev, the plugin wraps that entry so it installs the [DevTools](/integration/debugging/#devtools-extension) bridge, sets the dev flag and loads the dev checks first. `disableHmr: true` doesn't affect this. The plugin also keeps that entry out of Vite's dependency pre-bundling, so it always shares your pages' Sygnal core (also with a linked `file:` sygnal). Diagnostics name Pages, Layouts and Wrappers by their function name (or `componentName`); the root is `VikeLayoutWrapper` when a Layout or Wrapper is configured.

When `sygnal-check` is installed, the plugin also checks your source on startup and after every change. By default it checks the `src/`, `pages/` and `renderer/` directories that exist; set `check.include` to choose others:

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
import vike from 'vike/plugin'

export default defineConfig({
  plugins: [
    sygnal({ disableHmr: true, diagnostics: { strict: true }, check: { include: ['pages', 'components'] } }),
    vike(),
  ],
})
```

Production builds contain none of the dev checks.

## How It Works

- The server renders the page component to HTML using Sygnal's `renderToString()`, with the component state serialized into a `<script>` tag
- Layout HTML wraps the page content but lives **outside** the `#page-view` mount point, so it survives Sygnal's DOM patching
- On the client, Sygnal hydrates the page at `#page-view` using the serialized state
- On client-side navigation, the previous Sygnal app is disposed and a new one is booted for the next page
- Data from `+data.js` is passed to the client via Vike's `passToClient` and merged into `initialState`
- Error boundaries are supported — if a page has `.onError`, it is used as a fallback during SSR errors
