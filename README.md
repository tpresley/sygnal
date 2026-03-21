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
npx degit tpresley/sygnal-template my-app
cd my-app
npm install
npm run dev
```

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
  DELETE: { PARENT: (state) => ({ type: 'DELETE', taskId: state.id }) }
}

// Parent receives (use component reference — minification-safe)
Lane.intent = ({ CHILD }) => ({
  TASK_DELETED: CHILD.select(TaskCard).filter(e => e.type === 'DELETE'),
})
```

### Event Bus

Global broadcast for cross-component communication:

```jsx
// Any component can emit
Publisher.model = {
  NOTIFY: { EVENTS: (state) => ({ type: 'notification', data: state.message }) }
}

// Any component can subscribe
Subscriber.intent = ({ EVENTS }) => ({
  HANDLE: EVENTS.select('notification'),
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

### Custom Drivers

Wrap any async operation as a driver:

```javascript
import { driverFromAsync } from 'sygnal'

const apiDriver = driverFromAsync(async (url) => {
  const res = await fetch(url)
  return res.json()
}, { selector: 'endpoint', args: 'url', return: 'data' })

run(RootComponent, { API: apiDriver })
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
<input ref={inputRef} />
// inputRef.current.focus()
```

### Commands

Send imperative commands from parent to child:

```jsx
import { createCommand } from 'sygnal'

const playerCmd = createCommand()
<VideoPlayer commands={playerCmd} />

// Parent sends commands with optional data
playerCmd.send('seek', { time: 30 })

// Child receives via commands$ source
VideoPlayer.intent = ({ commands$ }) => ({
  SEEK: commands$.select('seek'),  // emits { time: 30 }
})
```

### Effect Handlers

Run side effects without state changes — no more `ABORT` workarounds:

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

### Model Shorthand

Compact syntax for single-driver model entries:

```jsx
App.model = {
  'SEND_CMD | EFFECT': () => playerCmd.send('play'),
  'NOTIFY | EVENTS': (state) => ({ type: 'alert', data: state.message }),
  'DELETE | PARENT': (state) => ({ type: 'DELETE', id: state.id }),
}
```

### Disposal Hooks

Cleanup on unmount:

```jsx
MyComponent.intent = ({ dispose$ }) => ({
  CLEANUP: dispose$,
})

MyComponent.model = {
  CLEANUP: { WEBSOCKET: () => ({ type: 'close' }) },
}
```

### Testing

Test components in isolation with `renderComponent`:

```jsx
import { renderComponent } from 'sygnal'

const t = renderComponent(Counter, { initialState: { count: 0 } })

t.simulateAction('INCREMENT')
await t.waitForState(s => s.count === 1)

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

Auto-configures JSX and HMR with state preservation:

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

### TypeScript

Full type definitions included:

```tsx
import type { RootComponent } from 'sygnal'

type State = { count: number }
type Actions = { INCREMENT: null }

const App: RootComponent<State, {}, Actions> = ({ state }) => (
  <div>{state.count}</div>
)
```

## Bundler Setup

**Vite** (recommended):

```javascript
// vite.config.js
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'sygnal',
  },
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
| [Advanced Features](./examples/advanced-feature-tests) | Portals, slots, disposal, suspense, lazy loading |
| [TypeScript 2048](./examples/ts-example-2048) | Full game in TypeScript |
| [AI Discussion Panel](./examples/ai-panel-spa) | Complex SPA with custom drivers |
| [Sygnal ToDoMVC](https://github.com/tpresley/sygnal-todomvc) | [Live Demo](https://tpresley.github.io/sygnal-todomvc/) |
| [Sygnal 2048](https://github.com/tpresley/sygnal-2048) | [Live Demo](https://tpresley.github.io/sygnal-2048/) |
| [Sygnal Calculator](https://github.com/tpresley/sygnal-calculator) | [Live Demo](https://tpresley.github.io/sygnal-calculator/) |

## Acknowledgments

Sygnal's reactive architecture is built on patterns from [Cycle.js](https://cycle.js.org/) by [André Staltz](https://github.com/staltz). The Cycle.js runtime, DOM driver, state management, and isolation modules have been absorbed into the library — snabbdom, xstream, and extend are the only external dependencies.

## License

[MIT](./LICENSE)
