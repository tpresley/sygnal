---
title: Types
description: TypeScript type definitions and package exports
---

All types are exported from `sygnal` (`import type { … } from 'sygnal'`). See [TypeScript](/integration/typescript/) for how to use them.

## Components

### Component

```typescript
type Component<
  STATE = any,
  PROPS = { [prop: string]: any },
  DRIVERS = {},
  ACTIONS = {},
  CALCULATED = {},
  CONTEXT = {},                      // the context the view and reducers see
  SINK_RETURNS extends NonStateSinkReturns = {},
  PROVIDED_CONTEXT = CONTEXT          // what this component's own .context provides
> = ((props: ViewProps<STATE & CALCULATED, PROPS, CONTEXT> /* , state, context, peers */) => JSX.Element) & {
  // with CALCULATED, also accepts an intent annotated with IntentSources<STATE>
  intent?: (sources: IntentSources<STATE & CALCULATED, DRIVERS>) => { [ACTION in keyof ACTIONS]?: Stream<any> }
  model?: ComponentModel
  initialState?: STATE
  calculated?: Calculated
  context?: Context<PROVIDED_CONTEXT>
  onError?: (error: Error, info: { componentName: string }) => any
  // … peers, components, isolatedState, storeCalculatedInState, debug, DOMSourceName, stateSourceName
}
```

(Abridged; `ComponentModel`, `Calculated` and `Context` stand for internal types.)

### ViewProps, StateProp, ElementProps

The view receives `ViewProps`; `state` and `context` are always there. In JSX the element takes `ElementProps` instead: the component's own props, with `state` an optional slice name or lens (`<Editor state="editor" />`, `<Editor state={lens} />`, `<Editor />`). `context` and `slots` are never passed by the parent.

```typescript
type ViewProps<STATE = any, PROPS = {}, CONTEXT = {}> = PROPS & {
  state: STATE
  context: CONTEXT
  children?: JSX.Element | JSX.Element[]
  slots?: Record<string, JSX.Element[]>
}

type StateProp = string | Lens<any, any>

// used as JSX.LibraryManagedAttributes
type ElementProps<PROPS> = /* PROPS without state, context and slots, & { state?: StateProp } */ any
```

### RootComponent

A `Component` without props, so the view's `state` is typed by `STATE` (and `CALCULATED`).

```typescript
type RootComponent<STATE = any, DRIVERS = {}, ACTIONS = {}, CALCULATED = {}, CONTEXT = {},
                   SINK_RETURNS extends NonStateSinkReturns = {}, PROVIDED_CONTEXT = CONTEXT> =
  Component<STATE, {}, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS, PROVIDED_CONTEXT>
```

### IntentSources

The object an intent function receives: `DOM`, `STATE`, `EVENTS`, `CHILD`, `dispose$`, plus custom drivers.

```typescript
type IntentSources<STATE = any, DRIVERS = {}> = CombinedSources<STATE, FixDrivers<DRIVERS>>
```

### ActionsOf

Derives the action map (action name → payload type) from an intent function, or from its return type.

```typescript
type ActionsOf<INTENT> = { [ACTION in keyof ReturnType<INTENT>]: StreamPayload<ReturnType<INTENT>[ACTION]> }
```

### ParentPayloadOf

The value type a component sends to its parent through `PARENT`: the `PARENT` type in a `Component<…>` annotation's `SINK_RETURNS`, or, for a component without an annotation, inferred from its model. A child annotated without `{ PARENT: T }` gives `unknown`; a component without a model (or with `PARENT: true` entries only) gives `any`. `CHILD.select(Comp)` returns `Stream<ParentPayloadOf<typeof Comp>>`.

```typescript
type ParentPayloadOf<COMPONENT> = /* SINK_RETURNS['PARENT'], or the model's PARENT return type; unknown / any */ any
```

### ChildSource

```typescript
type ChildSource = {
  select<COMPONENT extends (...args: any[]) => any>(component: COMPONENT): Stream<ParentPayloadOf<COMPONENT>>
  select<T = any>(component: (...args: any[]) => any): Stream<T>
  select<T = any>(name: string): Stream<T>    // non-canonical (minification-unsafe)
}
```

### Lens / Lense

```typescript
type Lens<PARENT_STATE = any, CHILD_STATE = any> = {
  get: (state: PARENT_STATE) => CHILD_STATE
  set: (state: PARENT_STATE, childState: CHILD_STATE) => PARENT_STATE
}
```

