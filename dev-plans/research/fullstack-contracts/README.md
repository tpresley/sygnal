# Research: front-end / back-end contracts for Sygnal

Status: research + working spike (2026-10-29), branch `claude/explore-fullstack-contracts-6e8952`. Nothing here ships.

**The question:** how can a Sygnal client and its server share functions, types and schemas without hand-writing and maintaining HTTP/SSE routes on both sides?

**The short answer:** keep effects as data. A shared **contract** (procedures with Standard Schemas) can produce the plain request objects that `makeFetchDriver` and `makeSocketDriver` already understand:

- a query becomes a GET `FetchRequest`, so it works as a `resources` entry with the cache, retry and `latest`;
- a mutation becomes a POST with reply actions;
- a stream becomes an `SseConnection` for the `connections` static.

The client needs no new driver and no change to the core. Most of the value comes from roughly 120 lines of client code plus a roughly 140-line Fetch-API server handler. The spike runs end to end: types, validation at both ends, streaming, `renderComponent` tests, a real Hono server, and cross-client invalidation. A function-first variant (`*.server.ts` and a Vite plugin) also works on the same pieces.

Everything below describes the spike in [`spike/`](spike/). Run it with `npm --prefix dev-plans/research/fullstack-contracts/spike test`; it needs the root `npm run build` and the spike's own `npm install`.

---

## 1. Where Sygnal stands today

[RESEARCH-network-calls](../../RESEARCH-network-calls.md) measured a "4-place problem": registering the driver, sending the request, wiring the reply in intent, and handling the reply. Since then, Option B (reply actions), Option C (`resources`), the opt-in `queryCache`, `invalidate`/`invalidates`/`updates`, Option D (`connections` with `makeSocketDriver`, SSE over fetch with headers, resume and staleness), `validate: schema`, and the `renderComponent` HTTP and socket fakes have all shipped. The **client-side** shape is now good: a call and its continuation sit on one line, and replies reach exactly the sender.

What is still hand-maintained is everything that crosses the network boundary. In the baseline below ([`spike/baseline/`](spike/baseline/)), which is a disciplined baseline with a shared zod types file, these all have to agree with no tool checking them:

| # | Must agree | Where |
|---|---|---|
| 1 | `GET /api/quotes` path | server route, client resource |
| 2 | query parameter `tag` | server `c.req.query('tag')`, client `query: { tag }` |
| 3 | `POST /api/quotes` path + method | server, client |
| 4 | POST body `{ text, tag }` | server zod schema, client literal (untyped `json`) |
| 5 | `/api/quotes/feed` path | server, client |
| 6 | the feed's `tag` parameter + manual `encodeURIComponent` | server, client |
| 7 | the CSRF header name + value | server, client ×2 |
| 8 | the list's response type | server `c.json(...)` (untyped), client `Resource<Quote[]>` |
| 9 | the add response type | client `Actions.ADDED: Quote` (declared by hand) |
| 10 | the feed event type | client `Actions.ARRIVED: Quote` |
| 11 | the error body `{ message, issues }` | 3 places on the server, the client's FAILED |
| 12 | the cache tag `'quotes'` | resource `tags`, mutation `invalidates` |

In the contract version, 10 of these 12 go away or are checked by `tsc`. The remaining two are the error body shape (fixed once in the library) and the reply action names (already checked by `sygnal-check` SYG112, see §6).

## 2. Prior art, mapped onto MVI and drivers

Sygnal's constraint is that **effects are data and replies come back as actions**. Anything whose client API is "call a function, get a Promise" has to be adapted so the call *builds a request* instead of *performing* it. Sygnal can't simply adopt such a client; it can only borrow its contract and wire format.

