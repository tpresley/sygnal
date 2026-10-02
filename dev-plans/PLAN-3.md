# PLAN-3: Network Layer and the rest of 6.0.0

**Goal:** make network calls (HTTP, WebSocket, server-sent events, and later server functions) a first-class part of Sygnal for 6.0.0. A request and the place its answer goes should read together. Connections should follow component and state lifecycles. Tests should script both without wiring. 6.0.0 also takes the PLAN-2 carry-over items (G-140…G-143, G-133, N-1).

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

### 1.4 Declarative reads: `resources` (additive; may ship after 6.0.0)

```jsx
Quote.resources = { quote: (state) => state.id && { url: `/api/quotes/${state.id}` } }
// state.quote = { status: 'idle' | 'loading' | 'success' | 'error', data, error }
Quote.model = { REFRESH: { RESOURCES: 'quote' } }
```

- This desugars to §1.1. When the derived request changes, the runtime sends it with `latest` and routes `ok`/`error` to built-in reducers that write `state.quote`. Each write is an action (`RESOURCE` with `{ name, … }`), visible in devtools and `t.states`.
- Later additions: dedupe across instances, and Vike `+data` prefetch through HYDRATE.
- It goes **last**, behind an eval gate (Phase 3), because it introduces a framework-owned state key (Q6: top-level key vs a `$resources` namespace).

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
  - New task **22-chat-socket** (WebSocket: connect per room, send, receive, reconnect status), both arms, with a hidden test against a local `ws` server.
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

### Phase 3: Resources (eval-gated, additive)
- **3-A:** A `resources` prototype on an `exp/` branch. A/B against §1.1 on tasks 05, 11, 17 and 23 (user's terminal).
  - Adopt into 6.0.0 only if it is faster or simpler with no pass-rate loss.
  - Otherwise park it for 6.1 and record the decision.

### Phase 4: Docs, agent context, measure
- **4-A: Agent-facing sync** (owns `llms.txt`, `docs/public/llms.txt`, `skills/sygnal-dev/**`, template `AGENTS.md`, docs):
  - the routed HTTP recipe replaces the select/errors recipe (expected to *shrink* llms.txt);
  - add one socket recipe;
  - alternative forms page;
  - `guide/drivers.md` split into HTTP / sockets / custom drivers;
  - RPC/Telefunc page.
  - Constraints: ≤ 250 lines; `check-doc-samples` clean; the installed skill re-synced before any eval (D35).
- **4-B: CHANGELOG `[Unreleased]`** (§3) and ROADMAP §16 → done or partial.
- **4-C: Eval (user's terminal, guard on):**
  - tiers 1–3 + `net` + TS, both arms, 5 trials, against `p4-final2`;
  - one Haiku run on the shared tasks + `net`.
  Success bars:
  - task 05 ≤ React + 2 s;
  - tasks 11 and 17 gap reduced by ≥ 25%;
  - `net` tier passes 5/5 on Opus;
  - Haiku async pass rate not lower than p4-haiku2;
  - zero routed-request typos left in final code, since the checker catches them.
- **4-D: REPORT-v3.md.** Release stays held per D56.

**Dependency order:**
- 0-A → 0-B → 1-A → (1-B, 1-C, 1-D, 1-T in parallel) → 2-A → 2-B → 2-C → 3-A → 4-A → 4-B → 4-C → 4-D.
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
| `resources` writes a framework-owned state key | Eval-gated, additive, namespace decision Q6. |

## 7. Definition of done

- Routed HTTP, hardened EFFECT, `makeSocketDriver` + `connections` and the redesigned fakes are merged, with every gate green.
- G-133, G-140, G-141, G-131, G-142 and G-143 are closed.
- `resources` is adopted or parked, with the eval evidence recorded.
- CHANGELOG `[Unreleased]` has the network section, breaking changes and migration.
- ROADMAP §16 is updated, and REPORT-v3 is written.
- Agent docs are in sync, and llms.txt is ≤ 250 lines.
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