### CollectionProps, ArrayKeysOf, CollectionFrom

```typescript
type ArrayKeysOf<STATE> = { [KEY in keyof STATE]-?: NonNullable<STATE[KEY]> extends ReadonlyArray<any> ? KEY : never }[keyof STATE] & string

// any string or Lens while STATE is unknown; otherwise an array key of STATE or a Lens over it
type CollectionFrom<STATE = any> = 0 extends (1 & STATE) ? string | Lens : ArrayKeysOf<STATE> | Lens<STATE, any>

type CollectionProps<PROPS = any, STATE = any> = {
  of: AnyComponent
  from: CollectionFrom<STATE>
  filter?: (item: any) => boolean
  sort?: SortSpec
} & Omit<PROPS, 'of' | 'from' | 'filter' | 'sort'>

type SortFunction<ITEM = any> = (a: ITEM, b: ITEM) => number
type SortObject<ITEM = any> = { [field: string]: 'asc' | 'desc' | 1 | -1 }  // one key
// 'asc'/'desc' (whole items), a field name, a comparator, a SortObject, or an array of these
type SortSpec<ITEM = any> = string | SortFunction<ITEM> | SortObject<ITEM>
  | ReadonlyArray<string | SortFunction<ITEM> | SortObject<ITEM>>
```

`Collection<PROPS, STATE>` (an instantiation expression) gives a Collection whose `from` is checked against `STATE`.

### SwitchableProps

```typescript
type SwitchableProps<PROPS = any> = {
  of: Record<string, AnyComponent>
  current: string
  state?: string | Lens
} & Omit<PROPS, 'of' | 'state' | 'current'>
```

## Events

### SygnalEvents

An empty interface you augment to type the EVENTS bus:

```typescript
// src/events.ts
export {}   // keep: without it the block below replaces the 'sygnal' types instead of adding to them

declare module 'sygnal' {
  interface SygnalEvents {
    DELETE_LANE: { laneId: string }
    RESET: void
  }
}
```

### EventName, EventPayload, RegisteredEvent

```typescript
type EventName = keyof SygnalEvents extends never ? string : keyof SygnalEvents & string
type EventPayload<TYPE extends string = string> = keyof SygnalEvents extends never ? any : SygnalEvents[TYPE]
// Event<any> while the registry is empty, else the union of { type, data } for every registered event
type RegisteredEvent = Event<any>
type Event<DATA = any> = { type: string; data: DATA }
```

### EventSink

What `event()` returns: an `EVENTS` sink function.

```typescript
type EventSink<TYPE extends string = string, STATE = any, DATA = any> =
  (state: STATE, data: DATA, next: any, props: any) => { type: TYPE; data: EventPayload<TYPE> }
```

### EventsSource

```typescript
type EventsSource = Stream<Event> & {
  select(type: EventName): Stream<EventPayload>   // typed by the registry once it has entries
}
```

## Running and Diagnostics

### RunOptions

```typescript
type RunOptions = {
  mountPoint?: string
  fragments?: boolean
  useDefaultDrivers?: boolean
  diagnostics?: DiagnosticsMode | DiagnosticsOptions
}
```

### SygnalApp

```typescript
type SygnalApp<STATE = any, DRIVERS = {}> = {
  sources: CombinedSources<STATE, DRIVERS>
  sinks: SygnalSinks<STATE, DRIVERS>
  dispose: () => void
  hmr: (newComponent?: AnyComponentModule, state?: STATE) => void
}
```

### DiagnosticsMode, DiagnosticsOptions, Diagnostic

```typescript
type DiagnosticsMode = 'off' | 'collect' | 'warn' | 'error'

type DiagnosticsOptions = {
  mode?: DiagnosticsMode
  ignore?: DiagnosticCode[]       // codes to drop
}

type DiagnosticCode = `SYG${number}`
type DiagnosticSeverity = 'error' | 'warn' | 'info'

type Diagnostic = {
  code: DiagnosticCode
  severity: DiagnosticSeverity
  component?: string
  message: string
  fix?: string
  data?: any
  docsUrl: string                 // https://sygnal.js.org/reference/errors#sygnnn
  text: string                    // [Sygnal CODE] Component: message. fix docsUrl
  timestamp: number
}
```

### SygnalDevTools

