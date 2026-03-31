---
title: API Reference
description: Complete API documentation for Sygnal
---

## run()

Bootstraps a Sygnal application.

```typescript
function run(
  component: RootComponent,
  drivers?: Record<string, CycleDriver>,
  options?: RunOptions
): SygnalApp
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `component` | `RootComponent` | The root component function (with optional `.intent`, `.model`, etc.) |
| `drivers` | `Record<string, CycleDriver>` | Additional drivers beyond the defaults (optional) |
| `options` | `RunOptions` | Configuration options (optional) |

### RunOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mountPoint` | `string` | `'#root'` | CSS selector for the DOM element to render into |
| `fragments` | `boolean` | `true` | Enable JSX fragment support in the DOM driver |
| `useDefaultDrivers` | `boolean` | `true` | Include default drivers (DOM, STATE, EVENTS, LOG) |

### Returns: SygnalApp

| Property | Type | Description |
|----------|------|-------------|
| `sources` | `object` | All driver source objects |
| `sinks` | `object` | All driver sink streams |
| `dispose` | `() => void` | Shuts down the application and cleans up listeners |
| `hmr` | `(newComponent?, state?) => void` | Hot-swap the root component, preserving state |

### Examples

```javascript
import { run } from 'sygnal'
import RootComponent from './RootComponent.jsx'

// Basic usage
run(RootComponent)

// With custom mount point
run(RootComponent, {}, { mountPoint: '#app' })

// With custom drivers
import myDriver from './myDriver'
run(RootComponent, { MY_DRIVER: myDriver })

// With HMR (Vite)
const { hmr, dispose } = run(RootComponent)
if (import.meta.hot) {
  import.meta.hot.accept('./RootComponent.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
```

---

## Vite Plugin

Auto-configures JSX transform and HMR. Import from `sygnal/vite`.

```javascript
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
})
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `disableJsx` | `boolean` | `false` | Skip automatic JSX configuration |
| `disableHmr` | `boolean` | `false` | Skip automatic HMR injection |

The HMR transform runs only in dev mode (`vite` / `vite dev`). Files that already contain `import.meta.hot` are left untouched.

See [Bundler Configuration](/integration/bundler-config/) for details.

---

## component()

Lower-level factory for creating Sygnal components with explicit options. Most users won't need this — function augmentation (attaching `.model`, `.intent`, etc. directly to the view function) is the standard approach. Use `component()` when you need advanced isolation control or are building components programmatically.

```typescript
function component(options: ComponentFactoryOptions): Component
```

### ComponentFactoryOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | — | Component identifier (used in debug logs) |
| `view` | `Function` | — | The component's view function |
| `model` | `object` | — | Action-to-reducer mapping |
| `intent` | `Function` | — | Maps sources to action streams |
| `initialState` | `object` | — | Starting state |
| `calculated` | `object` | — | Derived state field definitions. Values are either `(state) => value` or `[[...deps], (state) => value]` for dependency-tracked memoization. Deps can reference base state keys or other calculated field names. Circular dependencies throw at creation time. |
| `storeCalculatedInState` | `boolean` | `true` | Whether to store calculated fields in state |
| `context` | `object` | — | Context values for descendants |
| `peers` | `object` | — | Peer component definitions |
| `components` | `object` | — | Named child component definitions |
| `hmrActions` | `string \| string[]` | — | Actions to trigger on HMR |
| `DOMSourceName` | `string` | `'DOM'` | Custom DOM driver name |
| `stateSourceName` | `string` | `'STATE'` | Custom state driver name |
| `debug` | `boolean` | `false` | Enable debug logging |

### Example

```javascript
import { component } from 'sygnal'

const MyComponent = component({
  name: 'MyComponent',
  view: ({ state }) => <div>{state.count}</div>,
  initialState: { count: 0 },
  intent: ({ DOM }) => ({
    INCREMENT: DOM.select('.btn').events('click')
  }),
  model: {
    INCREMENT: (state) => ({ count: state.count + 1 })
  }
})
```

---

## collection() / Collection

Renders a list of components from an array on state.

### JSX Usage (lowercase)

```jsx
<collection of={ItemComponent} from="items" filter={fn} sort="name" />
```

### JSX Usage (capitalized)

```jsx
import { Collection } from 'sygnal'

