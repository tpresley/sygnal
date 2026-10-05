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
| `diagnostics` | `DiagnosticsMode \| { mode?, ignore?, strict? }` | `'off'` (`'warn'` in the Vite dev server) | Runtime [diagnostics](/guide/diagnostics/): `'off'`, `'collect'`, `'warn'` or `'error'`, plus codes to ignore and [strict mode](/guide/strict-mode/) (`strict: true` needs `sygnal/diagnostics`; without a `mode` it also turns diagnostics on). Takes precedence over the dev flag the Vite plugin sets |
| `onError` | `(error, info) => void` | none | [App-level error hook](/advanced/error-boundaries/#app-level-error-hook) for reporting: called once per error, after the component's own `onError` boundary, with `{ componentName?, action?, phase, driver? }` (`phase`: `'view'`, `'reducer'`, `'effect'`, `'intent'`, `'context'`, `'declaration'`, `'driver'`, `'instantiate'`, `'dispose'`) |
| `uid` | `string` | `'u'` | The root of this app's [`uid()`](#uid-view-and-reducer-prop) ids. Give each app on a page its own, and pass the same value to `renderToString` when hydrating ([SSR](/integration/ssr/#stable-ids-uid)) |

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

// Fail fast on any diagnostic (e.g. in CI)
run(RootComponent, {}, { diagnostics: 'error' })

// With timers (the timers static needs its driver)
import { makeTimerDriver } from 'sygnal'
run(RootComponent, { TIMER: makeTimerDriver() })

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
| `diagnostics` | `DiagnosticsMode \| { mode, strict, ignore }` | `'warn'` | Runtime diagnostics in the dev server (`'off'` injects nothing) |
| `check` | `boolean \| { strict, include, ignore, overlay }` | `true` | Run `sygnal-check` in the dev server, when installed |
| `vitestSetup` | `boolean` | `true` | Under Vitest, add `sygnal/diagnostics` to `test.setupFiles` |
| `nativeGlobalThis` | `boolean` | `true` | Alias xstream's `globalthis` polyfill to the native `globalThis`, in dev, build and Vitest |
| `devtools` | `boolean \| { redux }` | `true` | Install the [DevTools](/integration/debugging/#devtools-extension) bridge (`sygnal/devtools`) in the dev server; `{ redux: true }` also connects the [Redux DevTools](/integration/debugging/#redux-devtools) extension |

The HMR transform and the diagnostics setup run only in dev mode (`vite` / `vite dev`); production builds get none of it. Files that already contain `import.meta.hot` are left untouched.

See [Bundler Configuration](/integration/bundler-config/#plugin-options) for every option and the dev-mode behavior.

---

## defineComponent()

Builds a component from an options object, for code that makes components from data (generators, wrappers). It returns an ordinary function component: a new function that calls `view` with the one view argument, with the other options assigned as its statics and `name` as its `componentName`. Writing the function and assigning its statics directly (`Counter.model = …`) is the usual form; both run the same way.

```typescript
function defineComponent(options: DefineComponentOptions): Component
```

| Option | Type | Description |
|--------|------|-------------|
| `view` | `({ state, context, ...props }) => vnode` | The view (required) |
| `name` | `string` | The component's name (`componentName`: diagnostics, devtools, `uid()`); defaults to the view's `componentName` or function name, or `'Component'` for an anonymous inline view |
| any static | | `model`, `intent`, `initialState`, `isolatedState`, `calculated`, `context`, `onError`, `debug`, `connections`, `resources`, `route`, `head`, `uses`, `timers`, `persist`, `viewTransitions` |

```jsx
import { defineComponent } from 'sygnal'

const Counter = defineComponent({
  name: 'Counter',
  view: ({ state }) => <button className="inc">{state.count}</button>,
  initialState: { count: 0 },
  intent: ({ DOM }) => ({ INCREMENT: DOM.click('.inc') }),
  model: { INCREMENT: (state) => ({ ...state, count: state.count + 1 }) },
})
```

Statics already on the view (`Card.initialState = …`) are copied to the new component, and the options override them. The view function itself is not changed, so one view can back several definitions. `defineComponent` replaces the `component({ ... })` factory that 6.0 removed; see [Migrating to 6.0](/guide/migrating-to-6/#component-factory).

---

## Collection

Renders a list of components from an array on state.

### JSX Usage

```jsx
import { Collection } from 'sygnal'

<Collection of={ItemComponent} from="items" filter={item => !item.done} sort="name" className="list" />
```

The lowercase `<collection>` tag works too, without an import.

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `of` | `Component` | Yes | The component to instantiate for each item |
| `from` | `string \| Lens` | Yes | State property name or lens for the source array. Must be an array ([SYG401](/reference/errors/#syg401)); type-checkable with [`Collection<PROPS, STATE>`](/integration/typescript/#collection-from) |
| `filter` | `(item) => boolean` | No | Filter function — only items returning `true` are rendered |
| `sort` | `string \| object \| array \| function` | No | Sort items — string (field name, `"asc"`, or `"desc"`), object (`{ field: "asc" \| "desc" \| 1 \| -1 }`), array (multi-field), or comparator function |
| `className` | `string` | No | CSS class for the wrapping container element |

### Item Keys

Items are keyed by their `id` property if present, otherwise by their index in the state array (also under `filter` and `sort`). Ids should be unique: with duplicates only the first item renders, and [SYG424](/reference/errors/#syg424) warns in development. An item without an `id` sees its index as `state.id`; writing its state back doesn't store it.

### Self-Removal

An item removes itself from the collection by returning `undefined` from a state reducer:

```javascript
Item.model = {
  REMOVE: () => undefined
}
```

Removed items are disposed, recursively (nested Collections included). Reordering the array keeps each item's instance. See [Collections](/guide/collections/#item-keys-and-identity).

---

## Switchable

Conditionally renders one component from a set based on a name.

### JSX Usage

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

### Behavior

- Only the current page renders. A hidden page first renders when it is first shown.
- Every page's intent and actions keep running while it is hidden; its declarations (`connections`, `resources`) pause unless marked `background: true`. See [Switchable](/guide/switchable/).

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
function createRef<T = HTMLElement>(): Ref<T>   // { current: T | null }
```

```jsx
import { createRef } from 'sygnal'
const myRef = createRef()

function Box({ state }) {
  return <div ref={myRef}>...</div>
}

Box.model = {
  MEASURE: (state) => ({ ...state, width: myRef.current?.offsetWidth ?? 0 }),
}
```

The `ref` prop sets `.current` to the DOM element on mount and `null` on unmount.

---

## createRef$()

Creates a stream-based ref that emits the DOM element.

```typescript
function createRef$<T = HTMLElement>(): Ref$<T>   // { current: T | null, stream: MemoryStream<T | null> }
```

```jsx
import { createRef$ } from 'sygnal'
const el$ = createRef$()

function MyComponent({ state }) {
  return <div ref={el$}>...</div>
}

MyComponent.intent = () => ({
  MOUNTED: el$.stream,
})
```

Pass the ref object to the `ref` prop and use its `.stream` in intent.

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
import { createCommand } from 'sygnal'

const cmd = createCommand()

// Parent passes it as a prop...
function App({ state }) {
  return <VideoPlayer commands={cmd} />
}

// ...and sends commands, typically from an EFFECT
App.model = {
  PLAY: { EFFECT: () => cmd.send('play') },
  SEEK: { EFFECT: () => cmd.send('seek', { time: 30 }) },
}

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
    EFFECT: (state, data, next, props) => { /* side effect; return nothing */ }
  }
}
```

### Reducer Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `state` | `STATE` | Current component state (with calculated fields) |
| `data` | `any` | Data from the triggering action |
| `next` | `(action, data?, delay?) => void` | Dispatch a follow-up action |
| `props` | `object` | Current props, children, slots, context, and `signal`: an `AbortSignal` aborted on unmount (EFFECT only) |

An EFFECT may be `async` and call `next()` after an `await`: a rejection is reported as [SYG214](/reference/errors/#syg214), and `next()` after unmount is ignored ([Async work that isn't HTTP](/advanced/effect/#async-work-that-isnt-http)).

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

Logs a warning ([SYG219](/reference/errors/#syg219)) if the handler returns a value — EFFECT handlers should not return anything.

See [Effect Handlers guide](/advanced/effect/) for more patterns.

---

## ELEMENT (Built-in Sink)

A built-in sink for element commands: calls a method of an element the component rendered, such as `focus()`, `scrollIntoView()` or a `<dialog>`'s `showModal()`. No driver to register. Guide: [Element Commands](/guide/element-commands/).

```typescript
// the value of an ELEMENT entry: a command, an array of them, or a reducer returning either (or ABORT)
type ElementSinkValue =
  | ElementCommand
  | ElementCommand[]
  | ((state, data, next, props) => ElementCommand | ElementCommand[] | typeof ABORT)
// ElementCommand: { <method>: target, ...options }; target: a control or a selector
```

| Command | Calls |
|---|---|
| `{ focus: target, preventScroll?, focusVisible? }` | `element.focus(options)` |
| `{ blur: target }`, `{ select: target }`, `{ click: target }` | `element.blur()`, `element.select()`, `element.click()` |
| `{ scrollIntoView: target, block?, inline?, behavior? }` | `element.scrollIntoView(options)` |
| `{ showModal: target }`, `{ show: target }` | A `<dialog>`'s `showModal()`, `show()` |
| `{ close: target, returnValue? }` | A `<dialog>`'s `close(returnValue)` |
| `{ showPopover: target }`, `{ hidePopover: target }`, `{ togglePopover: target, force? }` | A popover's methods |

- The first key of a command is the method; the other keys are its options, passed as one object (`close` gets `returnValue`). Any other method the element has also runs; add it to the `ElementCommandRegistry` interface for TypeScript.
- A control made from a spec object with `commands` is asked first: `{ open: DueDate }` calls `spec.commands.open(element, options)`.
- The target is looked up in the sending instance's own view (children and Collection items are isolated); [`focusWithin(selector)`](#focuswithin) reaches inside them. The command runs after the next patch at which the target exists; it gives up after about 1 s ([SYG640](/reference/errors/#syg640)). An unknown or DOM-mutating method is [SYG641](/reference/errors/#syg641).
- An array runs its commands in order; `ABORT` sends nothing. Nothing runs during server rendering.
- In tests: `t.commands('ELEMENT')` lists the commands sent; with `dom: 'real'` they also run.

---

## focusWithin()

An `ELEMENT` focus target that reaches inside the sender's children (PLAN-5). [Guide](/guide/element-commands/#focusing-inside-children-focuswithin).

```typescript
function focusWithin(selector: string): WithinTarget
// ELEMENT: { focus: focusWithin('.title'), preventScroll?: boolean }
```

Focuses the first element under the sender's root element that matches `selector` (a child component's or a Collection item's included), with the command's options. It runs after the next patch, so an item the same action adds is there; no match does nothing (`renderComponent()` reports [SYG640](/reference/errors/#syg640) when nothing in the view matches).

---

## event()

Creates an `EVENTS` sink function that puts `{ type, data }` on the global event bus. Use it as the `EVENTS` value inside a model entry.

<!-- docs-check: skip -->
```typescript
function event(type: string, payload?: any | ((state, data, next, props) => any)): EventSink
```

```jsx
import { event } from 'sygnal'

Lane.model = {
  DELETE_LANE: {
    STATE:  (state) => ({ ...state, deleting: true }),
    EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })),
  },
  RESET: { EVENTS: event('RESET') },               // no payload
  DARK:  { EVENTS: event('SET_MODE', 'dark') },    // static payload
}
```

Receivers subscribe with `EVENTS.select('DELETE_LANE')`, which emits the payload. With a [`SygnalEvents` registry](/integration/typescript/#typed-events), `type` and the payload are type-checked.

`emit(type, payload?)` is an older helper that returns a whole model entry (`{ EVENTS: fn }`); it still works but isn't canonical (see [Alternative Forms](/advanced/alternative-forms/#emit)).

---

## renderComponent()

Render a Sygnal component in isolation for testing. Creates a minimal Cycle.js runtime with mocked DOM, event bus, and state drivers.

```typescript
function renderComponent(
  component: ComponentFunction,
  options?: RenderOptions
): RenderResult<State>   // State inferred from the component (or renderComponent<State>(C))
```

### RenderOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initialState` | `any` | Component's `.initialState` | Override the component's initial state |
| `drivers` | `object` | `{}` | Additional drivers beyond the defaults |
| `diagnostics` | `DiagnosticsMode` | `'collect'` (or the current mode) | Diagnostics mode while rendered |
| `strict` | `boolean` | unchanged | Strict-mode runtime checks while rendered |
| `mockConfig` | `object` | `{}` | Mock DOM event streams, by selector |
| `autoConnect` | `boolean` | `true` | Fake socket connections open by themselves; `false` holds them until `t.open()` |
| `socketSink` | `string` | `'WS'` | The driverless sink that receives the `connections` static |
| `dom` | `'mock' \| 'real'` | `'mock'` | `'real'` patches the tree into a real container element ([Real DOM](/integration/testing/#real-dom)) |
| `onError` | `(error, info) => void` | none | The [app-level error hook](/advanced/error-boundaries/#tests), as `run()`'s `onError` |
| `timerSink` | `string` | `'TIMER'` | The sink of the timer fake (the real `makeTimerDriver()` on the test's clock), unless a driver is passed under that name |
| `storage` | `Record<string, entry \| string>` | `{}` | The fake storage of a root's [`persist()`](/guide/persistence/#testing) (`'local'` and `'session'` alike): key to `{ version, state }` (with `format: 'plain'`, the stored keys) or a raw string. Used as is: writes land in it, and calls given the same object share it |

The [Testing guide's options table](/integration/testing/#options) lists the rest (timing, HTTP, router and head fakes).

### Returns: RenderResult

| Property | Type | Description |
|----------|------|-------------|
| `simulateEvent` | `(selector, type, init?) => void` | Dispatch a DOM event through the mock DOM (the real intent runs) |
| `simulateAction` | `(name, data?) => void` | Push an action under its real name (every sink runs) |
| `ready` | `() => Promise<void>` | Resolves once subscribed and earlier calls are delivered |
| `next` | `(predicate?, timeout?) => Promise<any>` | Next matching state emitted after the call |
| `waitForState` | `(predicate, timeout?) => Promise<any>` | First matching state, recorded history included |
| `settle` | `(timeout?) => Promise<void>` | Resolves once nothing is pending |
| `state` | `any` (read-only) | The latest state (`states.at(-1)`) |
| `states` | `any[]` | Every state emitted |
| `html` | `() => string` | Latest render as HTML (throws before the first render: `await t.ready()` first) |
| `emitted` | `{ type, data }[]` | EVENTS emissions |
| `sinkValues` | `(sinkName) => any[]` | Values sent to a sink |
| `requests` | `(sinkName) => any[]` | Requests sent to a sink: `sinkValues` without the `{ abort }` commands |
| `respond` | `(sinkName, value, target?) => Promise<void>` | Answer the newest pending request on a driverless source that matches `target` (an `ok`/`error` action name or category, `{ url }` or another partial request, a predicate, or `{ request, category, status, body }`): a request with reply actions gets `value` as its `ok` action, a plain one goes to `select()`. Throws at the call when nothing matching is pending (unless earlier simulated input is still queued); resolves after the reply is reduced and rendered ([Testing](/integration/testing/#answering-requests-respond-and-fail)) |
| `fail` | `(sinkName, error, target?) => Promise<void>` | Fail it the same way: its `error` action gets `{ error, request, status, body }`, or `errors()` (a number is an HTTP status) |
| `connections` | `(sinkName) => FakeConnection[]` | Connections declared on a driverless socket sink (`name`, `url`, `state`, `sender`, the spec) |
| `push` | `(sinkName, data, target?) => Promise<void>` | A frame from the server on the matching open connections (`{ event }` for an SSE named event) |
| `drop` | `(sinkName, { code, reason }?, target?) => Promise<void>` | A close the app didn't make: `close` fires, the fake reconnects per the spec |
| `open` | `(sinkName, target?) => Promise<void>` | Complete a pending open (with `autoConnect: false`) |
| `sent` | `(sinkName, to?) => any[]` | The `{ to, json \| text \| binary }` values sent |
| `diagnostics` | `Diagnostic[]` | Diagnostics collected while rendered |
| `expectNoDiagnostics` | `() => void` | Throws if a warning or error was collected |
| `actions` | `TestAction[]` | Live log of every action the tree ran: `{ type, data, component, instance, sinks, cause, at }` ([Action log](/integration/testing/#action-log-tactions-and-texplain)) |
| `explain` | `(predicate) => ExplainedAction \| undefined` | The first action whose resulting state matches, with that state and its STATE reducer |
| `commands` | `(sinkName = 'ELEMENT') => ElementCommand[]` | The [element commands](/guide/element-commands/#testing) sent, one per command; another sink name gives its `sinkValues` |
| `timers` | `() => ActiveTimer[]` | The [timers](/guide/timers/#testing) running now: each spec plus `name`, `action`, `component` |
| `storage` | `(key) => { version, state } \| undefined` | The fake storage's entry for `key` ([persist()](/guide/persistence/#testing)); with `format: 'plain'`, the stored keys (TS: `t.storage<Entry>(key)`). `settle()` makes the pending writes first |
| `query`, `queryAll` | `(selector \| control) => Element \| null`, `Element[]` | Elements of the latest render (snapshots on the mock DOM, real elements with `dom: 'real'`) |
| `widget` | `(selector \| control) => { props, instance, emit(name, detail?) }` | A [widget's](/guide/widgets/#testing) host: the props the view passed it, the instance `mount` returned (`dom: 'real'`), and `emit`, which sends the event its `emit()` would |
| `container` | `Element \| null` | `dom: 'real'`: the mount element |
| `inspect` | `(options?) => InspectGraph` | App graph of the rendered tree (needs `sygnal/diagnostics`); `{ actions: true }` (or a number: the last n) adds `recentActions` |
| `state$`, `dom$`, `events$`, `sinks`, `sources` | | Live streams and driver objects |
| `dispose` | `() => void` | Tear down the tree and restore the diagnostics settings |

### Example

```jsx
import { renderComponent } from 'sygnal'

const t = renderComponent(Counter, { initialState: { count: 0 } })
t.simulateEvent('.inc', 'click')
await t.next(s => s.count === 1)
t.expectNoDiagnostics()
t.dispose()
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
| `onError` | `(error, info) => void` | — | [App-level error hook](/advanced/error-boundaries/#rendertostring), called with the phase `'view'` |
| `uid` | `string` | `'u'` | The root of the [`uid()`](#uid-view-and-reducer-prop) ids; the same value as `run()`'s `uid` on the client |

See [SSR](/integration/ssr/#rendertostringoptions) for every option.

A custom element's (a hyphenated tag's) props are written as attributes, with camelCase names in kebab-case (`withClear` → `with-clear`); function and object props have no attribute form and are left out ([Web components](/guide/web-components/#server-rendering)). A [widget](/guide/widgets/#server-rendering) renders its host with its `fallback` inside.

### Examples

```jsx
import { renderToString } from 'sygnal'

// Basic usage
const html = renderToString(App, { state: { count: 0 } })
// The root element carries data-sygnal-ssr="" (removed by the first client render)

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

Works with all sinks (EFFECT, EVENTS, PARENT, STATE). The reducer receives the current state, so you can access component data during cleanup. Disposal is recursive: removing a component disposes everything inside it, including nested Collections and Switchables.

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

If not defined, errors render an empty `<div data-sygnal-error>` and log to `console.error` ([SYG406](/reference/errors/#syg406)). An `onError` that throws is reported as [SYG407](/reference/errors/#syg407). To report errors from the whole app (to an error tracker), use `run()`'s [`onError` option](/advanced/error-boundaries/#app-level-error-hook).

---

## uid (View and Reducer Prop)

A stable id for the component instance, passed to the view and to reducers (on their `props` argument):

```typescript
function uid(): string               // this instance's id, e.g. 'u'
function uid(name: string): string   // an id derived from it, e.g. 'u-email'
```

Ids come from the instance's position in the tree (and its Collection item key), so they differ between instances, stay the same across renders, and match between `renderToString` and the client. Use them for `id` / `for` / `aria-*` pairs. `uid` is a reserved prop. The root is `'u'`, or `run()`'s and `renderToString()`'s `uid` option. Guide: [Labels and ids](/guide/forms/#labels-and-ids-uid).

---

## isolatedState (Static Property)

Required when a sub-component declares `.initialState` (otherwise [SYG405](/reference/errors/#syg405)).

```jsx
Widget.initialState = { count: 0 }
Widget.isolatedState = true
```

- Bound to a slice (`<Widget state="counter" />` or a lens): `initialState` seeds the slice only while it is `undefined`; an existing slice is kept ([SYG425](/reference/errors/#syg425) warns in development when it lacks `initialState`'s keys).
- No `state` prop: the state is local to the instance and never written to the parent.

### resetState (Tag Prop)

`<Widget state="counter" resetState />` replaces the slice with the child's `initialState` each time the child is created. It is read at creation, like `state`, and is never a prop of the child. See [State Management](/guide/state/#isolated-state).

---

## controls()

`controls({ Name: 'input', Save: 'button' })` returns element tokens that the view renders (`<Save>Save</Save>`, a `<button data-control="Save">`) and the intent, element commands, behaviors and tests select (`DOM.click(Save)`). An [alternative form](/advanced/alternative-forms/#controls-instead-of-class-selectors) to class selectors; see [Controls](/guide/controls/).

---

## defineWidget()

`defineWidget({ tag, mount, update, unmount, events, commands, fallback })` wraps a framework-agnostic widget (a date picker, a chart, an editor) as a JSX tag. The view renders it like an element and the intent selects it by class; it is also a control spec (`controls({ Due: DatePicker })`). See [Widgets](/guide/widgets/).

```jsx
const DatePicker = defineWidget({
  tag: 'input',
  mount: (el, props, dispatch) => flatpickr(el, { defaultDate: props.value, onChange: ([date]) => dispatch('pick', date) }),
  update: (picker, props) => picker.setDate(props.value, false),
  unmount: (picker) => picker.destroy(),
  events: ['pick'],
  commands: { open: (picker) => picker.open() },
})
// <label>Due <DatePicker className="due" value={state.due} /></label>
// DUE: DOM.select('.due').events('pick').detail()      OPEN: { ELEMENT: { open: '.due' } }
```

| Field | Description |
|-------|-------------|
| `tag` | The host element (default `'div'`); it has no children of its own |
| `mount(el, props, dispatch)` | Called once the host is in the page; returns the instance. `dispatch(name, detail)` sends an event |
| `update(instance, props, el)` | Called with the newest props when they change (shallow; `style`/`attrs` objects by their entries); without it, a change remounts |
| `unmount(instance, el)` | Called when the host leaves the page |
| `events` | The names `dispatch(name, detail)` sends (bubbling `CustomEvent`s on the host) |
| `commands` | Element commands, `(instance, options, el) => …`; they win over native methods of the same name (`close` and `togglePopover` get the options object too) |
| `fallback` | What [server rendering](/guide/widgets/#server-rendering) puts inside the host: a vnode, a string, or `(props, h) => vnode` |
| `hostProps` | More prop names to put on the host (besides `id`, `className`, `style`, `title`, `name`, `placeholder`, `role`, `tabindex`, `hidden`, `lang`, `dir`, `attrs`, `aria-*`, `data-*`) |
| `name` | A name for diagnostics |

A `ref` on the tag gets the host element; `key` and `ref` are not passed to the widget. A `mount`/`update` that throws is reported to `onError` with the phase `'widget'` and the owning component's `onError` fallback renders in that widget's place ([SYG660–662](/reference/errors/#syg660)). Types: `Widget<P, I, EV, TAG>`, `WidgetDefinition`, `WidgetHostProps`, `WidgetDispatch`.

---

## uses (Static Property)

The [behaviors](/guide/behaviors/) a component uses, each under a state key:

```jsx
TaskList.uses = { pager: pager({ pageSize: 10, next: '.newer', prev: '.older' }) }
```

The behavior's state is at `state.pager` (its calculated fields stored on it), and its actions are named after the key (`pager.NEXT`). A host model entry for a behavior action runs after the behavior's; a host intent action of the same name replaces the behavior's trigger. A key that is also in `initialState`, or a value that isn't a behavior, is [SYG127](/reference/errors/#syg127). Types: `UsesState<typeof uses>`, `UsesActions<typeof uses>`.

---

## defineBehavior()

Defines a reusable [behavior](/guide/behaviors/#writing-a-behavior): state, intent and model without a view.

```typescript
function defineBehavior(definition: {
  initialState: Slice;
  intent?: (sources, options, key) => { [action: string]: Stream<any> };
  // handlers: (slice, data, next, props, options, key); HOST: (state, data, next, props, options, key) => state
  model?: { [action: string]: Handler | { [sink: string]: Handler; HOST?: HostReducer } };
  calculated?: { [field: string]: (slice) => any };
  timers?: (slice, options, key) => { [name: string]: TimerSpec | false };
}): (options?) => Behavior
```

Returns a factory: call it with the options of one use (`disclosure({ toggle: '.toggle' })`). Options that name a key of `initialState` set that key's starting value. The intent gets the host's sources, the options and the use's key; actions are named without the key. Model handlers get the slice, then the options and the key after `props`; a `HOST` entry is a reducer on the host's whole state. `timers` declares timers for the host (`'<key>.<name>'`; a spec action naming one of the behavior's actions is namespaced). [Guide](/guide/behaviors/#options-the-key-host-state-and-timers).

---

## pager()

A behavior: a page cursor over a list. [Guide](/guide/behaviors/#pager).

```typescript
function pager(options?: { pageSize?: number; page?: number; total?: number | null; next?: Control | string; prev?: Control | string }): Behavior
```

| | |
|---|---|
| State | `page` (from 0), `pageSize` (20), `total` (`null`: unknown); calculated `offset`, `pages`, `hasPrev`, `hasNext` |
| Actions | `NEXT`, `PREV` (no change at the bounds), `GOTO` (a page number, kept in range), `SET_TOTAL` |

---

## selection() / isSelected()

A behavior: single or multiple selection over a list. [Guide](/guide/behaviors/#selection).

```typescript
function selection(options?: { multi?: boolean; item?: Control | string; all?: Control | string; clear?: Control | string; attr?: string; from?: string; idField?: string }): Behavior
function isSelected(slice: { selected: string[] }, id: string | number): boolean
```

| | |
|---|---|
| State | `selected` (ids as strings, in selection order); calculated `count` |
| Actions | `SELECT` (an id, or a click on an `item`), `SELECT_ALL`, `TOGGLE_ALL`, `CLEAR` |

`isSelected(state.sel, id)` compares ids as strings.

---

## undo() / undoable()

Undo history for one key of the state. [Guide](/advanced/undo/).

```typescript
function undo(options: { key: string; limit?: number; track?: string[]; coalesceMs?: number; coalesce?: string[]; resetOn?: string[]; undo?: Control | string; redo?: Control | string }): Behavior
function undoable(model: Model, options: { key: string; limit?: number; track?: string[]; coalesceMs?: number; coalesce?: string[]; resetOn?: string[] }): Model
```

`uses = { history: undo({ key: 'doc' }) }` gives `state.history = { past, future, canUndo, canRedo }` and the actions `history.UNDO` / `history.REDO`. `model = undoable({ ... }, { key: 'doc' })` wraps the model's STATE reducers instead and adds plain `UNDO` / `REDO` actions. Options: `limit` (100 snapshots), `track` (only these actions are recorded), `coalesceMs` (changes by one action within this many ms are one step), `coalesce` (only these actions' changes join a step, e.g. typing; every other action is always its own step; `coalesceMs` defaults to 500 with it), `resetOn` (actions that clear the history). A `track` or `resetOn` name with no model entry is [SYG226](/reference/errors/#syg226).

---

## persist()

Saves the root component's state in the browser's storage and restores it at startup. Guide: [Persistence](/guide/persistence/).

```typescript
function persist(options: {
  key: string
  pick?: (keyof State)[]            // or omit
  omit?: (keyof State)[]
  version?: number                  // default 1
  migrate?: (old: any, fromVersion: number) => Partial<State> | null | undefined
  storage?: 'local' | 'session' | { getItem, setItem, removeItem, subscribe? }   // default 'local'
  sync?: boolean                    // apply other tabs' writes (RESTORE)
  hydrate?: boolean                 // restore after the first render; detected when omitted
  debounceMs?: number               // default 100
  format?: 'versioned' | 'plain'    // default 'versioned'; 'plain': no version / migrate
}): Persist<State>
```

```javascript
TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'], version: 2, migrate })
```

- Stored as JSON `{ version, state }`: the `pick` keys (or all but `omit`; never calculated fields). `format: 'plain'` stores those keys themselves (`{"title":"…","body":"…"}`), with no `version` / `migrate` ([A plain format](/guide/persistence/#a-plain-format)).
- Restored synchronously before `INITIALIZE` and merged into `initialState`. When the app hydrates server-rendered HTML, in a `RESTORE` action after the first render instead, so that render matches the server's markup. That is detected: `renderToString()` markup in `run()`'s mount point (its root element has `data-sygnal-ssr`), a server-rendered [Astro](/integration/astro/) island, a [Vike](/integration/vike/) hydration; `hydrate: true` / `false` override it ([Server rendering](/guide/persistence/#server-rendering-hydrate)). Another stored version goes through `migrate` (nothing returned, or no `migrate`: ignored).
- Written after `debounceMs` without a state change, on `pagehide` and on dispose; not when unchanged.
- Root component only ([SYG224](/reference/errors/#syg224)); a `pick` / `omit` key not in `initialState` is [SYG223](/reference/errors/#syg223); a failed restore, migrate or write is [SYG642](/reference/errors/#syg642) (warning) and the app continues.
- Nothing is read or written during server rendering. In tests: `renderComponent`'s `storage` option and `t.storage(key)`.

### PERSIST (Built-in Sink)

`PERSIST: { clear: true }` in a model entry of the persisting root removes the stored copy (a value, or a function of `(state, data)` returning it or `ABORT`). The state the same action produces isn't saved. No driver.

### RESTORE (Built-in Action)

Sent to the persisting root with the saved keys as its data: after the first render when the app hydrates server-rendered HTML (see [persist()](#persist)), and for another tab's write with `sync: true`. The built-in entry merges them into the state (`{ ...state, ...data }`); a `RESTORE` model entry replaces it.

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
    // moveTask: your own helper that returns the new lanes array
    return { ...state, lanes: moveTask(state.lanes, state.dragging.taskId, toLaneId, insertBefore) }
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

## makeFetchDriver()

An HTTP driver over `fetch`. Guide: [HTTP Requests with makeFetchDriver()](/guide/drivers/#http-requests-with-makefetchdriver).

```typescript
function makeFetchDriver(options?: {
  baseUrl?: string;                    // prefix for every url
  headers?: Record<string, string> | Headers;  // for every request
  init?: FetchInit;                    // fetch() options for every request, e.g. { credentials: 'include' }
  latest?: boolean;                    // default for every request (false)
  timeoutMs?: number;                  // default for every request (none)
  parse?: 'auto' | 'json' | 'text' | 'response' | ((res: Response) => any);  // default 'auto'
  fetch?: typeof fetch;                // default: globalThis.fetch, read at each request
}): Driver
```

| Sink value (request) | Effect |
|---|---|
| `{ url, ok?, error?, key?, method?, query?, json?, body?, headers?, latest?, timeoutMs?, parse?, init? }` | `fetch(baseUrl + url + ?query, init)`. Method defaults to POST with `json`/`body`, else GET. Other fetch options go under `init`; any other key is app data (not sent, returned on `request`) |
| `'/api/x'` | GET of that URL (no reply actions) |
| `{ abort: 'LOADED' }`, `{ abort: true, key }` | Cancel this instance's requests with reply actions in flight with that key (`key`, else the `ok` action, else `error`) |
| `{ category?, abort: true }` | Cancel the component's plain requests in flight in that category (all of its requests, without a category) |
| `ABORT`, `null`, `undefined` | Nothing |

**Reply actions** (canonical): a request naming `ok` / `error` is answered with that action, on exactly the sending instance.

| Action | Data |
|---|---|
| `ok` | The parsed body of a 2xx response (`parse: 'response'`: the `Response`) |
| `error` | `{ error, status?, body?, request }` (`FetchFailure`): non-2xx (`status`, parsed `body`), network error, parse error, timeout (`error.name === 'TimeoutError'`) |

`latest: true` aborts this instance's earlier requests with the same key still in flight; their replies never arrive. A removed instance's requests with reply actions are aborted. A name with no model entry is [SYG112](/reference/errors/#syg112); a `then`/`catch` key is [SYG610](/reference/errors/#syg610) (not sent).

**Without reply actions** (no `ok`/`error`): replies go to the source.

| Source | Emits |
|---|---|
| `HTTP.select(category?)` | `{ category, value, status, request }` for each 2xx response |
| `HTTP.errors(category?)` | `{ error, category, request, status?, body? }` for a non-2xx status, network error, parse error or timeout |

Without reply actions, `latest` and `abort` act per category; each component instance sees only the replies to its own (and its children's) requests, and the root sees all. Disposing the app aborts everything in flight. No requests are made during server rendering. Guide: [HTTP](/guide/http/).

---

## makeSocketDriver()

WebSocket and server-sent events. Guide: [Sockets](/guide/sockets/).

```typescript
function makeSocketDriver(options?: {
  baseUrl?: string;                    // prefix for relative URLs
  reconnect?: false | { delayMs?: number; maxDelayMs?: number; jitter?: boolean | number };  // default for every connection
  queueLimit?: number;                 // sends kept per connection while (re)connecting (100)
  WebSocket?: any;                     // default: globalThis.WebSocket, read at connect time
  EventSource?: any;                   // default: globalThis.EventSource
}): Driver
```

| Sink value | Effect |
|---|---|
| `{ connections: { [name]: spec \| falsy } }` | The sender's whole set of connections, diffed by name: new names open, removed or falsy ones close, a changed URL / `protocols` / `withCredentials` / `share` reconnects. The `connections` static sends this for you |
| `{ to: name, json? \| text? \| binary? }` | Send on the sender's own WebSocket connection; queued while (re)connecting. Unknown, closed-for-good or SSE connection: [SYG611](/reference/errors/#syg611) |

Spec: `{ socket: url, protocols? }` or `{ sse: url, withCredentials?, events?: { eventName: 'ACTION' } }`, plus the optional actions `message` (the JSON-parsed frame), `open` (`{ reconnected }`), `close` (`{ code, reason, willReconnect }`, only for closes the app didn't make), `error` (`{ error }`), and `reconnect` (default `{ delayMs: 500, maxDelayMs: 10000, jitter: 0.2 }`; `false` for none) and `share` (default `true`: one socket per URL, ref-counted). Events without an action go to `WS.select(name?)` as `{ name, type, data }`. A disposed instance's connections close; no connections during server rendering.

### connections (Static Property)

```typescript
// (state: State & Calculated) => Connections: { [name]: spec | falsy }
Chat.connections = (state) => ({
  room: state.room && { socket: `/ws/rooms/${state.room}`, message: 'RECEIVED' },
})
```

Sent to the `makeSocketDriver()` sink at startup and whenever the result changes (structurally equal results are not resent). Without a registered `makeSocketDriver()` nothing opens and nothing is reported. Use the static or a model-sent `{ connections }` value, not both. In `renderComponent`, the static goes to the fake sink named by `socketSink` (default `'WS'`).

---

## makeTimerDriver()

Runs the components' `timers` statics. Guide: [Timers](/guide/timers/).

```typescript
function makeTimerDriver(): Driver
```

```javascript
run(App, { TIMER: makeTimerDriver() })
```

The key is free (`TIMER` by convention): the core finds the driver by the static it takes. Each timer's action goes to the instance that declared it, with every sink of its model entry. A removed instance's timers stop; disposing the app stops all of them; nothing runs during server rendering. A component that declares `timers` without the driver is [SYG643](/reference/errors/#syg643) in dev. `renderComponent` provides it (`timerSink`, `t.timers()`).

### timers (Static Property)

```typescript
// (state: State & Calculated) => { [name]: spec | falsy }
Stopwatch.timers = (state) => ({
  tick: state.running && { every: 100, action: 'TICK' },
})
```

| Spec | Action data |
|---|---|
| `{ every: ms, action, background? }`: repeats every `ms` (> 0), drift-free; late ticks coalesce (`n` jumps) | `{ n, t }`: tick number from 1, `Date.now()` |
| `{ after: ms, action, background? }`: once, after `ms` (≥ 0); not again while the same spec stays declared | `{ t }` |
| `{ frame: 'ACTION', background? }`: every animation frame (`requestAnimationFrame`, else 16 ms) | `{ t, dt }`: `Date.now()`, ms since the previous frame (0 first) |

The result is compared by name whenever the state changes: a new name starts, a falsy or missing one stops, a changed spec restarts, an equal one keeps running. A hidden Switchable page's timers stop (and start from scratch when it is shown) unless `background: true`. An invalid spec is not started ([SYG422](/reference/errors/#syg422)). Types: `TimerSpec`, `Timers`, `TimerTick`, `TimerAfter`, `TimerFrame`.

---

## makeViewTransitionDOMDriver()

A DOM driver that applies the renders asked for by the components' `viewTransitions` statics inside `document.startViewTransition()`. Guide: [View Transitions](/guide/view-transitions/).

```typescript
function makeViewTransitionDOMDriver(
  mountPoint?: string | Element | DocumentFragment, // default '#root'
  options?: DOMDriverOptions                       // as makeDOMDriver; fragments on, as in run()
): Driver
```

```javascript
run(App, { DOM: makeViewTransitionDOMDriver('#root') })
```

It replaces `run()`'s default DOM driver (use the same mount point). One action is one render of the page, held until the browser has its snapshot (a later render that arrives meanwhile replaces it), then applied. The first render, `prefers-reduced-motion: reduce` and browsers without the API apply at once. A new transition skips one that is still animating. Opt-in, so apps without View Transitions don't ship it. `renderComponent` never animates.

### viewTransitions (Static Property)

```typescript
// Array<action name>
Board.viewTransitions = ['MOVE']
App.viewTransitions = ['ROUTE']   // the router's reply action: route changes
```

When a listed action's `STATE` reducer changes the state, the render it causes runs as a View Transition. Any component of the app can list its own actions. Without `makeViewTransitionDOMDriver()` the render applies at once, and dev reports [SYG645](/reference/errors/#syg645). Elements are matched by `view-transition-name` (a `style={{ viewTransitionName }}`), which must be unique on the page.

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

### Reply actions

A request with `ok` / `error` (from a component) is answered with that action on exactly the sending instance: `ok` gets the resolved value (after `post`), `error` gets `{ error, request }`. There is no `latest`/`abort` (a call can't be cancelled).

### Source API (requests without reply actions)

The driver source exposes:

<!-- docs-check: skip -->
```typescript
source.select(selector?: string | Function): Stream
source.errors(selector?: string | Function): Stream<AsyncDriverError>
```

- `select()` with no arguments returns all responses
- `select('name')` filters responses where `[selectorProperty] === 'name'`
- `select(fn)` filters responses using a custom predicate function
- `errors()` takes the same selectors and emits failed requests: `{ error, request, [selectorProperty] }`. Rejections never reach `select()`. While nothing listens to `errors()`, failures are only logged with `console.error`

### Example

```javascript
import { driverFromAsync } from 'sygnal'
import { geocode } from './geo.js'   // async (address) => ({ lat, lng })

run(RootComponent, { GEO: driverFromAsync(geocode) })

// Use in model: geocode(state.address); the reply is FOUND or NOT_FOUND
Place.model = {
  FIND:      { GEO: (state) => ({ value: state.address, ok: 'FOUND', error: 'NOT_FOUND' }) },
  FOUND:     (state, coords) => ({ ...state, coords }),
  NOT_FOUND: (state, { error }) => ({ ...state, status: error.message }),
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

### Source API (requests without reply actions)

<!-- docs-check: skip -->
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

## onlineStatus$

A stream of booleans reflecting the browser's online/offline state. ([PWA Helpers guide](/integration/pwa/))

```typescript
const onlineStatus$: Stream<boolean>
```

Emits `navigator.onLine` immediately, then `true`/`false` on `online`/`offline` window events. SSR-safe — emits `true` once if `window` is undefined.

### Example

```javascript
import { onlineStatus$ } from 'sygnal'

App.intent = () => ({
  ONLINE_CHANGED: onlineStatus$,
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

## Diagnostics

Runtime [diagnostics](/guide/diagnostics/) helpers, exported from `sygnal`. They return data in every mode except `'off'`.

| Export | Description |
|---|---|
| `getDiagnostics()` | All diagnostics collected so far (most recent last, up to 500) |
| `clearDiagnostics()` | Clear the collected diagnostics |
| `onDiagnostic(callback)` | Call `callback(diagnostic)` for each new diagnostic; returns an unsubscribe function |
| `getDevTools()` | The DevTools bridge (`window.__SYGNAL_DEVTOOLS__`) installed by the dev-only `sygnal/devtools` entry, or `undefined` (always in production builds): `connected`, `getDiagnostics()`, and `inspect()` once `sygnal/diagnostics` is loaded. See [DevTools](/integration/debugging/#devtools-extension) |

A diagnostic is `{ code, severity, component?, message, fix?, data?, docsUrl, text, timestamp }`, where `text` is the formatted `[Sygnal CODE] …` line. Every code is listed in the [Error Reference](/reference/errors/).

### sygnal/diagnostics

The dev-only entry with the runtime checks. Importing it registers them; it also exports:

| Export | Description |
|---|---|
| `inspect(options?)` | The app graph of the live components (`InspectGraph`) |
| `configureStrict(on?)` | Strict-mode runtime checks on (`true`), off (`false`) or default (`undefined`: on when `globalThis.__SYGNAL_STRICT__ === true`) |
| `isStrictEnabled()` | Whether the strict checks are on |
| `checkEventBus()` | Report SYG105 for EVENTS types selected but never emitted; returns `{ selected, emitted, selectedNeverEmitted, emittedNeverSelected }` |
| `listCodes()` / `getCodeInfo(code)` | `{ code, severity, title, docsSlug }` for the registered codes |
| `configureChecks({ settleMs, idleMs, minRenders })` | Timing of the DOM checks (SYG103/104) |
| `resetChecks()` | Forget what the checks have seen and reported |
| `installChecks()` | Re-register the checks (done on import); returns an uninstall function |
| `checks`, `RXJS_HINTS` | The registered checks, and the RxJS → xstream table behind SYG301 |

---

## sygnal/devtools

The dev-only entry for the [DevTools extension](/integration/debugging/#devtools-extension). Importing it installs the bridge (`window.__SYGNAL_DEVTOOLS__`) and, in a browser, starts the action log. The Vite plugin imports it in the dev server; production builds never contain it.

| Export | Description |
|---|---|
| `getDevTools()`, `installDevTools()` | The bridge (installed on import); it also has `configureCopyAsTest(options)` and `getSession(target?)` |
| `getActions(filter?)`, `onAction(fn)`, `clearActions()` | The [action log](/integration/debugging/#the-action-log): every instance's actions with their cause, sinks and state change |
| `recordActions()`, `isRecording()` | Start recording (automatic in a browser) and check it |
| `copyAsTest(target?, options?)`, `copyAsTestResult(target?, options?)` | ["Copy as test"](/integration/debugging/#copy-as-test): a `renderComponent` test that replays a session |
| `getSession(target?)` | One instance's recorded session, as plain data |
| `connectReduxDevtools(target?, { name?, filter? })` | Send the actions and the root's state to the [Redux DevTools](/integration/debugging/#redux-devtools) extension; returns a disconnect function |

See [From code](/integration/debugging/#from-code-copyastest-and-getactions) for the arguments.

---

## sygnal/element

`defineElement(tag, Component, options?)` from `sygnal/element` publishes a component as a custom element (props from attributes and properties, sinks as DOM events, optional shadow root). See [Web components: publishing](/guide/web-components/#publishing-a-component-as-a-custom-element).

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

## STATE.watch()

A stream, in intent, of a value selected from the component's state, emitted only when that value changes (compared structurally). Guide: [Reacting to state changes](/guide/intent/#reacting-to-state-changes-statewatch).

```typescript
interface StateSource<State> {
  watch<T>(selector: (state: State) => T, options?: { immediate?: boolean }): Stream<T>
}
```

```jsx
Notes.intent = ({ STATE }) => ({
  SAVE: STATE.watch(state => state.text).compose(debounce(1000)),
})
```

By default only later changes are emitted; `{ immediate: true }` emits the current value first. In a Collection item, `state` is the item's state. The stream ends when the component is disposed. The raw state stream is `STATE.stream`.

---

## Event Shorthands

### DOM Source

The DOM source wraps `@cycle/dom`'s `MainDOMSource` with a Proxy that adds shorthand event methods. Any property access that doesn't already exist on the source becomes an event listener factory:

```typescript
type SygnalDOMSource = MainDOMSource & {
  // standard events are typed like DOM.select(selector).events(name):
  // DOM.keydown(sel): Stream<KeyboardEvent>, DOM.click(sel): Stream<MouseEvent>, …
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
DOM.click('.task').data('taskId')        // camelCase name → data-task-id attribute
DOM.keydown('.input').key()              // e.key
DOM.click('.btn').target()               // e.target
DOM.select('.due').events('pick').detail()  // e.detail (a CustomEvent's payload)
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
| `.data(name, fn?)` | `dataset[name]` of `e.target` or its nearest ancestor with the attribute | `name` camelCase or kebab-case: `'taskId'` and `'task-id'` both read `data-task-id` (via `closest('[data-task-id]')`) |
| `.key(fn?)` | `e.key` | For keyboard events |
| `.target(fn?)` | `e.target` | The DOM element |
| `.detail(fn?)` | `e.detail` | A `CustomEvent`'s payload: a [widget's](/guide/widgets/) `dispatch(name, detail)`, a [web component's](/guide/web-components/) event, a `defineElement` element's sink |

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

<!-- docs-check: skip -->
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
