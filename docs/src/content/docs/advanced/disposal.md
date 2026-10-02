---
title: "Disposal Hooks"
description: "Cleanup on component unmount"
---

Run cleanup logic when components unmount — clear timers, disconnect observers, release resources a component opened itself.

Driver work is cleaned up for you: a removed component's routed HTTP requests are aborted, the connections it declared with [`connections`](/guide/sockets/) close (with no `close` action), and an `async` [EFFECT](/advanced/effect/#async-work-that-isnt-http) gets an aborted `signal`.

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
import { event } from 'sygnal'

// Tell the rest of the app that this card is going away
TaskCard.model = {
  DISPOSE: {
    EVENTS: event('CARD_REMOVED', (state) => state.id),
  },
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

Disposal is recursive: when an item is removed, every component inside it is disposed too, including nested Collections and Switchables (a removed lane disposes all of its cards). Disposal runs synchronously when the parent re-renders without the child, and each component is disposed at most once.

Under [`renderComponent()`](/integration/testing/), `t.dispose()` disposes the whole tree, so `DISPOSE` entries of children run as well.