<Collection of={ItemComponent} from="items" className="list" />
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `of` | `Component` | Yes | The component to instantiate for each item |
| `from` | `string \| Lens` | Yes | State property name or lens for the source array |
| `filter` | `(item) => boolean` | No | Filter function — only items returning `true` are rendered |
| `sort` | `string \| object \| array \| function` | No | Sort items — string (field name, `"asc"`, or `"desc"`), object (`{ field: "asc" \| "desc" \| 1 \| -1 }`), array (multi-field), or comparator function |
| `className` | `string` | No | CSS class for the wrapping container element |

### Programmatic Usage

```javascript
import { collection } from 'sygnal'

const MyList = collection(ItemComponent, 'items', {
  container: 'ul',          // HTML element for the container (default: 'div')
  containerClass: 'my-list', // CSS class for the container
  combineList: ['DOM'],      // Sinks to combine (default: ['DOM'])
  globalList: ['EVENTS'],    // Sinks to merge globally (default: ['EVENTS'])
  stateSourceName: 'STATE',  // State driver name (default: 'STATE')
  domSourceName: 'DOM'       // DOM driver name (default: 'DOM')
})
```

### Item Keys

Items are keyed by their `id` property if present, otherwise by array index:

```javascript
itemKey: (state, index) => state.id !== undefined ? state.id : index
```

### Self-Removal

An item removes itself from the collection by returning `undefined` from a state reducer:

```javascript
Item.model = {
  REMOVE: () => undefined
}
```

---

## switchable() / Switchable

Conditionally renders one component from a set based on a name.

### JSX Usage (lowercase)

```jsx
<switchable
  of={{ tab1: Component1, tab2: Component2 }}
  current={state.activeTab}
/>
```

### JSX Usage (capitalized)

```jsx
import { Switchable } from 'sygnal'

<Switchable of={{ tab1: Component1, tab2: Component2 }} current={state.activeTab} />
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `of` | `Record<string, Component>` | Yes | Maps names to components |
| `current` | `string` | Yes | Name of the currently visible component |
| `state` | `string \| Lens` | No | State slice for the switched components |

### Programmatic Usage

```javascript
import { switchable } from 'sygnal'

// With a state property name
const MySwitchable = switchable(
  { tab1: Component1, tab2: Component2 },
  'activeTab',    // State property to watch
  'tab1',         // Initial/default value
  { switched: ['DOM'], stateSourceName: 'STATE' }
)

// With a mapping function
const MySwitchable = switchable(
  { tab1: Component1, tab2: Component2 },
  state => state.tabs.current,  // Function to extract current name from state
  'tab1'
)

// With a stream
const MySwitchable = switchable(
  { tab1: Component1, tab2: Component2 },
  name$,          // Observable stream of component names
  'tab1'
)
```

### Options (programmatic)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `switched` | `string[]` | `['DOM']` | Which sinks switch with the active component |
| `stateSourceName` | `string` | `'STATE'` | State driver name |

### Behavior

- **Switched sinks** (default: `DOM`) — Only the active component's output is used
- **Non-switched sinks** — Merged from all components (they all remain active)

---

## Portal

Renders children into a different DOM container.

```jsx
import { Portal } from 'sygnal'

<Portal target="#modal-root">
  <div className="modal">Content</div>
</Portal>
```

| Prop | Type | Description |
|------|------|-------------|
| `target` | `string` | **Required.** CSS selector for the destination container |
| `children` | `VNode[]` | Content to render in the target |

Portal content is outside the component's DOM event delegation scope. Use `DOM.select('document').events('click').filter(...)` to capture events on portal elements.

---

## Transition

CSS-based enter/leave animations using a Vue-style `name` prop that generates six CSS classes.

```jsx
import { Transition } from 'sygnal'

<Transition name="fade">
  {state.visible && <div>Animated</div>}
</Transition>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | `'v'` | Base name for generated CSS classes (`{name}-enter-from`, `{name}-enter-active`, `{name}-enter-to`, `{name}-leave-from`, `{name}-leave-active`, `{name}-leave-to`) |
| `duration` | `number` | — | Explicit timeout in ms. If omitted, listens for `transitionend` event |

See [Transitions guide](/advanced/transitions/) for the full class lifecycle and CSS examples.

---

## Suspense

Shows fallback UI while children are not ready.

```jsx
import { Suspense } from 'sygnal'

<Suspense fallback={<div>Loading...</div>}>
  <AsyncComponent />
</Suspense>
```

| Prop | Type | Description |
|------|------|-------------|
| `fallback` | `VNode \| string` | UI to show while children are pending |
| `children` | `VNode[]` | Children that may signal not-ready via the READY sink |

