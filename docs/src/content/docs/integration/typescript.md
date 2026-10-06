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
    <input className="name" aria-label="Name" value={state.name} />
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

The view's arguments are typed from the annotation: `state` is `AppState` (plus the calculated fields), so callbacks over it (`state.items.find((item) => …)`) need no annotations either.

## Component Type Parameters

```typescript
Component<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS, PROVIDED_CONTEXT>
RootComponent<STATE, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS, PROVIDED_CONTEXT>
```

| Parameter | Description |
|-----------|-------------|
| `STATE` | Shape of the component's state |
| `PROPS` | Shape of props received from parent (`RootComponent`: none) |
| `DRIVERS` | Custom driver type specifications (`{ API: { source: ...; sink: ... } }`) |
| `ACTIONS` | Map of action names to their data types |
| `CALCULATED` | Shape of calculated field values |
| `CONTEXT` | Shape of the context the view and reducers read (from ancestors and the component's own `.context`) |
| `SINK_RETURNS` | Return types for non-state sinks (`EVENTS`, `LOG`, `PARENT`) |
| `PROVIDED_CONTEXT` | Shape of what the component's own `.context` provides (defaults to `CONTEXT`) |

Unused parameters take `{}`: `Component<TaskState, {}, {}, TaskActions>`.

## Sub-components in JSX

The view of a typed component receives `state: STATE`, but in JSX the parent passes the state as a slice name of its own state, a lens, or nothing (the child then shares the parent's state). Only the component's own props are checked:

```tsx
import type { Component } from 'sygnal'

type EditorState = { draft: string }
const Editor: Component<EditorState> = ({ state }) => <textarea className="draft" value={state.draft} />

type PanelProps = { title: string }
const Panel: Component<{}, PanelProps> = ({ title }) => <aside>{title}</aside>

const Page: Component<{ editor: EditorState }> = () => (
  <div>
    <Editor state="editor" />   {/* state: a field name of Page's state, or a lens */}
    <Panel title="Details" />   {/* no state prop: shares Page's state */}
  </div>
)
```

`<Panel />` without `title`, or `<Editor state={42} />`, is a type error. The parent never passes `context` or `slots`; the framework provides them.

## Context

Type the context a component reads with `CONTEXT`. The view's `context` is always present (no `context?.` needed):

```tsx
import type { Component } from 'sygnal'

type AppContext = { theme: 'light' | 'dark'; selectedId: number | null }
type Task = { id: number; title: string }

const TaskRow: Component<Task, {}, {}, {}, {}, AppContext> = ({ state, context }) => (
  <div className={context.selectedId === state.id ? `row ${context.theme} selected` : 'row'}>{state.title}</div>
)
```

The component that defines `.context` uses the same parameter, and every key of it must be provided:

```tsx
type AppState = { theme: 'light' | 'dark'; selectedId: number | null }

const App: RootComponent<AppState, {}, {}, {}, AppContext> = ({ state }) => <div>{state.theme}</div>

App.context = {
  theme:      (state) => state.theme,
  selectedId: (state) => state.selectedId,
}
```

A component that reads one context and provides another passes what it provides as `PROVIDED_CONTEXT` (the 8th parameter): `Component<SectionState, {}, {}, {}, {}, AppContext & SectionContext, {}, SectionContext>`. Its view sees both.

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

- a model key the intent doesn't produce (a typo such as `INCREMNT`) is a type error; the built-ins `BOOTSTRAP`, `INITIALIZE` and `DISPOSE` stay allowed (`HYDRATE` is no longer a built-in: list it like any other action if you dispatch it);
- each reducer's `data` argument has the type its stream emits;
- `next('ACTION', data)` is checked against the action map.

An action that only `next()` dispatches isn't produced by the intent, so add it to the map yourself:

```tsx
type CounterActions = ActionsOf<typeof counterIntent> & { SAVED: { id: string } }
```

### Reply actions

The [reply actions](/guide/http/) a request names (`ok: 'LOADED'`, `error: 'FAILED'`) aren't produced by the intent either. Add them with their data: the `ok` action gets the parsed body (the type isn't inferred from the request, so name it), the `error` action a `FetchFailure` (`{ error, status?, body?, request }`):

```tsx
import type { Component, IntentSources, ActionsOf, FetchRequest, FetchSource, FetchFailure } from 'sygnal'

type Quote = { text: string }
type QuoteState = { id: number; status: string; quote?: Quote }
type QuoteDrivers = { HTTP: { source: FetchSource; sink: FetchRequest } }

const quoteIntent = ({ DOM }: IntentSources<QuoteState, QuoteDrivers>) => ({ LOAD: DOM.click('.load') })
type QuoteActions = ActionsOf<typeof quoteIntent> & { LOADED: Quote; FAILED: FetchFailure }

const QuoteCard: Component<QuoteState, {}, QuoteDrivers, QuoteActions> = ({ state }) => (
  <div><button className="load">Load</button> {state.quote?.text ?? state.status}</div>
)
QuoteCard.intent = quoteIntent
QuoteCard.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    HTTP:  (state) => ({ url: `/api/quotes/${state.id}`, ok: 'LOADED', error: 'FAILED' }),
  },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote }),                     // quote: Quote
  FAILED: (state, { status }) => ({ ...state, status: status === 404 ? 'missing' : 'error' }),
}
```

`ok` and `error` are typed as plain strings, so a request can be built in a helper without `as const`; a name with no model entry is caught by `sygnal-check` and the dev entry ([SYG112](/reference/errors/#syg112)), not by `tsc`. `then` / `catch` keys are type errors on these requests ([SYG610](/reference/errors/#syg610) at runtime). `{ abort: 'LOADED' }` cancels by action or key name.

The actions of a [`connections`](/guide/sockets/) static are added the same way: `{ RECEIVED: Message; CONNECTED: SocketOpen; DROPPED: SocketClose }` (`SocketOpen`, `SocketClose`, `SocketError` and the `Connections` return type are exported from `sygnal`).

`IntentSources<STATE, DRIVERS>` is the type of the object an intent receives: `DOM`, `STATE`, `EVENTS`, `CHILD`, `dispose$` and your custom drivers.

With [calculated fields](/guide/calculated-fields/), annotate with the plain state, `IntentSources<AppState>`; `IntentSources<AppState & AppCalculated>` also works, and gives `STATE.stream` the calculated fields too:

```tsx
type BoardState = { lists: { id: string; cards: number[] }[] }
type BoardCalculated = { totalCards: number }

const boardIntent = ({ DOM }: IntentSources<BoardState>) => ({ ADD: DOM.click('.add') })

const Board: Component<BoardState, {}, {}, ActionsOf<typeof boardIntent>, BoardCalculated> = ({ state }) => (
  <div>{state.totalCards} cards <button className="add">Add</button></div>
)
Board.calculated = { totalCards: (state) => state.lists.reduce((n, list) => n + list.cards.length, 0) }
Board.intent = boardIntent
Board.model = { ADD: (state) => ({ ...state, lists: [...state.lists, { id: `l${state.lists.length}`, cards: [] }] }) }
```

The DOM shorthands are typed like `DOM.select(selector).events(name)`: `DOM.keydown('.field')` emits `KeyboardEvent`s (so `.filter((e) => e.key === 'Enter')` checks), `DOM.click('.btn')` `MouseEvent`s, `DOM.input('.name').value()` strings. Custom event names (`DOM['my-event']('.x')`) emit `Event`.

## Typed Events

The `EVENTS` bus is untyped (`any`) until you register your event names and payload types by augmenting the `SygnalEvents` interface. While the registry is empty, TypeScript checks no event names: `event('DOC_SAVE')` and `EVENTS.select('DOC_SAVED')` compile even though the names differ, and the payload is `any`. Register every event your app uses (one `events.ts` file is enough); `npx --no-install sygnal-check` also reports a type that is emitted but never selected, or selected but never emitted ([SYG105](/reference/errors/#syg105)), with or without a registry.

```typescript
// src/events.ts
export {}   // keep this: it makes the file a module, so the block below adds to 'sygnal'.
            // Without it the block replaces the package's types ("has no exported member").

declare module 'sygnal' {
  interface SygnalEvents {
    DELETE_LANE: { laneId: string }
    SET_MODE: 'light' | 'dark'
    RESET: void            // no payload: event('RESET')
  }
}
```

Once the registry has an entry:

- `event('DELETE_LANE', fn)` and `emit()` only accept registered names (a typo is reported as `Argument of type '"DELETE_LAEN"' is not assignable to parameter of type …`), and the payload (function result or static value) must match the registered type;
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

`CHILD.select(ChildComponent)` returns a stream of whatever the child's `PARENT` sink sends. For a child typed with `Component<…>`, declare that type as the `PARENT` entry of `SINK_RETURNS` (the 7th parameter); the child's `PARENT` reducers are then checked against it and the parent's stream is typed:

```tsx
import type { Component, IntentSources, ActionsOf } from 'sygnal'

type Task = { id: number; title: string }
export type PinRequest = { taskId: number }

const taskIntent = ({ DOM }: IntentSources<Task>) => ({ PIN: DOM.click('.pin') })

const TaskItem: Component<Task, {}, {}, ActionsOf<typeof taskIntent>, {}, {}, { PARENT: PinRequest }> = ({ state }) => (
  <div className="task">{state.title} <button className="pin">Pin</button></div>
)
TaskItem.intent = taskIntent
TaskItem.model = {
  PIN: { PARENT: (state) => ({ taskId: state.id }) },   // must return a PinRequest
}

type ListState = { tasks: Task[]; pinnedId: number | null }
const listIntent = ({ CHILD }: IntentSources<ListState>) => ({
  PIN: CHILD.select(TaskItem).map((request) => request.taskId),   // request: PinRequest
})
```

Without `{ PARENT: … }` the annotation doesn't say what the child sends, so `CHILD.select(TaskItem)` is a `Stream<unknown>`: reading a field of the payload is a type error until you declare it.

A child written without a `Component<…>` annotation has its payload inferred from its `model`:

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

The payload type is `ParentPayloadOf<typeof TaskCard>`. It is `any` when there is nothing to infer from (no model, or `PARENT: true` pass-through entries only), and `unknown` for a `Component<…>` child without a `PARENT` type. An explicit type argument also works: `CHILD.select<number>(Child)`.

## Collection `from`

To type-check a Collection's `from` against the parent's state, bind the state type with an instantiation expression:

```tsx
import { Collection } from 'sygnal'

type LaneState = { title: string; tasks: { id: string; title: string }[] }

const TaskCollection = Collection<{}, LaneState>

function Lane({ state }: { state: LaneState }) {
  return (
    <ul className="tasks">
      <TaskCollection of={TaskCard} from="tasks" />
      {/* <TaskCollection of={TaskCard} from="title" />  ✗ 'title' isn't an array field */}
    </ul>
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

`renderComponent()` and its result are fully typed (`RenderOptions`, `RenderResult<State>`). The state type is inferred from the component (a `Component<State, ...>` annotation or a typed view, calculated fields included, else its `initialState`), so test predicates need no annotation:

```tsx
const t = renderComponent(Counter)          // RenderResult<CounterState>
t.simulateEvent('.inc', 'click')
const s = await t.next(s => s.count > 0)    // s: CounterState
```

For a handle declared before it is assigned (in `beforeEach`), name the type: `let t: RenderResult<CounterState>`, not `any` (an `any` handle leaves `s` in `t.next(s => …)` untyped, TS7006 under `strict`). For an untyped component, pass the state type: `renderComponent<CounterState>(Counter)`. Without either, the state is `any`, as before. The diagnostics types (`Diagnostic`, `DiagnosticsMode`, `InspectGraph` and its parts) are exported from `sygnal`, and the `sygnal/diagnostics` entry ships its own declarations.
