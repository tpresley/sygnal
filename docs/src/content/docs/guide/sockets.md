---
title: Sockets
description: WebSocket and server-sent events with makeSocketDriver() and the connections static
---

`makeSocketDriver()` handles WebSocket and server-sent events (SSE). A component declares its connections as a function of its state, and their events arrive as the actions it names. Register the driver once in `main.js`:

```javascript
import { run, makeSocketDriver } from 'sygnal'
import App from './App.jsx'

run(App, { WS: makeSocketDriver() })
```

## Declaring Connections

A component's `connections` static maps its state to the connections it wants open:

```jsx
import { ABORT } from 'sygnal'

function Chat({ state }) {
  return (
    <div>
      <p className="status">{state.status}</p>
      <ul>{state.messages.map(m => <li>{m.text}</li>)}</ul>
      <input className="draft" aria-label="Message" value={state.draft} />
      <button className="send">Send</button>
      <button className="leave">Leave</button>
    </div>
  )
}
Chat.initialState = { room: 'general', status: 'connecting', messages: [], draft: '' }
Chat.connections = (state) => ({   // derived from state: diffed by name
  room: state.room && {
    socket: `/ws/rooms/${state.room}`,
    message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
    reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false },   // a fixed 1 s retry
  },
})
Chat.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), SEND: DOM.click('.send'), LEAVE: DOM.click('.leave') })
Chat.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  SEND: {
    STATE: (state) => (state.draft.trim() ? { ...state, draft: '' } : ABORT),
    WS:    (state) => (state.draft.trim() ? { to: 'room', json: { text: state.draft } } : ABORT),  // queued while (re)connecting
  },
  LEAVE:     (state) => ({ ...state, room: null, status: 'offline', messages: [] }),   // closes it: no DROPPED
  RECEIVED:  (state, msg) => ({ ...state, messages: [...state.messages, msg] }),        // the JSON-parsed frame
  CONNECTED: (state) => ({ ...state, status: 'online' }),                               // data: { reconnected }
  DROPPED:   (state, { willReconnect }) => ({ ...state, status: willReconnect ? 'reconnecting' : 'offline' }),  // { code, reason, willReconnect }
}
```