### READY Sink

Components control Suspense via the built-in `READY` sink:

```jsx
// Component starts as not-ready, signals ready when data loads
MyComponent.model = {
  DATA_LOADED: {
    STATE: (state, data) => ({ ...state, data }),
    READY: () => true,
  },
}
```

Components without explicit `READY` model entries auto-emit `true` on instantiation.

---

## Slot

Marks named content regions for child components to render in specific locations.

```jsx
import { Slot } from 'sygnal'

<Card state="card">
  <Slot name="header"><h2>Title</h2></Slot>
  <Slot name="actions"><button>Save</button></Slot>
  <p>Default content</p>
</Card>
```

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Slot name. If omitted, content goes to the `default` slot |
| `children` | `VNode[]` | Content for this slot |

The child component receives a `slots` object in its view parameters:

```jsx
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

Unnamed children (not wrapped in `<Slot>`) go to `slots.default`. The `children` parameter continues to work as before — it contains the same elements as `slots.default`.

See [Slots guide](/advanced/slots/) for reactive updates and fallback patterns.

---

## lazy()

Code-split a component via dynamic import.

```typescript
function lazy(loadFn: () => Promise<{ default: Component }>): Component
```

```jsx
import { lazy } from 'sygnal'
const HeavyChart = lazy(() => import('./HeavyChart.jsx'))
```

Renders a `<div data-sygnal-lazy="loading">` placeholder until the import resolves. Static properties (intent, model, etc.) are copied from the loaded module's default export.

---

## createRef()

Creates a ref object for DOM element access.

```typescript
function createRef<T extends Element = Element>(): { current: T | null }
```

```jsx
import { createRef } from 'sygnal'
const myRef = createRef()

<div ref={myRef}>...</div>

// In model:
myRef.current?.offsetWidth  // Access the DOM element
```

The `ref` prop sets `.current` to the DOM element on mount and `null` on unmount.

---

## createRef$()

Creates a stream-based ref that emits the DOM element.

```typescript
function createRef$<T extends Element = Element>(): Stream<T | null>
```

```jsx
import { createRef$ } from 'sygnal'
const el$ = createRef$()

<div ref={el$}>...</div>

// In intent:
MyComponent.intent = () => ({
  ELEMENT: el$,
})
```

---

## createCommand()

Creates an imperative command channel for parent-to-child communication.

```typescript
function createCommand(): Command
```

### Returns: Command

| Property | Type | Description |
|----------|------|-------------|
| `send` | `(type: string, data?: any) => void` | Send a named command with optional data |

When a `Command` object is passed as any prop to a child component, the child receives a `commands$` source in intent:

### commands$ Source

| Method | Type | Description |
|--------|------|-------------|
| `select` | `(type: string) => Stream<any>` | Returns a stream that emits the `data` from each matching command |

### Examples

```jsx
import { createCommand, ABORT } from 'sygnal'

const cmd = createCommand()

// Parent passes as prop and sends commands
<VideoPlayer commands={cmd} />
cmd.send('play')
cmd.send('seek', { time: 30 })

// Child reads via commands$ source in intent
VideoPlayer.intent = ({ commands$ }) => ({
  PLAY: commands$.select('play'),
  SEEK: commands$.select('seek'),  // emits { time: 30 }
})
```

See [Commands guide](/advanced/commands/) for usage patterns.

---

## EFFECT (Built-in Sink)

A built-in sink for side-effect-only model entries. Runs the reducer function but produces no state change and emits nothing to any driver.

```typescript
Component.model = {
  ACTION_NAME: {
    EFFECT: (state, data, next, props) => void
  }
}
```

### Reducer Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `state` | `STATE` | Current component state (with calculated fields) |
| `data` | `any` | Data from the triggering action |
| `next` | `(action, data?, delay?) => void` | Dispatch a follow-up action |
| `props` | `object` | Current props, children, slots, context |

### Examples

```jsx
// Send a command without changing state
App.model = {
  PLAY: {
    EFFECT: () => playerCmd.send('play'),
  },
}

// Route to different actions based on state
App.model = {
  ROUTE: {
    EFFECT: (state, data, next) => {
      if (state.mode === 'a') next('DO_A', data)
      else next('DO_B', data)
    },
  },
}

