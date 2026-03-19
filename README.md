# Sygnal

An intuitive framework for building fast, small and composable components or applications.

Sygnal is built on top of [Cycle.js](https://cycle.js.org/), and allows you to write functional reactive, Observable based, components with fully isolated side-effects without having to worry about the complex plumbing usually associated with functional reactive programming.

Components and applications written using Sygnal look similar to React functional components, and can be nested just as easily, but have many benefits including:
- 100% pure components with absolutely no side effects
- No need for component state management (it's handled automatically at the application level)
- Small bundle sizes
- Fast build times
- Fast rendering
- Close to zero boiler plate code

## Documentation

- **[Getting Started](./docs/getting-started.md)** — Installation, setup, and your first interactive component
- **[Guide](./docs/guide.md)** — In-depth coverage of all features: state, MVI, collections, drivers, context, TypeScript, and more
- **[API Reference](./docs/api-reference.md)** — Complete reference for all exports, types, and configuration options

## Quick Start

```bash
npx degit tpresley/sygnal-template my-app
cd my-app
npm install
npm run dev
```

Or install manually:

```bash
npm install sygnal
```

## In a Nutshell

A Sygnal component is a function (the **view**) with static properties that define **when** things happen (`.intent`) and **what** happens (`.model`):

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

// Intent: WHEN things happen
Counter.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click'),
  DECREMENT: DOM.select('.decrement').events('click')
})

// Model: WHAT happens
Counter.model = {
  INCREMENT: (state) => ({ count: state.count + 1 }),
  DECREMENT: (state) => ({ count: state.count - 1 })
}
```

Start it with `run()`:

```javascript
import { run } from 'sygnal'
import Counter from './Counter.jsx'

run(Counter)
```

That's it. No store setup, no providers, no hooks — just a function and some properties.

## Built on Cycle.js

Sygnal is built on top of Cycle.js which is a functional reactive coding framework that asks "what if the user was a function?"

It is worth reading the summary on the [Cycle.js homepage](https://cycle.js.org/), but essentially Cycle.js allows you to write simple, concise, extensible, and testable code using a functional reactive style, and helps ensure that all side-effects are isolated away from your component code.

Sygnal takes it a step further, and makes it easy to write arbitrarily complex applications that have all of the Cycle.js benefits, but with a much easier learning curve, and virtually no complex plumbing or boiler plate code.

## Key Features

### Model-View-Intent Architecture

Separate **what** your component does (Model), **when** it does it (Intent), and **how** it's displayed (View). All side effects are delegated to drivers, keeping your components 100% pure.

### Monolithic State

Automatic application-level state management with no setup. Trivial undo/redo, state restoration, and time-travel debugging.

### Collections

Render dynamic lists with filtering and sorting built in:

```jsx
<collection of={TodoItem} from="items" filter={item => !item.done} sort="name" />
```

### Switchable Components

Swap between components based on state:

```jsx
<switchable of={{ home: HomePage, settings: SettingsPage }} current={state.activeTab} />
```

### Form Handling

Extract form values without the plumbing:

```jsx
import { processForm } from 'sygnal'

MyForm.intent = ({ DOM }) => ({
  SUBMITTED: processForm(DOM.select('.my-form'), { events: 'submit' })
})
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

Catch and recover from errors in child component rendering without crashing the app:

```jsx
BrokenComponent.onError = (error, { componentName }) => (
  <div>Something went wrong in {componentName}</div>
)
```

### Refs (DOM Access)

Access DOM elements declaratively:

```jsx
import { createRef } from 'sygnal'
const myRef = createRef()

function MyComponent({ state }) {
  return <div ref={myRef}>Measured: {state.width}px</div>
}
```

### Portals

Render children into a different DOM container — essential for modals, tooltips, and dropdowns:

```jsx
import { Portal } from 'sygnal'

{state.showModal && (
  <Portal target="#modal-root">
    <div className="modal">Modal content here</div>
  </Portal>
)}
```

### Transitions

CSS-based enter/leave animations:

```jsx
import { Transition } from 'sygnal'

<Transition enter="fade-in" leave="fade-out">
  {state.visible && <div>Animated content</div>}
</Transition>
```

### Lazy Loading

Code-split components with automatic placeholder rendering:

```jsx
import { lazy } from 'sygnal'
const HeavyChart = lazy(() => import('./HeavyChart.jsx'))
```

### Suspense

Show fallback UI while async children resolve:

```jsx
import { Suspense } from 'sygnal'

<Suspense fallback={<div>Loading...</div>}>
  <SlowComponent />
</Suspense>
```

Components signal readiness via the built-in `READY` sink. Components without explicit `READY` model entries are ready immediately.

### Disposal Hooks

Run cleanup logic when components unmount — close connections, clear timers:

```jsx
MyComponent.intent = ({ DOM, dispose$ }) => ({
  CLEANUP: dispose$,  // Emits once on unmount
})

MyComponent.model = {
  CLEANUP: {
    WEBSOCKET: () => ({ type: 'close' }),
  },
}
```

### Hot Module Replacement

State-preserving HMR out of the box:

```javascript
const { hmr, dispose } = run(RootComponent)

if (import.meta.hot) {
  import.meta.hot.accept('./RootComponent.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
```

### Astro Integration

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

### TypeScript Support

Full type definitions included:

```tsx
import type { RootComponent } from 'sygnal'

type AppState = { count: number }
type AppActions = { INCREMENT: null }

const App: RootComponent<AppState, {}, AppActions> = ({ state }) => (
  <div>{state.count}</div>
)
```

## Bundler Setup (JSX)

For Vite:

```javascript
// vite.config.js
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'sygnal',
  }
})
```

For TypeScript projects, also add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "sygnal"
  }
}
```

Without JSX, use `h()`:

```javascript
import { h } from 'sygnal'
h('div', [h('h1', 'Hello'), h('button.btn', 'Click')])
```

See the [Guide](./docs/guide.md#bundler-configuration) for other bundlers.

## Examples

- **[Getting Started](./examples/getting-started)** — Interactive guide with live demos (Astro)
- **[Kanban Board](./examples/kanban)** — Drag-and-drop with Collections and cross-component communication
- **[Advanced Feature Tests](./examples/advanced-feature-tests)** — Portals, disposal, suspense, lazy loading
- **[TypeScript 2048](./examples/ts-example-2048)** — Full game in TypeScript
- **[AI Discussion Panel](./examples/ai-panel-spa)** — Complex SPA with custom drivers
- **[Astro Integration](./examples/astro-smoke)** — Sygnal in Astro
- **[HMR Smoke Test](./examples/hmr-smoke)** — Minimal counter with HMR
- **[Sygnal ToDoMVC](https://github.com/tpresley/sygnal-todomvc)** ([Live Demo](https://tpresley.github.io/sygnal-todomvc/)) — TodoMVC implementation
- **[Sygnal 2048](https://github.com/tpresley/sygnal-2048)** ([Live Demo](https://tpresley.github.io/sygnal-2048/)) — 2048 game
- **[Sygnal Calculator](https://github.com/tpresley/sygnal-calculator)** ([Live Demo](https://tpresley.github.io/sygnal-calculator/)) — Simple calculator

## License

MIT
