# PLAN-3: Network Layer and the rest of 6.0.0

> **Plan renumbering (2026-10-02, the user's decision):** later plans are numbered by run order. In PLAN-3 documents written before this date, "PLAN-4" means the ecosystem plan, now **PLAN-5**. The new **PLAN-4** is "controls and core ergonomics" (`claude/sygnal-feature-gaps-c61a02:dev-plans/PLAN-4.md`); it runs after PLAN-3 and before PLAN-5. Earlier text is left unchanged.

**Goal:** make network calls (HTTP, WebSocket, server-sent events, and later server functions) a first-class part of Sygnal for 6.0.0. A request and the place its answer goes should read together. Connections should follow component and state lifecycles. Tests should script both without wiring. 6.0.0 also takes the PLAN-2 carry-over items (G-140…G-143, G-133, N-1).

**Amended 2026-10-02 (D74–D82):** PLAN-3 also takes the query cache, the SPA router and a `HEAD` driver for 6.0.0, handed over by the ecosystem-research session (PLAN-4, `claude/sygnal-component-research-b1873e:dev-plans/HANDOFF-to-PLAN-3.md`; its H- and R- items are mapped in the tracker). See §1.4 (as built), §1.6, §1.7 and Phase 5. PLAN-4 starts after PLAN-3 and depends on: the generic `__sygnalStatic` declaration mechanism, a Standard Schema helper module, a focus/online/visibility listener module, and the remaining budgets (recorded in the tracker).

MVI stays intact, as in PLAN-1 and PLAN-2:
- models return descriptions of effects;
- drivers perform the effects;
- every state change is an action;
- views have no event binding.

**Status:** plan only. No code changes until the user approves §8. A tracker, `dev-plans/PLAN-3-status.md`, will be created in the PLAN-2 format when Phase 0 starts.

**Starting point** (main `6b7144e`; 6.0.0 prepared and held open, D56):

| | Sygnal | React | Gap |
|---|---|---|---|
| Opus 5.5, all shared tasks (`p4-final2`) | | | +12.4 s |
| Task 05 async driver | 26.2 s | 22.8 s | **+3.4 s** (5.4.0: +15.2 s) |
| Task 11 search-debounce | | | +25 s |
| Task 13 course-portal | | | +22 s |
| Task 17 address lookup | 70.7 s | 40.6 s | **+30 s** |
| Haiku 4.5 pass rate | 71/95 | 62/95 | Sygnal ahead; 1.54× wall |

On Haiku's tasks 11 and 17, `latest: true` gave Sygnal 3/5 on task 11, where React agents missed request invalidation in 10 of 10 trials. The remaining Haiku cost is comprehension, not correctness (REPORT-v2).

**Inputs:**
- [`RESEARCH-network-calls.md`](RESEARCH-network-calls.md): options A–E and prior art. That research predates PLAN-2's E2; §0 reconciles the two.
- `PLAN-2-status.md` carry-over: G-140, G-141, G-142, G-143, G-133, N-1; decisions D52, D54, D56.
- `evals/agent-ergonomics/results/PHASE3-RESULTS.md` (E2) and `REPORT-v2.md` (async and Haiku findings).
- `src/extra/fetchDriver.ts`; the fake sources in `src/extra/testing.ts`; the legacy `HTTP 'initial'` path in `src/component.ts` (around line 580).
- ROADMAP §16.

**Gap in the inputs:** the tracker cites "10 open design questions" in E2's report. They were never committed: not in PHASE3-RESULTS, nor in commit `dbb884a`, whose branch has been deleted. ROADMAP §16 keeps four of them (Q-net-1…4 below). If the coordinator notes from that session still exist, add the rest to §8.

**Constraints (unchanged from the handover):**
- Canonical forms per CLAUDE.md, and the agent-facing sync rule (PLAN-2 §1).
- `llms.txt` ≤ 250 lines, byte-identical in `docs/public`. It is 235 lines now.
- Size gate: `node scripts/size-gate.mjs`, 42,300 B. The last recorded value is 42,105 B (4-R), so only about 195 B of headroom; re-measure in 0-A.
- Eval trials run only from the user's Terminal panel. The coordinator prepares the commands, and the G-127 process guard stays on.
- No version bumps, tags, PR to main or publish (D56). Network-layer changes go into the existing CHANGELOG `[Unreleased]` entry.

**Non-goals:**
- A native server-function runtime (see §1.5; it can land later as an additive feature).
- GraphQL clients.
- Offline sync and caching beyond a resource's dedupe.
- Replacing xstream.

---

## 0. Reconciling the research with main

The most important fact: **`makeFetchDriver`, `t.respond`, `t.fail` and `t.requests` are unreleased.** They exist only in `[Unreleased]`, so 6.0.0 can reshape them with no migration cost. Only 5.4.0 APIs need migration entries.

| Research option | What main already has | Effect on the plan |
|---|---|---|
| **B. Reply-routed requests** (`ok: 'LOADED', error: 'FAILED'`) | `makeFetchDriver` with `select(category)`/`errors(category)`, `latest`, `abort`, per-scope isolation (D54). E2 already removed the driver file, `fetch` in components (20/20 → 0/20) and request ids. | **Extends.** The driver half is done. Routing removes what is left of the round trip: the intent half, the `category` string and the select/errors split. Expect a smaller time win than the research projected (task 05 is already at +3.4 s). The bigger wins are fewer concepts, which is Haiku's comprehension cost, reviewability, and tests (G-140/G-141). The eval in Phase 4 must show it. |
| **A. Async EFFECT** | Unchanged since 5.4.0. llms.txt says "HTTP goes through `makeFetchDriver`, not `fetch` + `next()`", and E5 flagged that the `next()`-after-`await` fact might pull agents back to fetch-in-EFFECT. | **Harden it, don't promote it.** Make it safe for non-HTTP async work (IndexedDB, clipboard, workers). Agent docs keep pointing HTTP at the driver. |
| **C. `resources`** | Nothing yet. | **New**, built on B. Additive, so it can slip past 6.0.0 if the eval says so. |
| **D. `connections`** (WebSocket/SSE) | Nothing built in. The docs show a hand-written `makeWebSocketDriver` (`integration/vike.md`) and a `WEBSOCKET: () => ({ type: 'close' })` DISPOSE example. | **New.** ROADMAP §16 asks for "one model for HTTP and WebSocket"; §1.3 does this by reusing B's routing. |
| **E. RPC** | Nothing. | **Docs and a Telefunc adapter only** in 6.0.0 (§1.5). |
| `driverFromAsync` | 5.4.0 canonical form for custom async drivers; G-069 buffering fixed. | **Extends.** It gets reply routing too. It moves to alternative forms for HTTP, but stays canonical for non-HTTP promise APIs. |
| Legacy `HTTP 'initial'` hydration (`component.ts`, `requestSourceName`) | Skipped for `__sygnalFetch` sources (R4-7). | **Remove in 6.0.0** (breaking; §3). It only serves `@cycle/http`-style sources, and SSR data arrives through `HYDRATE`/Vike `+data`. |

**Carry-over items:**

| Item | Absorbed? | Plan |
|---|---|---|
| **G-133** (an isolated mid-level parent sees descendants' replies) | **Absorbed for canonical code.** A routed reply goes to exactly the component instance that sent the request. Routing is by a sender-instance tag, not the isolation scope, so it also works for unisolated children. | `select()`/`errors()` (now an alternative form) keep the D54 subtree semantics, which stay compatible with `@cycle/http`. Close G-133 as "keep, documented" (Q4). |
| **G-140** (`t.respond` on a superseded request fails asynchronously) | **Not absorbed.** Routed requests still need fakes. | Redesign the fakes in 1-C. `t.respond`/`t.fail` throw **synchronously** when no matching request is pending, which is the `expect(() => …).toThrow()` that 4 of 5 agents wrote. On success they return a promise that resolves after the reply action has been reduced. |
| **G-141** (`t.requests` lists abort commands) | **Not absorbed.** | `t.requests(name)` lists requests only; `t.sinkValues(name)` keeps everything. Matching by content, not identity (the E2 13-t4 friction), goes in the same change. |
| **G-131** (child string requests in the fake aren't scope-tagged) | Absorbed: the fake routes by sender instance, like the real driver. | 1-C. |
| **G-134** (lowercased header names) | Unchanged. The CHANGELOG line is already present. | None. |
| **G-142** (`renderComponent<S>` typing) | Not network-related. | Workstream 1-T (types), together with the new network types. |
| **G-143** (Haiku diagnostics and docs gaps) | Not network-related. | Workstream 1-G, in parallel. |

---

## 1. Target design (6.0.0)

There is one mechanism, with three uses:

1. A **routed request** names its continuation actions, and the framework delivers the driver's reply as that action, to exactly the sending component instance.
2. **Declarations** (`connections`, `resources`) are state-derived values that the core sends to a driver sink. The driver diffs them and opens, closes or fetches, and its events come back as routed actions.
3. Core cost: a sender tag on sink values, one routed-reply subscription per component per routing-capable driver, and a `state → sink` map for each declaration static. The protocol work lives in the drivers, which cost 0 B unless used.

### 1.1 HTTP: routed requests (canonical)

```jsx
Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
Quote.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    HTTP:  (state) => ({ url: `/api/quotes/${state.id}`, ok: 'LOADED', error: 'FAILED' }),
  },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote }),            // data = the parsed body
  FAILED: (state, { status }) => ({ ...state, status: status === 404 ? 'missing' : 'error' }),
}
```

- **Request shape:** E2's shape is kept unchanged (`url, method, query, json, body, headers, latest, timeoutMs, parse, init`), plus `ok` and `error`. A string is still a GET with no routing.
- **`ok` data:** the parsed body, which is what agents expect. `parse: 'response'` gives the `Response`. Status and request are available on the error payload. Q2 covers whether `ok` should get them too.
- **`error` data:** `{ error, status, body, request }`, the same as E2's errors payload without `category`.
- **No `category`:** `latest: true` cancels earlier in-flight requests *with the same `ok` action* from the same instance. An explicit `key: 'search'` overrides this. `{ abort: 'LOADED' }` (or `{ abort: true, key }`) cancels them. Removing category strings removes the last string join.
- **Delivery:** a reply from the sending instance becomes `{ type: ok, data }` on its action stream. If the instance is gone (Collection item removed, page disposed), its requests were already aborted, so nothing arrives.
- **Unrouted requests:** a request without `ok`/`error` still reaches `select()`/`errors()`, which are kept as an alternative form for stream-level composition. Strict mode flags `HTTP.select()` when a routed form would do (new SYG508).
- **Registration:** E2 found that agents accept `run(App, { HTTP: makeFetchDriver() })` ("a single import away"). Making `HTTP` built in would add about 1.3 KB to every app and break the size gate. **Recommendation (Q3): keep explicit registration.** SYG609 and `renderComponent`'s automatic fake already cover a missing driver. Component-declared drivers (ROADMAP Q-net-1) stay out of scope.
- **Generic routing:**
  - Any driver whose replies echo `request` can opt in by marking its source `__sygnalRoutes`. `makeFetchDriver`, `driverFromAsync` and the new socket driver all do.
  - Custom drivers get a small helper (`routable(source)`) or keep `select()`.
  - The `ok`/`error` keys are reserved only on sinks of routing-capable drivers.
  - **Never `then`:** an object with a `then` key is a thenable and breaks `await`. The checker rejects `then`/`catch` keys in requests.
- **Checker:**
  - SYG102 accepts `ok: 'X'`, `error: 'X'` and `message: 'X'` (and the other §1.3 keys) as triggers.
  - New SYG1xx (static and runtime): a routed action name with no model entry. This is the routed equivalent of SYG101, and it catches typos.

### 1.2 Async EFFECT hardening (escape hatch, non-HTTP)

`EFFECT: async (state, data, next, { signal }) => { … next('DONE', result) }`

Behaviour changes:
- A returned thenable no longer triggers SYG219.
- A rejection is reported as SYG214.
- `next()` after dispose is a no-op with a debug log.
- `props.signal` is an `AbortSignal` aborted on DISPOSE.

There is no concurrency option; work that needs `latest` belongs in a driver. Docs: an "Async work that isn't HTTP" section. llms.txt keeps its one-line pointer, and the HTTP recipe stays §1.1.

### 1.3 WebSocket and SSE: `connections`

```jsx
Chat.connections = (state) => ({
  room: state.roomId && {
    socket: `/ws/rooms/${state.roomId}`,              // or sse: '/events/…' (read-only)
    message: 'RECEIVED', open: 'CONNECTED', close: 'DISCONNECTED', error: 'SOCKET_ERROR',  // all optional
  },
})
Chat.intent = ({ DOM }) => ({ SEND: DOM.submit('.composer').map(e => e.target.text.value) })
Chat.model = {
  SEND:      { WS: (state, text) => ({ to: 'room', json: { type: 'say', text } }) },
  RECEIVED:  (state, msg) => ({ ...state, messages: [...state.messages, msg] }),   // JSON-parsed when it parses
  CONNECTED: (state) => ({ ...state, online: true }),
}
// main: run(Chat, { WS: makeSocketDriver({ baseUrl, reconnect: { maxDelayMs: 10000 } }) })
```

- **How the core sends declarations:** the core maps the state stream through `connections`, drops structurally equal repeats, and sends `{ connections: {...} }` (sender-tagged) to the `WS` sink. The driver diffs by `(instance, name)`:
  - it opens new connections and closes removed ones;
  - a falsy entry means "closed";
  - a changed URL closes the old connection and opens the new one;
  - DISPOSE closes everything.
- **Driver behaviour:**
  - reconnection with jittered backoff;
  - outgoing messages queued while connecting (bounded);
  - `json` stringified, `text`/`binary` sent as-is;
  - incoming JSON parsed when it parses;
  - connections shared by URL across instances, ref-counted;
  - no connections during SSR.
- **One driver, two transports:** SSE (`sse:`) uses `EventSource` and the same keys, minus sending.
- **Tests:**
  - `t.connections('WS')` lists what is open;
  - `t.push('WS', 'room', msg)` delivers a message;
  - `t.close('WS', 'room', { code })` closes a connection;
  - `t.sent('WS')` lists outgoing messages.

  All of them are matched by content, and they throw synchronously when nothing matches (the G-140 lesson).
- **Timers and media queries:** `every(ms, 'TICK')` and similar declarations would use the same mechanism, but they are **out of scope** unless they come for free.
- **Q5:** the static's name. Options are `connections` and Elm's `subscriptions`; the latter clashes with stream "subscriptions" in Sygnal's own docs.

### 1.4 Declarative reads: `resources` (ships in 6.0.0; the eval decides canonical vs advanced, D74)

As built in 3-A (`exp/p3-resources`), amended by D78:

```jsx
Quote.resources = { quote: (state) => state.id && `/api/quotes/${state.id}` }   // a URL or a request; falsy = idle
// state.quote = { status: 'idle' | 'loading' | 'success' | 'error', data, error, refreshing? }
Quote.model = { REFRESH: { HTTP: { refresh: 'quote' } } }
```

- The core sends the state-derived map to the source that declares the `resources` static (`__sygnalStatic`, generalised from 2-B's `connections`); the driver fetches a changed request with latest semantics and writes `state[name]` through the built-in `RESOURCE` action, so every write is an action.
- **D78 (reloads):** a refetch of the **same** request (refresh, invalidation, focus, polling) keeps `data` and sets `refreshing: true`; a **key change** clears `data` (status `loading`) unless the resource sets `keepPrevious: true` (pagination). This keeps task 23's "no stale quote while loading" and SWR-style refreshes.
- `ok`/`error` on a resource also dispatch those actions after the write. Writes (POST) stay reply actions (§1.1).
- Risks to handle in Phase 5: a user key named like a resource is overwritten; a one-render glitch (old `success` before `loading`); a silent no-op without `makeFetchDriver` (like G-161); JSON-based change detection.

### 1.5 Server functions (6.0.0: docs plus an adapter only)

- **6.0.0:**
  - a guide page for Telefunc with Vike, called through `driverFromAsync` with routing (`TELEFUNC: s => ({ value: s.id, ok: 'LOADED' })`);
  - a tiny `makeAsyncDriver(fns)` convenience that routes `{ call: 'getQuote', args, ok, error }` if it fits the size budget.
- **Later, a native `serverFn`:** only under the research's security rules:
  - `*.server.ts` files only;
  - a mandatory Standard Schema validator;
  - plain JSON on the wire;
  - POST with a custom header and an Origin check;
  - an explicit `ctx`;
  - an endpoint manifest.

---

### 1.6 Query cache in `makeFetchDriver` (D79, D80)

All of it lives in the fetch driver (0 B core) and the fake runs the real driver (H-9), so there is one copy of every rule.

- **Opt-in:** `makeFetchDriver({ cache: true | { staleTime, gcTime, refetchOnFocus, refetchOnReconnect } })`. When on, resources use stale-while-revalidate (`staleTime` default 0: cached data shows at once, then refetches, `refreshing: true`), identical in-flight cacheable requests are **de-duplicated** across instances (each sender still gets its reply as its own action; a fetch aborts only when no sender wants it), and focus/reconnect refetch stale mounted resources. Reply-action requests stay one-send-one-request unless they set `cache: true`. Off by default so existing semantics (and task 23's spec) hold.
- **Polling:** `refetchEvery: ms` per resource, paused while the document is hidden. Opt-in.
- **Invalidation:** `{ invalidate: tag | tags | '/url-prefix' | (req) => boolean }` from any component; resources and cache entries carry explicit `tags`. No derived tags. Mounted matches refetch (keeping data, D78); works with or without the cache. Sugar on a write: `invalidates: ['quotes']`, on success only.
- **Retries:** `retry: n | { count, delayMs, maxDelayMs, jitter }`, **default 0 everywhere**; GET/HEAD only unless set on the request; network errors, 408, 429 (`Retry-After`), 5xx. The `error` action fires once with `{ attempts }`. Same backoff semantics as the socket driver's `reconnect`.
- **Validation:** `validate: schema` (any Standard Schema) on a request or resource; a failure goes to `error` with `{ issues }`. Helper in its own module (`src/extra/standardSchema.ts`), reused by PLAN-4's forms and by server functions.
- **SSR seeding:** `dehydrate()` / `hydrate()` on the driver and `makeFetchDriver({ initialCache })`; a `{ prefetch: request }` sink command warms the cache without a reply (router link hover). Vike `+data` prefetch into the cache; verify in a real Vike app (with G-165).
- **Testing and inspection:** `t.cache('HTTP')`, `t.focus()`, `t.online()`; triggers are off in the fake unless a test enables them; retries run on fake timers. `inspect()` lists in-flight requests, cache entries and resources. A devtools panel view is a stretch item.
- **Diagnostics:** a non-idempotent cached request (POST with `cache`/`staleTime`); `validate` that isn't a Standard Schema; `invalidate` matching nothing (info, dev only).
- Recipes (docs only, H-10): optimistic update with rollback, pagination with `keepPrevious`, infinite list, mutation status.
- The focus/online/visibility listeners are an internal module PLAN-4 reuses.

### 1.7 Router and `HEAD` driver (D81, D82)

- **Naming first (D82):** "routed requests" become **reply actions** in the docs; `src/extra/routing.ts` → `replies.ts`; SYG112's title and the inspect trigger (`'routed'` → `'reply'`) follow. The router owns the word "route".
- **Driver:** `run(App, { ROUTER: makeRouterDriver({ routes: { home: '/', task: '/tasks/:id', notFound: '*' }, base, mode: 'history' | 'hash' }) })` (0 B core unless used; must confirm the route static costs ~0 B core in the 5-0 spike).
- **Reading the route:** option (a): a declaration static names a reply action (`App.route = 'ROUTE'`), and the app's own reducer stores `{ name, params, query, hash, path }`; guards and redirects stay in the model (`ROUTE` can return `ROUTER: { to, replace: true }`).
- **Rendering:** `<Switchable of={{ home: Home, task: Task }} current={state.route.name} />`; whether route pages keep alive (Switchable's 6.0 default) is decided in the workstream.
- **Navigating:** sink commands `{ to, params, query }`, `{ back: true }`, `{ replace: true }`; links are plain `<a href={href('task', { id })}>`; the driver intercepts same-origin anchor clicks at the document level (views bind no events), respecting modifier keys, middle-click, `target`, `download`, external origins and an opt-out attribute. Unsaved-changes guard: `{ block: 'CONFIRM_LEAVE' }`.
- **Data:** no loader API: pages derive `resources` from `state.route.params`; link-hover `{ prefetch }`; SSR seeds the cache (§1.6).
- **Extras:** scroll restoration; focus management after navigation; `document.title` per route through the **`HEAD` driver** (title/meta/link, SSR-aware; X-1).
- **Tests:** `t.navigate('/tasks/2')`, `t.location`, `t.back()`; the fake runs the real driver over an in-memory history.
- **Diagnostics:** unknown route name; missing/extra params in `{ to, params }` / `href()`; a Switchable `current` that isn't a route name; `makeRouterDriver` inside a Vike app. Typed `href()` from the route table.
- **Vike:** aim for one API (the `ROUTER` sink maps to Vike's `navigate()`, route state from `pageContext`); otherwise a documented "in Vike, use Vike's routing" split.

## 2. What changes for existing APIs

| API | 6.0.0 | Canonical? |
|---|---|---|
| `makeFetchDriver` (unreleased) | Adds `ok`/`error`/`key`, and `abort` by action or key. `category` remains for unrouted requests. | Yes, routed form |
| `HTTP.select/errors` (unreleased) | Kept; D54 semantics; strict SYG508 when routing would do | Alternative form |
| `t.respond`/`t.fail`/`t.requests` (unreleased) | Matched by content (the routed `ok` name, url, or a request); throw synchronously when nothing matches; requests only (G-140/G-141) | Yes |
| `driverFromAsync` (5.4.0) | Accepts `ok`/`error` routing; `category` + `select` still work | Routed form, for non-HTTP promise APIs |
| Async EFFECT (5.4.0) | Hardened (§1.2) | Escape hatch |
| `HTTP 'initial'` hydration, `requestSourceName` (5.x) | **Removed** | — |
| Hand-written WebSocket drivers (docs) | Replaced in the docs by `makeSocketDriver` + `connections` | — |

---

## 3. Breaking changes and migration entries (vs 5.4.0)

All of these go into the existing `[Unreleased]` entry. The `makeFetchDriver` / test-fake bullets under **Added** are rewritten to describe the final shape (they were never released, so they get no migration entry).

**Breaking (runtime):**
1. **Legacy `@cycle/http` hydration removed.** An `HTTP` source's `select('initial')` no longer becomes `HYDRATE`, and the `requestSourceName` option is gone.
   Migration: pass SSR data through Vike `+data` or the SSR state handoff (`hydrateState`). 1-A confirms there is no other in-repo user.
2. **Async EFFECT.** A returned promise no longer warns (SYG219), a rejection is reported as SYG214, and `next()` after unmount does nothing.
   Migration: tests that expected SYG219 for an async EFFECT, or that relied on `next()` firing after dispose.
3. **Reserved request keys** `ok`, `error`, `key` (and `then`/`catch` rejected) on sinks of `makeFetchDriver`, `driverFromAsync` and `makeSocketDriver`. A 5.4.0 `driverFromAsync` request that already used `ok`/`error` as data keys would now be routed.
   Migration: rename those keys, or nest them under `value`.

**Breaking (canonical forms / strict):**

4. New strict codes:
   - SYG508: `HTTP.select`/`errors` round-trip where a routed request would do;
   - SYG509 (if adopted): `driverFromAsync` wrapping `fetch`.
   Strict-clean code from 5.4.0 that used `driverFromAsync` + `QUOTE.select('quote')` for HTTP gets flagged.
   Migration: before/after in `advanced/alternative-forms`.

**Breaking (TypeScript):**

5. New `FetchRequest` fields, `SocketRequest`/`Connection` types and a `connections` static. `RenderResult<S>` becomes generic (G-142); old `any`-typed tests still compile.

**Not breaking:** `resources` and `connections` are new statics, and `makeSocketDriver` is a new export.

---

## 4. Phases and workstreams

The operating model is PLAN-2 §1 unchanged: integration branch, isolation-worktree subagents, file ownership, full gates on every merge, failing-first tests and a review subagent per phase. The integration branch is `plan3-integration`, cut from main `6b7144e`.

### Phase 0: Setup (coordinator)
- **0-A:** Create the tracker. Re-measure the size gate and the llms.txt line count. Settle §8 Q1–Q7 with the user.
- **0-B:** Prototype spike, throwaway: sender tagging plus routed replies in `component.ts` with `makeFetchDriver`. Measure the core bytes. **Gate:** ≤ 250 B gzipped on kanban. If it's over, propose a budget re-baseline (Q7) before Phase 1.
- **0-C (eval, user's terminal):**
  - New task **22-chat-socket** (WebSocket: connect per room, send, receive, reconnect status), both arms. Hidden tests use a deterministic fake `WebSocket` (as hidden tests stub `fetch`); a local `ws` server is for the 2-A browser tests only.
  - New task **23-quote-resource** (a read that refetches when an id changes, with cancel-stale), both arms. It is written so that §1.1 and §1.4 both solve it.
  - Both go in a new tier `net`, so existing tiers stay fixed. Verify with `verify.mjs`, and catch mutants as in 0-C of PLAN-2.

### Phase 1: Foundation (parallel where ownership allows)
- **1-A: Routing core** (owns `src/component.ts`, `src/extra/fetchDriver.ts`, `src/extra/driverFactories.ts`):
  - sender tag;
  - routed delivery;
  - `ok`/`error`/`key`/abort-by-action;
  - `driverFromAsync` routing;
  - `then`/`catch` rejection;
  - removal of the legacy `HTTP 'initial'` path.
  Failing-first tests include: Collection items each get only their own replies; unisolated child vs parent; dispose mid-flight; `latest` per `ok` name.
- **1-B: EFFECT hardening** (also `component.ts`, so it runs after 1-A on the same branch):
  - thenable handling;
  - SYG214 on rejection;
  - `signal`;
  - no-op `next()` after dispose.
- **1-C: Test fakes** (owns `src/extra/testing.ts`): routed fakes, content matching, synchronous throws, promise on success, `t.requests` without aborts. Fixes G-140, G-141 and G-131.
- **1-D: Checker** (owns `sygnal-check/**`, `codes.ts`, explanations):
  - SYG102 triggers from routing keys;
  - new SYG1xx (unknown routed action), static and runtime;
  - SYG508 (strict);
  - `explanations.json` and error docs regenerated.
- **1-T: Types** (owns `src/index.d.ts`, `type-tests/**`): routed request types, with the `ok`/`error` names checked against the model's keys where TS can do it; `RenderResult<S>` (G-142).
- **1-G: Haiku gaps** (G-143; owns `src/extra/diagnostics/checks/**` except network codes, plus the docs and skill lines it names). Independent of the network work.

### Phase 2: Connections
- **2-A:** `makeSocketDriver` (new `src/extra/socketDriver.ts`): WebSocket and SSE, diffing, reconnect, sharing, SSR no-op. Browser tests against a local `ws` server.
- **2-B:** The `connections` static in the core (state map → sink, sender-tagged), and the checker learning `message`/`open`/`close` triggers. **Gate:** core cost reported against the Q7 budget.
- **2-C:** Socket fakes (`t.push`, `t.close`, `t.sent`, `t.connections`).

### Phase 3: Resources
- **3-A:** A `resources` prototype on an `exp/` branch (done). D74: it ships in 6.0.0 (lands in 5-2); the final eval's skill-only A/B decides canonical vs advanced.

### Phase 5: Cache, router, HEAD (D74–D82; before 4-C)
- **5-0:** R-10 rename (reply actions, `replies.ts`, SYG112 title, inspect `'reply'`) across code, docs, llms.txt and skill; plus a router spike measuring the core cost of the route static (target ~0 B). D77: `sygnal/vite` injects DevTools in dev; production builds don't carry it (G-100; frees ~2.3 KB core; migration note).
- **5-1:** H-9: the HTTP fake runs the real `makeFetchDriver` over an in-memory `fetch` (replaces 1-C's private rule copies).
- **5-2:** H-1/D78 into `resources`; land `exp/p3-resources` on `plan3-integration` (trim llms.txt within D76).
- **5-3 (cache track):** §1.6 (cache, dedupe, triggers, polling, invalidation, retries, validation, listener module).
- **5-4 (router track, parallel with 5-3):** §1.7 router + `HEAD` driver, fakes, diagnostics, Vike mapping.
- **5-5:** SSR cache seeding and `{ prefetch }` (needs 5-3 and 5-4); verify in a real Vike app (G-165).
- **5-6:** eval tasks **24-list-detail-cache** and **25-router-spa** in the `net` tier, both arms (React arm on TanStack Query / React Router), verify + mutants.
- **5-7:** H-10 recipes, H-11 inspect/`t.cache`, agent and site docs within the D76 budgets.

### Phase 4: Docs, agent context, measure
- **4-A: Agent-facing sync** (owns `llms.txt`, `docs/public/llms.txt`, `skills/sygnal-dev/**`, template `AGENTS.md`, docs):
  - the routed HTTP recipe replaces the select/errors recipe (expected to *shrink* llms.txt);
  - add one socket recipe;
  - alternative forms page;
  - `guide/drivers.md` split into HTTP / sockets / custom drivers;
  - RPC/Telefunc page.
  - Constraints (D76 supersedes the 250-line cap): `llms.txt` ≤ 300 lines in 6.0.0 with PLAN-3 ≤ 285; SKILL.md ≤ 36 KB with PLAN-3 ≤ 35 KB; `check-doc-samples` clean; the installed skill re-synced before any eval (D35).
- **4-B: CHANGELOG `[Unreleased]`** (§3) and ROADMAP §16 → done or partial.
- **4-C: Eval (user's terminal, guard on; D75: once, after Phase 5):**
  - checkpoint already run: `p3-final` (Sygnal, all tiers) and `p3-final-haiku` measure the network layer before Phase 5;
  - Sygnal all tiers incl. 24/25 (~125 trials), React arm for 24/25, Haiku (~105), and a skill-only `resources` canonical A/B on 05/11/17/23/24 (~25), ≈ $80;
  - learn time and peak context per trial checked against `p3-final` (D76): > ~10% worse → trim the agent docs before release.
  Success bars:
  - task 05 ≤ React + 2 s;
  - tasks 11 and 17 gap reduced by ≥ 25%;
  - `net` tier passes 5/5 on Opus;
  - Haiku async pass rate not lower than p4-haiku2;
  - zero routed-request typos left in final code, since the checker catches them.
- **4-D: REPORT-v3.md.** Release stays held per D56.

**Dependency order:**
- 0-A → 0-B → 1-A → (1-B, 1-C, 1-D, 1-T in parallel) → 2-A → 2-B → 2-C → 3-A → 4-A → 4-B → **5-0 → 5-1 → 5-2 → (5-3 ∥ 5-4) → 5-5 → 5-6 → 5-7** → 4-C → 4-D.
- 0-C and 1-G run in parallel with everything.

---

## 5. Gates (every merge)

These are the PLAN-2 gates:
- `npm run build:all`, `npm test`, `npm --prefix sygnal-check test`;
- `node scripts/check-doc-samples.mjs`, `node scripts/gen-error-docs.mjs --check`;
- docs build, `node scripts/size-gate.mjs`;
- llms.txt line count and the byte-identical copy.

New for PLAN-3: browser tests for real WebSocket/SSE (a local server in `browser-tests`), and a test that the fetch, socket and resources code is tree-shaken out of kanban.

## 6. Risks

| Risk | Mitigation |
|---|---|
| The size gate: routing and declarations live in the core, with ~195 B headroom | Spike first (0-B). Keep protocol logic in the drivers. Q7 decides re-baselining with numbers in hand. |
| Routing on top of the tested E2 shape is less of a win than projected (task 05 is already close to React) | The eval decides between the canonical forms. If it fails its success bar, ship routing as an alternative and keep select/errors canonical. |
| Agents write `fetch` in async EFFECT again once it is "safe" | llms.txt/skill keep HTTP → driver. Measure fetch-in-component counts in 4-C (E2 baseline: 0/20). |
| Socket tests are flaky in the browser | Local server per run, deterministic fakes for unit tests, `--reruns` in verify. |
| `resources` writes a framework-owned state key | D62 top-level key; diagnose a user key collision in 5-2. |
| Cache semantics surprise agents (stale data, refetch storms) | Opt-in `cache` (D79), retries default 0, triggers off in the fake; eval task 24 measures it. |
| Router scope creep (loaders, nested layouts) | No loader API (data via `resources`); nested routes only if the 5-4 design needs them. |
| Agent docs grow past what agents read efficiently | D76 caps; learn-time check against `p3-final` before release. |

## 7. Definition of done

- Routed HTTP, hardened EFFECT, `makeSocketDriver` + `connections` and the redesigned fakes are merged, with every gate green.
- G-133, G-140, G-141, G-131, G-142 and G-143 are closed.
- `resources` (with D78), the opt-in query cache (§1.6), the router and the `HEAD` driver (§1.7) are merged; the eval decides `resources`' canonical status.
- CHANGELOG `[Unreleased]` has the network section, breaking changes and migration.
- ROADMAP §16 is updated, and REPORT-v3 is written.
- Agent docs are in sync within D76 (llms.txt ≤ 300, SKILL ≤ 36 KB), and the tracker records the remaining core-size and llms budgets for PLAN-4.
- Release is still held (D56).

## 8. Decisions needed before code (recommendations first)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Routing key names | `ok` / `error` (mirrors `res.ok`; `then` is impossible). Alternative: `onDone` / `onError`. |
| Q2 | `ok` action data | The parsed body only; `parse: 'response'` for more. Alternative: `{ value, status, request }`, which is more complete but means one more thing to destructure. |
| Q3 | Built-in `HTTP`/`WS` or explicit `run()` registration | Explicit: 0 B unless used, and E2 shows agents accept it. |
| Q4 | G-133 for `select()` | Keep the D54 subtree semantics. Routed replies are exact-instance anyway. |
| Q5 | Name of the declaration static | `connections`. |
| Q6 | Where `resources` state lives | Top-level key named by the resource (reads best); revisit if the eval or collisions say otherwise. |
| Q7 | Size budget | Decide after 0-B with measured bytes. Expect a request for +300–500 B. |
| Q-net-1…4 (ROADMAP §16) | Component-declared drivers; a clearer error when a test omits a driver; SSR/hydration of in-flight requests; cleanup on dispose | 1: no (Q3). 2: already covered by the automatic fake and SYG609, so re-check after 1-C. 3: requests are skipped during SSR; resources prefetch through `+data` in 3-A. 4: covered by routing and the socket driver's dispose behaviour. |