// Combine with other sinks
App.model = {
  SUBMIT: {
    STATE: (state) => ({ ...state, submitting: true }),
    EFFECT: () => formCmd.send('validate'),
  },
}
```

Returns a `console.warn` if the reducer returns a value — EFFECT handlers should not return anything.

See [Effect Handlers guide](/advanced/effect/) for more patterns.

---

## Model Shorthand

Compact syntax for model entries that target a single sink. Use `'ACTION | SINK'` as the key:

```typescript
Component.model = {
  'ACTION | SINK': reducer
}
// Equivalent to:
Component.model = {
  ACTION: { SINK: reducer }
}
```

### Examples

```jsx
App.model = {
  'PLAY | EFFECT':   () => playerCmd.send('play'),
  'ALERT | EVENTS':  (state) => ({ type: 'notify', data: state.msg }),
  'DELETE | PARENT':  (state) => ({ type: 'DELETE', id: state.id }),
  'FETCH | HTTP':    (state) => ({ url: `/api/${state.id}` }),
}
```

The `|` separator requires the key to be a quoted string. Whitespace around `|` is optional. Intent action names containing `|` throw an error.

See [Model Shorthand guide](/advanced/model-shorthand/) for more details.

---

## renderComponent()

Render a Sygnal component in isolation for testing. Creates a minimal Cycle.js runtime with mocked DOM, event bus, and state drivers.

```typescript
function renderComponent(
  component: ComponentFunction,
  options?: RenderOptions
): RenderResult
```

### RenderOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initialState` | `any` | Component's `.initialState` | Override the component's initial state |
| `mockConfig` | `object` | `{}` | Mock DOM events — maps selectors to event streams |
| `drivers` | `object` | `{}` | Additional drivers beyond the defaults |

### Returns: RenderResult

| Property | Type | Description |
|----------|------|-------------|
| `state$` | `Stream<any>` | Live stream of state values |
| `dom$` | `Stream<any>` | Live stream of rendered VNode trees |
| `events$` | `EventsSource` | Event bus source (`.select(type)`) |
| `sinks` | `object` | All driver sink streams |
| `sources` | `object` | All driver source objects |
| `states` | `any[]` | Collected state values |
| `simulateAction` | `(name: string, data?: any) => void` | Push an action into the model |
| `waitForState` | `(predicate, timeout?) => Promise<any>` | Resolve when state matches |
| `dispose` | `() => void` | Tear down the component |

### Examples

```jsx
import { renderComponent } from 'sygnal'

// Basic usage
const t = renderComponent(Counter, { initialState: { count: 0 } })
t.simulateAction('INCREMENT')
await t.waitForState(s => s.count === 1)
t.dispose()

// With mock DOM events
import xs from 'xstream'
const t = renderComponent(Counter, {
  mockConfig: { '.inc': { click: xs.of({}) } },
})
```

See [Testing guide](/integration/testing/) for full usage patterns.

---

## renderToString()

Render a Sygnal component to an HTML string for server-side rendering. Recursively renders sub-components, Collections, and special components.

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
| `hydrateState` | `boolean \| string` | — | Embed state in `<script>` tag for client hydration |

### Examples

```jsx
import { renderToString } from 'sygnal'

// Basic usage
const html = renderToString(App, { state: { count: 0 } })

// With hydration state
const html = renderToString(App, {
  state: { count: 5 },
  hydrateState: true,
})
// Appends: <script>window.__SYGNAL_STATE__={"count":5}</script>
```

See [Server-Side Rendering guide](/integration/ssr/) for full usage patterns.

---

## DISPOSE (Built-in Action)

A built-in model action that fires automatically when the component is about to unmount. This is the preferred way to handle component cleanup.

```jsx
MyComponent.model = {
  DISPOSE: {
    EFFECT: (state) => {
      clearInterval(state.intervalId)
    },
  },
}
```

Works with all sinks (EFFECT, EVENTS, PARENT, STATE) and supports model shorthand:

```jsx
MyComponent.model = {
  'DISPOSE | EFFECT': (state) => clearInterval(state.intervalId),
}
```

The reducer receives the current state, so you can access component data during cleanup.

---

## dispose$ (Advanced)

A source stream available in every component's intent. Emits `true` once when the component unmounts. Use this for advanced cases that need stream composition. For most cleanup tasks, the `DISPOSE` model action is simpler.

```jsx
MyComponent.intent = ({ DOM, dispose$ }) => ({
  CLEANUP: dispose$,
})

MyComponent.model = {
  CLEANUP: {
    WEBSOCKET: () => ({ type: 'close' }),
  },
}
```

Not imported — automatically available as a source in intent.

---

