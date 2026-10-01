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

## Adding Custom Drivers

Pass additional drivers as the second argument to `run()`:

```javascript
import { run } from 'sygnal'
import RootComponent from './RootComponent.jsx'
import myCustomDriver from './drivers/myCustomDriver'

run(RootComponent, {
  CUSTOM: myCustomDriver
})
```

The driver is then available as both a source (in intent) and a sink (in model):

```jsx
MyComponent.intent = ({ DOM, CUSTOM }) => ({
  DATA_RECEIVED: CUSTOM.select('some-category')
})

MyComponent.model = {
  FETCH: {
    CUSTOM: (state) => ({ category: 'some-category', url: '/api/data' })
  }
}
```

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

## Writing a Driver from Scratch

A Cycle.js driver is a function that takes a sink stream and returns a source object:

```javascript
function myDriver(sink$) {
  // Listen to commands from the app
  sink$.addListener({
    next: (command) => {
      // Perform side effects here
      console.log('Received command:', command)
    }
  })

  // Return a source for the app to observe
  return {
    select: (type) => {
      // Return a filtered stream
    }
  }
}
```

## Using driverFromAsync()

For the common case of wrapping a Promise-returning function as a driver, use `driverFromAsync()`:

```javascript
import { driverFromAsync } from 'sygnal'

const apiDriver = driverFromAsync(
  async (url) => {
    const response = await fetch(url)
    return response.json()
  },
  {
    selector: 'endpoint',  // Property name for categorizing requests
    args: 'url',           // Property to extract as function arguments
    return: 'data',        // Property name for the return value
    pre: (incoming) => incoming,         // Pre-process incoming commands
    post: (result, incoming) => result   // Post-process results
  }
)

// Register the driver
run(RootComponent, { API: apiDriver })
```

### driverFromAsync() Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `selector` | String | `'category'` | Property used to categorize/filter responses |
| `args` | String, Array, or Function | `'value'` | How to extract function arguments from incoming commands |
| `return` | String | `'value'` | Property name to wrap the return value in |
| `pre` | Function | Identity | Pre-process incoming sink values |
| `post` | Function | Identity | Post-process results before sending to source |

### Using the Driver in Components

```jsx
// Intent — receive API responses
MyComponent.intent = ({ DOM, API }) => ({
  FETCH_USERS: DOM.click('.load-users'),
  DATA_LOADED: API.select('users'),   // Filter by the selector property
  LOAD_FAILED: API.errors('users'),   // Failed requests (see below)
})

// Model — send API requests
MyComponent.model = {
  FETCH_USERS: {
    STATE: (state) => ({ ...state, loading: true, error: null }),
    API:   () => ({ endpoint: 'users', url: '/api/users' }),
  },
  DATA_LOADED: (state, response) => ({ ...state, loading: false, users: response.data }),
  LOAD_FAILED: (state, failure) => ({ ...state, loading: false, error: String(failure.error) }),
}
```

A response is `{ [return]: value, [selector]: request[selector] }` (with the defaults, `{ value, category }`). A promise that resolves to `null` or `undefined` is delivered the same way.

### Handling Errors with `errors()`

When the function's promise rejects (or `post` throws or rejects), the failure is delivered on the source's `errors()` stream, never on `select()`:

| Call | Receives |
|---|---|
| `API.errors()` | Every failure |
| `API.errors('users')` | Failures of requests whose selector property is `'users'` |
| `API.errors(fn)` | Failures for which `fn(failure)` returns true |

Each failure is `{ error, request, [selector]: request[selector] }`: the rejection reason, the request that failed, and its selector value. Listen to `errors()` for every request that can fail, so a loading state can't hang. While nothing listens to `errors()`, failures are only logged with `console.error`.

### Only the Latest Response (Stale Requests)

Replies arrive in the order the promises settle, not the order the requests were sent. When only the newest request counts (search as you type, say), keep a request id in state, send it with the request, and `ABORT` any reply or failure whose id isn't the latest:

```jsx
import { ABORT, debounce } from 'sygnal'

function Search({ state }) {
  return (
    <div className="search">
      <input className="q" value={state.query} />
      <p className="status">{state.loading ? 'Searching…' : state.error}</p>
      <ul className="results">{state.results.map((r) => <li>{r.title}</li>)}</ul>
    </div>
  )
}
Search.initialState = { query: '', reqId: 0, loading: false, error: '', results: [] }
Search.intent = ({ DOM, SEARCH }) => {
  const query$ = DOM.input('.q').value()
  return {
    TYPE:    query$,
    SEARCH:  query$.compose(debounce(300)).filter((q) => q !== ''),
    RESULTS: SEARCH.select('search'),   // { category, value: { id, results } }
    FAILED:  SEARCH.errors('search'),   // { error, category, request }
  }
}
Search.model = {
  TYPE: (state, query) => query === ''
    ? { ...state, query, reqId: state.reqId + 1, loading: false, error: '', results: [] }  // also drops the request in flight
    : { ...state, query },
  SEARCH: {
    STATE:  (state) => ({ ...state, reqId: state.reqId + 1, loading: true, error: '' }),
    SEARCH: (state, q) => ({ category: 'search', value: { id: state.reqId + 1, q } }),  // sinks see the state before STATE
  },
  RESULTS: (state, { value }) =>
    value.id !== state.reqId ? ABORT : { ...state, loading: false, results: value.results },
  FAILED: (state, { request }) =>
    request.value.id !== state.reqId ? ABORT : { ...state, loading: false, error: 'Search failed.' },
}
```

```js
// main.js: the driver echoes the id back with the result
import { run, driverFromAsync } from 'sygnal'
import Search from './Search.jsx'

const search = async ({ id, q }) => {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)   // goes to errors()
  return { id, results: (await res.json()).results }
}
run(Search, { SEARCH: driverFromAsync(search) })
```

- The `SEARCH` sink computes `state.reqId + 1` because every sink of an entry sees the state from **before** this action (see [Model](/guide/model/#sinks-see-the-state-before-the-action)).
- A failure carries the original `request`, so `request.value.id` identifies it without the driver's help.
- Clearing the input bumps `reqId` too, so a reply to a request sent before the clear is ignored.
- In a test, pass a driver whose promises you resolve by hand (`drivers: { SEARCH: driverFromAsync(fn) }`) and resolve them out of order.
