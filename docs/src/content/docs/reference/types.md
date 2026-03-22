---
title: Types
description: TypeScript type definitions and package exports
---

## TypeScript Types

### Component

```typescript
type Component<
  STATE = any,
  PROPS = any,
  DRIVERS = {},
  ACTIONS = {},
  CALCULATED = {},
  CONTEXT = {},
  SINK_RETURNS extends NonStateSinkReturns = {}
>
```

### RootComponent

```typescript
type RootComponent<
  STATE = any,
  DRIVERS = {},
  ACTIONS = {},
  CALCULATED = {},
  CONTEXT = {},
  SINK_RETURNS extends NonStateSinkReturns = {}
>
```

### Lens / Lense

```typescript
type Lens<PARENT_STATE = any, CHILD_STATE = any> = {
  get: (state: PARENT_STATE) => CHILD_STATE
  set: (state: PARENT_STATE, childState: CHILD_STATE) => PARENT_STATE
}
```

### Stream / MemoryStream

```typescript
import type { Stream, MemoryStream } from 'sygnal'
```

### RunOptions

```typescript
type RunOptions = {
  mountPoint?: string
  fragments?: boolean
  useDefaultDrivers?: boolean
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

### CollectionProps

```typescript
type CollectionProps<PROPS = any> = {
  of: Component | ((props: PROPS) => JSX.Element)
  from: string | Lens
  filter?: (item: any) => boolean
  sort?: string | ((a: any, b: any) => number) | { [field: string]: 'asc' | 'desc' | SortFunction }
}
```

### SwitchableProps

```typescript
type SwitchableProps<PROPS = any> = {
  of: Record<string, Component | ((props: PROPS) => JSX.Element)>
  current: string
  state?: string | Lens
}
```

### SygnalDOMSource

```typescript
type SygnalDOMSource = MainDOMSource & {
  [eventName: string]: (selector: string) => Stream<Event>
}
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

### DragStartPayload

```typescript
type DragStartPayload = {
  element: HTMLElement
  dataset: Record<string, string>
}
```

### DropPayload

```typescript
type DropPayload = {
  dropZone: HTMLElement
  insertBefore: HTMLElement | null
}
```

### DriverFromAsyncOptions

```typescript
type DriverFromAsyncOptions<INCOMING = any, OUTGOING = any, RETURN = any> = {
  selector?: string
  args?: string | string[] | ((incoming: INCOMING) => any | any[])
  return?: string | undefined
  pre?: (incoming: INCOMING) => INCOMING
  post?: (value: RETURN, incoming: INCOMING) => OUTGOING | Promise<OUTGOING>
}
```

### ChildSource

```typescript
type ChildSource = {
  select: (typeOrComponent: string | Function) => Stream<any>
}
```

`select()` accepts either a **component function reference** (preferred) or a string name:

- `CHILD.select(TaskCard)` — matches by function identity. Minification-safe.
- `CHILD.select('TaskCard')` — matches by component name. Not recommended for production builds as minification mangles function names.

### DefaultDrivers

```typescript
type DefaultDrivers<STATE, EVENTS = any> = {
  STATE: { source: StateSource<STATE>; sink: STATE }
  DOM: { source: MainDOMSource; sink: never }
  EVENTS: { source: Stream<Event<EVENTS>>; sink: EVENTS }
  LOG: { source: never; sink: any }
  CHILD: { source: ChildSource; sink: never }
}
```

### Event

```typescript
type Event<DATA = any> = { type: string; data: DATA }
```

---

## Package Exports

Sygnal provides multiple entry points:

| Import Path | Description |
|-------------|-------------|
| `sygnal` | Main entry — all core functions, types, and DOM helpers |
| `sygnal/jsx-runtime` | Automatic JSX transform runtime (`jsx`, `jsxs`, `Fragment`) |
| `sygnal/jsx-dev-runtime` | Automatic JSX transform runtime (development mode) |
| `sygnal/jsx` | Classic JSX pragma (`jsx` and `Fragment` functions) |
| `sygnal/astro` | Astro integration plugin |
| `sygnal/astro/client` | Astro client-side hydration renderer |
| `sygnal/astro/server` | Astro server-side renderer |
| `sygnal/types` | TypeScript type definitions only |

### Main Export Summary

```javascript
// Core
import { run, component, ABORT } from 'sygnal'

// Components
import { collection, Collection, switchable, Switchable } from 'sygnal'

// Component Features
import { Portal, Transition, Suspense, lazy, createRef, createRef$ } from 'sygnal'

// Utilities
import { processForm, classes, exactState, driverFromAsync, enableHMR, makeDragDriver } from 'sygnal'

// Streams
import { xs, debounce, throttle, delay, dropRepeats, sampleCombine } from 'sygnal'

// DOM (from @cycle/dom)
import { h, div, span, a, button, input, form, label, ul, li, p, ... } from 'sygnal'

// Types
import type {
  Component, RootComponent, Lens, Stream, MemoryStream, RunOptions, SygnalApp,
  SygnalDOMSource, DragDriverSource, DragDriverRegistration, DragStartPayload, DropPayload
} from 'sygnal'
```
