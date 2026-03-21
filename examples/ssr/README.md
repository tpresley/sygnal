# Sygnal SSR Example

Demonstrates server-side rendering with Express and client-side hydration.

Two independent Sygnal components (Counter and TodoList) are rendered on the server, each with their own `hydrateState` variable. The client picks up the embedded state and makes both components interactive — without re-fetching data or flashing default content.

## Quick Start

```bash
npm install
npm run build          # Build the client bundle
NODE_ENV=production node server.js
```

Open http://localhost:3000 — view source to see the server-rendered HTML and embedded `<script>` tags.

## Development

Run two terminals:

```bash
# Terminal 1: Express server
node server.js

# Terminal 2: Vite dev server for client JS
npx vite --port 5188
```

## How It Works

### Server (`server.js`)

```js
import { renderToString } from 'sygnal'
import Counter from './src/Counter.jsx'

const html = renderToString(Counter, {
  state: { count: 5 },
  hydrateState: '__COUNTER_STATE__',
})
// → '<div class="counter">...</div><script>window.__COUNTER_STATE__={"count":5}</script>'
```

### Client (`src/client.js`)

```js
import { run } from 'sygnal'
import Counter from './Counter.jsx'

Counter.initialState = window.__COUNTER_STATE__
run(Counter, {}, { mountPoint: '#counter-app' })
```

### Multiple Apps

Each component gets its own hydration variable (`__COUNTER_STATE__`, `__TODO_STATE__`), so multiple Sygnal apps can coexist on the same page without collision.
