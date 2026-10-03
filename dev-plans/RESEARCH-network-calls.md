# Research: network calls in Sygnal (HTTP, WebSocket, RPC)

> Superseded in part by [PLAN-3.md](PLAN-3.md): main already has `makeFetchDriver` (PLAN-2 E2), and the 5.x/6.0 phasing below was folded into 6.0.0 there.

Status: research / proposal (2026-10-01). Nothing here is implemented.

## 1. The problem, measured

A request/response today touches four places, joined by a string:

| # | Where | What |
|---|---|---|
| 1 | `main.js` | register a driver: `run(App, { QUOTE: driverFromAsync(fetchQuote) })` |
| 2 | `model` | send a request: `LOAD: { QUOTE: s => ({ category: 'quote', value: s.id }) }` |
| 3 | `intent` | turn replies back into actions: `LOADED: QUOTE.select('quote')`, `FAILED: QUOTE.errors('quote')` |
| 4 | `model` | handle the reply: `LOADED: (s, { value }) => …` |

Steps 2 and 3 are one logical operation, a call and its continuation, split across intent and model. The `category` string is the only thing that joins them. Nothing in the call site says where the answer goes. A reader has to search for the category to follow the flow.

Evidence from `evals/agent-ergonomics` (phase 3, task 05 "fetch a quote with loading and error states"):

- **Time:** Sygnal 58.3 s mean vs React 37.2 s. This is still one of the larger tier-1 gaps after PLAN-1.
- **Code:** Sygnal 103 changed lines across 3 files (component, driver, `main.js`) vs React 62 lines in 1 file.
- **Bugs:** B-005 (rejections swallowed), G-015 (driver sinks untestable via `simulateAction`) and G-069 (a reply with no `select()` listener throws) are all symptoms of this shape.
- **Hidden reference solution:** it avoids the error channel entirely by folding errors into `{ ok }` in the driver. Even the "correct" answer is working around the shape.

What agents reach for first is `async () => { set loading; try { await fetch } catch { set error } }`. In Sygnal, that pattern already half-works through `EFFECT` + `next()` (see Option A).

WebSockets are a different case. A socket really is a stream in and a stream out, so the source/sink shape fits it. The pain there is **lifecycle**: who opens the socket, when it closes, reconnection, and per-component scoping. Shape isn't the problem.

## 2. Prior art

| System | Model | Lesson for Sygnal |
|---|---|---|
| Cycle.js `@cycle/http` | the same as today: `HTTP.select('cat').flatten()` | the origin of the pain; `flatten()` of response streams is worse still |
| **Elm** `Cmd Msg` | `Http.get { url, expect = Http.expectJson GotQuote decoder }`; the command names the message its result becomes | **the call site names its continuation**; still pure data, still effect-as-description |
| Elmish (`Cmd.OfPromise.either fn arg Ok Err`), Hyperapp 2 (`[request, { url, action: GotQuote }]`), redux-loop | the same idea in JS | proven in JS; effects stay data and stay testable |
| **Elm subscriptions** / Hyperapp subscriptions | `subscriptions : Model -> Sub Msg`; the runtime diffs them and opens/closes sources | **the right model for sockets, SSE and timers**: lifecycle is derived from state |
| TanStack Query, Solid `createResource`, Angular `httpResource` (stable in v20) | a read is a declarative function of inputs; status/value/error are exposed; it refetches when inputs change | agents know `useQuery` well; it handles reads (not mutations) almost for free |
| RTK `createAsyncThunk` | the `pending/fulfilled/rejected` action triple | familiar naming for the status actions |
| XState `invoke: fromPromise` with `onDone`/`onError` | a call bound to a continuation, inside a machine | the same idea as Elm; too heavy to adopt wholesale |
| Telefunc (Vike), TanStack Start `createServerFn`, SolidStart/Next `"use server"`, Astro Actions | the compiler turns a server function import into a fetch stub | the most ergonomic option; it carries a real security surface (React2Shell, CVE-2025-55182, Dec 2025: pre-auth RCE via server-function payload deserialization, CVSS 10) |

## 3. Options

All examples implement the task-05 quote component. The view is unchanged throughout:

```jsx
function Quote({ state }) { /* button.load, shows state.status / state.quote */ }
```

### Option A: Async EFFECT, made first-class (the "agent-native" escape hatch)

This works today, with rough edges:

