---
title: "Disposal Hooks"
description: "Cleanup on component unmount"
---

Run cleanup logic when components unmount — close WebSocket connections, clear timers, disconnect observers.

## The `dispose$` Source

Every component's intent function receives a `dispose$` stream that emits `true` once when the component is being removed from the DOM:

```jsx
function LiveFeed({ state }) {
  return <div>{state.messages.length} messages</div>
}

LiveFeed.intent = ({ DOM, dispose$ }) => ({
  NEW_MESSAGE: /* stream from WebSocket driver */,
  CLEANUP: dispose$,
})

LiveFeed.model = {
  NEW_MESSAGE: (state, msg) => ({
    ...state,
    messages: [...state.messages, msg],
  }),
  CLEANUP: {
    WEBSOCKET: () => ({ type: 'close' }),  // Send close command to driver
  },
}
```

Internal subscriptions (context, sub-component sinks) are automatically cleaned up on disposal. The `dispose$` stream is for user-defined cleanup like closing external connections.

## Collection Item Disposal

Collection items are automatically disposed when removed from the state array. Each item's `dispose$` fires independently.
