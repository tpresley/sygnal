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

Always return a new object and spread the previous state. A reducer that drops keys is reported as [SYG201](/reference/errors/#syg201).

Every reducer receives four arguments:

1. `state`: the current component state (including [calculated fields](/guide/calculated-fields/))
2. `data`: the value emitted by the action's stream in intent
3. `next`: a function that dispatches another action (see [Chaining Actions](#chaining-actions-with-next))
4. `props`: the props the parent passed, plus `context`, `children` and `slots`

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

## Aborting an Action

Return `ABORT` from a STATE reducer to mean "no change". The state update is skipped entirely:

```jsx
import { ABORT } from 'sygnal'

MyComponent.model = {
  MOVE: (state, position) => state.locked ? ABORT : { ...state, position },
}
```

Use `ABORT` rather than returning `state` unchanged; [strict mode](/guide/strict-mode/) flags the latter ([SYG502](/reference/errors/#syg502)). Returning `undefined` is different: in a [Collection](/guide/collections/#self-removal) item it removes the item, and in a root component it wipes the state ([SYG202](/reference/errors/#syg202)).

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

### Sinks See the State Before the Action

Every sink of one action receives the same `state`: the result of all earlier actions, before this action's own `STATE` reducer runs. `EVENTS`, `PARENT`, `EFFECT` and driver sinks never see what `STATE` returns for the same action. To send the updated value, compute it from `(state, data)` inside the sink:

```jsx
import { event } from 'sygnal'

Counter.model = {
  INC: {
    STATE:  (state) => ({ ...state, count: state.count + 1 }),
    EVENTS: event('COUNT_CHANGED', (state) => ({ count: state.count + 1 })),  // not state.count: that's the old value
    PARENT: (state, data, next, props) => ({ id: props.id, count: state.count + 1 }),
  },
}
```

If several sinks need the same derived value, put it in a helper function that each of them calls with `(state, data)`.

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

The payload function receives the reducer arguments `(state, data, next, props)`. Any component receives the event with `EVENTS.select('DELETE_LANE')` in its intent. With TypeScript, the [`SygnalEvents` registry](/integration/typescript/#typed-events) checks event names and payloads.

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
| `HYDRATE` | When the component receives its first state during HMR |
| `DISPOSE` | When the component is about to unmount (see [Disposal Hooks](/advanced/disposal/)) |

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