```jsx
Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
Quote.model = {
  LOAD: {
    STATE:  (state) => ({ ...state, status: 'loading' }),
    EFFECT: async (state, data, next, { signal }) => {
      try {
        const res = await fetch(`/api/quotes/${state.id}`, { signal })
        if (!res.ok) throw new Error(res.statusText)
        next('LOADED', await res.json())
      } catch (error) { next('FAILED', error) }
    },
  },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote }),
  FAILED: (state)        => ({ ...state, status: 'error' }),
}
```

Today's gaps (`src/component.ts:1028` `makeEffectHandler`):

- An async EFFECT returns a Promise, which triggers SYG219 ("returned a value, which is ignored").
- Rejections escape the `try/catch` and become unhandled rejections; SYG214 never fires.
- There's no `AbortSignal` and no dispose guard, so `next()` can fire after unmount.
- There's no concurrency control: a slow first response can overwrite a fast second one.
- `sygnal-check` SYG102 already understands `next('X')` as a trigger, which is good.

What it would take (non-breaking, small):

- Treat a returned thenable as expected.
- Route rejections to SYG214.
- Pass `{ signal }` (in props/4th arg): it aborts on DISPOSE, and on re-entry when the entry opts into `latest`.
- Make `next()` a no-op after dispose.

| | |
|---|---|
| Agent ease | ★★★★★ This is exactly what agents write unprompted |
| Reviewability | ★★★☆ It reads top to bottom, but it is imperative code inside the model |
| MVI purity | ★★☆ The effect runs in the model, not a driver. Untestable without mocking global `fetch`. Not serialisable or replayable in devtools |
| Breaking | No |

Position: fix it and document it as the escape hatch for one-off async work. Don't make it the canonical form.

### Option B: Reply-routed requests (Elm `Cmd` style)

The request names its continuation actions. The framework routes the driver's reply back into the **sending component's** action stream, so the intent wiring disappears. Add a built-in `HTTP` driver (fetch-based) so `main.js` changes disappear too.

```jsx
Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
Quote.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    HTTP:  (state) => ({ url: `/api/quotes/${state.id}`, ok: 'LOADED', error: 'FAILED' }),
  },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote }),
  FAILED: (state, { status, error }) => ({ ...state, status: 'error' }),
}
// main.js: run(Quote): nothing to register
```

Design points:

- **Generic protocol, not HTTP-only.** Any request object with `ok` and/or `error` keys is reply-routed. `driverFromAsync` gets it for free: `QUOTE: s => ({ value: s.id, ok: 'LOADED', error: 'FAILED' })`. Custom drivers opt in by echoing a request id. The old `category` + `select()` form keeps working.
- **Key names:** never use `then` (an object with `then` is a thenable and breaks `await`). `ok`/`error` mirrors `res.ok`. `onDone`/`onError` (XState) is the alternative.
- **HTTP request shape:** `{ url, method?, body?, headers?, as?: 'json'|'text'|'blob'|'response', ok, error, key?, mode?: 'latest'|'queue'|'parallel', timeout? }`. Behaviour:
  - JSON by default.
  - A non-2xx response is an error, with payload `{ status, body, error, request }`. The B-005 trap goes away by design.
  - `key` + `mode: 'latest'` aborts the previous in-flight request (search-as-you-type races).
  - Everything is aborted on component DISPOSE.
- **Named continuations only.** Inline reducers (`ok: (s, d) => …`) are not allowed. Named actions stay visible in devtools, `simulateAction`, logs and the static checker.
- **Checker:** SYG102 accepts `ok: 'X'` as a trigger. A new SYG1xx code flags an `ok`/`error` name with no model entry. Strict mode can later flag the `select(category)` round-trip as an alternative form.
- **Testing:**
  - The request is plain data, so `t.sinkValues('HTTP')` asserts it.
  - `renderComponent(Quote, { http: { 'GET /api/quotes/1': { text: 'hi' } } })` mocks responses (a route table), with no global `fetch` mock.
  - `simulateAction('LOADED', …)` still works. This fixes G-015's driver half.

| | |
|---|---|
| Agent ease | ★★★★ Shaped like RTK's pending/fulfilled/rejected; one obvious place to write it; the checker catches a wrong name |
| Reviewability | ★★★★★ The call and where its answer goes are on one line |
| MVI purity | ★★★★★ The model still returns a description and the driver still does the I/O. This is how Elm does it |
| Breaking | No (additive). Built-in `HTTP` reserves a sink name; check collisions with user drivers named `HTTP` (user driver wins + warning in 5.x) |