## onError (Static Property)

Error boundary handler for a component.

```typescript
Component.onError = (error: Error, info: { componentName: string }) => VNode | undefined
```

```jsx
MyComponent.onError = (error, { componentName }) => (
  <div>Error in {componentName}: {error.message}</div>
)
```

If not defined, errors render an empty `<div data-sygnal-error>` and log to `console.error`.

---

## isolatedState (Static Property)

Required when a sub-component declares `.initialState`. Prevents accidental parent state overwrite.

```jsx
Widget.initialState = { count: 0 }
Widget.isolatedState = true  // Required — without this, Sygnal throws an error
```

When `isolatedState = true` and the parent state doesn't have the child's state slice, the child's `initialState` seeds it automatically.

---

## makeDragDriver()

Creates a Cycle.js driver for HTML5 drag-and-drop that works across isolated components.

```typescript
function makeDragDriver(): (sink$: Stream<DragDriverRegistration | DragDriverRegistration[]>) => DragDriverSource
```

### Setup

```javascript
import { run, makeDragDriver } from 'sygnal'
import RootComponent from './RootComponent.jsx'

run(RootComponent, { DND: makeDragDriver() })
```

### DragDriverRegistration

Configuration objects emitted via the model sink to register drag categories:

```typescript
type DragDriverRegistration = {
  category:   string    // Required: name for this group of drag elements
  draggable?: string    // CSS selector for draggable elements
  dropZone?:  string    // CSS selector for drop zones
  accepts?:   string    // Only accept drops from this dragging category
  dragImage?: string    // CSS selector for custom drag preview (resolved via .closest())
}
```

Register categories from `BOOTSTRAP` in the model. Wrap in `{ configs: [...] }` because model sinks cannot return bare arrays:

```javascript
RootComponent.model = {
  BOOTSTRAP: {
    DND: () => ({
      configs: [
        { category: 'task', draggable: '.task-card' },
        { category: 'lane', dropZone: '.lane-drop-zone', accepts: 'task' },
      ],
    }),
  },
}
```

### DragDriverSource

The source object returned by the driver, available in intent as `DND`:

```typescript
type DragDriverSource = {
  select(category: string): DragDriverCategory
  dragstart(category: string): Stream<DragStartPayload>
  dragend(category: string): Stream<null>
  drop(category: string): Stream<DropPayload>
  dragover(category: string): Stream<any>
  dispose(): void
}
```

The shorthand methods (`dragstart`, `dragend`, `drop`, `dragover`) are equivalent to `select(category).events(eventName)`.

### DragDriverCategory

Returned by `DND.select(category)`:

```typescript
type DragDriverCategory = {
  events(eventType: 'dragstart'): Stream<DragStartPayload>
  events(eventType: 'dragend'):   Stream<null>
  events(eventType: 'drop'):      Stream<DropPayload>
  events(eventType: string):      Stream<any>
}
```

### Event Payloads

```typescript
type DragStartPayload = {
  element: HTMLElement          // The dragged element
  dataset: Record<string, string>  // The element's data-* attributes
}

type DropPayload = {
  dropZone:     HTMLElement        // The drop zone element
  insertBefore: HTMLElement | null // Sibling element at the cursor (for ordering)
}
```

### Example

```javascript
RootComponent.intent = ({ DND }) => ({
  DRAG_START: DND.dragstart('task'),
  DROP:       DND.drop('lane'),
  DRAG_END:   DND.dragend('task'),
})

RootComponent.model = {
  DRAG_START: (state, { dataset }) => ({
    ...state,
    dragging: { taskId: dataset.taskId },
  }),

  DROP: (state, { dropZone, insertBefore }) => {
    const toLaneId = dropZone.dataset.laneId
    // ... move the dragged task
  },

  DRAG_END: (state) => ({ ...state, dragging: null }),
}
```

---

## processForm()

Extracts form field values from a form DOM source.

```typescript
function processForm(
  target: FormSource,
  options?: { events?: string | string[]; preventDefault?: boolean }
): Stream<FormData>
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `FormSource` | A DOM source for a form element (from `DOM.select('.my-form')`) |
| `options.events` | `string \| string[]` | Events to listen for (default: `['input', 'submit']`) |
| `options.preventDefault` | `boolean` | Call `preventDefault()` on events (default: `true`) |

### Returns

A stream that emits objects containing:

| Property | Type | Description |
|----------|------|-------------|
| `[fieldName]` | `any` | Each form field's value, keyed by its `name` attribute |
| `event` | `Event` | The raw DOM event |
| `eventType` | `string` | The event type (e.g., `'input'`, `'submit'`) |

If a submit button with a `name` attribute is focused, its name and value are also included.

### Example

```jsx
import { processForm } from 'sygnal'