The [DevTools](/integration/debugging/#devtools-extension) bridge, installed by the dev-only `sygnal/devtools` entry (the Vite plugin loads it in dev). `getDevTools()` returns `SygnalDevTools | undefined`.

```typescript
interface SygnalDevTools {
  readonly connected: boolean
  getDiagnostics(): Diagnostic[]
  inspect?(): InspectGraph        // present once 'sygnal/diagnostics' is loaded
}
```

### InspectGraph

The app graph produced by `inspect()`, `t.inspect()` and `sygnal-check --graph --json`. Its parts (`InspectComponent`, `InspectAction`, `InspectChild`, `InspectSelector`, `InspectDiagnostic`) are exported too.

```typescript
interface InspectGraph {
  version: 1
  source?: 'runtime' | 'static'
  components: InspectComponent[]
  events: Record<string, { emitters: string[]; selectors: string[] }>
  diagnostics: InspectDiagnostic[]
}

interface InspectComponent {
  name: string
  id: string
  parentId: string | null
  file?: string
  kind: 'root' | 'child' | 'collection-item' | 'switchable'
  actions: { name: string; trigger: 'intent' | 'next' | 'builtin' | 'unknown'; sinks: string[] }[]
  stateKeys: string[]
  calculated: string[]
  contextProvides: string[]
  contextConsumes?: string[] | null
  eventsEmitted: string[]
  eventsSelected: string[]
  children: { name: string; via: 'tag' | 'collection' | 'switchable' | 'slot'; from?: string | null; count?: number }[]
  selectors: { selector: string; events: string[] | null; matched: boolean | null; isolationHit: string | null }[]
  diagnostics: InspectDiagnostic[]
}
```

## Testing

### RenderOptions

```typescript
interface RenderOptions {
  initialState?: any
  mockConfig?: Record<string, any>
  drivers?: Record<string, any>
  diagnostics?: DiagnosticsMode
  strict?: boolean
}
```

### RenderResult

```typescript
interface RenderResult {
  state$: Stream<any>
  dom$: Stream<any>
  events$: any
  sinks: Record<string, any>
  sources: Record<string, any>
  simulateAction: (actionName: string, data?: any) => void
  simulateEvent: (selector: string, eventType: string, eventInit?: SimulatedEventInit) => void
  ready: () => Promise<void>
  waitForState: (predicate: (state: any) => boolean, timeoutMs?: number) => Promise<any>
  next: (predicate?: (state: any) => boolean, timeoutMs?: number) => Promise<any>
  settle: (timeoutMs?: number) => Promise<void>
  states: any[]
  readonly state: any
  sinkValues: (sinkName: string) => any[]
  emitted: Array<{ type: string; data: any }>
  diagnostics: Diagnostic[]
  expectNoDiagnostics: () => void
  html: () => string
  dispose: () => void
  inspect: () => InspectGraph
}
```

### SimulatedEventInit

```typescript
interface SimulatedEventInit {
  target?: Record<string, any>    // merged into event.target
  value?: any                     // target.value
  checked?: boolean               // target.checked
  dataset?: Record<string, any>   // merged into target.dataset (values become strings)
  data?: Record<string, any>      // alias for dataset
  key?: string                    // event.key
  [prop: string]: any             // copied onto the event
}
```

## Drivers and Helpers

### SygnalDOMSource

The shorthands for standard DOM events are typed like `DOM.select(selector).events(name)`: `DOM.keydown('.x')` is a stream of `KeyboardEvent`, `DOM.click('.x')` of `MouseEvent` (`PointerEvent` with newer DOM typings). Other names are streams of `Event`.

```typescript
type DOMEventShorthands = {
  [EVENT in keyof HTMLElementEventMap]: (selector: string) => EnrichedEventStream<HTMLElementEventMap[EVENT]>
}   // except 'select', which is DOM.select(selector)

type SygnalDOMSource = MainDOMSource & DOMEventShorthands & {
  [eventName: string]: (selector: string) => EnrichedEventStream<Event>   // custom events
}
```

### DriverFromAsyncOptions, AsyncDriverError

```typescript
type DriverFromAsyncOptions<INCOMING = any, OUTGOING = any, RETURN = any> = {
  selector?: string
  args?: string | string[] | ((incoming: INCOMING) => any | any[])
  return?: string | undefined
  pre?: (incoming: INCOMING) => INCOMING
  post?: (value: RETURN, incoming: INCOMING) => OUTGOING | Promise<OUTGOING>
}

// payload of source.errors()
type AsyncDriverError<INCOMING = any> = {
  error: any
  request: INCOMING
  [selectorProperty: string]: any
}
```

### Ref, Ref$

```typescript
interface Ref<T = HTMLElement> { current: T | null }
interface Ref$<T = HTMLElement> extends Ref<T> { stream: MemoryStream<T | null> }
```

### DragDriverSource

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

### DragDriverRegistration

```typescript
type DragDriverRegistration = {
  category: string
  draggable?: string
  dropZone?: string
  accepts?: string
  dragImage?: string
}
```

### DragStartPayload, DropPayload

```typescript
type DragStartPayload = {
  element: HTMLElement
  dataset: Record<string, string>
}

type DropPayload = {
  dropZone: HTMLElement
  insertBefore: HTMLElement | null
}
```

### DefaultDrivers

```typescript
type DefaultDrivers<STATE, EVENTS = any> = {
  STATE: { source: StateSource<STATE>; sink: STATE }
  DOM: { source: SygnalDOMSource; sink: never }
  EVENTS: { source: EventsSource<EVENTS>; sink: EVENTS }
  LOG: { source: never; sink: any }
  CHILD: { source: ChildSource; sink: never }
}
```

### Stream / MemoryStream

```typescript
import type { Stream, MemoryStream } from 'sygnal'
```

---

## Package Exports

| Import Path | Description |
|-------------|-------------|
| `sygnal` | Main entry: all core functions, types, and DOM helpers |
| `sygnal/diagnostics` | Dev-only runtime checks, strict mode and `inspect()` (see [Diagnostics](/guide/diagnostics/)) |
| `sygnal/vite` | Vite plugin |
| `sygnal/jsx-runtime` | Automatic JSX transform runtime (`jsx`, `jsxs`, `Fragment`) |
| `sygnal/jsx-dev-runtime` | Automatic JSX transform runtime (development mode) |
| `sygnal/jsx` | Classic JSX pragma (`jsx` and `Fragment` functions) |
| `sygnal/astro` | Astro integration |
| `sygnal/astro/client` | Astro client-side hydration renderer |
| `sygnal/astro/server` | Astro server-side renderer |
| `sygnal/config` (also `sygnal/vike`, `sygnal/vike/config`) | Vike extension config |
| `sygnal/vike/ClientOnly` | `ClientOnly` component for Vike |
| `sygnal/types` | TypeScript type definitions only |

The static checker is a separate package: `sygnal-check` (see [Building with AI Agents](/integration/agents/#sygnal-check)).

### Main Export Summary

<!-- docs-check: skip -->
```javascript
// Core
import { run, component, ABORT } from 'sygnal'

// Components
import { collection, Collection, switchable, Switchable } from 'sygnal'

// Component Features
import { Portal, Transition, Suspense, Slot, lazy, createRef, createRef$, createCommand } from 'sygnal'

// Model helpers
import { event, set, toggle, emit } from 'sygnal'

// Utilities
import { processForm, processDrag, classes, exactState, driverFromAsync, enableHMR, makeDragDriver } from 'sygnal'

// Testing and SSR
import { renderComponent, renderToString } from 'sygnal'

// Diagnostics
import { getDiagnostics, clearDiagnostics, onDiagnostic, getDevTools } from 'sygnal'
import { inspect, configureStrict, checkEventBus } from 'sygnal/diagnostics'
import 'sygnal/devtools'   // dev only: installs the DevTools bridge (automatic with sygnal/vite)

// PWA
import { makeServiceWorkerDriver, onlineStatus$, createInstallPrompt } from 'sygnal'

// Streams
import { xs, debounce, throttle, delay, dropRepeats, sampleCombine } from 'sygnal'

// DOM (from @cycle/dom)
import { h, div, span, a, button, input, form, label, ul, li, p, ... } from 'sygnal'

// Types
import type {
  Component, RootComponent, IntentSources, ActionsOf, ParentPayloadOf, SygnalEvents,
  Lens, Stream, MemoryStream, RunOptions, SygnalApp, Diagnostic, DiagnosticsMode,
  InspectGraph, RenderOptions, RenderResult, SygnalDOMSource, DragDriverSource
} from 'sygnal'
```
