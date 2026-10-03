---
title: HTTP
description: HTTP requests with makeFetchDriver() and reply actions
---

For HTTP, use the built-in fetch driver instead of calling `fetch` in a component. Register it once in `main.js`:

```javascript
import { run, makeFetchDriver } from 'sygnal'
import App from './App.jsx'

run(App, { HTTP: makeFetchDriver() })
```

A model entry sends a request to the `HTTP` sink and names the actions that receive the reply: `ok` for a 2xx response, `error` for everything else. The intent has no line for the reply.

```jsx
import { ABORT } from 'sygnal'

function Quote({ state }) {
  return (
    <div className="quote">
      <button className="pick" data={{ id: 1 }}>First</button>
      <button className="pick" data={{ id: 2 }}>Second</button>
      <button className="refresh">Refresh</button>
      <p className="text">{state.status === 'loading' ? 'Loading…' : state.error || state.quote?.text}</p>
    </div>
  )
}
Quote.initialState = { id: null, status: 'idle', quote: null, error: '' }
Quote.intent = ({ DOM }) => ({
  SHOW:    DOM.click('.pick').data('id', Number),
  REFRESH: DOM.click('.refresh'),
})
Quote.model = {
  SHOW: {
    STATE: (state, id) => ({ ...state, id, status: 'loading', error: '' }),
    HTTP:  (state, id) => ({ url: `/api/quotes/${id}`, ok: 'LOADED', error: 'FAILED', latest: true }),  // id from data: state.id is still the old one here
  },
  REFRESH: {
    STATE: (state) => (state.id === null ? ABORT : { ...state, status: 'loading', error: '' }),
    HTTP:  (state) => (state.id === null ? ABORT : { url: `/api/quotes/${state.id}`, ok: 'LOADED', error: 'FAILED', latest: true }),
  },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote }),     // the parsed body
  FAILED: (state, { status }) => ({ ...state, status: 'error', error: status === 404 ? 'No such quote.' : 'Could not load the quote.' }),
}
```

