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
function Layout({ innerHTML }) {
  return (
    <div className="layout">
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
      <main props={{ innerHTML: innerHTML || '' }}></main>
    </div>
  )
}

Layout.initialState = {}

export default Layout
```

The Layout receives page content via the `innerHTML` prop during SSR. The `<main>` element uses `props={{ innerHTML }}` to inject the raw HTML.

:::tip
The Layout renders **outside** the Sygnal mount point (`#page-view`). This means the Layout HTML persists across client-side navigations without being destroyed by Sygnal's DOM driver. Only the page content inside `#page-view` is swapped.
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

## Config Options

These options can be set in any `+config.js` file:

| Option | Type | Description |
|--------|------|-------------|
| `title` | `string` | Page title (set on `document.title` during client navigation) |
| `description` | `string` | Meta description for the page |
| `favicon` | `string` | Path to favicon (global) |
| `lang` | `string` | HTML lang attribute |
| `ssr` | `boolean` | Set to `false` for client-only rendering |
| `Layout` | component | Sygnal component wrapping page content |
| `Head` | component | Component rendered into `<head>` |

## How It Works

- The server renders the page component to HTML using Sygnal's `renderToString()`, with the component state serialized into a `<script>` tag
- Layout HTML wraps the page content but lives **outside** the `#page-view` mount point, so it survives Sygnal's DOM patching
- On the client, Sygnal hydrates the page at `#page-view` using the serialized state
- On client-side navigation, the previous Sygnal app is disposed and a new one is booted for the next page
- Data from `+data.js` is passed to the client via Vike's `passToClient` and merged into `initialState`
- Error boundaries are supported — if a page has `.onError`, it is used as a fallback during SSR errors
