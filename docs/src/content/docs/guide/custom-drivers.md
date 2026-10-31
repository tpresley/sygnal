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
import Place from './Place.jsx'

run(Place, { GEO: driverFromAsync(geocode) })
```

```jsx
// Place.jsx
export default function Place({ state }) {
  return (
    <div>
      <input className="address" aria-label="Address" value={state.address} />
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
    API:   (state, q) => ({ value: { id: state.reqId, q }, ok: 'RESULTS', error: 'FAILED' }),  // STATE has incremented reqId
  },
  RESULTS: (state, { id, results }) => (id !== state.reqId ? ABORT : { ...state, loading: false, results }),
  FAILED:  (state, { request }) => (request.value.id !== state.reqId ? ABORT : { ...state, loading: false, error: 'Search failed.' }),
}
// main.js: run(Search, { API: driverFromAsync(async ({ id, q }) => ({ id, results: await searchApi(q) })) })
```

- STATE runs first, so the `API` sink reads the incremented `state.reqId` ([Model](/guide/model/#what-state-each-sink-sees)).
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

Import `xs` from `'sygnal'`, not `import xs from 'xstream'`: xstream is CommonJS, and under Node's ESM loader or Vite 8 (in a `"type": "module"` package) its default import is the module object, so `xs.create` is undefined when the driver starts. Sygnal's `xs` is the same xstream with that default resolved; `sygnal-check` reports the default import as [SYG302](/reference/errors/#syg302) (info) and `--fix` rewrites it. The same goes for the extras: `import dropRepeats from 'xstream/extra/dropRepeats'` is the module object there too ("dropRepeats is not a function"), so take them from `'sygnal'`: `import { dropRepeats, debounce } from 'sygnal'`.

- The intent reads the source as `CLOCK.select(…)`. Return whatever API suits the driver; `select()` is the convention.
- A `dispose()` on the source is called when the app is disposed (or hot-reloaded).
- A hand-written driver's source is read in the intent unless it answers with reply actions ([below](#reply-actions-in-your-own-driver)). Use `driverFromAsync` when a single request/reply fits.
- In tests, any driver you don't pass is replaced by a recording fake (`t.sinkValues('CLOCK')`); pass a stub in `drivers` to emit values.

## Reply actions in your own driver

`driverFromAsync` answers each request once. A driver that answers several times (upload progress, then the result) or that has its own lifecycle uses the same reply-action protocol directly: `makeReplies()` and `senderOf()`.

```javascript
// drivers/upload.js
import { makeReplies, senderOf } from 'sygnal'

// send(file, step, signal): uploads `file`, calls step(fraction) as it goes, resolves with the result
export function makeUploadDriver(send) {
  return (sink$) => {
    const inflight = new Map()   // sender → AbortController
    // onStop: the sending component was disposed, so its upload is aborted
    const { replies, reply } = makeReplies((sender) => inflight.get(sender)?.abort())
    sink$.addListener({
      next: (req) => {
        const sender = senderOf(req)
        if (sender === undefined) return   // not sent by a component: nobody to answer
        const ctl = new AbortController()
        inflight.set(sender, ctl)
        send(req.file, (fraction) => req.progress && reply(sender, req.progress, fraction), ctl.signal).then(
          (result) => req.ok && reply(sender, req.ok, result),
          (error) => req.error && reply(sender, req.error, { error, request: req }),
        )
      },
    })
    return { ...replies }
  }
}

// main.js: run(App, { UPLOAD: makeUploadDriver(sendToS3) })
```

```jsx
// Uploader.jsx
export function Uploader({ state }) {
  return (
    <div>
      <button type="button" className="go">Upload</button>
      <progress value={state.fraction} />
      {state.failed && <p role="alert">{state.failed}</p>}
    </div>
  )
}

Uploader.initialState = { fraction: 0, done: null, failed: null }
Uploader.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Uploader.model = {
  GO: { UPLOAD: () => ({ file: 'report.pdf', progress: 'UP_PROGRESS', ok: 'UPLOADED', error: 'UP_FAILED' }) },
  UP_PROGRESS: (state, fraction) => ({ ...state, fraction }),
  UPLOADED: (state, result) => ({ ...state, done: result }),
  UP_FAILED: (state, { error }) => ({ ...state, failed: error.message }),
}
```

- `...replies` marks the source: the core stamps each request a component sends to it with the sending instance, and adds that instance's replies to its actions. `senderOf(req)` reads the stamp.
- `reply(sender, type, data)` dispatches `type` on that instance only, as often as you call it. A Collection item, or any of several instances of one component, hears only its own replies.
- `onStop(sender)` runs when that instance is disposed; replies to it after that are dropped (`listening(sender)` tells). Abort its work there.
- The names are the component's model entries, as with `makeFetchDriver`: a missing one is [SYG112](/reference/errors/#syg112) in the dev checks. `sygnal-check` reads `ok`, `error` and `progress` keys; list the other keys your driver replies with in `replyKeys` in `sygnal-check.config.json` (`{ "replyKeys": { "UPLOAD": ["cancelled"] } }`), and their actions are checked too ([Editor setup](/integration/editors/)).
- In tests pass the real driver with a scripted `send`: `renderComponent(Uploader, { drivers: { UPLOAD: makeUploadDriver(fakeSend) } })`.
