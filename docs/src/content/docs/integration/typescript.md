---
title: TypeScript
description: Type-safe Sygnal components
---

Sygnal ships with full TypeScript type definitions. Type a component with `Comp<{ ... }>` (or `RootComp<{ ... }>` for the component you pass to `run()`), naming what it has, and let `ActionsOf` derive the actions from its intent:

```tsx
import type { RootComp, IntentSources, ActionsOf } from 'sygnal'

type AppState = {
  count: number
  name: string
}

const intent = ({ DOM }: IntentSources<AppState>) => ({
  INCREMENT: DOM.click('.btn'),
  SET_NAME:  DOM.input('.name').value(),     // Stream<string>
})

type AppActions = ActionsOf<typeof intent>

const App: RootComp<{ state: AppState; actions: AppActions }> = ({ state }) => (
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

Run `tsc --noEmit` as well as `sygnal-check`: sygnal-check reads the code without types (it finds wiring bugs, such as an action with no model entry), so a value of the wrong type, like an `initialState` that doesn't match `AppState`, is caught only by `tsc`. The TypeScript templates of create-sygnal-app run both with `npm run check`.

## Component Types

`Comp<{ ... }>` takes the component's types by name. Name only what the component has; each key left out takes its default:

```typescript
Comp<{ state: Task; props: { lane: string }; actions: TaskActions; parent: { taskId: string } }>
RootComp<{ state: AppState; drivers: AppDrivers; actions: AppActions }>
```

| Key | Description |
|-----------|-------------|
| `state` | Shape of the component's state (default `any`) |
| `props` | Shape of props received from the parent (default: any prop; `RootComp`: none) |
| `drivers` | Custom driver type specifications (`{ API: { source: ...; sink: ... } }`) |
| `actions` | Map of action names to their data types (`ActionsOf<typeof intent>`; default: any action) |
| `calculated` | Shape of calculated field values (added to `state`) |
| `context` | Shape of the context the view and reducers read (from ancestors and the component's own `.context`) |
| `parent` | What the `PARENT` sink sends, so the parent's `CHILD.select(C)` is typed (not on `RootComp`) |
| `sinks` | Return types for the non-state sinks (`{ EVENTS, LOG, PARENT }`; `parent: T` is short for `sinks: { PARENT: T }`) |
| `provided` | Shape of what the component's own `.context` provides (defaults to `context`) |

A misspelled key (`action`, `prop`) is a type error. `Comp<{ props: PanelProps }>` is a component with props and any state.

### The positional form

`Comp` and `RootComp` are `Component` and `RootComponent` with the type arguments named. The positional form still works, and is the same type:

```typescript
Component<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS, PROVIDED_CONTEXT>
RootComponent<STATE, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS, PROVIDED_CONTEXT>
```

Unused parameters take `{}`: `Component<TaskState, {}, {}, TaskActions>` is `Comp<{ state: TaskState; actions: TaskActions }>`. An `any` PROPS (`Component<TaskState, any>`) allows any prop and keeps `state` typed (since 6.7). The object form has a name of its own because `Component<{ state: 'idle' | 'busy' }>` already means a component whose state has a `state` key.

## Sub-components in JSX

The view of a typed component receives `state`, but in JSX the parent passes the state as a slice name of its own state, a lens, or nothing (the child then shares the parent's state). Only the component's own props are checked:

```tsx
import type { Comp } from 'sygnal'

type EditorState = { draft: string }
const Editor: Comp<{ state: EditorState }> = ({ state }) => <textarea className="draft" value={state.draft} />

type PanelProps = { title: string }
const Panel: Comp<{ props: PanelProps }> = ({ title }) => <aside>{title}</aside>

const Page: Comp<{ state: { editor: EditorState } }> = () => (
  <div>
    <Editor state="editor" />   {/* state: a field name of Page's state, or a lens */}
    <Panel title="Details" />   {/* no state prop: shares Page's state */}
  </div>
)
```

`<Panel />` without `title`, or `<Editor state={42} />`, is a type error. The parent never passes `context` or `slots`; the framework provides them.

## Context

Type the context a component reads with `context`. The view's `context` is always present (no `context?.` needed):

```tsx
import type { Comp } from 'sygnal'

type AppContext = { theme: 'light' | 'dark'; selectedId: number | null }
type Task = { id: number; title: string }

const TaskRow: Comp<{ state: Task; context: AppContext }> = ({ state, context }) => (
  <div className={context.selectedId === state.id ? `row ${context.theme} selected` : 'row'}>{state.title}</div>
)
```

The component that defines `.context` uses the same key, and every key of it must be provided:

```tsx
type AppState = { theme: 'light' | 'dark'; selectedId: number | null }

const App: RootComp<{ state: AppState; context: AppContext }> = ({ state }) => <div>{state.theme}</div>