MyForm.intent = ({ DOM }) => ({
  // All field changes and submits
  FORM_DATA: processForm(DOM.select('.my-form')),

  // Submit only
  SUBMITTED: processForm(DOM.select('.my-form'), { events: 'submit' }),

  // Custom events, no preventDefault
  CHANGES: processForm(DOM.select('.my-form'), {
    events: ['input', 'change'],
    preventDefault: false
  })
})
```

---

## driverFromAsync()

Creates a Cycle.js driver from a Promise-returning function.

```typescript
function driverFromAsync(
  promiseReturningFunction: (...args: any[]) => Promise<any>,
  options?: DriverFromAsyncOptions
): CycleDriver
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `promiseReturningFunction` | `Function` | An async function or function returning a Promise |
| `options` | `DriverFromAsyncOptions` | Configuration (optional) |

### DriverFromAsyncOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `selector` | `string` | `'category'` | Property name used to categorize and filter responses |
| `args` | `string \| string[] \| Function` | `'value'` | How to extract function arguments from incoming commands |
| `return` | `string` | `'value'` | Property name to wrap the return value in |
| `pre` | `(incoming) => incoming` | Identity | Pre-process incoming sink values before argument extraction |
| `post` | `(result, incoming) => result` | Identity | Post-process results before sending to source |

### Source API

The driver source exposes:

```typescript
source.select(selector?: string | Function): Stream
```

- `select()` with no arguments returns all responses
- `select('name')` filters responses where `[selectorProperty] === 'name'`
- `select(fn)` filters responses using a custom predicate function

### Example

```javascript
import { driverFromAsync } from 'sygnal'

// Create a driver from a fetch function
const apiDriver = driverFromAsync(
  async (url, method = 'GET') => {
    const res = await fetch(url, { method })
    return res.json()
  },
  {
    selector: 'endpoint',
    args: (incoming) => [incoming.url, incoming.method],
    return: 'data',
    post: (result) => ({ success: true, payload: result })
  }
)

// Register it
run(RootComponent, { API: apiDriver })

// Use in intent
MyComponent.intent = ({ API }) => ({
  USERS_LOADED: API.select('users')
})

// Use in model
MyComponent.model = {
  FETCH_USERS: {
    API: () => ({ endpoint: 'users', url: '/api/users', method: 'GET' })
  }
}
```

---

## makeServiceWorkerDriver()

Creates a Cycle.js driver that registers a service worker and exposes lifecycle events as streams. ([PWA Helpers guide](/integration/pwa/))

```typescript
function makeServiceWorkerDriver(
  scriptUrl: string,
  options?: ServiceWorkerOptions
): (sink$: Stream<ServiceWorkerCommand>) => ServiceWorkerSource
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `scriptUrl` | `string` | Path to the service worker file (e.g., `'/sw.js'`) |
| `options` | `ServiceWorkerOptions` | Optional configuration |

### ServiceWorkerOptions

| Option | Type | Description |
|--------|------|-------------|
| `scope` | `string` | Registration scope for the service worker |

### Source API

```typescript
source.select(type?: string): Stream
```

| Event Type | Emits | Description |
|-----------|-------|-------------|
| `'installed'` | `true` | Worker finished installing |
| `'activated'` | `true` | Worker activated |
| `'waiting'` | `ServiceWorker` | New version waiting to activate |
| `'controlling'` | `true` | Worker took control of the page |
| `'error'` | `Error` | Registration or lifecycle error |
| `'message'` | `any` | Data from `postMessage` |

### Sink Commands

| Command | Description |
|---------|-------------|
| `{ action: 'skipWaiting' }` | Tell waiting worker to activate immediately |
| `{ action: 'postMessage', data: any }` | Send a message to the active worker |
| `{ action: 'unregister' }` | Unregister the service worker |

### Example

```javascript
import { run, makeServiceWorkerDriver } from 'sygnal'

run(App, { SW: makeServiceWorkerDriver('/sw.js') })

App.intent = ({ SW, DOM }) => ({
  UPDATE_READY: SW.select('waiting'),
  APPLY_UPDATE: DOM.click('.update-btn'),
})

