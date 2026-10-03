---
title: Custom Drivers
description: driverFromAsync() for any promise-returning function, and hand-written drivers
---

For HTTP use [`makeFetchDriver()`](/guide/http/), and for WebSocket and SSE [`makeSocketDriver()`](/guide/sockets/). For any other asynchronous API (a browser API, an SDK, [server functions](/integration/server-functions/)), wrap it as a driver.

## driverFromAsync()

`driverFromAsync(fn)` turns a promise-returning function into a driver. A request names the reply actions with `ok` and `error`, like an HTTP request:

```javascript
// main.js
import { run, driverFromAsync } from 'sygnal'
import { geocode } from './geo.js'   // async (address) => ({ lat, lng })
import App from './App.jsx'

run(App, { GEO: driverFromAsync(geocode) })
```

```jsx
function Place({ state }) {
  return (
    <div>
      <input className="address" value={state.address} />
      <button className="find">Find</button>
      <p className="where">{state.status === 'found' ? `${state.coords.lat}, ${state.coords.lng}` : state.status}</p>
    </div>
  )
}
Place.initialState = { address: '', status: '', coords: null }
Place.intent = ({ DOM }) => ({
  ADDRESS: DOM.input('.address').value(),
  FIND:    DOM.click('.find'),
})
Place.model = {
  ADDRESS: (state, address) => ({ ...state, address }),
  FIND: {
    STATE: (state) => ({ ...state, status: 'Looking up…' }),
    GEO:   (state) => ({ value: state.address, ok: 'FOUND', error: 'NOT_FOUND' }),   // calls geocode(state.address)
  },
  FOUND:     (state, coords) => ({ ...state, status: 'found', coords }),            // what geocode() resolved to
  NOT_FOUND: (state, { error }) => ({ ...state, status: `Not found: ${error.message}` }),
}
```

- The request's `value` is the function's argument (see `args` below for several).
- The `ok` action gets what the promise resolved to (after `post`). The `error` action gets `{ error, request }`: the rejection reason (or what `post` threw) and the request.
- The reply reaches exactly the instance that sent the request. Names with no model entry are [SYG112](/reference/errors/#syg112); `then`/`catch` keys are refused ([SYG610](/reference/errors/#syg610)).
- `driverFromAsync` can't cancel a call, so it has no `latest` or `abort`. When only the newest reply counts, see [Stale replies](#stale-replies) below, or write a driver that can cancel.
- In tests, the driver needs no wiring: `renderComponent` fakes it, and `await t.respond('GEO', { lat: 1, lng: 2 }, 'FOUND')` answers the request ([Testing](/integration/testing/#answering-requests-respond-and-fail)).

### Options

```javascript
driverFromAsync(fn, {
  args: 'value',                        // a field name, an array of field names, or (request) => args
  pre: (request) => request,            // transform the request first
  post: (result, request) => result,    // transform the result before it is delivered
  selector: 'category',                 // no reply actions only: the field select()/errors() filter on
  return: 'value',                      // no reply actions only: the field the result is put in
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `args` | String, Array, or Function | `'value'` | How to get the function's arguments from a request: `args: ['call', 'args']` calls `fn(request.call, request.args)` |
| `pre` | Function | Identity | Pre-process each request |
| `post` | Function | Identity | Post-process each result (may return a promise) |
| `selector` | String | `'category'` | The request field that `select()`/`errors()` filter on (requests without reply actions) |
| `return` | String | `'value'` | The field a reply without reply actions carries the result in |

### Requests without reply actions

A request without `ok`/`error` is answered on the source: `API.select(category)` emits `{ value, category }` and `API.errors(category)` emits `{ error, request, category }`, filtered by the `selector` field (or a predicate; nothing for all). This is the form for stream composition, or for replies a component other than the sender handles; for a component reading back its own request, the reply-action form is canonical ([SYG508](/reference/errors/#syg508), [alternative forms](/advanced/alternative-forms/#selecterrors-round-trip)). While nothing listens to `errors()`, failures are logged with `console.error`.

### Stale replies

Without `latest`, a slow reply can land after a newer one. Keep a request id in state, send it, have the function echo it, and `ABORT` any reply whose id isn't the latest:

```jsx
import { ABORT } from 'sygnal'

Search.model = {
  SEARCH: {
    STATE: (state) => ({ ...state, reqId: state.reqId + 1, loading: true }),
    API:   (state, q) => ({ value: { id: state.reqId + 1, q }, ok: 'RESULTS', error: 'FAILED' }),  // sinks see the state before STATE
  },
  RESULTS: (state, { id, results }) => (id !== state.reqId ? ABORT : { ...state, loading: false, results }),
  FAILED:  (state, { request }) => (request.value.id !== state.reqId ? ABORT : { ...state, loading: false, error: 'Search failed.' }),
}
// main.js: run(Search, { API: driverFromAsync(async ({ id, q }) => ({ id, results: await searchApi(q) })) })
```

- The `API` sink computes `state.reqId + 1` because every sink of an entry sees the state from **before** this action ([Model](/guide/model/#sinks-see-the-state-before-the-action)).
- A failure carries the original `request`, so `request.value.id` identifies it without the function's help.
- Clearing the input should bump `reqId` too, so a reply to a request sent before the clear is ignored.

For HTTP, none of this is needed: use `latest: true` with [`makeFetchDriver()`](/guide/http/#only-the-latest-response).

## Async Work in an EFFECT

A one-off call that doesn't need a driver (a clipboard write, `navigator.share()`, an IndexedDB write) can run in an `async` EFFECT, which dispatches its result with `next()`. See [Async work that isn't HTTP](/advanced/effect/#async-work-that-isnt-http). It has no cancellation or `latest`: for anything that does, use a driver.

## Writing a Driver from Scratch

A driver is a function that takes the sink stream (the values the model sends) and returns a source object (what the intent reads):

```javascript
import { xs } from 'sygnal'

function makeClockDriver() {
  return (sink$) => {
    let timer, listener
    sink$.addListener({
      next: (command) => {
        clearInterval(timer)
        if (command.start) timer = setInterval(() => listener?.next(Date.now()), command.ms)
      },
    })
    const ticks$ = xs.create({ start: l => { listener = l }, stop: () => { listener = null } })
    return { select: () => ticks$, dispose: () => clearInterval(timer) }
  }
}

// main.js: run(App, { CLOCK: makeClockDriver() })
// intent:  TICK: CLOCK.select()
// model:   START: { CLOCK: () => ({ start: true, ms: 1000 }) }
```

- The intent reads the source as `CLOCK.select(…)`. Return whatever API suits the driver; `select()` is the convention.
- A `dispose()` on the source is called when the app is disposed (or hot-reloaded).
- A hand-written driver has no reply actions: its source is read in the intent. Use `driverFromAsync` when a request/reply shape fits.
- In tests, any driver you don't pass is replaced by a recording fake (`t.sinkValues('CLOCK')`); pass a stub in `drivers` to emit values.