App.context = {
  theme:      (state) => state.theme,
  selectedId: (state) => state.selectedId,
}
```

A component that reads one context and provides another names what it provides as `provided`: `Comp<{ state: SectionState; context: AppContext & SectionContext; provided: SectionContext }>`. Its view sees both.

### App-wide context: the `SygnalContext` registry

When the root provides the same fields to the whole app, register them once instead of repeating them in each component. Augment `SygnalContext`, usually from the root's own `.context` object with `ContextOf`, which reads each entry's return type:

```tsx
import type { ContextOf, RootComp, Route } from 'sygnal'

type AppState = { route: Route; csrf: string | null }

export const context = {
  route: (state: AppState) => state.route,
  csrf:  (state: AppState) => state.csrf,
}

declare module 'sygnal' {
  interface SygnalContext extends ContextOf<typeof context> {}
}

const App: RootComp<{ state: AppState }> = ({ context }) => <h1>{context.route.name}</h1>

App.context = context
```

Now every `Comp` and `RootComp` reads `context.route` and `context.csrf` with no `context` key. A `context` key on a component adds to the registry's fields, for what a subtree's provider adds. Like the `SygnalEvents` registry, it stays empty and changes nothing until you augment it, and the file that augments it must be a module.

The registry says what a component may read, not that an ancestor provides it. To require the root to provide all of it, name it as `provided`: `RootComp<{ state: AppState; provided: ContextOf<typeof context> }>`.

## Actions from the Intent: `ActionsOf`

`ActionsOf<typeof intent>` turns an intent function into an action map: each key's `Stream<T>` becomes `T`. Declare the intent as a constant first, typing its sources with `IntentSources<State>`, then name the derived actions as `actions`:

```tsx
import type { Comp, IntentSources, ActionsOf } from 'sygnal'

type CounterState = { count: number }

const counterIntent = ({ DOM }: IntentSources<CounterState>) => ({
  INCREMENT: DOM.click('.inc').mapTo(1),   // Stream<number>
  RESET:     DOM.click('.reset'),
})

