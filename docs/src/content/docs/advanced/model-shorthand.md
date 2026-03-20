---
title: "Model Shorthand"
description: "Compact syntax for single-driver model entries"
---

When a model entry targets a single non-state sink, use the `'ACTION | DRIVER'` shorthand instead of a nested object:

```jsx
App.model = {
  // Shorthand
  'SEND_CMD | EFFECT': () => playerCmd.send('play'),

  // Equivalent longhand
  SEND_CMD: {
    EFFECT: () => playerCmd.send('play'),
  },
}
```

## Syntax

The key format is `'ACTION | DRIVER'` — the action name, a pipe `|` character, and the driver/sink name, with optional whitespace around the pipe. Since `|` is not valid in unquoted JavaScript identifiers, the key must be a quoted string.

```jsx
App.model = {
  'NOTIFY | EVENTS': (state) => ({ type: 'alert', data: state.message }),
  'DELETE | PARENT': (state) => ({ type: 'DELETE', id: state.id }),
  'TRACK | EFFECT':  (state) => analytics.track(state.page),
}
```

## Works with All Sinks

The shorthand works with any sink — built-in or custom drivers:

```jsx
App.model = {
  // Built-in sinks
  'PLAY | EFFECT':    () => playerCmd.send('play'),
  'ALERT | EVENTS':   (state) => ({ type: 'notification', data: state.msg }),
  'REMOVE | PARENT':  (state) => ({ type: 'REMOVE', id: state.id }),
  'LOADED | READY':   () => true,

  // Custom drivers
  'FETCH | HTTP':     (state) => ({ url: `/api/items/${state.id}` }),
  'SEND | WEBSOCKET': (state) => ({ type: 'message', data: state.input }),
}
```

## Mixing Shorthand and Longhand

You can freely mix shorthand and longhand entries in the same model:

```jsx
App.model = {
  // Regular state reducer (no shorthand needed)
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),

  // Shorthand for single-driver actions
  'NOTIFY | EVENTS': (state) => ({ type: 'counted', data: state.count }),

  // Longhand for multi-driver actions
  SUBMIT: {
    STATE:  (state) => ({ ...state, submitting: true }),
    EFFECT: () => formCmd.send('validate'),
    EVENTS: (state) => ({ type: 'submit', data: state.form }),
  },
}
```

## Intent Validation

Action names in `.intent` must not contain the `|` character. If they do, Sygnal throws an error at component initialization to prevent ambiguity:

```jsx
// ❌ This will throw
App.intent = ({ DOM }) => ({
  'MY | ACTION': DOM.select('.btn').events('click'),  // Error!
})
```