| System | Shape | Fits Sygnal how | Verdict |
|---|---|---|---|
| **tRPC** | Router of query / mutation / subscription procedures; the client imports `typeof appRouter` (type only); a Proxy client returns Promises; subscriptions over SSE or WS | The router type is a contract. Its HTTP wire format is simple (GET `?input=`, POST JSON, the answer under `result.data`), so a request builder plus a `parse` unwrap could speak to an existing tRPC server | Good **interop adapter** target; don't adopt its client |
| **oRPC** | Contract-first or router-first; Standard Schema; event iterators (async generators → SSE); OpenAPI generation | The closest relative of this spike: a contract with input/output schemas and streaming as async iterators. Its OpenAPI handler speaks plain JSON | **Most promising server to adopt instead of writing our own** (open question 1). Verify its wire formats before relying on them |
| **ts-rest / Zodios** | A contract of REST routes (method, path, schemas) | Contract-first REST; maps 1:1 onto FetchRequest | Same idea; REST paths instead of procedure names |
| **Telefunc** (Vike) | `*.telefunc.ts` files, a transform turns imports into fetch stubs, `shield()` validation, one POST endpoint | Function-first. The stub returns a Promise, so Sygnal would wrap it in `driverFromAsync`, or (the spike) emit stubs that return request data | Good fit for Vike users. The spike's function-first variant is the same idea with data-returning stubs |
| **React server functions** (`"use server"`), SolidStart, Qwik `server$` | Inline closures extracted by a compiler; IDs; rich serialisation; Qwik captures the closure scope | Implicit capture is the opposite of "effects as data". React2Shell (CVE-2025-55182, Dec 2025) was a deserialisation RCE in exactly this layer | **Reject the inline form.** File-based only, plain JSON only |
| **TanStack Start `createServerFn`** | A builder (`.validator().handler()`), a compiler split, Standard Schema | Function-first with a mandatory validator: the same as the spike's `query(schema, fn)` | Confirms the function-first design |
| **Remix / React Router** loaders and actions | Data bound to route modules; after any action, every loader revalidates by default | Maps onto `resources` per route plus "a mutation invalidates queries". The useful lesson is the **revalidate-by-default** policy | Borrow the invalidation default idea (§4.5) |
| **GraphQL + codegen** | Schema-first, typed documents, normalised cache, subscriptions | A `gql` request builder (POST JSON) is a trivial adapter; a normalised cache is a different product | Out of scope as a default; an adapter is easy if asked for |
| **OpenAPI / TypeSpec + openapi-typescript / openapi-fetch** | Language-neutral spec → TS types for `paths`; typed `GET('/quotes/{id}', { params })` | The answer for **non-TypeScript back ends** (Go, Python, Rails). A typed path-template builder → FetchRequest fits perfectly | **Second adapter** after the native contract |
| **Hono RPC** (`hc<AppType>`) | Types inferred from the chained routes; the client is a fetch Proxy | Hono already exports `InferRequestType` / `InferResponseType`. A builder that turns `AppType` into typed FetchRequests would type REST routes with no contract file | A cheap adapter for teams that keep Hono REST routes |
| **Replicache / Zero / ElectricSQL** | A local replica plus server-authoritative sync; optimistic mutators; live queries | A sync engine is a *driver whose source is a replica*; a live query is a resource that never goes stale. It is a large commitment and owns the data layer | Later, as an integration, not core. The spike's `$sync` (§4.5) is the 5% version |
| **Convex** | Functions in `convex/`, a generated `api` object, `useQuery(api.x.y)` live over WS, dependency tracking on the server | The best DX reference: function-first and **live by default**. The server knows each query's dependencies; the spike declares them by hand (`invalidates`) | The north star for "live" queries; the spike approximates it with declared invalidation |

**Best fit:** a **contract whose calls build request data** (the oRPC/ts-rest family), plus **server-pushed invalidation** (the Convex/Remix idea) through an SSE stream that turns into `{ invalidate }` sink values. Both land on drivers that already exist. Function-first (Telefunc/TanStack style) is a DX layer on top of the same pieces, at the price of a compiler step and more security surface.

