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

## HTTP Requests with makeFetchDriver()

For HTTP, use the built-in fetch driver instead of calling `fetch` in a component. Register it once in `main.js`:

```javascript
import { run, makeFetchDriver } from 'sygnal'
import App from './App.jsx'

run(App, { HTTP: makeFetchDriver() })
```

The model sends a request to the `HTTP` sink; the intent reads the replies from the `HTTP` source by `category`:

```jsx
function Quote({ state }) {
  return (
    <div className="quote">
      <button className="get">Get a quote</button>
      <p className="text">{state.status === 'loading' ? 'Loading…' : state.error || state.text}</p>
    </div>
  )
}
Quote.initialState = { status: 'idle', text: '', error: '' }
Quote.intent = ({ DOM, HTTP }) => ({
  LOAD:   DOM.click('.get'),
  LOADED: HTTP.select('quote'),   // { category, value, status, request }
  FAILED: HTTP.errors('quote'),   // { error, category, request, status, body }
})
Quote.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading', error: '' }),
    HTTP:  () => ({ category: 'quote', url: '/api/quote' }),
  },
  LOADED: (state, { value }) => ({ ...state, status: 'idle', text: `${value.text} — ${value.author}` }),
  FAILED: (state, { status }) => ({ ...state, status: 'idle', error: status === 404 ? 'No quote today.' : 'Could not load a quote.' }),
}
```

### Requests

A request is an object (or a URL string, for a plain GET):

| Field | Default | Meaning |
|---|---|---|
| `url` | (required) | The URL, prefixed with the driver's `baseUrl` |
| `category` | `undefined` | Tag that `select(category)` / `errors(category)` filter on; also the group for `latest` and `abort` |
| `method` | `'POST'` with `json`/`body`, else `'GET'` | HTTP method |
| `query` | — | Object appended as a query string: `{ q: 'dune' }` → `?q=dune` (URL-encoded; `null`/`undefined` values skipped) |
| `json` | — | Body sent as `JSON.stringify(json)` with `Content-Type: application/json` |
| `body` | — | Raw body (string, `FormData`, `Blob`, …) |
| `headers` | — | Merged over the driver's `headers` |
| `latest` | driver's `latest` (false) | Abort the requests of this category still in flight (see below) |
| `timeoutMs` | driver's `timeoutMs` (none) | Fail with a `TimeoutError` after this many ms |
| `parse` | `'auto'` | How the body becomes `value`: `'auto'` (JSON when the content-type says JSON, otherwise text; 204 → `null`), `'json'`, `'text'`, `'response'` (the `Response` itself), or a function `res => value` |

Any other field (`credentials`, `mode`, `cache`, …) is passed to `fetch()` as an init option. A sink that returns `ABORT`, `null` or `undefined` sends nothing.

### Responses and Failures

- **`HTTP.select(category)`** emits `{ category, value, status, request }` for each **2xx** response. `value` is the parsed body, `request` is the request object exactly as the model sent it, so any field you add to it (an id, the query) comes back with the reply.
- **`HTTP.errors(category)`** emits `{ error, category, request, status, body }` for everything else: a non-2xx status (`status` and the parsed `body` are set, and `error.message` is like `'HTTP 404 Not Found: /api/zip/00000'`), a network error (`status` is undefined), a body that doesn't parse, a timeout (`error.name === 'TimeoutError'`), or no `fetch` in the environment. Failures never reach `select()`.
- Both take a category, nothing (everything), or a predicate. Listen to `errors()` for every request that can fail, so a loading state can't hang. A failure nothing listens to is logged with `console.error`.

### Only the Latest Response (Stale Requests)

Responses arrive in the order the server answers, not the order the requests were sent. When only the newest request counts (search as you type, say), add `latest: true`: sending it aborts the requests of the same category still in flight, and their responses and failures are never delivered. To cancel without sending a new request (the user cleared the box), send `{ category, abort: true }`:

```jsx
import { ABORT, debounce } from 'sygnal'

function Search({ state }) {
  return (
    <div className="search">
      <input className="q" value={state.query} />
      <p className="status">{state.status === 'searching' ? 'Searching…' : state.error}</p>
      <ul className="results">{state.results.map((r) => <li>{r.title}</li>)}</ul>
    </div>
  )
}
Search.initialState = { query: '', status: 'idle', error: '', results: [] }
Search.intent = ({ DOM, HTTP }) => {
  const query$ = DOM.input('.q').value()
  return {
    TYPE:    query$,
    SEARCH:  query$.compose(debounce(300)).filter((q) => q !== ''),
    RESULTS: HTTP.select('search'),
    FAILED:  HTTP.errors('search'),
  }
}
Search.model = {
  TYPE: {
    STATE: (state, query) => query === ''
      ? { ...state, query, status: 'idle', error: '', results: [] }
      : { ...state, query },
    HTTP: (state, query) => (query === '' ? { category: 'search', abort: true } : ABORT),  // clearing cancels the request in flight
  },
  SEARCH: {
    STATE: (state) => ({ ...state, status: 'searching', error: '' }),
    HTTP:  (state, q) => ({ category: 'search', url: '/api/search', query: { q }, latest: true }),
  },
  RESULTS: (state, { value }) => ({ ...state, status: 'done', results: value.results }),
  FAILED:  (state) => ({ ...state, status: 'done', error: 'Search failed.', results: [] }),
}
```

