---
title: TypeScript
description: Type-safe Sygnal components
---

Sygnal ships with full TypeScript type definitions. Type a component with `Component` (or `RootComponent` for the component you pass to `run()`), and let `ActionsOf` derive the actions from its intent:

```tsx
import type { RootComponent, IntentSources, ActionsOf } from 'sygnal'

type AppState = {
  count: number
  name: string
}

const intent = ({ DOM }: IntentSources<AppState>) => ({
  INCREMENT: DOM.click('.btn'),
  SET_NAME:  DOM.input('.name').value(),     // Stream<string>
})

type AppActions = ActionsOf<typeof intent>

const App: RootComponent<AppState, {}, AppActions> = ({ state }) => (
  <div>
    <h1>{state.name}: {state.count}</h1>
    <input className="name" value={state.name} />
    <button className="btn">+1</button>
  </div>
)

App.initialState = { count: 0, name: 'Counter' }
App.intent = intent
App.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  SET_NAME:  (state, name) => ({ ...state, name }),     // name: string
}

export default App
```

## Component Type Parameters

```typescript
Component<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>
RootComponent<STATE, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>
```

| Parameter | Description |
|-----------|-------------|
| `STATE` | Shape of the component's state |
| `PROPS` | Shape of props received from parent |
| `DRIVERS` | Custom driver type specifications (`{ API: { source: ...; sink: ... } }`) |
| `ACTIONS` | Map of action names to their data types |
| `CALCULATED` | Shape of calculated field values |
| `CONTEXT` | Shape of context values |
| `SINK_RETURNS` | Return types for non-state sinks (`EVENTS`, `LOG`, `PARENT`) |

## Actions from the Intent: `ActionsOf`

`ActionsOf<typeof intent>` turns an intent function into an action map: each key's `Stream<T>` becomes `T`. Declare the intent as a constant first, typing its sources with `IntentSources<State>`, then pass the derived actions to `Component`:

```tsx
import type { Component, IntentSources, ActionsOf } from 'sygnal'

type CounterState = { count: number }

const counterIntent = ({ DOM }: IntentSources<CounterState>) => ({
  INCREMENT: DOM.click('.inc').mapTo(1),   // Stream<number>
  RESET:     DOM.click('.reset'),
})

const Counter: Component<CounterState, {}, {}, ActionsOf<typeof counterIntent>> = ({ state }) => (
  <div>
    <span>{state.count}</span>
    <button className="inc">+</button>
    <button className="reset">Reset</button>
  </div>
)

Counter.intent = counterIntent
Counter.model = {
  INCREMENT: (state, by) => ({ ...state, count: state.count + by }),   // by: number
  RESET:     (state) => ({ ...state, count: 0 }),
}
```

With the actions typed:

- a model key the intent doesn't produce (a typo such as `INCREMNT`) is a type error; the built-ins `BOOTSTRAP`, `INITIALIZE`, `HYDRATE` and `DISPOSE` stay allowed;
- each reducer's `data` argument has the type its stream emits;
- `next('ACTION', data)` is checked against the action map.

An action that only `next()` dispatches isn't produced by the intent, so add it to the map yourself:

```tsx
type CounterActions = ActionsOf<typeof counterIntent> & { SAVED: { id: string } }
```

`IntentSources<STATE, DRIVERS>` is the type of the object an intent receives: `DOM`, `STATE`, `EVENTS`, `CHILD`, `dispose$` and your custom drivers.

## Typed Events

The `EVENTS` bus is untyped (`any`) until you register your event names and payload types by augmenting the `SygnalEvents` interface:

```typescript
// src/events.ts
export {}   // the file must be a module

declare module 'sygnal' {
  interface SygnalEvents {
    DELETE_LANE: { laneId: string }
    SET_MODE: 'light' | 'dark'
    RESET: void            // no payload: event('RESET')
  }
}
```

Once the registry has an entry:

- `event('DELETE_LANE', fn)` and `emit()` only accept registered names, and the payload (function result or static value) must match the registered type;
- `EVENTS.select('DELETE_LANE')` returns `Stream<{ laneId: string }>`, and an unregistered name is an error;
- a raw `EVENTS` sink must return one of the registered `{ type, data }` shapes.

```tsx
import { event } from 'sygnal'

Lane.model = {
  DELETE: {
    STATE:  (state) => ({ ...state, deleting: true }),
    EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })),   // checked
  },
  DARK:  { EVENTS: event('SET_MODE', 'dark') },
  RESET: { EVENTS: event('RESET') },
}

const boardIntent = ({ EVENTS }: IntentSources<BoardState>) => ({
  REMOVE_LANE: EVENTS.select('DELETE_LANE'),   // Stream<{ laneId: string }>
})
```

Inside a typed model, `event()`'s payload function gets the component's `state` and the action's `data` types even without a registry. The helper types `EventName`, `EventPayload<'TYPE'>` and `RegisteredEvent` are exported.

## Typed Child Events

`CHILD.select(ChildComponent)` returns a stream of whatever the child's `PARENT` sink returns, inferred from the child's `model`:

```tsx
function TaskCard({ state }: { state: { id: string; title: string } }) {
  return <div className="task">{state.title}</div>
}
TaskCard.model = {
  DELETE: {
    PARENT: (state: { id: string }) => ({ taskId: state.id }),
  },
}

const laneIntent = ({ CHILD }: IntentSources<LaneState>) => ({
  DELETE_TASK: CHILD.select(TaskCard).map((e) => e.taskId),   // e: { taskId: string }
})
```

The payload type is `ParentPayloadOf<typeof TaskCard>`. It falls back to `any` when it can't be inferred: no model, `PARENT: true` pass-through entries only, or a child declared as `Component<...>` without a `PARENT` type in its `SINK_RETURNS`. An explicit type argument also works: `CHILD.select<number>(Child)`.

## Collection `from`

To type-check a Collection's `from` against the parent's state, bind the state type with an instantiation expression:

```tsx
import { Collection } from 'sygnal'

type LaneState = { title: string; tasks: { id: string; title: string }[] }

const TaskCollection = Collection<{ className?: string }, LaneState>

function Lane({ state }: { state: LaneState }) {
  return (
    <div>
      <TaskCollection of={TaskCard} from="tasks" className="tasks" />
      {/* <TaskCollection of={TaskCard} from="title" />  ✗ 'title' isn't an array field */}
    </div>
  )
}
```

`from` then only accepts keys of `LaneState` whose value is an array (`ArrayKeysOf<LaneState>`), or a `Lens<LaneState, …>`. The plain `<Collection>` (no state type) accepts any string or lens.

## exactState() Helper

Use `exactState()` to enforce that state updates match your type exactly (no extra properties):

```tsx
import { exactState } from 'sygnal'
import type { AppState } from './types'

const asAppState = exactState<AppState>()

App.model = {
  UPDATE: (state) => asAppState({ ...state, count: state.count + 1 })
  // TypeScript error if you add properties not in AppState
}
```

## Testing Types

`renderComponent()` and its result are fully typed (`RenderOptions`, `RenderResult`). The diagnostics types (`Diagnostic`, `DiagnosticsMode`, `InspectGraph` and its parts) are exported from `sygnal`, and the `sygnal/diagnostics` entry ships its own declarations.