## 3. The spike

```
spike/
  lib/contract.ts                defineApi, query/mutation/stream, createClient → request data,
                                 repliesOf / reply / failure (typed reducers), $sync
  lib/server.ts                  createHandler(contract, impl): Fetch API handler, validation,
                                 CSRF rules, SSE from async iterables, $sync hub, inProcessFetch
  lib/testing.ts                 fixture(proc, data): a test fixture checked against the contract
  lib/fn.ts                      function-first: query(schema, fn) in *.server.ts, collect(), rpcStub
  lib/vite-server-functions.ts   Vite plugin: client stubs for *.server.ts, virtual:sygnal-rpc, dev /rpc/*
  app/api.ts                     the contract (11 lines)
  app/server.ts                  the implementation + Hono mount
  app/Quotes.tsx                 the component: resource + mutation + stream
  app/Sync.tsx                   withSync(): the $sync connection as a mixin
  fnapp/quotes.server.ts         function-first: the server functions ARE the API
  fnapp/Quotes.tsx               the same component importing them
  baseline/                      the same feature with today's makeFetchDriver + hand-written Hono routes
  test/                          14 tests (below);  type-tests/inference.tsx: negative type tests
```

### 3.1 The contract and the component

```ts
// app/api.ts: shared by client and server
export const Quote = z.object({ id: z.number(), text: z.string(), tag: z.string() })
export const contract = defineApi({
  listQuotes: query({ input: z.object({ tag: z.string().optional() }), output: z.array(Quote) }),
  addQuote:   mutation({ input: z.object({ text: z.string().min(3), tag: z.string() }), output: Quote, invalidates: ['listQuotes'] }),
  quoteFeed:  stream({ input: z.object({ tag: z.string().optional() }), output: Quote }),
})
export const api = createClient(contract)
export const replies = repliesOf(contract)
```