No request ids and no `ABORT` checks in the reducers: a reply that reaches `RESULTS` or `FAILED` is always the latest one. `{ abort: true }` without a category cancels every request in flight. `makeFetchDriver({ latest: true })` makes every request latest-only (a request can still say `latest: false`).

### Driver Options

```javascript
makeFetchDriver({
  baseUrl: '/api',                       // prefix for every url
  headers: { Authorization: `Bearer ${token}` },
  latest: false,                         // default for every request
  timeoutMs: 10000,                      // default for every request (default: none)
  parse: 'auto',                         // default for every request
  fetch: myFetch,                        // default: globalThis.fetch, read at each request
})
```

- Disposing the app (or a hot reload) aborts every request in flight; nothing is delivered after.
- Replies that arrive before anything listens (a request sent on `BOOTSTRAP`) are held until the first listener subscribes.
- Server rendering (`renderToString`, Vike, Astro) runs views only, so no request is made on the server; drivers run on the client.

### Testing Without a Driver

`renderComponent` needs no driver for `HTTP`. The requests the component sends are recorded, and the `HTTP` source is a fake you answer from the test:

```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import Search from './Search.jsx'

let t
afterEach(() => t?.dispose())

it('searches after a pause; only the latest request counts', async () => {
  t = renderComponent(Search)
  t.simulateEvent('.q', 'input', { value: 'dune' })
  t.respond('HTTP', { results: [{ id: 7, title: 'Dune' }] })   // waits for the debounced request
  await t.next((s) => s.status === 'done')
  expect(t.requests('HTTP')).toEqual([{ category: 'search', url: '/api/search', query: { q: 'dune' }, latest: true }])
  expect(t.html()).toContain('<li>Dune</li>')

  t.simulateEvent('.q', 'input', { value: 'dun' })
  t.fail('HTTP', 500)                                             // or an Error, or a message
  await t.next((s) => s.error === 'Search failed.')
})
```

- `t.requests('HTTP')` is the live list of values the component sent to the sink.
- `t.respond(name, value, opts?)` answers the most recent pending request (of `opts.category`, or exactly `opts.request`), waiting up to 1 s for the component to send one, and delivers `{ category, value, status: 200, request }` on `select()`. `t.fail(name, error, opts?)` delivers `{ error, category, request, status, body }` on `errors()`; a number is an HTTP status (`t.fail('HTTP', 404)`).
- The fake follows `latest: true` and `{ abort: true }`: a superseded or cancelled request is no longer pending, and answering it explicitly (`{ request: t.requests('HTTP')[0] }`) delivers nothing, like the real driver.
- The test fails with a message when there is no pending request, or when nothing in the intent selects the reply (a category typo, or a missing `errors()` handler).
- The same works for any driver name the test doesn't pass in `drivers` (sources of `driverFromAsync` drivers have the same shape). `{ request: null }` pushes a value no request asked for.

In a running app, a sink or source with no driver is reported as [SYG609](/reference/errors/#syg609) (with the dev diagnostics on).

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

To wrap any Promise-returning function as a driver (for HTTP, [makeFetchDriver()](#http-requests-with-makefetchdriver) is simpler), use `driverFromAsync()`:

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

### Stale Replies with Other Drivers

For HTTP, use `latest: true` on a [makeFetchDriver()](#only-the-latest-response-stale-requests) request. For a driver that can't cancel (a `driverFromAsync` function, a socket), the general technique is a request id: keep `reqId` in state, bump it when sending, send it with the request, have the driver echo it in its result, and `ABORT` any reply or failure whose id isn't the latest:

```jsx
import { ABORT } from 'sygnal'

Search.model = {
  SEARCH: {
    STATE:  (state) => ({ ...state, reqId: state.reqId + 1, loading: true }),
    SEARCH: (state, q) => ({ category: 'search', value: { id: state.reqId + 1, q } }),  // sinks see the state before STATE
  },
  RESULTS: (state, { value }) =>
    value.id !== state.reqId ? ABORT : { ...state, loading: false, results: value.results },
  FAILED: (state, { request }) =>
    request.value.id !== state.reqId ? ABORT : { ...state, loading: false, error: 'Search failed.' },
}
// main.js: run(Search, { SEARCH: driverFromAsync(async ({ id, q }) => ({ id, results: await searchApi(q) })) })
```

- The `SEARCH` sink computes `state.reqId + 1` because every sink of an entry sees the state from **before** this action (see [Model](/guide/model/#sinks-see-the-state-before-the-action)).
- A failure carries the original `request`, so `request.value.id` identifies it without the driver's help.
- Clearing the input should bump `reqId` too, so a reply to a request sent before the clear is ignored.
