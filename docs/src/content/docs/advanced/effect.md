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

Before `EFFECT`, a side-effect-only entry had to be a `STATE` reducer that ran the effect and returned `ABORT` to skip the state update. That still works, but [strict mode](/guide/strict-mode/) flags it ([SYG503](/reference/errors/#syg503)): `EFFECT` makes the intent explicit, so STATE reducers stay pure. `ABORT` remains the canonical way for a STATE reducer to say "no change" (see [Model](/guide/model/#aborting-an-action)).

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
import { event } from 'sygnal'

App.model = {
  SUBMIT: {
    STATE:  (state) => ({ ...state, submitting: true }),
    EFFECT: () => analyticsCmd.send('track', { event: 'submit' }),
    EVENTS: event('FORM_SUBMITTED', (state) => state.formData),
  },
}
```

Every sink of one action receives the same state: the result of all earlier actions, before this action's own `STATE` reducer runs. So `EFFECT` and `EVENTS` above see `submitting` as it was, not `true`. Pass anything they need through the action's data, or compute it from the same inputs.

## Return Value Warning

EFFECT handlers should not return a value — any return value is ignored. If a value is returned, a console warning ([SYG219](/reference/errors/#syg219)) is emitted to help catch mistakes where a reducer was accidentally placed in an EFFECT sink instead of a STATE sink. An arrow function with an expression body returns its value, so wrap a call that returns something (such as a Promise) in braces: `EFFECT: () => { player.play() }`.

```jsx
// ⚠️ This will log a warning — the returned state is ignored
App.model = {
  BROKEN: {
    EFFECT: (state) => ({ ...state, count: state.count + 1 }),
  },
}
```