```tsx
// app/Quotes.tsx: no URLs, no routes, no hand-written reply types
Quotes.resources   = { quotes: (state) => api.listQuotes({ tag: state.tag }) }
Quotes.connections = (state) => ({ feed: api.quoteFeed({ tag: state.tag }, { message: 'ARRIVED' }) })
Quotes.model = {
  ADD: {
    STATE: (state) => ({ ...state, error: '' }),
    HTTP:  (state) => api.addQuote({ text: state.draft, tag: state.tag }, { ok: 'ADDED', error: 'FAILED' }),
  },
  ADDED:   replies.addQuote((state, quote) => ({ ...state, draft: '', error: `Added #${quote.id}` })),  // quote: Quote
  FAILED:  replies.error((state, { status, body }) => …),
  ARRIVED: replies.quoteFeed((state, quote) => ({ ...state, live: [...state.live, quote].slice(-5) })),
}
```

```ts
// app/server.ts: the implementation is typed by the contract; a wrong return type is a compile error
const impl: Implementation<typeof contract> = {
  listQuotes: ({ tag }) => quotes.filter((q) => !tag || q.tag === tag),
  addQuote:   ({ text, tag }) => { … return quote },
  quoteFeed:  async function* ({ tag }, { signal }) { … yield quote … },  // an async generator is the stream
}
app.all('/rpc/*', (c) => createHandler(contract, impl, { validateOutput: true, sync: true })(c.req.raw))
```

What `api.addQuote(...)` returns is plain data, so `t.requests('HTTP')` shows it:
`{ url: '/rpc/addQuote', method: 'POST', json: {...}, headers: { 'x-sygnal-rpc': '1' }, invalidates: ['rpc:listQuotes'], ok: 'ADDED', error: 'FAILED' }`.

### 3.2 Design decisions made in the spike

- **Queries are GET** (`?input=<json>`) so they keep everything the fetch driver gives GET: `resources`, `queryCache` (GET/HEAD only), default retries, de-duplication and `latest`. Each query is tagged `rpc:<name>`, so invalidation by procedure name works without a cache.
- **Mutations are POST**, **streams are SSE through `headers`**. The RPC header makes `makeSocketDriver` read the stream with `FetchEventSource`. That one path works in browsers, in Node and in tests, and it is CSRF-safe. Resume (`Last-Event-ID`) and `staleAfterMs` come for free.
- **Server rules** (Option E of the earlier research, all tested in `e2e.test.tsx`):
  - every input is validated with the contract's Standard Schema before the procedure runs (400 with `issues`);
  - the RPC header is required (403); a foreign `Origin` is refused (403); the wrong method is 405;
  - an unknown name or `__proto__` is 404 (`Object.hasOwn`);
  - plain JSON only; a thrown `ApiError(status, message)` is passed through, and anything else becomes a generic 500;
  - `validateOutput: true` checks every reply and stream event against the output schema (dev or test).
- **Typed reducers without hand-written types.** Sygnal's types deliberately don't infer reply data from `ok: 'X'` (D70). `replies.addQuote(fn)` (contract) and `reply(addQuote, fn)` (function-first) are identity functions whose only job is to type the reducer's `data`. They cost nothing at run time, and `sygnal-check` sees through them (§6).
- **`invalidates` is declared once, on the contract's mutation.** The client adds it to every call (the local resources refetch), and the server broadcasts it to *other* clients over `$sync` (§4.5).

### 3.3 Tests (all pass, 3 runs in a row with no flakes)

| File | What it shows |
|---|---|
| `quotes.fake.test.tsx` | Covers the whole component with `renderComponent`'s **built-in fakes**: `t.requests('HTTP')` shows the request data, `t.respond(…, 'quotes')` answers the resource, and `t.push('WS', …, 'feed')` sends a stream event. `fixture(contract.addQuote, data)` validates the fixture against the contract, so a stale fixture fails the test (and `tsc`) |
| `quotes.inprocess.test.tsx` | The **real server implementation, in-process**: `makeFetchDriver({ fetch })` and `makeSocketDriver({ fetch })` with a `fetch` that calls `app.fetch(request)`, with no port. Covers list, add, invalidation refetch, the SSE stream from the async generator, a 400 with issues and a 409 `ApiError` |
| `e2e.test.tsx` | A real `@hono/node-server` port with Node's fetch, plus the security rules (header, origin, method, input, unknown names) |
| `sync.test.tsx` | Two clients on one server: client B's list refetches when client A adds, through `$sync`, with no code in B that knows about A's mutation |
| `fnapp.server.test.ts` | The Vite plugin: the client transform of `quotes.server.ts` contains only stubs (no implementation, no `zod`, no `ApiError`); any other export fails the build; the dev server answers `/rpc/*` from the real module |
| `fnapp.component.test.tsx` | The function-first component (its import stubbed by the plugin) round-trips through the Vite dev server, stream included |
| `baseline.inprocess.test.tsx` | The baseline passes the same scenario, so the comparison is honest |
| `type-tests/inference.tsx` (`tsc`) | Negative tests: the wrong input, an unknown procedure, a mutation in `invalidates`, the wrong reply type in a reducer, a server implementation returning the wrong shape, and the function-first input and output inferred from the server function's own signature |

## 4. Results

### 4.1 Lines and touch points

Non-blank, non-comment lines of the app code. The library is written once and isn't counted.

| | Shared | Server | Client component | Total | Unchecked cross-boundary agreements |
|---|---|---|---|---|---|
| Baseline (`makeFetchDriver` + Hono routes) | 5 (`types.ts`) | 42 | 40 | **87** | **12** (§1 table) |
| Contract-first (`app/`) | 11 (`api.ts`) | 36 | 36 | **83** | **0** checked by nothing; 1 by convention (error body, fixed in the library) |
| Function-first (`fnapp/`) | 0 | 27 | 37 | **64** | **0** |

For three endpoints, **lines are roughly a wash** (−5 % contract, −26 % function-first). The baseline server's per-route parsing, validation and SSE framing move into the library, while the contract adds its declarations. The saving grows with the number of endpoints: every baseline route repeats ~6–10 lines of method, path, parse, validate, error shape and framing, while a contract procedure is 1 line plus its implementation. **Agreements are the real win:** 12 → 0.

### 4.2 Drift experiment

Each line is one change, compiled with `tsc` and run through the in-process tests:

| Drift | Baseline | Contract-first | Function-first |
|---|---|---|---|
| D1: the server returns `{ body }` instead of `{ text }` | `tsc`: caught only because the in-memory store happened to be typed `Quote[]`; `c.json(anything)` itself is unchecked. **The test passes** (the UI silently shows nothing) | `tsc` error in the implementation; at run time `validateOutput` turns it into a 500 and **the test fails** | `tsc` error |
| D2: the client sends `{ category }` instead of `{ tag }` | **nothing** (`json` is untyped; the server's 400 surfaces only at run time) | `tsc` error at the call site | `tsc` error at the call site |
| D3: a URL / name typo (`listQuote`) | **nothing** (a 404 at run time) | `tsc` error ("did you mean listQuotes") | `tsc` error |
| D4: a schema field renamed in the shared file | `tsc` errors everywhere (the baseline shares a types file) | `tsc` errors everywhere | n/a (no schema file) |

So a disciplined baseline already gets D4. The contract adds D1–D3, which are the drifts a shared types file can't see, because they live in strings and untyped bodies.

### 4.3 Testing

The contract adds two testing modes on top of today's fakes, with no new `renderComponent` API:

1. **The fakes, unchanged.** Requests are data, so `t.requests` and `t.respond` work as they do today. `fixture(proc, data)` keeps fake replies honest.
2. **The real backend in-process.** `makeFetchDriver({ fetch: inProcessFetch(handler) })` runs the real server code, with no port and no mocks, in a jsdom test. The same `inProcessFetch` is how SSR could call the API without a network hop.

A sugar worth considering is `renderComponent(C, { api: handler })`, which would wire both drivers to an in-process fetch.

### 4.4 Function-first (`*.server.ts` + Vite plugin)

```ts
// fnapp/quotes.server.ts: no contract file; the exports are the API
export const addQuote = mutation(z.object({ text: z.string().min(3), tag: z.string() }), ({ text, tag }) => { … return quote })
// fnapp/Quotes.tsx
import { listQuotes, addQuote, quoteFeed } from './quotes.server.ts'
HTTP: (state) => addQuote({ text: state.draft, tag: state.tag }, { ok: 'ADDED', error: 'FAILED', invalidates: [listQuotes] })
```

- TypeScript checks the client against the real module, so the output type is the function's return type, with **no output schema at all**. The client transform replaces the module with `rpcStub('fnapp/quotes/addQuote', 'mutation')` lines. Any export that isn't `query|mutation|stream(...)` or a type is a **build error** (fail closed), so a helper or a secret can never be stubbed by guesswork or leak.
- The plugin serves `/rpc/*` in dev from `virtual:sygnal-rpc`, which uses `import.meta.glob` to collect every `*.server.ts` file into `createHandler`.
- **Costs:**
  - a compiler step (the plugin is ~60 lines, but it is a security boundary that must be reviewed like one);
  - procedure names derived from file paths (a moved file is a renamed endpoint, which breaks old clients during a deploy);
  - no output validation;
  - the in-process test path doesn't work in the same Vitest process, because the import is stubbed (the test uses a Vite dev server in `globalSetup`).
- **Spike limitation:** export detection is a regex. A real version would use the `oxc` / `@babel/parser` AST that `sygnal/vite` and `sygnal-check` already have.

### 4.5 State sync: `$sync` (server-pushed invalidation)

With `createHandler(…, { sync: true })`, a successful mutation that declares `invalidates` pushes `['rpc:listQuotes']` to every client on `/rpc/$sync`. On the client, the whole mechanism is one connection and one model entry: `STALE: { HTTP: (_, tags) => ({ invalidate: tags }) }`. The fetch driver's existing app-wide `invalidate` refetches every mounted resource with that tag, keeping the shown data while it does (`refreshing: true`).

That is a **server-authoritative read model with no new driver**: Convex-style liveness, with declared rather than tracked dependencies. It does not cover:

- tenant or user scoping (the spike has one global channel);
- tag arguments (invalidating `listQuotes({ tag: 'calm' })` and not every tag);
- de-duplication against the sender's own local invalidation (the sender currently refetches twice);
- offline use and optimistic merging (the `updates` option covers the local optimistic case today).

A full sync engine (Zero, Electric, Replicache) would be a driver owning a replica, which is a separate product decision.

## 5. Options compared

| Option | DX | Maintenance | Security surface | Fits "effects as data" | Effort |
|---|---|---|---|---|---|
| A. Status quo (`makeFetchDriver` + hand routes) | ★★ | 12 agreements per 3 endpoints | per-route, ad hoc | ★★★★★ | 0 |
| **B. Contract-first client (`createClient` → request data)** | ★★★★ | 0 agreements; the contract file is the one place | none new on the client | ★★★★★ | S (client ~120 lines + types) |
| **C. B + Sygnal's own Fetch-API handler** | ★★★★★ | Sygnal owns a server library (security fixes, adapters) | moderate: validation, CSRF, SSE, errors | n/a (server) | M (~140 lines spike → maybe 400 with tests/docs) |
| C′. B + an existing server (oRPC / tRPC / Hono RPC / OpenAPI) through adapters | ★★★★ | someone else's server; Sygnal maintains thin adapters | theirs | ★★★★★ (the adapter builds data) | S per adapter |
| D. Function-first (`*.server.ts` + `sygnal/vite`) | ★★★★★ | no contract file; a compiler to maintain | highest (the transform is the boundary) | ★★★★ | M–L |
| E. `$sync` invalidation stream | ★★★★ (liveness for free) | small | channel scoping is the app's job | ★★★★★ | S on top of C |
| F. Full sync engine driver | ★★★★★ for its use cases | large, owns the data layer | large | ★★★★ | L, not core |
| G. GraphQL | ★★★ | schema + codegen pipeline | its own | ★★★★ (an adapter) | not recommended as a default |

## 6. What `sygnal-check` and the types can verify

- **Already works:** with the contract style, `sygnal-check` follows `ok:` / `error:` / `message:` inside the contract call's argument and through the `replies.x(...)` wrapper. Tried with typos: SYG112 "did you mean 'ADDED'" and SYG102 fire exactly as in the baseline, and the clean files have 0 warnings, strict included. No checker change is needed for the existing rules.
- **New, for JS users** (TS users get these from `tsc`):
  - an unknown procedure (`api.listQuote` → "did you mean listQuotes"), resolving the `createClient(contract)` import to the `defineApi({...})` literal;
  - a mutation named in `invalidates`, or an unknown name there;
  - a stream procedure used in `resources`, or a query in `connections`;
  - in function-first, an export that isn't a server function (mirroring the build error, earlier, in the editor).
- **Type drift across deploys** (an old client against a new server) is out of reach statically. The contract can carry a hash the client sends as a header, and the handler could answer a mismatched hash with a 409 "reload", or keep old procedures alive. That is open question 4.
- **The language server:** go-to-definition from `api.addQuote` to the server implementation is a natural follow-up, since the checker already resolves imports for the graph.

## 7. Recommended direction

1. **Ship the client half as an experimental subpath (`sygnal/api`)**: `defineApi`, `query/mutation/stream`, `createClient`, the typed-reducer helpers, and `fixture()`. It is tiny, isomorphic and side-effect free, and it reuses every driver feature (resources, cache, retry, `latest`, SSE resume). It is the part with the highest value per line.
2. **Make the wire protocol pluggable in `createClient`** (URL scheme, method, input encoding, reply unwrap via `parse`), and **decide between Sygnal's own handler and adopting oRPC on the server** (open question 1) before writing more server code. The spike's handler is fine as a reference and a test fixture. Owning a production server library is a long-term security commitment that D209-style reasoning argues against ("don't bundle actively maintained third-party code" points the same way: depend on a maintained server, don't write one).
3. **`$sync` as an opt-in** on whichever server is chosen, plus a `sync: true` option on the client (an app-level connection, likely a `makeFetchDriver` or behavior option rather than a mixin).
4. **`renderComponent(C, { api })`** sugar for in-process tests, and docs for "test against the real backend".
5. **Then function-first** in `sygnal/vite`, built on the same `callable()` and handler pieces, with an AST-based export check, explicit stable names (an optional `name:` per function to survive file moves), and a security review.
6. **Adapters as demand appears:** openapi-typescript `paths` (non-TS back ends), then Hono `AppType`, then tRPC.
7. **Checker rules** for JS users (§6), after the API settles.

### Rough plan

| Phase | Scope | Size |
|---|---|---|
| P0 | Decide open questions 1–3; check oRPC's contract and OpenAPI handler against the spike's tests | 1–2 days |
| P1 | `sygnal/api` client + types + `fixture` + docs page "Typed APIs" + type tests; the spike's tests move to `test/` | ~1 week |
| P2 | The server: an oRPC adapter, or `createHandler` hardened (body size limit, error mapping, `Last-Event-ID` to the stream, per-request context); Hono / Vike / Astro mounting docs | ~1 week |
| P3 | `$sync` with scoping, tag arguments and de-duplication; `renderComponent({ api })`; an eval task "add an endpoint + UI" vs React + tRPC | ~1 week |
| P4 | Function-first in `sygnal/vite` (AST, stable names, prod build of `virtual:sygnal-rpc`, Vike `+server`); checker rules | 1–2 weeks |

## 8. Open questions for the maintainer

1. **Own the server or adopt one?** Building `createHandler` means Sygnal maintains a security-sensitive server library. Adopting oRPC (contract + OpenAPI handler) or recommending Hono RPC/tRPC keeps Sygnal client-only. My lean: client-only plus adapters, and the spike's handler kept as a minimal reference and test helper.
2. **Contract-first, function-first, or both?** Function-first wins on lines and on "no second file", but it costs a compiler, path-derived names and a bigger security review. My lean: contract-first first; function-first later as sugar that produces the same contract.
3. **The name and the reserved path**: `sygnal/api` vs `sygnal/rpc`; the `/rpc` prefix and the `x-sygnal-rpc` header name.
4. **Version skew**: during a deploy, old clients call new servers. Should the contract hash be sent and checked, or should old procedures be kept alive?
5. **Are typed-reducer wrappers acceptable as a canonical form** (`ADDED: replies.addQuote((state, quote) => …)`)? The alternative is `type Actions = { ADDED: Output<typeof api.addQuote> }` on `Component<…>`, which is canonical today but longer. Either way, `sygnal-check` already handles both.

## 9. Notes on Sygnal found during the spike

- No core changes were needed. `invalidates` works without a `queryCache`, `{ invalidate }` is app-wide, and `makeSocketDriver({ fetch })` with `headers` makes SSE work in Node and jsdom. All three features made this possible.
- `renderComponent(C, { drivers: { HTTP: makeFetchDriver({ fetch }) } })` runs a real backend in a component test without any fake.
- Vite's esbuild can't start inside a jsdom Vitest environment (a `TextEncoder` invariant), so a test that needs a Vite dev server must start it in `globalSetup`.