### Option C: Declarative resources (reads as a function of state)

For reads, the most common case, there is no action at all. The data lives in the one state tree, so SSR/HYDRATE, devtools and tests still see it.

```jsx
Quote.resources = {
  quote: (state) => state.id && { url: `/api/quotes/${state.id}` },  // null/false = idle
}
// state.quote === { status: 'idle'|'loading'|'success'|'error', data, error, updatedAt }
function Quote({ state }) { /* state.quote.status, state.quote.data */ }
Quote.model = {
  REFRESH: { RESOURCE: 'quote' },          // manual refetch, still an action
}
```

- The resource refetches when the derived request changes (structural compare), and aborts the stale request.
- It is implemented **on top of Option B**: each fetch is an `HTTP` request with synthetic `ok`/`error` actions (`RESOURCE:quote/success`). Every state change therefore still goes through a reducer and shows up in devtools. This keeps the "all state changes are actions" invariant.
- Later additions (same API): a shared cache and dedupe across components, `staleTime`, and SSR prefetch through Vike's `data()` hook plus HYDRATE.
- Mutations stay Option B (`SAVE: { HTTP: … ok: 'SAVED' }`), optionally with `invalidates: ['quote']`.

| | |
|---|---|
| Agent ease | ★★★★★ for reads: it is `useQuery`/`httpResource`, which agents know cold |
| Reviewability | ★★★★★ |
| MVI purity | ★★★★ Derived from state, desugars to actions; a little framework magic writing into a state key |
| Breaking | No in principle; realistically a 6.0 headline feature (new static, new reserved state-key semantics, SSR integration) |

### Option D: Subscriptions for WebSocket, SSE and timers (Elm `Sub` style)

Connections are declared as a function of state. The runtime diffs them: it opens new ones, closes removed ones, reconnects with backoff, and closes everything on dispose. Incoming messages arrive as named actions. Outgoing messages use a sink with the subscription's name.

```jsx
Chat.subscriptions = (state) => ({
  room: state.roomId && socket(`/ws/rooms/${state.roomId}`, {
    message: 'RECEIVED', open: 'CONNECTED', close: 'DISCONNECTED',   // all optional
  }),
  clock: every(1000, 'TICK'),
})
Chat.intent = ({ DOM }) => ({ SEND: DOM.submit('.composer').map(/* text */) })
Chat.model = {
  SEND:      { room: (state, text) => ({ type: 'say', text }) },  // JSON-encoded and sent on that socket
  RECEIVED:  (state, msg) => ({ ...state, messages: [...state.messages, msg] }),
  CONNECTED: (state) => ({ ...state, online: true }),
  TICK:      (state) => ({ ...state, now: Date.now() }),
}
```

- The same mechanism covers `eventSource(url, …)` (SSE), `every(ms, …)`, `media('(prefers-color-scheme: dark)', …)` and so on. That replaces a family of hand-written drivers and BOOTSTRAP/DISPOSE bookkeeping.
- A shared connection: two components subscribing to the same URL share one socket (ref-counted).
- **Lighter alternative (5.x):** ship a `socketDriver(url)` factory now. The source has `.messages(filter?)` and `.status()`; the sink sends; it handles reconnect and JSON. It keeps the current shape (which suits sockets), solves most of the pain, and can later become what subscriptions desugar to.

| | |
|---|---|
| Agent ease | ★★★★ Agents otherwise write `new WebSocket` in an EFFECT and leak it |
| Reviewability | ★★★★★ "This component is connected to X while Y" is literally written down |
| MVI purity | ★★★★★ This is Elm's architecture verbatim |
| Breaking | No (new static); 6.0-sized |

### Option E: Typed server functions (RPC)

```ts
// quotes.server.ts: only ever runs on the server
export const getQuote = serverFn(z.object({ id: z.number() }), async ({ id }, ctx) => db.quote(id))
```

```jsx
import { getQuote } from './quotes.server'   // sygnal/vite rewrites this to a fetch stub on the client
Quote.model = {
  LOAD: { RPC: (state) => call(getQuote, { id: state.id }, { ok: 'LOADED', error: 'FAILED' }) },
}
```

