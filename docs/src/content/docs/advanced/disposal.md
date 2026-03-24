---
title: "Disposal Hooks"
description: "Cleanup on component unmount"
---

Run cleanup logic when components unmount — close WebSocket connections, clear timers, disconnect observers.

## The `DISPOSE` Action

The simplest way to handle component cleanup. Define a `DISPOSE` entry in the model — it fires automatically when the component is about to be removed from the DOM:

```jsx
function LiveFeed({ state }) {
  return <div>{state.messages.length} messages</div>
}

LiveFeed.model = {
  NEW_MESSAGE: (state, msg) => ({
    ...state,
    messages: [...state.messages, msg],
  }),
  DISPOSE: {
    EFFECT: () => console.log('LiveFeed unmounting'),
  },
}
```

`DISPOSE` works with all sinks — EFFECT for side effects, EVENTS to notify parent components, PARENT for one-level communication, and even STATE (though state changes during disposal are unlikely to render).

```jsx
// Notify parent that this component is going away
TaskCard.model = {
  DISPOSE: {
    EVENTS: (state) => ({ type: 'CARD_REMOVED', data: state.id }),
  },
}

// Or using model shorthand
TaskCard.model = {
  'DISPOSE | EVENTS': (state) => ({ type: 'CARD_REMOVED', data: state.id }),
}
```

The DISPOSE reducer receives the current state, so you can read component data during cleanup:

```jsx
Timer.model = {
  DISPOSE: {
    EFFECT: (state) => {
      clearInterval(state.intervalId)
    },
  },
}
```

## The `dispose$` Source (Advanced)

For cases that need stream composition, the `dispose$` source is available in intent. It emits `true` once when the component unmounts:

```jsx
LiveFeed.intent = ({ DOM, dispose$ }) => ({
  CLEANUP: dispose$,
})

LiveFeed.model = {
  CLEANUP: {
    WEBSOCKET: () => ({ type: 'close' }),
  },
}
```

Use `dispose$` when you need to combine disposal with other streams (e.g., debouncing, merging with other lifecycle events). For most cleanup tasks, the `DISPOSE` model action is simpler and preferred.

## Collection Item Disposal

Collection items are automatically disposed when removed from the state array. Each item's `DISPOSE` action (and `dispose$` stream) fires independently.