App.model = {
  UPDATE_READY: (state) => ({ ...state, updateAvailable: true }),
  APPLY_UPDATE: {
    SW: () => ({ action: 'skipWaiting' }),
    EFFECT: () => window.location.reload(),
  },
}
```

---

## onlineStatus$()

Returns a stream of booleans reflecting the browser's online/offline state. ([PWA Helpers guide](/integration/pwa/))

```typescript
function onlineStatus$(): Stream<boolean>
```

Emits `navigator.onLine` immediately, then `true`/`false` on `online`/`offline` window events. SSR-safe — emits `true` once if `window` is undefined.

### Example

```javascript
import { onlineStatus$ } from 'sygnal'

App.intent = () => ({
  ONLINE_CHANGED: onlineStatus$(),
})

App.model = {
  ONLINE_CHANGED: (state, isOnline) => ({ ...state, isOffline: !isOnline }),
}
```

---

## createInstallPrompt()

Captures the `beforeinstallprompt` browser event and exposes it reactively. ([PWA Helpers guide](/integration/pwa/))

```typescript
function createInstallPrompt(): InstallPrompt
```

### Returns: InstallPrompt

| Method | Returns | Description |
|--------|---------|-------------|
| `select(type)` | `Stream<any>` | Stream filtered by `'beforeinstallprompt'` or `'appinstalled'` |
| `prompt()` | `Promise \| undefined` | Triggers the deferred install prompt |

### Example

```javascript
import { createInstallPrompt } from 'sygnal'

const installPrompt = createInstallPrompt()

App.intent = ({ DOM }) => ({
  CAN_INSTALL: installPrompt.select('beforeinstallprompt'),
  INSTALL:     DOM.click('.install-btn'),
})

App.model = {
  CAN_INSTALL: (state) => ({ ...state, canInstall: true }),
  INSTALL: {
    EFFECT: () => installPrompt.prompt(),
    STATE: (state) => ({ ...state, canInstall: false }),
  },
}
```

---

## xs

The xstream Observable library, re-exported for convenience.

```typescript
import { xs } from 'sygnal'
```

### Common Methods

| Method | Description |
|--------|-------------|
| `xs.of(...values)` | Create a stream from values |
| `xs.never()` | A stream that never emits |
| `xs.empty()` | A stream that immediately completes |
| `xs.periodic(ms)` | Emits incrementing numbers at an interval |
| `xs.merge(...streams)` | Combine multiple streams — emits whenever any stream emits |
| `xs.combine(...streams)` | Combine latest values from multiple streams |
| `xs.fromPromise(promise)` | Create a stream from a Promise |

### Common Instance Methods

| Method | Description |
|--------|-------------|
| `.map(fn)` | Transform emitted values |
| `.mapTo(value)` | Replace all emissions with a constant value |
| `.filter(fn)` | Only pass values where the predicate returns true |
| `.startWith(value)` | Emit an initial value before the stream's first emission |
| `.remember()` | Cache the last emitted value for late subscribers |
| `.flatten()` | Unwrap a stream of streams |
| `.compose(operator)` | Apply a stream operator |
| `.fold(fn, seed)` | Accumulate values (like `reduce` for streams) |
| `.drop(n)` | Skip the first N emissions |
| `.take(n)` | Only emit the first N values |
| `.last()` | Emit only the final value |
| `.endWhen(other$)` | Complete when another stream emits |

See the full [xstream documentation](https://github.com/staltz/xstream) for more.

---

## Stream Operators

Sygnal re-exports commonly used xstream extra operators:

```javascript
import { debounce, throttle, delay, dropRepeats, sampleCombine } from 'sygnal'
```

### debounce(ms)

Wait for a pause in emissions before passing the latest value through.

```javascript
const search$ = input$.compose(debounce(300))
```

### throttle(ms)

Emit at most once per time period.

```javascript
const scroll$ = scrollEvents$.compose(throttle(200))
```

### delay(ms)

Delay all emissions by a fixed duration.

```javascript
const delayed$ = click$.compose(delay(500))
```

### dropRepeats(isEqual?)

Drop consecutive duplicate values. Optionally provide a custom equality function.

```javascript
const unique$ = values$.compose(dropRepeats())
const customUnique$ = objects$.compose(dropRepeats((a, b) => a.id === b.id))
```

### sampleCombine(...streams)

When the source emits, combine with the latest value from other streams.

```javascript
const withState$ = click$.compose(sampleCombine(state$))
// Emits [clickEvent, latestState] each time click$ fires
```

---

## Event Shorthands

### DOM Source

The DOM source wraps `@cycle/dom`'s `MainDOMSource` with a Proxy that adds shorthand event methods. Any property access that doesn't already exist on the source becomes an event listener factory:

```typescript
type SygnalDOMSource = MainDOMSource & {
  [eventName: string]: (selector: string) => Stream<Event>
}
```

```javascript
// DOM.eventName(selector) is equivalent to DOM.select(selector).events(eventName)

