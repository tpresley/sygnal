---
title: Typed APIs
description: Typed clients for an API contract with sygnal/api (dev preview) — oRPC, OpenAPI and Hono — with requests as data, typed replies and errors, contract fixtures and version-skew detection
---

:::caution[Dev preview]
`sygnal/api` is a dev preview. Its API may change before it is stable. Feedback is welcome.
:::

`sygnal/api` builds a typed client from an API contract that your server already has. With a client, you don't write a URL, a route or a reply type in a component. Each procedure of the contract becomes a function that **builds a request**: the same plain data the [HTTP](/guide/http/) and [socket](/guide/sockets/) drivers already take. Effects stay data, replies still come back as actions, and the drivers' features (resources, the query cache, `latest`, retries, reconnects) all apply.

| The procedure | The call returns | Use it in |
|---|---|---|
| a `GET` | a request tagged with the endpoint | `resources`, or an `HTTP` sink |
| any other method | a request with a JSON body | an `HTTP` sink, with `ok` / `error` reply actions |
| a stream (an oRPC event iterator, or `.sse(path)`) | a server-sent events connection | `connections` |

There are three adapters, one per kind of contract. All of them use plain JSON on the wire:

- `orpcClient(contract)`: an [oRPC](https://orpc.dev) contract router, served by oRPC's `OpenAPIHandler`. This is the recommended pairing.
- `openApiClient<paths>()`: the `paths` type that [openapi-typescript](https://openapi-ts.dev) generates from any OpenAPI document, for any back end.
- `honoClient<ExtractSchema<typeof app>>()`: the routes of a [Hono](https://hono.dev) app.

Sygnal doesn't ship a server. It is a client for the server you choose. (For Telefunc's server functions under Vike, see [Server Functions](/integration/server-functions/).)

## An oRPC contract

The contract is the one module the client and the server share. In this demo, a stand-in server answers the way oRPC's `OpenAPIHandler` does: plain JSON, a 400 with `data.issues` for invalid input, and a declared error by its `code`.

```js live-file=./contract.js
import { oc } from '@orpc/contract'
import { z } from 'zod'

const Quote = z.object({ id: z.number(), text: z.string() })

export const contract = {
  quotes: {
    list: oc.route({ method: 'GET', path: '/quotes' }).output(z.array(Quote)),
    add: oc.route({ method: 'POST', path: '/quotes' })
      .input(z.object({ text: z.string().min(3) }))
      .output(Quote)
      .errors({ DUPLICATE: { status: 409, data: z.object({ id: z.number() }) } }),
    remove: oc.route({ method: 'DELETE', path: '/quotes/{id}' })
      .input(z.object({ id: z.coerce.number() }))
      .output(z.object({ removed: z.boolean() })),
  },
}
```

```js live-server
const quotes = [{ id: 1, text: 'Start where you are.' }]
let next = 2

export default {
  'GET /api/quotes': () => ({ json: quotes, delayMs: 300 }),
  'POST /api/quotes': ({ json }) => {
    if (json.text.length < 3) return { status: 400, json: { defined: false, code: 'BAD_REQUEST', status: 400, message: 'Input validation failed', data: { issues: [{ path: ['text'], message: 'At least 3 characters' }] } } }
    const dup = quotes.find((q) => q.text === json.text)
    if (dup) return { status: 409, json: { defined: true, code: 'DUPLICATE', status: 409, message: 'DUPLICATE', data: { id: dup.id } } }
    const quote = { id: next++, text: json.text }
    quotes.push(quote)
    return { json: quote, delayMs: 300 }
  },
  'DELETE /api/quotes/:id': ({ params }) => {
    const i = quotes.findIndex((q) => q.id === Number(params.id))
    if (i >= 0) quotes.splice(i, 1)
    return { json: { removed: i >= 0 } }
  },
}
```

```jsx live title="Quotes.jsx"
import { orpcClient } from 'sygnal/api'
import { contract } from './contract.js'

const api = orpcClient(contract, { prefix: '/api' })

function Quotes({ state }) {
  return (
    <div>
      <form className="add">
        <input className="draft" value={state.draft} aria-label="New quote" />
        <button type="submit">Add</button>
      </form>
      <p className="message">{state.message}</p>
      <ul>
        {(state.quotes.data ?? []).map((q) => (
          <li>{q.text} <button className="remove" data={{ id: q.id }} aria-label={`Remove ${q.text}`}>×</button></li>
        ))}
      </ul>
    </div>
  )
}
Quotes.initialState = { draft: '', message: '', quotes: { status: 'idle' } }
Quotes.resources = {
  quotes: () => api.quotes.list(),
}
Quotes.intent = ({ DOM }) => ({
  TYPE: DOM.input('.draft').value(),
  ADD: DOM.select('.add').events('submit', { preventDefault: true }),
  REMOVE: DOM.click('.remove').data('id', Number),
})
Quotes.model = {
  TYPE: (state, draft) => ({ ...state, draft }),
  ADD: { HTTP: (state) => api.quotes.add({ text: state.draft }, { ok: 'ADDED', error: 'FAILED', invalidates: [api.quotes.list] }) },
  ADDED: (state, quote) => ({ ...state, draft: '', message: `Added #${quote.id}` }),
  FAILED: (state, { body }) => ({
    ...state,
    message: body?.code === 'DUPLICATE' ? `Already there: #${body.data.id}` : body?.data?.issues?.[0]?.message ?? 'Could not add it',
  }),
  REMOVE: { HTTP: (state, id) => api.quotes.remove({ id }, { invalidates: [api.quotes.list] }) },
}
```

Add a quote, add it again, or add a short one. Each reply arrives as the action the call named.

- **`api.quotes.list()`** is `{ url: '/api/quotes', endpoint: 'quotes.list', tags: ['api:quotes.list'] }`. As a resource it is fetched when declared, and it refetches when the derived input changes.
- **`api.quotes.add(input, options)`** is a POST with `json: input`. The options are the request's own fields: `ok`, `error`, `key`, `latest`, `timeoutMs`, `retry` and the rest of the [request fields](/guide/http/#requests).
- **`invalidates: [api.quotes.list]`** refetches the resources built by that endpoint after a 2xx reply, using its `api:quotes.list` tag. A tag string works too.
- **Path parameters** (`/quotes/{id}`, `/files/{+path}`) are filled from the input and removed from it. For a GET, the rest of the input goes in the query string in oRPC's bracket notation (`tags[0]=a`, `filter[min]=2`). For other methods, it is the JSON body.
- **Each request carries `endpoint`**, the procedure's id. It is an app key, so it isn't sent, and devtools and `t.requests` show it.

### Streams

An oRPC event iterator is read as server-sent events. Give the procedure `.route({ method: 'GET' })`, then declare the call in `connections`. Each event arrives as the `message` action:

```js title="contract.js"
import { oc, eventIterator } from '@orpc/contract'

export const contract = {
  quotes: {
    // …
    feed: oc.route({ method: 'GET', path: '/quotes/feed' })
      .input(z.object({ tag: z.string().optional() }))
      .output(eventIterator(Quote)),
  },
}
```

```jsx title="Quotes.jsx"
Quotes.connections = (state) => ({
  feed: api.quotes.feed({ tag: state.tag }, { message: 'ARRIVED', resume: true }),
})
Quotes.model = {
  ARRIVED: (state, quote) => ({ ...state, live: [quote, ...state.live] }),
}
```

The connection takes every option of an [SSE connection](/guide/sockets/): `open`, `close`, `error`, `resume`, `staleAfterMs`, `reconnect`. A changed input closes the old stream and opens the new one. The procedure on the server is an async generator, and one `yield` is one event.

## Types

TypeScript infers every input, reply and error from the contract. The canonical component form names the reply actions' data with `Output` and `ApiFailure`:

```tsx title="Quotes.tsx"
import type { Component, Resource, FetchRequest, FetchSource, ActionsOf, IntentSources } from 'sygnal'
import type { Output, ApiFailure } from 'sygnal/api'
import { api } from './api'

type State = { draft: string; message: string; quotes: Resource<Output<typeof api.quotes.list>> }
type Drivers = { HTTP: { source: FetchSource; sink: FetchRequest } }
const intent = ({ DOM }: IntentSources<State, Drivers>) => ({ TYPE: DOM.input('.draft').value(), ADD: DOM.click('.add') })
type Actions = ActionsOf<typeof intent> & {
  ADDED: Output<typeof api.quotes.add>
  FAILED: ApiFailure<typeof api.quotes.add>
}

export const Quotes: Component<State, {}, Drivers, Actions> = ({ state }) => <ul>…</ul>
Quotes.model = {
  ADD: { HTTP: (state) => api.quotes.add({ text: state.draft }, { ok: 'ADDED', error: 'FAILED' }) },
  ADDED: (state, quote) => ({ ...state, message: `Added #${quote.id}` }),             // quote: { id: number; text: string }
  FAILED: (state, { body }) => ({
    ...state,
    message: body?.defined && body.code === 'DUPLICATE' ? `#${body.data.id}` : body?.message ?? 'Failed',  // narrowed by code
  }),
}
```

- **The input is checked at the call:** a missing field, a wrong type or an unknown procedure is a compile error.
- **`Output<typeof endpoint>`** is the reply as JSON delivers it (`Jsonify`). A `z.date()` the server returns is a `string` here, because that is what arrives.
- **`ApiFailure<typeof endpoint>`** is the `error` action's data with a typed `body`. With oRPC, the body is the union of the procedure's declared errors (by `code`, with their typed `data`) and `{ defined: false, … }` for anything else, including input validation (`data.issues`).
- The server implements the same contract with `implement(contract)`, so a handler that returns the wrong shape is a compile error on the server too.

In JavaScript, [sygnal-check](/guide/diagnostics/) reports a misspelled procedure ([SYG691](/reference/errors/#syg691)): it follows `api` to its `orpcClient(contract)` call, and the contract to its object literal, through imports.

## The server

On the server, implement the contract with oRPC and serve it with the `OpenAPIHandler`. It is a Fetch handler (`Request` → `Response`), so it mounts in Hono, a Worker, Vite's dev server or Node:

```ts title="server.ts"
import { implement } from '@orpc/server'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { contract } from './contract'

const os = implement(contract)
const router = os.router({
  quotes: {
    list: os.quotes.list.handler(() => db.quotes.all()),
    add: os.quotes.add.handler(({ input, errors }) => {
      const dup = db.quotes.byText(input.text)
      if (dup) throw errors.DUPLICATE({ data: { id: dup.id } })
      return db.quotes.insert(input)
    }),
    // …
  },
})
const handler = new OpenAPIHandler(router)

export async function handle(request: Request) {
  const { matched, response } = await handler.handle(request, { prefix: '/api' })
  return matched ? response : new Response('Not found', { status: 404 })
}
```

- **Use the `OpenAPIHandler`, not the `RPCHandler`.** The RPC protocol wraps every value in `{ json, meta }` to carry rich types. A Sygnal request is plain JSON both ways, and the [network-calls research](https://github.com/tpresley/sygnal/blob/main/dev-plans/RESEARCH-network-calls.md) rules out rich serialisation on the wire.
- **GET input comes from the query string**, so every value arrives as a string. Give non-string fields of a GET procedure a coercing schema: `z.coerce.number()`, `z.coerce.boolean()`.
- An input with `inputStructure: 'detailed'` (separate params, query, headers and body) isn't supported yet. `orpcClient` throws when it creates the client.

The [`typed-api` example](https://github.com/tpresley/sygnal/tree/main/examples/typed-api) is a complete app: the contract, the oRPC server in Vite's dev server, a component with a resource, a mutation, a delete and a live feed, and its tests.

## Testing

A request is data, so [`renderComponent`](/integration/testing/) fakes answer it like any other request. An endpoint can be the target of `t.respond`, `t.fail` and `t.push`. `fixture(endpoint, data)` checks the data against the contract's output schema, so a fixture that drifts from the contract fails the test:

```jsx title="Quotes.test.jsx"
import { renderComponent } from 'sygnal'
import { fixture, errorFixture } from 'sygnal/api'
import { api } from './api'
import { Quotes } from './Quotes'

it('adds a quote, and shows a duplicate', async () => {
  const t = renderComponent(Quotes)
  await t.ready()
  await t.respond('HTTP', fixture(api.quotes.list, [{ id: 1, text: 'Start where you are.' }]), api.quotes.list)

  await t.simulateEvent('.draft', 'input', { value: 'Less, but better.' })
  await t.simulateEvent('.add', 'submit')
  expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/quotes', method: 'POST', json: { text: 'Less, but better.' } })
  await t.respond('HTTP', fixture(api.quotes.add, { id: 2, text: 'Less, but better.' }), api.quotes.add)
  expect(t.state.message).toBe('Added #2')

  const dup = errorFixture(api.quotes.add, 'DUPLICATE', { id: 2 })   // { status: 409, body: { defined: true, code, … } }
  await t.simulateEvent('.add', 'submit')
  await t.fail('HTTP', dup.status, { request: api.quotes.add, body: dup.body })
})
```

- **`fixture(endpoint, data)`** takes the server's value (a `Date` stays a `Date`) and returns it the way JSON delivers it. A stream endpoint's fixture is one event: `t.push('WS', fixture(api.quotes.feed, quote), api.quotes.feed)`.
- **`errorFixture(endpoint, code, data, message?)`** builds a declared error, and checks its data against the error's schema.
- **The real server, in-process:** a Fetch handler can be the drivers' `fetch`, with no port and no mocks. The test then runs the real procedures:

```js title="Quotes.server.test.js"
const fetch = (url, init) => handle(new Request(new URL(url, 'http://localhost'), init))
const t = renderComponent(Quotes, { drivers: { HTTP: makeFetchDriver({ fetch }), WS: makeSocketDriver({ fetch }) } })
```

A stream connection with `headers` is read over `fetch` (in Node too), so in-process tests can include streams: pass the client a `headers` option, such as the contract hash below.

## Version skew

After a deploy, a tab that was loaded earlier still runs the old client against the new server. Send a hash of the contract with every request, check it on the server, and the stale tab learns it must reload instead of sending requests the new API may reject:

```ts title="api.ts"
import { orpcClient, contractHash } from 'sygnal/api'
import { contract } from './contract'

export const api = orpcClient(contract, { prefix: '/api', headers: { 'x-api-contract': contractHash(contract) } })
```

```ts title="server.ts"
import { contractHash, contractSkew } from 'sygnal/api'

const hash = contractHash(contract)
export async function handle(request: Request) {
  const skew = contractSkew(request, { hash, header: 'x-api-contract' })
  if (skew) return skew            // 409 CONTRACT_SKEW, in oRPC's error shape
  // … the OpenAPIHandler
}
```

```js title="main.js"
import { run, makeFetchDriver, makeSocketDriver } from 'sygnal'
import { contractFetch } from 'sygnal/api'

const fetch = contractFetch({ onSkew: () => showReloadBanner() })
run(App, { HTTP: makeFetchDriver({ fetch }), WS: makeSocketDriver({ fetch }) })
```

- **`contractHash(contract)`** hashes the procedures' ids, routes, input and output JSON Schemas (from the schemas' Standard JSON Schema support; zod 4 has it) and error codes. Any other value, such as an OpenAPI document, is hashed as its stable JSON. The hash is for detecting change only; it isn't cryptographic.
- **`contractSkew(request, { hash, header })`** answers a request that sends another hash with a 409 `CONTRACT_SKEW`. A request without the header passes, unless you set `require: true`.
- **`isContractSkew(failure)`** tells an `error` action or a failed resource apart. **`contractFetch()`** reports [SYG690](/reference/errors/#syg690) once and calls `onSkew` for each skew answer.

## OpenAPI (any back end)

For an API described by an OpenAPI document (Go, Python, Rails, or oRPC's `OpenAPIGenerator`), generate its `paths` type with openapi-typescript (`npx openapi-typescript openapi.json -o api-types.ts`), then name each endpoint once:

```ts title="api.ts"
import { openApiClient } from 'sygnal/api'
import type { paths } from './api-types'

const http = openApiClient<paths>({ prefix: '/api' })
export const getQuote = http.get('/quotes/{id}')
export const listQuotes = http.get('/quotes')
export const addQuote = http.post('/quotes')
export const quoteFeed = http.sse<Quote>('/quotes/feed')     // the event type is yours to name
```

```js
getQuote({ params: { path: { id: 1 } } }, { ok: 'LOADED' })   // { url: '/api/quotes/1', … }
listQuotes({ params: { query: { tag: 'calm', tags: ['a', 'b'] } } })
addQuote({ body: { text: 'Less, but better.' } }, { ok: 'ADDED', error: 'FAILED', invalidates: [listQuotes] })
```

The input is openapi-fetch's `{ params: { path, query, header }, body }`. Query arrays repeat the key (`tags=a&tags=b`), and objects use `key[field]`. `Output<typeof getQuote>` is the 2xx JSON response, and `ErrorBody<typeof getQuote>` the other responses' JSON. The adapter has no runtime schema, so `fixture()` is checked by the compiler only.

## Hono

For a Hono app whose routes carry types (validators, `c.json(value, status)`), pass Hono's own `ExtractSchema`:

```ts title="api.ts"
import { honoClient } from 'sygnal/api'
import type { ExtractSchema } from 'hono/types'
import type { app } from '../server/app'

const hono = honoClient<ExtractSchema<typeof app>>()
export const getQuote = hono.get('/api/quotes/:id')
export const addQuote = hono.post('/api/quotes')
```

```js
getQuote({ param: { id: '1' } }, { ok: 'LOADED' })
addQuote({ json: { text: 'Less, but better.' } }, { ok: 'ADDED', error: 'FAILED' })
```

The input is `hc`'s `{ param, query, json, header }`. `Output` is the output of the route's 2xx responses, and `ErrorBody` that of the others. A `streamSSE` route is `hono.sse<Event>('/api/feed')`.

## Reference

| Export | |
|---|---|
| `orpcClient(contract, options?)` | The oRPC router's tree, with each procedure an endpoint |
| `openApiClient<paths>(options?)` | `.get/.post/.put/.patch/.delete(path)` and `.sse<T>(path)` → an endpoint |
| `honoClient<Schema>(options?)` | The same, for Hono routes |
| `options` | `prefix` (before every path), `headers` (on every request and stream), `validate` (oRPC: also check replies with the output schema on the client) |
| an endpoint | `(input?, options?) => request \| connection`, with `id`, `kind` (`'query' \| 'mutation' \| 'stream'`), `method`, `path` and `match(request)` |
| `Output<E>`, `Input<E>`, `ErrorBody<E>`, `ApiFailure<E>`, `RawOutput<E>`, `Jsonify<T>` | Types |
| `fixture(endpoint, data)`, `errorFixture(endpoint, code, data?, message?)` | Test fixtures |
| `contractHash(contract)`, `contractSkew(request, { hash, header, require? })`, `isContractSkew(failure)`, `contractFetch({ fetch?, onSkew? })` | Version skew |
