---
title: Model
description: Defining state transitions with reducers
---

The `.model` property defines **what** happens for each action. It maps action names (the keys your [intent](/guide/intent/) returns) to reducers. Every intent action needs a model entry with the same name, and every model entry needs something that triggers it; otherwise Sygnal reports [SYG101](/reference/errors/#syg101) or [SYG102](/reference/errors/#syg102) in dev.

## State Reducers

The most common case is updating state. A function given directly as the entry is a **STATE reducer**: it receives the current state and returns the new one.

```jsx
MyComponent.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  SET_NAME:  (state, name) => ({ ...state, name }),
}
```

Always return a new object and spread the previous state. A reducer that drops keys is reported as [SYG201](/reference/errors/#syg201), and one that changes the state in place as [SYG222](#aborting-an-action).

Every reducer receives four arguments:

1. `state`: the current component state (including [calculated fields](/guide/calculated-fields/))
2. `data`: the value emitted by the action's stream in intent
3. `next`: a function that dispatches another action (see [Chaining Actions](#chaining-actions-with-next))
4. `props`: the props the parent passed, plus `context`, `children`, `slots` and [`uid`](/guide/inputs/#labels-and-ids-uid)

```jsx
Item.model = {
  SELECT: (state, data, next, props) => ({ ...state, selected: props.selectedId === state.id }),
}
```

The `set()` and `toggle()` helpers build common STATE reducers:

```jsx
import { set, toggle } from 'sygnal'

Panel.model = {
  OPEN:        set({ isOpen: true }),
  RENAME:      set((state, title) => ({ title })),
  TOGGLE_HELP: toggle('showHelp'),
}
```

`set()` takes an object or a function, never a field name: `set('title')` doesn't store the action data in `title` ([SYG221](/reference/errors/#syg221)). Use `set((state, title) => ({ title }))`.

## Aborting an Action

Return `ABORT` from a STATE reducer to mean "no change". The state update is skipped entirely:

```jsx
import { ABORT } from 'sygnal'

MyComponent.model = {
  MOVE: (state, position) => state.locked ? ABORT : { ...state, position },
}
```

Returning the state object the reducer received means the same thing: no state is emitted and nothing re-renders, so `(state, x) => x ? { ...state, x } : state` is a no-op when `x` is empty. The docs use `ABORT` because it says so explicitly. (Before 6.0, returning `state` produced a new state and strict mode flagged it as SYG502; that rule is retired.) One exception to "nothing re-renders": an action triggered by typing in a field (an `input` or `change` event) re-renders its component, so a controlled field that the reducer refused shows the state's value again (see [Controlled Inputs](/guide/inputs/#controlled-inputs)).

Because the same object means "no change", a reducer that changes the state in place and returns it has no effect. In dev, Sygnal reports that as [SYG222](/reference/errors/#syg222). Return a new object:

```jsx
Todo.model = {
  // SYG222: the same object comes back, so the change is ignored
  // DONE: (state) => { state.done = true; return state },
  DONE: (state) => ({ ...state, done: true }),
}
```

Returning `undefined` is different: in a [Collection](/guide/collections/#self-removal) item it removes the item, and in a root component it wipes the state ([SYG202](/reference/errors/#syg202)).

### Writing updates as mutations with Immer

Deep updates by spreading get long. [Immer](https://immerjs.github.io/immer/)'s curried `produce()` lets you write them as mutations of a draft, and returns a new object, or the original one when the recipe changed nothing, which Sygnal then treats as "no change". A `produce()` recipe is a STATE reducer as it is:

```jsx
import { produce } from 'immer'

Todos.model = {
  ADD: produce((draft, text) => {
    draft.todos.push({ id: draft.nextId, text, done: false })
    draft.nextId += 1
  }),
  TOGGLE: produce((draft, id) => {
    const todo = draft.todos.find(t => t.id === id)
    if (todo) todo.done = !todo.done
  }),
}
```

The recipe gets the reducer's arguments: `(draft, data, next, props)`. Immer is not bundled with Sygnal; install it yourself (`npm install immer`). By default Immer freezes the objects it returns, so another reducer that changes them in place throws instead of being silently ignored.

## Driver Sinks: the Object Form

When an action does more than update state, give the entry an object whose keys are **sinks**. Each sink gets its own reducer, with the same four arguments:

```jsx
import { event } from 'sygnal'

MyComponent.model = {
  SAVE: {
    STATE:  (state) => ({ ...state, saved: true }),
    EVENTS: event('SAVED', (state) => ({ id: state.id })),
    LOG:    (state) => `Saved ${state.id}`,
  },
}
```

Use the object form even for a single non-STATE sink:

```jsx
TaskCard.model = {
  DELETE: {
    PARENT: (state) => ({ taskId: state.id }),
  },
}
```

The built-in sinks are:

| Sink | Sends |
|---|---|
| `STATE` | The new state (same as a plain reducer) |
| `EVENTS` | A global event, usually built with `event()` (see below) |
| `PARENT` | A value to the parent component (see [Parent-Child Communication](/guide/parent-child/)) |
| `EFFECT` | Nothing; runs a side effect (see below) |
| `READY` | A readiness flag for [Suspense](/advanced/suspense/) |
| `LOG` | Any value, logged to the console |

Any custom driver passed to `run()` is a sink as well, by its name (for example `API` or `DND`).

A non-STATE reducer can return `ABORT` to send nothing.

### Choosing the State Seen by Sinks

**Sygnal 7 defaults to updated-state outputs.** No configuration is needed:

```js
run(App, drivers)
```

STATE runs once first, regardless of its position in the model entry. Other sinks receive the
same committed state, including calculated fields; effects still run synchronously and the DOM
patch follows the action. ABORT means no state change, not cancellation of the other sinks.

```jsx
Counter.model = {
  INC: {
    STATE: (state) => ({ ...state, count: state.count + 1 }),
    PARENT: (state) => ({ count: state.count }),
    EFFECT: (state, data, next, { previousState }) => {
      console.log(previousState.count, '→', state.count)
    },
  },
}
```

This is a breaking change from 6.x, where every reducer received pre-action state. Upgrading
requires auditing outputs that already compute the update themselves: `state.count + 1` would
increment twice in a notification. Use `props.previousState` when a deletion, cancellation or
comparison needs the old value; `props.state` matches the handler's selected snapshot.

A library declares its contract with `Counter.sinkState = 'after'` or
`defineBehavior({ sinkState: 'before', ... })`. Explicit declarations win over inherited app/host
settings; parent component declarations do not cascade to children. Undeclared old libraries
inherit defaults and need an audit. Built-in behaviors retain their existing before contract.
Behavior handlers receive a slice while `props.state` and `props.previousState` are host state.

For an action with any after-state output, the composed STATE transition completes before all
outputs. Outputs retain their relative order and each contributor gets its declared snapshot.
Here `'before'` selects the old snapshot; it does not promise execution before STATE. A grouped
behavior/host EFFECT retains its order and exception boundary. All-before actions retain their
legacy model ordering. A failed STATE reducer leaves state unchanged and other handlers still run;
this is not a transaction rollback guarantee for throwing custom lens setters.

### Sinks See the State Before the Action

This is the compatibility mode: `run(App, drivers, { sinkState: 'before' })`. Outputs receive the
pre-action state and must compute a new value from `(state, data)` themselves. Prefer after for new
apps. If you select the compatibility mode, match it in
`renderComponent(C, { sinkState: 'before' })`. These options and `previousState` require 7.x;
see [Migrating to 7.0](/guide/migrating-to-7/).

## Emitting Events with `event()`

`event(type, payload?)` returns an `EVENTS` sink function that puts `{ type, data }` on the global event bus:

```jsx
import { event } from 'sygnal'

Lane.model = {
  DELETE_LANE: {
    STATE:  (state) => ({ ...state, deleting: true }),
    EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })),
  },
  RESET_ALL: {
    EVENTS: event('RESET'),                 // no payload
  },
  DARK_MODE: {
    EVENTS: event('SET_THEME', 'dark'),     // static payload
  },
}
```

The payload function receives the reducer arguments `(state, data, next, props)`, and returns `ABORT` to send no event this time: `event('SAVED', (state) => (state.dirty ? { id: state.id } : ABORT))`. Any component receives the event with `EVENTS.select('DELETE_LANE')` in its intent. With TypeScript, the [`SygnalEvents` registry](/integration/typescript/#typed-events) checks event names and payloads.

## Side Effects with `EFFECT`

The `EFFECT` sink runs a function for its side effect only: no state change, nothing sent to a driver.

```jsx
App.model = {
  PLAY: {
    EFFECT: () => playerCmd.send('play'),
  },
  ROUTE: {
    EFFECT: (state, data, next) => next(state.mode === 'a' ? 'DO_A' : 'DO_B', data),
  },
}
```

Don't return a value from an `EFFECT` handler (it's ignored, and Sygnal warns with [SYG219](/reference/errors/#syg219)). See [Effect Handlers](/advanced/effect/).

## Passthrough with `true`

Setting a sink to `true` sends the action's data as-is:

```jsx
MyComponent.model = {
  LOG_DATA: {
    LOG: true,
  },
}
```

## Chaining Actions with `next()`

`next(action, data?, delay?)` dispatches another action of the same component. Call it from an `EFFECT` handler, or from a STATE reducer that also changes state:

```jsx
MyComponent.model = {
  SUBMIT: (state, data, next) => {
    next('VALIDATE', data)
    return { ...state, submitting: true }
  },

  START: {
    EFFECT: (state, data, next) => next('TICK', null, 1000),   // after 1 second
  },

  VALIDATE: (state, data) => ({ ...state, valid: Boolean(data) }),
  TICK:     (state) => ({ ...state, ticks: state.ticks + 1 }),
}
```

Without a delay, the follow-up action runs about 10 ms later. You can call `next()` several times in one reducer. The delay must be a number of milliseconds ([SYG215](/reference/errors/#syg215)).

## Built-in Actions

Sygnal dispatches these actions itself; add a model entry to react to them:

| Action | When It Fires |
|--------|---------------|
| `BOOTSTRAP` | Once, when the component is instantiated (like React's `useEffect(() => {}, [])`) |
| `INITIALIZE` | When the component receives its first state. STATE sink only ([SYG210](/reference/errors/#syg210)) |
| `DISPOSE` | When the component is about to unmount (see [Disposal Hooks](/advanced/disposal/)) |

`HYDRATE` is no longer a built-in action (6.0): nothing dispatches it, and it is an ordinary action name. Server data reaches the state through Vike's [`+data`](/integration/vike/) or the [`hydrateState`](/integration/ssr/) option.

```jsx
MyComponent.model = {
  BOOTSTRAP: {
    LOG:    () => 'Component mounted!',
    EFFECT: (state, data, next) => next('LOAD_DATA'),
  },
  INITIALIZE: (state) => ({ ...state, startedAt: Date.now() }),
  DISPOSE: {
    EFFECT: () => console.log('Component unmounting'),
  },
}
```