DOM.click('.btn')        // DOM.select('.btn').events('click')
DOM.dblclick('.title')   // DOM.select('.title').events('dblclick')
DOM.keydown('.input')    // DOM.select('.input').events('keydown')
DOM.blur('.field')       // DOM.select('.field').events('blur')
DOM.submit('.form')      // DOM.select('.form').events('submit')
DOM.mouseenter('.card')  // DOM.select('.card').events('mouseenter')
```

Any valid DOM event name works. The original `.select().events()` API is unchanged.

### Event Value Extraction

All DOM event streams (from `.events()` or shorthands) have chainable convenience methods:

```javascript
DOM.input('.field').value()              // e.target.value
DOM.change('.checkbox').checked()        // e.target.checked
DOM.click('.item').data('id')            // e.target.dataset.id (walks up via closest())
DOM.keydown('.input').key()              // e.key
DOM.click('.btn').target()               // e.target
```

Each method optionally accepts a transform function:

```javascript
DOM.input('.count').value(Number)        // Parse as number
DOM.click('.item').data('id', Number)    // Parse data attribute as number
```

| Method | Extracts | Notes |
|--------|----------|-------|
| `.value(fn?)` | `e.target.value` | For input/textarea/select |
| `.checked(fn?)` | `e.target.checked` | For checkboxes |
| `.data(name, fn?)` | `e.target.dataset[name]` | Walks up via `closest([data-name])` |
| `.key(fn?)` | `e.key` | For keyboard events |
| `.target(fn?)` | `e.target` | The DOM element |

Returns enriched streams — chainable with `.compose()`, `.filter()`, etc.

### DND Source

The DND driver source provides equivalent shorthands as explicit methods:

```javascript
DND.dragstart('task')  // DND.select('task').events('dragstart')
DND.dragend('task')    // DND.select('task').events('dragend')
DND.drop('lane')       // DND.select('lane').events('drop')
DND.dragover('lane')   // DND.select('lane').events('dragover')
```

See [makeDragDriver()](#makedragdriver) for full DND source documentation.

---

## Focus Management Props

Declarative JSX props for managing element focus. These are handled by the pragma layer and never reach the DOM.

### autoFocus

```jsx
<input autoFocus={true} />
```

When the element is inserted into the DOM, `.focus()` is called on it. Works on any focusable element (`input`, `textarea`, `select`, `button`, elements with `tabindex`, etc.).

### autoSelect

```jsx
<input autoFocus={true} autoSelect={true} value={state.title} />
```

When used alongside `autoFocus`, `.select()` is called after `.focus()`, selecting all text in the element. Only meaningful on elements that support text selection (`input`, `textarea`).

### Behavior

- Props are removed from the element before rendering — they do not become HTML attributes
- A snabbdom `insert` hook is injected automatically
- If you set your own `hook={{ insert: fn }}`, both hooks run (yours first, then focus)
- `autoSelect` without `autoFocus` still triggers focus (both imply focusing the element)

### Example

```jsx
function EditableTitle({ state }) {
  return (
    <div>
      {state.isEditing
        ? <input
            autoFocus={true}
            autoSelect={true}
            value={state.title}
            className="title-input"
          />
        : <h2 className="title">{state.title}</h2>
      }
    </div>
  )
}
```

---

## DOM Helpers

Sygnal re-exports all DOM helpers from `@cycle/dom`:

```javascript
import { h, div, span, input, button, form, a, ul, li, p, ... } from 'sygnal'
```

### h()

Create virtual DOM nodes without JSX:

```javascript
import { h } from 'sygnal'

// h(selector, data?, children?)
h('div.my-class', { style: { color: 'red' } }, [
  h('h1', 'Hello'),
  h('button.btn', 'Click me')
])
```

### Named Element Helpers

```javascript
import { div, h1, button, input } from 'sygnal'

div('.container', [
  h1('Hello'),
  button('.btn', 'Click me'),
  input('.text-input', { attrs: { type: 'text', placeholder: 'Enter name' } })
])
```
