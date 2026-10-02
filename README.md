# Sygnal

A reactive component framework with pure functions, zero side effects, and automatic state management.

[![npm version](https://img.shields.io/npm/v/sygnal.svg?style=flat-square)](https://www.npmjs.com/package/sygnal)
[![npm downloads](https://img.shields.io/npm/dm/sygnal.svg?style=flat-square)](https://www.npmjs.com/package/sygnal)
[![license](https://img.shields.io/npm/l/sygnal.svg?style=flat-square)](https://github.com/tpresley/sygnal/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/sygnal?style=flat-square&label=bundle%20size)](https://pkg-size.dev/sygnal)

---

## Why Sygnal?

- **Pure components** — Views are plain functions. All side effects are handled by drivers, outside your code.
- **Automatic state management** — Monolithic state tree with no store setup, no providers, no hooks. Trivial undo/redo and time-travel debugging.
- **Model-View-Intent** — Cleanly separate *what* happens (Model), *when* it happens (Intent), and *how* it looks (View).
- **Tiny footprint** — Three runtime dependencies: [snabbdom](https://github.com/snabbdom/snabbdom), [xstream](https://github.com/staltz/xstream), and [extend](https://github.com/nicjohnson145/extend).

## Quick Start

**Scaffold a new project:**

```bash
npm create sygnal-app my-app
cd my-app
npm run dev
```

Choose from Vite (SPA), Vite + PWA, Vike (SSR), or Astro templates in JavaScript or TypeScript. Without prompts (scripts, CI, coding agents): `npm create sygnal-app@latest my-app -- --template vite --js --install`.

**Or add to an existing project:**

```bash
npm install sygnal
```

## A Sygnal Component

A component is a function (the **view**) with static properties that define **when** things happen (`.intent`) and **what** happens (`.model`):

```jsx
function Counter({ state }) {
  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button className="increment">+</button>
      <button className="decrement">-</button>
    </div>
  )
}

Counter.initialState = { count: 0 }

Counter.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click'),
  DECREMENT: DOM.select('.decrement').events('click'),
})

Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  DECREMENT: (state) => ({ ...state, count: state.count - 1 }),
}
```

Start it:

```javascript
import { run } from 'sygnal'
import Counter from './Counter.jsx'

run(Counter)
```

No store setup, no providers, no hooks — just a function and some properties.

## Built for Agents

Sygnal includes tooling so that coding agents (and people) can write and debug Sygnal code without guessing:

- **[`llms.txt`](https://sygnal.js.org/llms.txt)**: one compact reference of the API in its canonical forms, written for language models.
- **Diagnostics**: silent wiring mistakes (a selector that matches nothing, an action with no model entry, an EVENTS type nobody selects) are reported as coded messages, such as `[Sygnal SYG104]`, with a fix and a link to the [error reference](https://sygnal.js.org/reference/errors/). They're on automatically in the Vite dev server and in tests, and add nothing to production bundles.
- **[`sygnal-check`](./sygnal-check)**: a static checker for the same mistakes, with a strict mode for the canonical forms, `--fix`, an app graph (`--graph`) and `explain <code>`.
- **MCP server**: `sygnal-check mcp` exposes `check`, `graph` and `explain` as tools (`claude mcp add sygnal-check -- npx --no-install sygnal-check mcp`).
- **`inspect()`**: a machine-readable graph of the running app, in the browser or from `renderComponent()` in a test.

The repository also contains an evaluation harness ([`evals/agent-ergonomics`](./evals/agent-ergonomics)) that runs coding agents on the same tasks in a Sygnal app and an equivalent React app, scores each run with hidden acceptance tests, and records time and iteration counts. The baseline results, from before this tooling existed, are in [`results/BASELINE.md`](./evals/agent-ergonomics/results/BASELINE.md).

See [Building with AI Agents](https://sygnal.js.org/integration/agents/).

## Features

### Collections

Render dynamic lists with built-in filtering and sorting:

```jsx
<Collection of={TodoItem} from="items" filter={item => !item.done} sort="name" />
```

### Switchable

Swap between components based on state:

```jsx
<Switchable of={{ home: HomePage, settings: SettingsPage }} current={state.activeTab} />
```

### Context

Top-down data propagation without prop drilling:

```jsx
App.context = {
  theme: (state) => state.settings.theme,
  currentUser: (state) => state.auth.user,
}

function Child({ state, context }) {
  return <div className={context.theme}>{context.currentUser.name}</div>
}
```

### Parent-Child Communication

Structured message passing between components:

```jsx
// Child emits
TaskCard.model = {
  DELETE: { PARENT: (state) => ({ taskId: state.id }) }
}

// Parent receives (pass the component itself)
Lane.intent = ({ CHILD }) => ({
  TASK_DELETED: CHILD.select(TaskCard).map(e => e.taskId),
})
```

### Event Bus

Global broadcast for cross-component communication:

```jsx
import { event } from 'sygnal'

// Any component can emit
Publisher.model = {
  NOTIFY: { EVENTS: event('NOTIFICATION', (state) => state.message) }
}

// Any component can subscribe
Subscriber.intent = ({ EVENTS }) => ({
  HANDLE: EVENTS.select('NOTIFICATION'),
})
```

### Calculated Fields

Derived state with optional dependency tracking:

```jsx
Invoice.calculated = {
  subtotal: [['items'], (state) => sum(state.items.map(i => i.price))],
  tax:      [['subtotal'], (state) => state.subtotal * 0.08],
  total:    [['subtotal', 'tax'], (state) => state.subtotal + state.tax],
}
```

### Form Handling

Extract form values without the boilerplate:

```jsx
MyForm.intent = ({ DOM }) => ({
  SUBMITTED: processForm(DOM.select('.my-form'), { events: 'submit' }),
})
```

### Drag and Drop

HTML5 drag-and-drop with a dedicated driver:

```javascript
import { makeDragDriver } from 'sygnal'

run(RootComponent, { DND: makeDragDriver() })
```

### HTTP and Sockets

Requests name the actions that receive their reply; connections are declared from state:

```jsx
import { run, makeFetchDriver, makeSocketDriver } from 'sygnal'

Quote.model = {
  LOAD:   { HTTP: (state, id) => ({ url: `/api/quotes/${id}`, ok: 'LOADED', error: 'FAILED', latest: true }) },
  LOADED: (state, quote) => ({ ...state, quote }),                 // the parsed body
  FAILED: (state, { status }) => ({ ...state, error: status }),
}

Chat.connections = (state) => ({
  room: state.room && { socket: `/ws/rooms/${state.room}`, message: 'RECEIVED' },
})

run(App, { HTTP: makeFetchDriver(), WS: makeSocketDriver() })
```

### Custom Drivers

Wrap any other async operation as a driver; requests route the same way (`{ value, ok: 'DONE', error: 'FAILED' }`):

```javascript
import { driverFromAsync } from 'sygnal'

run(RootComponent, { GEO: driverFromAsync(geocode) })
```

### Error Boundaries

Catch and recover from rendering errors:

```jsx
BrokenComponent.onError = (error, { componentName }) => (
  <div>Something went wrong in {componentName}</div>
)
```

### Portals

Render children into a different DOM container:

```jsx
<Portal target="#modal-root">
  <div className="modal">Modal content</div>
</Portal>
```

### Slots

Pass named content regions to child components:

```jsx
import { Slot } from 'sygnal'

<Card state="card">
  <Slot name="header"><h2>Title</h2></Slot>
  <Slot name="actions"><button>Save</button></Slot>
  <p>Default content</p>
</Card>

// In Card's view:
function Card({ state, slots }) {
  return (
    <div>
      <header>{...(slots.header || [])}</header>
      <main>{...(slots.default || [])}</main>
      <footer>{...(slots.actions || [])}</footer>
    </div>
  )
}
```

### Transitions

CSS-based enter/leave animations:

```jsx
<Transition name="fade" duration={300}>
  {state.visible && <div>Animated content</div>}
</Transition>
```

### Lazy Loading & Suspense

Code-split components with loading boundaries:

```jsx
const HeavyChart = lazy(() => import('./HeavyChart.jsx'))

<Suspense fallback={<div>Loading...</div>}>
  <HeavyChart />
</Suspense>
```

### Refs

Access DOM elements declaratively:

```jsx
const inputRef = createRef()

function Search({ state }) {
  return <input ref={inputRef} />   // inputRef.current is the element once mounted
}
```

### Commands

Send imperative commands from parent to child:

```jsx
import { createCommand } from 'sygnal'

const playerCmd = createCommand()

// Parent passes the command as a prop and sends commands with optional data
function App({ state }) {
  return <VideoPlayer commands={playerCmd} />
}
App.model = {
  SEEK: { EFFECT: () => playerCmd.send('seek', { time: 30 }) },
}

// Child receives via commands$ source
VideoPlayer.intent = ({ commands$ }) => ({
  SEEK: commands$.select('seek'),  // emits { time: 30 }
})
```

### Effect Handlers

Run side effects without state changes:

```jsx
App.model = {
  SEND_COMMAND: {
    EFFECT: () => playerCmd.send('play'),
  },
  ROUTE: {
    EFFECT: (state, data, next) => {
      if (state.mode === 'a') next('DO_A', data)
      else next('DO_B', data)
    },
  },
}
```

### Disposal Hooks

Cleanup on unmount with the built-in `DISPOSE` action:

```jsx
MyComponent.model = {
  DISPOSE: {
    EFFECT: (state) => clearInterval(state.timerId),
  },
}
```

For advanced cases needing stream composition, the `dispose$` source is also available in intent.

### PWA Helpers

Built-in service worker driver, online/offline detection, and install prompt handling:

```jsx
import { run, makeServiceWorkerDriver, onlineStatus$, createInstallPrompt } from 'sygnal'

const installPrompt = createInstallPrompt()

run(App, { SW: makeServiceWorkerDriver('/sw.js') })

App.intent = ({ DOM, SW }) => ({
  ONLINE_CHANGED: onlineStatus$,
  UPDATE_READY:   SW.select('waiting'),
  APPLY_UPDATE:   DOM.click('.update-btn'),
  INSTALL:        DOM.click('.install-btn'),
})
```

### Testing

Test components in isolation with `renderComponent`, driving them with DOM events:

```jsx
import { renderComponent } from 'sygnal'

const t = renderComponent(Counter, { initialState: { count: 0 } })

t.simulateEvent('.increment', 'click')
await t.next(s => s.count === 1)
t.expectNoDiagnostics()

t.dispose()
```

### Server-Side Rendering

Render components to HTML strings on the server:

```jsx
import { renderToString } from 'sygnal'

const html = renderToString(App, {
  state: { count: 0 },
  hydrateState: true,  // embeds state for client hydration
})
```

### Vite Plugin

Auto-configures JSX, HMR with state preservation, and dev-only diagnostics:

```javascript
// vite.config.js
import sygnal from 'sygnal/vite'
export default defineConfig({ plugins: [sygnal()] })
```

```javascript
// src/main.js — just run, HMR is automatic
import { run } from 'sygnal'
import App from './App.jsx'
run(App)
```

### Astro Integration

First-class Astro support with server rendering and client hydration:

```javascript
// astro.config.mjs
import sygnal from 'sygnal/astro'
export default defineConfig({ integrations: [sygnal()] })
```

```astro
---
import Counter from '../components/Counter.jsx'
---
<Counter client:load />
```

### Vike Integration

File-based routing with SSR, client-side navigation, and automatic hydration:

```javascript
// vite.config.js
import sygnal from 'sygnal/vite'
import vike from 'vike/plugin'
export default defineConfig({ plugins: [sygnal({ disableHmr: true }), vike()] })
```

```javascript
// pages/+config.js
import vikeSygnal from 'sygnal/config'
export default { extends: [vikeSygnal] }
```

Pages are standard Sygnal components in `pages/*/+Page.jsx`. Supports layouts, data fetching, SPA mode, custom drivers, and `ClientOnly` for browser-only components.

### TypeScript

Full type definitions included:

```tsx
import type { RootComponent, IntentSources, ActionsOf } from 'sygnal'

type State = { count: number }

const intent = ({ DOM }: IntentSources<State>) => ({
  INCREMENT: DOM.click('.inc'),
})

const App: RootComponent<State, {}, ActionsOf<typeof intent>> = ({ state }) => (
  <button className="inc">{state.count}</button>
)
App.intent = intent
App.model = { INCREMENT: (state) => ({ ...state, count: state.count + 1 }) }
```

Typed actions from the intent, a typed EVENTS registry, typed `CHILD.select()` payloads and type-checked Collection `from`.

## Bundler Setup

**Vite** (recommended): use the plugin above (`plugins: [sygnal()]`). Without it, configure the automatic JSX runtime yourself:

```javascript
// vite.config.js (Vite 8; under Vite 7 use esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' })
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'sygnal' } },
})
```

For TypeScript projects, add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "sygnal"
  }
}
```

Without JSX, use `h()` directly:

```javascript
import { h } from 'sygnal'
h('div', [h('h1', 'Hello'), h('button.btn', 'Click')])
```

## Documentation

📖 **[sygnal.js.org](https://sygnal.js.org)** — Full guide, API reference, and examples.

## Examples

| Example | Description |
|---------|-------------|
| [Getting Started](./examples/getting-started) | Interactive guide with live demos (Astro) |
| [Kanban Board](./examples/kanban) | Drag-and-drop with Collections and cross-component communication |
| [Vike SSR](./examples/vike) | File-based routing with SSR, layouts, and data fetching |
| [Advanced Features](./examples/advanced-feature-tests) | Portals, slots, disposal, suspense, lazy loading |
| [TypeScript 2048](./examples/ts-example-2048) | Full game in TypeScript |
| [AI Discussion Panel](./examples/ai-panel-spa) | Complex SPA with custom drivers |
| [Sygnal ToDoMVC](https://github.com/tpresley/sygnal-todomvc) | [Live Demo](https://tpresley.github.io/sygnal-todomvc/) |
| [Sygnal 2048](https://github.com/tpresley/sygnal-2048) | [Live Demo](https://tpresley.github.io/sygnal-2048/) |
| [Sygnal Mahjong](https://github.com/tpresley/mahjong-trainer) | [Live Demo](https://tpresley.github.io/mahjong-trainer/) |
| [Sygnal Calculator](https://github.com/tpresley/sygnal-calculator) | [Live Demo](https://tpresley.github.io/sygnal-calculator/) |

## Acknowledgments

Sygnal's reactive architecture is built on patterns from [Cycle.js](https://cycle.js.org/) by [André Staltz](https://github.com/staltz). The Cycle.js runtime, DOM driver, state management, and isolation modules have been absorbed into the library — snabbdom, xstream, and extend are the only external dependencies.

## License

[MIT](./LICENSE)
