---
title: Drivers
description: Side effects and custom driver creation
---

Drivers handle all side effects in a Sygnal application. They are the bridge between your pure component code and the outside world.

Every driver has two sides:
- **Source** — Provides data *to* your component (e.g., DOM events, API responses)
- **Sink** — Receives commands *from* your component (e.g., state updates, log messages)

## Default Drivers

Sygnal's `run()` function automatically includes these drivers:

| Driver / Source | Source (in intent) | Sink (in model) |
|--------|--------|------|
| `DOM` | `.select(css).events(event)` or shorthand `.click(css)` | Handled automatically by the view |
| `STATE` | `.stream` — The state Observable | Reducer functions from model |
| `EVENTS` | `.select(type)` — Custom event bus | Events, built with `event('TYPE', payload)` |
| `CHILD` | `.select(ComponentFn)` — Events from child components | — |
| `PARENT` | — | Values sent to the parent component |
| `EFFECT` | — | Side effects only; sends nothing (see [Effect Handlers](/advanced/effect/)) |
| `READY` | — | Boolean signal for [Suspense](/advanced/suspense/) boundaries |
| `LOG` | — | Any value — logged to the console |
| `props$` | Stream of props passed from the parent | — |
| `children$` | Stream of children passed from the parent | — |
| `context$` | Stream of merged [context](/guide/context/) values from ancestors | — |
| `dispose$` | Emits `true` once on [unmount](/advanced/disposal/) | — |

## Adding Drivers

Pass additional drivers as the second argument to `run()`. Each one is then a source (in intent) and a sink (in model) under that name:

```javascript
import { run, makeFetchDriver, makeSocketDriver } from 'sygnal'
import App from './App.jsx'

run(App, {
  HTTP: makeFetchDriver(),
  WS:   makeSocketDriver(),
})
```

Drivers are registered explicitly, so an app only ships the ones it uses. A sink or source with no driver is reported as [SYG609](/reference/errors/#syg609) (with the dev diagnostics on). In tests, `renderComponent` needs no drivers: a driver you don't pass is replaced by a fake you answer from the test ([Testing](/integration/testing/#answering-requests-respond-and-fail)).

| Driver | For | Guide |
|---|---|---|
| `makeFetchDriver()` | HTTP requests; replies arrive as the actions the request names | [HTTP](/guide/http/) |
| `makeSocketDriver()` | WebSocket and server-sent events, declared with the `connections` static | [Sockets](/guide/sockets/) |
| `driverFromAsync(fn)` | Any other promise-returning function | [Custom Drivers](/guide/custom-drivers/) |
| your own | Anything else: a function `sink$ => source` | [Custom Drivers](/guide/custom-drivers/#writing-a-driver-from-scratch) |

## HTTP Requests with makeFetchDriver()

A model entry sends a request and names the actions that receive the reply; the intent has no line for it:

```jsx
Quote.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    HTTP:  (state, id) => ({ url: `/api/quotes/${id}`, ok: 'LOADED', error: 'FAILED', latest: true }),
  },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote }),                       // the parsed body
  FAILED: (state, { status, error }) => ({ ...state, status: status === 404 ? 'missing' : 'error' }),
}
```

The full guide (latest-only requests, aborting, the request fields, testing) is on the [HTTP](/guide/http/) page.

## WebSocket and Server-Sent Events

A component declares its connections as a function of its state, and their events arrive as the actions it names:

```jsx
Chat.connections = (state) => ({
  room: state.room && { socket: `/ws/rooms/${state.room}`, message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED' },
})
Chat.model = {
  SAY:       { WS: (state, text) => ({ to: 'room', json: { text } }) },
  RECEIVED:  (state, msg) => ({ ...state, messages: [...state.messages, msg] }),
  CONNECTED: (state) => ({ ...state, online: true }),
  DROPPED:   (state) => ({ ...state, online: false }),
}
```

See [Sockets](/guide/sockets/).

## The Event Bus (EVENTS Driver)

The EVENTS driver provides a lightweight pub/sub system for communication between components that aren't parent and child:

```jsx
import { event } from 'sygnal'

// Publishing events (in model)
Publisher.model = {
  NOTIFY: {
    EVENTS: event('NOTIFICATION', (state) => ({ message: state.message })),
  },
}

// Subscribing to events (in intent): the stream emits the event's data
Subscriber.intent = ({ EVENTS }) => ({
  HANDLE_NOTIFICATION: EVENTS.select('NOTIFICATION'),
})
```

The bus is global (it isn't isolated per component) and a broadcast: every component that selects a type receives it, and an event nobody selects is dropped. A type that is emitted but never selected, or selected but never emitted, is reported as [SYG105](/reference/errors/#syg105), which usually means a typo. With TypeScript, the [`SygnalEvents` registry](/integration/typescript/#typed-events) checks names and payloads.

## The LOG Driver

The LOG driver sends values to the browser console:

```jsx
MyComponent.model = {
  SOME_ACTION: {
    STATE: (state) => ({ ...state, updated: true }),
    LOG: (state, data) => `Action triggered with: ${data}`
  }
}
```
