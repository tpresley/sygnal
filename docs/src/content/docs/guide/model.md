---
title: Model
description: Defining state transitions with reducers
---

The `.model` property defines **what** happens for each action. It maps action names to reducers or driver commands.

## Simple State Reducers

The most common case is updating state. A function provided directly as an action value is treated as a state reducer:

```jsx
MyComponent.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  SET_NAME: (state, data) => ({ ...state, name: data })
}
```

Reducer arguments:
1. `state` — The current component state
2. `data` — The value emitted by the triggering stream in intent
3. `next` — A function to trigger other actions (see [Chaining Actions](#chaining-actions))
4. `extra` — An object containing `{ context, props, children }`

## Multi-Driver Actions

When an action needs to do more than just update state, use an object to specify multiple driver sinks:

```jsx
MyComponent.model = {
  SAVE: {
    STATE: (state, data) => ({ ...state, saved: true }),
    LOG: (state, data) => `Saved: ${JSON.stringify(data)}`,
    EVENTS: (state, data) => ({ type: 'saved', data })
  }
}
```

## Passthrough with `true`

Setting a driver sink to `true` passes the intent data through as-is:

```jsx
MyComponent.model = {
  LOG_DATA: {
    LOG: true  // passes whatever data came from intent directly to LOG
  }
}
```

## Chaining Actions with `next()`

The `next()` function (third argument to any reducer) lets you trigger other actions:

```jsx
MyComponent.model = {
  SUBMIT: (state, data, next) => {
    // Trigger VALIDATE after this action completes
    next('VALIDATE', data)
    return { ...state, submitting: true }
  },

  // next() with a delay (in milliseconds)
  START: (state, data, next) => {
    next('DELAYED_ACTION', null, 1000)  // fires after 1 second
    return state
  },

  VALIDATE: (state, data) => {
    // handle validation
    return { ...state, valid: true }
  }
}
```

You can call `next()` multiple times in a single reducer, and optionally add a delay as the third argument.

## Aborting an Action

Import `ABORT` from Sygnal and return it to cancel a state update:

```jsx
import { ABORT } from 'sygnal'

MyComponent.model = {
  MOVE: (state, data) => {
    if (state.locked) return ABORT  // skip this action entirely
    return { ...state, position: data }
  }
}
```

## Built-in Actions

Sygnal provides three built-in actions that fire automatically:

| Action | When It Fires |
|--------|---------------|
| `BOOTSTRAP` | Once when the component is first instantiated (similar to React's `useEffect(() => {}, [])`) |
| `INITIALIZE` | When the component receives its first state |
| `HYDRATE` | When the component receives its first state during HMR |

```jsx
MyComponent.model = {
  BOOTSTRAP: {
    LOG: () => 'Component mounted!',
    STATE: (state, data, next) => {
      next('LOAD_DATA')
      return state
    }
  },
  INITIALIZE: (state) => {
    // runs once when state is first available
    return state
  }
}
```