The core sends the result of `connections` to the `WS` sink at startup and whenever it changes (a structurally equal result isn't sent again). The driver compares it, per component instance and connection name, with what is open:

- a new name opens a connection;
- a removed name or a falsy entry (`state.room && { … }` with no room) closes it;
- a changed URL, `protocols`, `withCredentials` or `share` closes it and opens the new one, so switching rooms is a state change;
- a change to anything else (action names, `reconnect`) applies without reconnecting;
- when the instance is removed, its connections close.

`connections` receives the state with its [calculated fields](/guide/calculated-fields/).

### Spec

| Key | Meaning |
|---|---|
| `socket` | WebSocket URL. A path (`/ws/rooms/general`) resolves against the page, with `ws:` for `http:` and `wss:` for `https:`. Prefixed with the driver's `baseUrl` unless absolute |
| `sse` | Server-sent events URL (`EventSource`), instead of `socket`. Read-only |
| `message` | Action for each incoming message. Its data is the JSON-parsed frame when it parses, else the raw data |
| `open` | Action when the connection opens, every time: `{ reconnected }` |
| `close` | Action when the connection closes or fails to open **without the app closing it**: `{ code, reason, willReconnect }` (SSE: `{ willReconnect }`) |
| `error` | Action on an error event: `{ error }` |
| `reconnect` | `false`, or `{ delayMs, maxDelayMs, jitter }` (see below) |
| `share` | Default `true`; `false` gives this connection a socket of its own |
| `protocols` | WebSocket subprotocols |
| `withCredentials` | SSE: send cookies cross-origin |
| `events` | SSE named events → actions: `{ price: 'PRICE' }` |

Every action key is optional. An event without an action name goes to the source, `WS.select(name)`, as `{ name, type, data }`.

The events reach **exactly the component instance** that declared the connection. A name with no model entry is reported as [SYG112](/reference/errors/#syg112); a spec with a `then` or `catch` key is ignored ([SYG610](/reference/errors/#syg610)).

### Closes the app makes

`close` fires only for closes the app didn't cause: a server close, a network drop, or a failed open. Leaving a room (a falsy entry), switching rooms (a new URL), removing the component, and disposing the app close the connection without a `close` action, cancel any retry, and ignore its late events. So `DROPPED` above never fires on `LEAVE`, and a status reducer needs no connection-generation ids.

## Sending

Send on one of the instance's own connections by name:

```jsx
SEND: { WS: (state, text) => ({ to: 'room', json: { text } }) }
```

- `json` is sent as `JSON.stringify(json)`; `text` and `binary` (an `ArrayBuffer`, `Blob` or typed array) are sent as they are.
- While the connection is connecting or reconnecting, sends are queued and go out when it opens (at most `queueLimit` per connection, default 100; the oldest are dropped).
- When one action both opens a connection (through state) and sends on it, the connection is declared first, so the send is queued, not lost.
- A send to a name this instance hasn't declared, to a connection that closed for good, or to an SSE connection is not sent ([SYG611](/reference/errors/#syg611)). Connection names are per instance: a parent can't send on a child's connection.

## Reconnecting

Reconnecting is on by default. After a drop, retry `n` (from 0) waits `min(maxDelayMs, delayMs * 2^n)`, varied by ±`jitter`:

| Option | Default |
|---|---|
| `delayMs` | `500` |
| `maxDelayMs` | `10000` |
| `jitter` | `0.2` (±20%); `false` or `0` for none |

A fixed delay is `{ delayMs: 1000, maxDelayMs: 1000, jitter: false }`. `reconnect: false` makes a drop final (`close` fires with `willReconnect: false`). The driver's `reconnect` option is the default for every connection, and a connection's own `reconnect` is merged over it. A successful open resets the backoff, and `open` fires with `{ reconnected: true }`.

## Hidden Pages

A component inside a hidden [Switchable](/guide/switchable/#hidden-pages-pause-connections-and-resources) page closes its connections (without a `close` action) and opens them again, as new connections, when the page is shown. Messages sent in between are not replayed. A connection the page must keep while hidden, such as a notification feed that drives a badge, sets `background: true` on its entry: `alerts: { socket: '/ws/alerts', message: 'ALERT', background: true }`.

## Sharing

Connections with the same URL (and the same `protocols` / `withCredentials`) share one socket, counted by reference: every instance that declares it gets each event, and the socket closes when the last one lets go. Several Collection items watching the same feed open one socket. `share: false` opts out.

## Server-Sent Events

An `sse` connection uses `EventSource` and is read-only:

```jsx
function Ticker({ state }) {
  return <p className="price">{state.price}</p>
}
Ticker.initialState = { price: null }
Ticker.connections = () => ({
  prices: { sse: '/events/prices', message: 'TICK', events: { 'price-update': 'PRICE' } },
})
Ticker.model = {
  TICK:  (state, data) => ({ ...state, last: data }),
  PRICE: (state, { price }) => ({ ...state, price }),      // a named event, JSON-parsed
}
```

`EventSource` retries short drops itself (`close` fires with `willReconnect: true`); the driver's `reconnect` applies when it gives up.

## Static or Model-Sent, Not Both

The `connections` static is the canonical form. A model entry can also send `{ connections: { … } }` to the sink itself (the [alternative form](/advanced/alternative-forms/#model-sent-connections)). Use one or the other in a component: each value is the instance's whole set of connections, so the static and a model-sent value replace each other's connections.

## Driver Options

```javascript
makeSocketDriver({
  baseUrl: 'https://chat.example.com',      // prefix for relative URLs
  reconnect: { maxDelayMs: 30000 },         // default for every connection (false: never)
  queueLimit: 100,                          // sends kept per connection while (re)connecting
  WebSocket: MyWebSocket,                   // default: globalThis.WebSocket, read at connect time
  EventSource: MyEventSource,               // default: globalThis.EventSource
})
```

- The `connections` static goes to the source registered by `makeSocketDriver()`. **Without that driver, nothing is opened and nothing reports it** (there is no sink name to check), so check `main.js` first when no connection opens. Tests need no driver (below).
- Server rendering opens nothing: without `WebSocket`/`EventSource`, nothing connects.
- Disposing the app closes every connection.

## Testing Without a Driver

`renderComponent` gives a component with `connections` a fake `WS` sink that runs the real driver over in-memory sockets: connections open by themselves, and the test plays the server.

```js
import { it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from 'sygnal'
import Chat from './Chat.jsx'

let t
afterEach(() => { t?.dispose(); vi.useRealTimers() })

it('chats, reconnects after a drop, and leaves', async () => {
  vi.useFakeTimers()
  t = renderComponent(Chat, { strict: true })
  await t.push('WS', { text: 'hi' })                   // a frame from the server
  expect(t.html()).toContain('<li>hi</li>')

  t.simulateEvent('.draft', 'input', { value: 'hello' })
  t.simulateEvent('.send', 'click')
  await t.next(s => s.draft === '')
  expect(t.sent('WS')).toEqual([{ to: 'room', json: { text: 'hello' } }])

  await t.drop('WS', { code: 1011 })                   // a close the app didn't make
  expect(t.state.status).toBe('reconnecting')
  await vi.advanceTimersByTimeAsync(1000)              // the fixed 1 s retry
  await t.waitForState(s => s.status === 'online')

  t.simulateEvent('.leave', 'click')
  await t.next(s => s.status === 'offline')
  expect(t.connections('WS')).toEqual([])
})
```

`t.connections`, `t.push`, `t.drop`, `t.open`, `t.sent`, the `autoConnect: false` option (to assert a "Connecting…" state) and `socketSink` are described in the [Testing guide](/integration/testing/#sockets-connections-push-drop).

## Related

- [HTTP](/guide/http/): requests with `makeFetchDriver()`
- [Custom Drivers](/guide/custom-drivers/)