const Counter: Comp<{ state: CounterState; actions: ActionsOf<typeof counterIntent> }> = ({ state }) => (
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
import type { Comp, IntentSources, ActionsOf, FetchRequest, FetchSource, FetchFailure } from 'sygnal'

type Quote = { text: string }
type QuoteState = { id: number; status: string; quote?: Quote }
type QuoteDrivers = { HTTP: { source: FetchSource; sink: FetchRequest } }

const quoteIntent = ({ DOM }: IntentSources<QuoteState, QuoteDrivers>) => ({ LOAD: DOM.click('.load') })
type QuoteActions = ActionsOf<typeof quoteIntent> & { LOADED: Quote; FAILED: FetchFailure }

const QuoteCard: Comp<{ state: QuoteState; drivers: QuoteDrivers; actions: QuoteActions }> = ({ state }) => (
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

STATE runs first, so `HTTP` gets the state after it: `state.status` is already `'loading'`. The fourth reducer argument has typed `state` and `previousState`; use `previousState` for a value from before the action, or for a guard on a field STATE changes.

`ok` and `error` are typed as plain strings, so a request can be built in a helper without `as const`; a name with no model entry is caught by `sygnal-check` and the dev entry ([SYG112](/reference/errors/#syg112)), not by `tsc`. `then` / `catch` keys are type errors on these requests ([SYG610](/reference/errors/#syg610) at runtime). `{ abort: 'LOADED' }` cancels by action or key name.

The actions of a [`connections`](/guide/sockets/) static are added the same way: `{ RECEIVED: Message; CONNECTED: SocketOpen; DROPPED: SocketClose }` (`SocketOpen`, `SocketClose`, `SocketError` and the `Connections` return type are exported from `sygnal`).

### A Model Apart from Its Component: `ModelFor`

Write the model as `Component.model = { ... }` next to the component whenever you can: reducers are typed from the `Comp` annotation, and a key that isn't in `actions` is an error. That is the canonical form.

When the model has to be its own constant, because its keys and payloads are what declares the actions, or it sits above a long view, a plain object has no type to take reducer parameters from. Use `satisfies ModelFor<Spec>`, with `Spec` being what `Comp` names:

```tsx
import type { Comp, IntentSources, ActionsOf, FetchFailure, ModelFor, ModelActions } from 'sygnal'

type Quote = { text: string }
type QuoteState = { id: number; status: string; quote?: Quote }

const intent = ({ DOM }: IntentSources<QuoteState>) => ({ LOAD: DOM.click('.load') })

type Spec = { state: QuoteState; actions: ActionsOf<typeof intent> }

const model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),                            // state: QuoteState
    HTTP:  (state) => ({ url: `/api/quotes/${state.id}`, ok: 'LOADED', error: 'FAILED' }),
  },
  LOADED: (state, quote: Quote) => ({ ...state, status: 'done', quote }),
  FAILED: (state, { status }: FetchFailure) => ({ ...state, status: status === 404 ? 'missing' : 'error' }),
} satisfies ModelFor<Spec>

const QuoteCard: Comp<Spec & { actions: ModelActions<typeof model> }> = ({ state }) => (
  <div><button className="load">Load</button> {state.quote?.text ?? state.status}</div>
)
QuoteCard.intent = intent
QuoteCard.model = model
```

- `state`, `next` and the fourth argument need no annotation. Nor does the data of an action `Spec` names (`LOAD` here).
- An action `Spec` doesn't name, such as a reply action or one sent by `next()`, is allowed. Annotate its data once on the reducer; unannotated it is `unknown`.
- `ModelActions<typeof model>` adds those actions to the component, so there is no separate action map. `timers` and `viewTransitions` are checked against the result.
- `next('LOAD', data)` is checked for an action `Spec` names. Any other name is accepted by `tsc`.

Because any key is allowed, a misnamed model key or `next()` name is not a type error in this form. `sygnal-check` reports them ([SYG101](/reference/errors/#syg101), [SYG102](/reference/errors/#syg102), [SYG117](/reference/errors/#syg117)), as it does for any `C.model = model`. `satisfies` needs TypeScript 4.9 or later, and `ModelFor` is types only.

`IntentSources<STATE, DRIVERS>` is the type of the object an intent receives: `DOM`, `STATE`, `EVENTS`, `CHILD`, `dispose$` and your custom drivers.

With [calculated fields](/guide/calculated-fields/), annotate with the plain state, `IntentSources<AppState>`; `IntentSources<AppState & AppCalculated>` also works, and gives `STATE.stream` the calculated fields too:

```tsx
type BoardState = { lists: { id: string; cards: number[] }[] }
type BoardCalculated = { totalCards: number }

const boardIntent = ({ DOM }: IntentSources<BoardState>) => ({ ADD: DOM.click('.add') })

const Board: Comp<{ state: BoardState; actions: ActionsOf<typeof boardIntent>; calculated: BoardCalculated }> = ({ state }) => (
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

`CHILD.select(ChildComponent)` returns a stream of whatever the child's `PARENT` sink sends. For a child typed with `Comp<{ … }>`, name that type as `parent`; the child's `PARENT` reducers are then checked against it and the parent's stream is typed:

```tsx
import type { Comp, IntentSources, ActionsOf } from 'sygnal'

type Task = { id: number; title: string }
export type PinRequest = { taskId: number }

const taskIntent = ({ DOM }: IntentSources<Task>) => ({ PIN: DOM.click('.pin') })

const TaskItem: Comp<{ state: Task; actions: ActionsOf<typeof taskIntent>; parent: PinRequest }> = ({ state }) => (
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

Without `parent` the annotation doesn't say what the child sends, so `CHILD.select(TaskItem)` is a `Stream<unknown>`: reading a field of the payload is a type error until you declare it.

(In the positional form, `parent` is the `PARENT` entry of `SINK_RETURNS`, the 7th parameter: `Component<Task, {}, {}, TaskActions, {}, {}, { PARENT: PinRequest }>`.)

A child written without a `Comp` / `Component` annotation has its payload inferred from its `model`:

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

The payload type is `ParentPayloadOf<typeof TaskCard>`. It is `any` when there is nothing to infer from (no model, or `PARENT: true` pass-through entries only), and `unknown` for an annotated child without a `parent` type. An explicit type argument also works: `CHILD.select<number>(Child)`.

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

`from` then only accepts keys of `LaneState` whose value is an array, dotted paths to arrays in its nested objects up to three levels (`'board.cards'`; `ArrayPathsOf<LaneState>`, since 6.5.0), or a `Lens<LaneState, …>`. The plain `<Collection>` (no state type) accepts any string or lens.

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

`renderComponent()` and its result are fully typed (`RenderOptions`, `RenderResult<State>`). The state type is inferred from the component (a `Comp<{ state: State }>` or `Component<State, ...>` annotation, or a typed view, calculated fields included, else its `initialState`), so test predicates need no annotation:

```tsx
const t = renderComponent(Counter)          // RenderResult<CounterState>
t.simulateEvent('.inc', 'click')
const s = await t.next(s => s.count > 0)    // s: CounterState
```

For a handle declared before it is assigned (in `beforeEach`), name the type: `let t: RenderResult<CounterState>`, not `any` (an `any` handle leaves `s` in `t.next(s => …)` untyped, TS7006 under `strict`). For an untyped component, pass the state type: `renderComponent<CounterState>(Counter)`. Without either, the state is `any`, as before. The diagnostics types (`Diagnostic`, `DiagnosticsMode`, `InspectGraph` and its parts) are exported from `sygnal`, and the `sygnal/diagnostics` entry ships its own declarations.