- The **`ok` action** gets the parsed body: JSON when the response says so, otherwise text (see `parse` below).
- The **`error` action** gets `{ error, status, body, request }`. For a non-2xx response, `status` and the parsed `body` are set and `error.message` reads like `'HTTP 404 Not Found: /api/quotes/9'`. For a network error, a body that doesn't parse, a timeout (`error.name === 'TimeoutError'`) or no `fetch`, `status` is `undefined`. `request` is the request as the model sent it.
- The reply goes to **exactly the component instance that sent the request**. Two `<Quote>` components, or every item of a Collection, can use the same action names without seeing each other's replies, and need no request ids.
- If the instance is removed (a Collection item deleted, a page left), its requests are aborted and nothing arrives.
- A name with no model entry is reported as [SYG112](/reference/errors/#syg112), with the closest model key. A request with a `then` or `catch` key is not sent ([SYG610](/reference/errors/#syg610)): use `ok` and `error`.

### Build the request from (state, data)

Every sink of one action sees the state from **before** that action ([Model](/guide/model/#sinks-see-the-state-before-the-action)). In `SHOW` above, `STATE` sets `id`, but the `HTTP` sink still sees the previous `state.id`, so it builds the URL from `data`. `REFRESH` doesn't change `id`, so it can read it from `state`.

## Only the Latest Response

Responses arrive in the order the server answers, not the order the requests were sent. With `latest: true`, sending a request aborts this instance's earlier requests **with the same key** that are still in flight, and their replies never arrive. The key is the `ok` action (else the `error` action), or an explicit `key`. A search box needs no request ids and no stale checks:

```jsx
import { ABORT, debounce } from 'sygnal'

function Search({ state }) {
  return <div><input className="q" value={state.query} /><p className="status">{state.status}</p><ul>{state.results.map(r => <li>{r.title}</li>)}</ul></div>
}
Search.initialState = { query: '', status: '', results: [] }
Search.intent = ({ DOM }) => ({
  TYPE:   DOM.input('.q').value(),
  SEARCH: DOM.input('.q').value().compose(debounce(300)).filter(q => q !== ''),
})
Search.model = {
  TYPE: {
    STATE: (state, query) => (query === '' ? { ...state, query, status: '', results: [] } : { ...state, query }),
    HTTP:  (state, query) => (query === '' ? { abort: 'RESULTS' } : ABORT),     // clearing cancels the request in flight
  },
  SEARCH: {
    STATE: (state) => ({ ...state, status: 'Searching…' }),
    HTTP:  (state, q) => ({ url: '/api/search', query: { q }, ok: 'RESULTS', error: 'FAILED', latest: true }),
  },
  RESULTS: (state, body) => ({ ...state, status: '', results: body.results }),
  FAILED:  (state, { status }) => ({ ...state, status: status === 404 ? 'Not found.' : 'Search failed.', results: [] }),
}
```

- **Cancel without sending**: `{ abort: 'RESULTS' }` aborts this instance's requests in flight whose key is `'RESULTS'`; `{ abort: true, key: 'search' }` does the same for an explicit key. Nothing is delivered for a cancelled request.
- **`key`** groups requests with different reply actions, or splits one action into separate groups: `` { url: `/api/items/${id}`, ok: 'ITEM', key: `item-${id}`, latest: true } `` keeps one request per item in flight.
- `makeFetchDriver({ latest: true })` makes every request latest-only (a request can still say `latest: false`). Prefer `latest: true` on the request: tests see it too.

## Requests

A request is an object (or a URL string, for a plain GET with no reply actions):

| Field | Default | Meaning |
|---|---|---|
| `url` | (required) | The URL, prefixed with the driver's `baseUrl` |
| `ok` | — | Action that receives the parsed body of a 2xx response |
| `error` | — | Action that receives `{ error, status, body, request }` |
| `key` | the `ok` action, else `error` | The group for `latest` and `abort` |
| `method` | `'POST'` with `json`/`body`, else `'GET'` | HTTP method |
| `query` | — | Object appended as a query string, before any `#fragment`: `{ q: 'dune' }` → `?q=dune` (URL-encoded; `null`/`undefined` values skipped; an array repeats the key: `{ tag: ['a', 'b'] }` → `?tag=a&tag=b`) |
| `json` | — | Body sent as `JSON.stringify(json)` with `Content-Type: application/json` |
| `body` | — | Raw body (string, `FormData`, `Blob`, …) |
| `headers` | — | Object or `Headers`, merged over the driver's `headers` case-insensitively (sent with lowercase names) |
| `latest` | driver's `latest` (false) | Abort this instance's requests with the same key still in flight |
| `timeoutMs` | driver's `timeoutMs` (none) | Fail with a `TimeoutError` after this many ms |
| `parse` | `'auto'` | How the body becomes the `ok` data: `'auto'` (JSON when the content-type says JSON, otherwise text; 204 → `null`), `'json'`, `'text'`, `'response'` (the `Response` itself), or a function `res => value` |
| `init` | driver's `init` | Other `fetch()` options: `{ credentials: 'include', mode, cache, redirect, referrer, referrerPolicy, integrity, keepalive, priority }` |
| `cache`, `staleTime` | — | Answer from the driver's cache (GET/HEAD only): see [Resources and Caching](/guide/resources/#the-query-cache) |
| `tags`, `invalidates` | — | Tags for [invalidation](/guide/resources/#invalidation); `invalidates: ['quotes']` refreshes the tagged reads after a 2xx reply |
| `updates` | — | After a 2xx reply, write it into this component's resources (and their cache entries): `updates: 'item'`, or `{ items: (list, reply) => newList }` ([Writing a reply into the cache](/guide/resources/#writing-a-reply-into-the-cache)) |
| `retry` | driver's `retry` for GET/HEAD (0) | Retry network errors, 408, 429 and 5xx: a count or `{ count, delayMs, maxDelayMs, jitter }` ([Retries](/guide/resources/#retries)) |
| `validate` | — | A Standard Schema the body must pass ([Validation](/guide/resources/#validation)) |

Any other field is yours (an id, the query text): it isn't sent, and it comes back on the failure's `request`. A sink that returns `ABORT`, `null` or `undefined` sends nothing.

A request that names only `ok` sends its failures to `HTTP.errors()` (logged when nothing listens), and one that names only `error` sends its successes to `HTTP.select()`. Name both.

## Driver Options

```javascript
makeFetchDriver({
  baseUrl: '/api',                       // prefix for every url
  headers: { Authorization: `Bearer ${token}` },
  init: { credentials: 'include' },      // fetch() options for every request
  latest: false,                         // default for every request
  timeoutMs: 10000,                      // default for every request (default: none)
  parse: 'auto',                         // default for every request
  fetch: myFetch,                        // default: globalThis.fetch, read at each request
  cache: queryCache(),                   // the query cache (default: none), see Resources and Caching
  retry: 2,                              // default for GET/HEAD requests (default: 0)
})
```

- Disposing the app (or a hot reload) aborts every request in flight; nothing is delivered after.
- Server rendering (`renderToString`, Vike, Astro) runs views only, so no request is made on the server; drivers run on the client. Server data for the first render comes from Vike's [`+data`](/integration/vike/) or [`hydrateState`](/integration/ssr/), and resources can be rendered from a seeded query cache ([Server rendering](/guide/resources/#server-rendering)).

## Testing Without a Driver

`renderComponent` needs no driver for `HTTP`. The requests the component sends are recorded, and the source is a fake that replies like the real driver. Answer a request with `t.respond` or fail it with `t.fail`, and `await` the call:

```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import Quote from './Quote.jsx'

let t
afterEach(() => t?.dispose())

it('shows the picked quote, then a missing one', async () => {
  t = renderComponent(Quote, { strict: true })
  t.simulateEvent('.pick[data-id="2"]', 'click')
  await t.respond('HTTP', { text: 'Two' }, 'LOADED')   // resolves once LOADED is reduced and rendered
  expect(t.requests('HTTP')[0].url).toBe('/api/quotes/2')
  expect(t.html()).toContain('Two')

  t.simulateEvent('.refresh', 'click')
  await t.fail('HTTP', 404)                           // an HTTP status, an Error, or a message
  expect(t.state.error).toBe('No such quote.')
  t.expectNoDiagnostics()
})
```

- The third argument picks the request: an action, key or category name (`'LOADED'`), a partial request (`{ url: '/api/quotes/2' }`), or a predicate. Without it, the newest pending request is answered.
- A request that was superseded by `latest: true` or aborted is no longer pending, and answering it **throws at the call**: `expect(() => t.respond('HTTP', [], { query: { q: 'du' } })).toThrow()` asserts that a stale request can't land. (A call made while earlier input is still queued, such as a debounced search, waits up to 1 s for its request instead.)
- `t.requests('HTTP')` lists the requests sent; `t.sinkValues('HTTP')` also has the `{ abort }` commands.

The [Testing guide](/integration/testing/#answering-requests-respond-and-fail) has the full matching rules. In a running app, a sink with no driver is reported as [SYG609](/reference/errors/#syg609) (with the dev diagnostics on).

## Reads That Follow State: resources

For data a component shows, declare it instead of loading it in the model: `` Quote.resources = { quote: (state) => state.id && `/api/quotes/${state.id}` } `` fetches whenever the request changes and writes `state.quote = { status, data, error, refreshing }`. [Resources and Caching](/guide/resources/) covers refetching, the opt-in cache, invalidation, retries and validation.

## Requests Without Reply Actions: select() and errors()

A request without `ok`/`error` has no reply actions: its reply goes to the `HTTP` source, read in the intent with `HTTP.select(category)` (`{ category, value, status, request }`) and `HTTP.errors(category)` (`{ error, category, request, status, body }`). Use it to compose replies as streams, or for replies that a component other than the sender handles. Reading your own request back this way is the [alternative form](/advanced/alternative-forms/#selecterrors-round-trip) of reply actions, flagged in strict mode as [SYG508](/reference/errors/#syg508).

## Recipes

### Optimistic update with rollback

Change the state at once and send the write in the same action. Put the previous value on the request as your own field: fields the driver doesn't know aren't sent, and they come back on the failure's `request`, so the `error` action can restore it.

```jsx
function Todos({ state }) {
  return (
    <div>
      <ul>{state.todos.map(t => <li className={t.done ? 'todo done' : 'todo'}><button className="toggle" data-id={String(t.id)}>{t.title}</button></li>)}</ul>
      <p className="error">{state.error}</p>
    </div>
  )
}
Todos.initialState = { todos: [{ id: 1, title: 'Write', done: false }], error: '' }
Todos.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle').data('id', Number) })
Todos.model = {
  TOGGLE: {
    STATE: (state, id) => ({ ...state, error: '', todos: state.todos.map(t => (t.id === id ? { ...t, done: !t.done } : t)) }),
    HTTP:  (state, id) => {
      const before = state.todos.find(t => t.id === id)   // the state before this action
      return { url: `/api/todos/${id}`, method: 'PATCH', json: { done: !before.done }, ok: 'SAVED', error: 'SAVE_FAILED', before }
    },
  },
  SAVED:       (state, saved) => ({ ...state, todos: state.todos.map(t => (t.id === saved.id ? saved : t)) }),
  SAVE_FAILED: (state, { request }) => ({   // request is the request as sent, with your own fields
    ...state,
    error: 'Could not save.',
    todos: state.todos.map(t => (t.id === request.before.id ? request.before : t)),
  }),
}
```

`SAVED` replaces the item with the server's version. In a test, `await t.fail('HTTP', 500)` and check that the item is back.

### Save status

A write's status is ordinary state: set it when the request is sent and in the reply actions. Ignoring a second click while saving keeps one request in flight.

```jsx
import { ABORT } from 'sygnal'

function Profile({ state }) {
  const label = { idle: '', saving: 'Saving…', saved: 'Saved.', failed: 'Could not save.' }[state.save]
  return (
    <form>
      <input className="name" value={state.name} />
      <button className="save" disabled={state.save === 'saving'}>Save</button>
      <p className="save-status">{label}</p>
    </form>
  )
}
Profile.initialState = { name: '', save: 'idle' }   // 'idle' | 'saving' | 'saved' | 'failed'
Profile.intent = ({ DOM }) => ({ NAME: DOM.input('.name').value(), SAVE: DOM.click('.save') })
Profile.model = {
  NAME: (state, name) => ({ ...state, name, save: 'idle' }),
  SAVE: {
    STATE: (state) => (state.save === 'saving' ? ABORT : { ...state, save: 'saving' }),
    HTTP:  (state) => (state.save === 'saving' ? ABORT : { url: '/api/profile', method: 'PUT', json: { name: state.name }, ok: 'SAVED', error: 'SAVE_FAILED' }),
  },
  SAVED:       (state) => ({ ...state, save: 'saved' }),
  SAVE_FAILED: (state) => ({ ...state, save: 'failed' }),
}
```

To refresh the reads a save changed, add `invalidates: ['profile']` to the request ([Invalidation](/guide/resources/#invalidation)). To show the saved record at once, add `updates: 'profile'` when the profile is a resource ([Writing a reply into the cache](/guide/resources/#writing-a-reply-into-the-cache)).

For reads, see the [pagination and infinite list recipes](/guide/resources/#recipes).

## Related

- [Resources and Caching](/guide/resources/): declarative reads, the query cache, invalidation, retries, validation
- [Sockets](/guide/sockets/): WebSocket and server-sent events with `makeSocketDriver()`
- [Custom Drivers](/guide/custom-drivers/): `driverFromAsync()` for any promise-returning function, and hand-written drivers
- [Server Functions](/integration/server-functions/): calling Telefunc functions through a driver with reply actions
