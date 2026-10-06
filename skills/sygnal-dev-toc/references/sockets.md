# WebSocket / SSE: makeSocketDriver + connections

```jsx
Chat.initialState = { room: 'general', status: 'connecting', messages: [] }
Chat.connections = (state) => ({   // from state, diffed by name: new opens, falsy/removed closes, changed URL reconnects
  room: state.room && { socket: `/ws/rooms/${state.room}`, message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
    reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false } },   // fixed 1 s retry (default: 500 ms doubling to 10 s)
})
Chat.model = {
  JOIN:      (state, room) => room === state.room ? ABORT : { ...state, room, status: 'connecting', messages: [] },  // same room: no new `open`
  SAY:       { WS: (state, text) => text.trim() ? { to: 'room', json: { text } } : ABORT },   // queued while (re)connecting
  LEAVE:     (state) => ({ ...state, room: null, status: 'offline', messages: [] }),     // closes it: no DROPPED
  RECEIVED:  (state, msg) => ({ ...state, messages: [...state.messages, msg] }),          // the JSON-parsed frame
  CONNECTED: (state) => ({ ...state, status: 'online' }),                                 // { reconnected }
  DROPPED:   (state, { willReconnect }) => ({ ...state, status: willReconnect ? 'reconnecting' : 'offline' }),
}
```
- main.js: `run(Chat, { WS: makeSocketDriver() })`; without it nothing opens, silently. Spec: `socket` or `sse` (read-only; `events: { 'price-update': 'PRICE' }`), optional `message open close error` actions, `reconnect` (`false` = never), `share` (default: one socket per URL). `close` fires only for drops the app didn't cause (leaving, a URL change and unmount close silently), so no connection ids. `{ to }` on an undeclared, closed or SSE connection is SYG611. Guide: https://sygnal.js.org/guide/sockets/
- A hidden Switchable page pauses its connections and resources; `background: true` on an entry keeps it live.