- RPC plugs into Option B (`call()` produces a reply-routed request), Option C (`resources: { quote: s => call(getQuote, { id: s.id }) }`) and Option A (`await getQuote(...)`). It isn't a competing model; it is a transport.
- **Security requirements** (non-negotiable if Sygnal builds its own):
  - **File-based only** (`*.server.ts`). No inline `"use server"` closures, so nothing in scope can be captured or leaked implicitly.
  - **Mandatory input validator** (Standard Schema: zod/valibot/arktype) at definition. A server function without one is a build error.
  - **Plain JSON on the wire.** No rich or reference-preserving serialisation formats; React2Shell was exactly that attack surface.
  - POST only, with a required custom header and an `Origin` check (CSRF).
  - The request context (`ctx`: cookies, session) is explicit, and auth is the function's job: every function is a public endpoint.
  - Stable but non-guessable endpoint IDs, an allow-list manifest, and no directory enumeration.
- **Cheapest path:** Sygnal already integrates with Vike, so support **Telefunc** first (it already has `shield()` validation and a security track record). Build a native `serverFn` only if demand appears outside Vike/Astro.

| | |
|---|---|
| Agent ease | ★★★★★ Typed end to end, no URL strings |
| Reviewability | ★★★★ |
| MVI purity | n/a (transport) |
| Breaking | No; requires a server runtime, so it applies only to SSR/Vike/Astro apps |

### Considered and rejected

- **Async intent** (`DOM.click(…).map(() => xs.fromPromise(fetch(…))).flatten()`). It already works, but it puts I/O in intent, and `flatten` semantics are a known agent stumbling block (SYG301 territory).
- **XState-style machines/actors.** Too much new surface for the problem; Option B's `ok`/`error` is the useful 10% of `invoke`.
- **Hooks (`useFetch` in the view).** This breaks Sygnal's "views are pure, no event binding" design decision.

## 4. Recommendation

The options are layers, not rivals. B is the foundation that C and E build on. A and D cover what B doesn't.

**5.x (additive, ships the biggest win cheaply)**

1. **Option B: reply routing plus a built-in `HTTP` driver.** This is the core fix. Reply routing removes the intent half of the round trip, and the built-in driver removes the `main.js` half and the B-005 class of bugs. It needs a route-table mock in `renderComponent`, the checker rules, and llms.txt/skill/docs updates with the new canonical form. The old category form moves to `advanced/alternative-forms`.
2. **Option A hardening.** Promise-aware EFFECT, rejection reporting, `signal`, dispose guard. It is small, it removes footguns agents already hit, and it is documented as the escape hatch.
3. **`socketDriver()`** (the lighter Option D): a reconnecting JSON socket with `.messages()`/`.status()`.
4. **Re-run eval task 05** and add two new tasks: "search-as-you-type with stale-response race" (`key`/`latest`) and "chat over WebSocket". The success bar is to close the task-05 gap to React (≤ 45 s) with zero driver files.

**6.0 (the bigger, opinionated shape)**

5. **Option C: `resources`** for reads, desugared to B, with Vike SSR prefetch.
6. **Option D: `subscriptions`** for sockets/SSE/timers; `socketDriver` becomes its implementation.
7. **Strict mode** flags the `select(category)` round trip for built-in HTTP (a new SYG5xx code).
8. **Option E:** Telefunc integration docs + `call()` adapter; a native `serverFn` only under the security rules above.

Why B over A as the canonical form: A matches agent instinct most closely, but it gives up what makes Sygnal worth choosing over React. A has no pure model, no data-only effects, no mock-free tests and no devtools replay. B costs agents almost nothing: one object literal with two action names, and the checker validates the names. It also reads better in review than either A or today's form, because the call and its continuation are on the same line. The eval re-run in step 4 is where this judgement should be tested; if B doesn't close most of the gap, revisit promoting A.

Open questions for the maintainer:

- Is `HTTP` the right built-in sink name? It risks colliding with existing `@cycle/http`-style user drivers. `FETCH` is the alternative.
- Should reply payloads for `ok` be the parsed body only (simplest), or `{ data, status, headers }` (more complete)? Recommendation: the body only, with `as: 'response'` as the opt-out.
- Should `resources` state live at a top-level key (`state.quote`) or a reserved namespace (`state.$resources.quote`)? A top-level key reads better; a namespace avoids collisions and lenses more cleanly.
