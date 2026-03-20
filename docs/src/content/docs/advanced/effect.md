---
title: "Effect Handlers"
description: "Run side effects in model entries without changing state"
---

Use the `EFFECT` sink for model entries that only need to run side effects — sending commands, calling `next()`, triggering external APIs — without producing a state change or emitting to any driver.

```jsx
App.model = {
  SEND_COMMAND: {
    EFFECT: () => playerCmd.send('play'),
  },
}
```

## Why EFFECT?

Previously, side-effect-only model entries required a `STATE` reducer that returned `ABORT` to suppress the state update:

```jsx
// Old pattern — works but misleading
App.model = {
  SEND_COMMAND: () => { playerCmd.send('play'); return ABORT },
}
```

`EFFECT` makes the intent explicit: this action has side effects and nothing else.

## Using next()

EFFECT handlers receive the same arguments as regular reducers — `(state, data, next, props)` — so you can use `next()` to dispatch follow-up actions:

```jsx
App.model = {
  ROUTE: {
    EFFECT: (state, data, next) => {
      if (state.mode === 'a') next('DO_A', data)
      else next('DO_B', data)
    },
  },
  DO_A: (state, data) => ({ ...state, resultA: data }),
  DO_B: (state, data) => ({ ...state, resultB: data }),
}
```

## Reading State

The current state (including calculated fields) is available as the first argument, just like regular reducers:

```jsx
App.model = {
  LOG_STATE: {
    EFFECT: (state) => {
      analytics.track('page_view', { page: state.currentPage })
    },
  },
}
```

## Combining with Other Sinks

EFFECT can be combined with other sinks in the same action to run side effects alongside state updates or driver emissions:

```jsx
App.model = {
  SUBMIT: {
    STATE: (state) => ({ ...state, submitting: true }),
    EFFECT: (state) => analyticsCmd.send('track', { event: 'submit' }),
    EVENTS: (state) => ({ type: 'form-submitted', data: state.formData }),
  },
}
```

## Return Value Warning

EFFECT handlers should not return a value — any return value is ignored. If a value is returned, a console warning is emitted to help catch mistakes where a reducer was accidentally placed in an EFFECT sink instead of a STATE sink.

```jsx
// ⚠️ This will log a warning — the returned state is ignored
App.model = {
  BROKEN: {
    EFFECT: (state) => ({ ...state, count: state.count + 1 }),
  },
}
```
