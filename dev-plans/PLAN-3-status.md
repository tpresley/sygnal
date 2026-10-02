# PLAN-3 Status Tracker

Tracks progress for [PLAN-3.md](PLAN-3.md). Maintained by the coordinator. The PLAN-2 tracker ([PLAN-2-status.md](PLAN-2-status.md)) remains the record for G-072…G-143 and D39–D56; new items here continue that numbering (G-144…, D57…).

**Integration branch:** `plan3-integration` (cut from main `6b7144e`). Release stays held (D56): no version bumps, tags, PR to main or publish.

## Baseline (0-A, 2026-10-02)

| Measure | Value |
|---|---|
| Size gate, kanban gated (`nativeGlobalThis: false`) | **42,125 B** / 42,300 B (175 B headroom) |
| Size, kanban default (native globalThis) | 38,131 B |
| `llms.txt` | 235 lines / 250; `docs/public/llms.txt` byte-identical |
| Eval reference | `p4-final2` (Opus 5.5, guard on), `p4-haiku2` (Haiku 4.5) |

**`net` tier baseline (`p3-net-baseline`, Opus 5.5, guard on, pre-routing build `cf9c641`, 20/20 pass, ≈ $5.9):**

| Task | Sygnal wall s | React wall s | Gap | Sygnal / React LOC added | Sygnal / React cost | Sygnal final code |
|---|---|---|---|---|---|---|
| 22 chat-socket | 87.6 | 41.8 | **+45.8 s (2.10×)** | 291 / 140 | $0.55 / $0.20 | 5/5 hand-wrote a socket driver file + `main.js` wiring; 5/5 hand-rolled connection-generation ids (`connId`/`gen`) + ABORT on mismatch |
| 23 quote-resource | 39.7 | 29.5 | +10.2 s (1.35×) | 103 / 54 | $0.30 / $0.14 | 5/5 `makeFetchDriver` + `latest: true`; 0 `fetch` in components |
| Matched | 63.7 | 35.7 | +28 s (1.78×) | | 2.47× cost | |

Delta attribution (analysis/p3-net-baseline.md): learning 11.7 s (42%, mostly reading framework source on 22), test-authoring +7 s, debug +5.1 s. Own-test failures include the G-140 trap again (`expect(() => t.fail(...)).toThrow()`, `t.fail` after supersede) and fake-socket CLOSING-state mistakes.

**Network-layer checkpoint (`p3-final`, Opus 5.5, Sygnal arm, all 23 tasks, 115/115 pass; D75):** matched wall on the 21 shared tasks 43.2 → **41.1 s** vs `p4-final2` (−5%); task 22 87.6 → **49.0 s** (291 → 133 LOC; gap to React +45.8 → **+7.2 s**); 11 59.4 → 42.9, 17 70.7 → 59.7, 05 26.2 → 19.7 s; task 23 unchanged (39.8 s, React 29.5). Cost +6% and peak context +1.8k tokens per trial (the bigger agent docs, G-166). `p3-final-haiku` running.

## Budgets (D76; for PLAN-3 and PLAN-4)

| Budget | Cap | Now (`plan3-integration`) | PLAN-3 share | Left for PLAN-4 |
|---|---|---|---|---|
| Core, size gate (gated) | 42,300 B | 42,098 B (+133 B with `resources`) | driver-side only after `resources`; D77 frees ~2.3 KB | to be recorded at the end of Phase 5 |
| `llms.txt` | 300 lines (was 250) | 250 | ≤ 285 | ≥ 15 |
| SKILL.md | 36 KB | 32.4 KB | ≤ 35 KB | ≥ 1 KB |
| Fetch driver (standalone gz) | 6 KB | 2.7 KB (4.1 KB with `resources`) | | |
| Router driver (standalone gz) | 3.5 KB | — | | |

## Handoff items from PLAN-4 (H-/R-/X-)

| Item | Status | Where |
|---|---|---|
| H-0a ship `resources` regardless | ✅ accepted, eval decides canonical (skill-only A/B) | D74 |
| H-0b hold the eval | ✅ changed: Haiku run finishes, `p3-final` kept as checkpoint, `p3-resources` not run, one final 4-C | D75 |
| H-0c budgets | ✅ accepted: llms 300, skill 36 KB, driver caps, DevTools reserve | D76, D77 |
| H-1 keep data while reloading | ✅ changed: same request keeps data (`refreshing`); key change clears unless `keepPrevious` | D78, 5-2 |
| H-2 shared cache | ✅ changed: opt-in via `makeFetchDriver({ cache })` | D79, 5-3 |
| H-3 dedupe | ✅ accepted (cache mode) | D79, 5-3 |
| H-4 invalidation | ✅ changed: explicit tags or URL prefix, no derived tags | D80, 5-3 |
| H-5 retries | ✅ changed: default 0 everywhere | D80, 5-3 |
| H-6 refetch triggers | ✅ accepted (focus/reconnect in `cache`; `refetchEvery` opt-in; off in fakes) | D79, 5-3 |
| H-7 SSR cache seeding + `{ prefetch }` | ✅ accepted | D80, 5-5 |
| H-8 Standard Schema `validate` | ✅ accepted (own module, for PLAN-4 F-1) | D80, 5-3 |
| H-9 HTTP fake runs the real driver | ✅ accepted, first | D80, 5-1 |
| H-10 recipes | ✅ accepted (docs; llms only if the eval shows need) | 5-7 |
| H-11 devtools/inspect | ✅ changed: `t.cache()` + inspect data; panel is a stretch item | D80, 5-7 |
| R-1…R-9, R-11 router | ✅ accepted; R-2 option (a) | D81, 5-4 |
| R-10 naming | ✅ accepted, done first | D82, 5-0 |
| X-1 `HEAD` driver | ✅ accepted | D81, 5-4 |

## Workstreams

| ID | Title | Status | Branch | Agent | Merged | Notes |
|---|---|---|---|---|---|---|
| 0-A | Tracker, baseline, decisions Q1–Q7 | ✅ | `plan3-integration` | coordinator | this commit | Baseline above; D57–D63 |
| 0-B | Routing-core size spike (throwaway) | ✅ | `exp/p3-routing-spike` | subagent | not merged (`d67e2d2`, reference for 1-A) | **Core +53 B** gated (42,178 B; v1 +90 → v3 +53; variant D +40 rejected: no abort-on-dispose, couples driver to core). Fetch driver +260 B (1,944 → 2,204 B incremental, esbuild+gzip, no trim pass). Shape: EVENTS `__emitterId` stamp generalised to `['EVENTS', ...routing sources]` in `initSinks`; `initAction$` merges `sources[n].routed(_componentNumber)` for sources with `__sygnalRoutes === true` (strict: the DOM source Proxy returns a function for any key); driver owns a sender→listener Map, latest key (sender, `key ?? ok`), abort on stream stop; `tagRequest` must copy the sender tag. Full gate green (vitest 1,110, browser 123). Findings G-144…G-147 |
| 0-C | Eval tier `net`: 22-chat-socket, 23-quote-resource (both arms) | ✅ | `p3-0c-net-tier` | subagent | `dc2ae34` (`a7bc8eb`) | verify `--reruns 3` 90/90 (starters 0/7, solutions 7/7, both arms); 11 mutants × 2 arms all caught; hidden tests byte-identical across arms; harness 57/57 + analysis 45/45; Sygnal solutions/starters strict-clean. 22: `/ws/rooms/<general\|random>`, statuses Not connected/Connecting…/Online/Reconnecting…, fixed 1 s retry, own close never retries; fake `WebSocket` via `vi.stubGlobal` (CLOSING until acked). 23: `GET /api/quotes/<id>`, latest-only incl. same-id refetch, Refresh. Sygnal refs: custom socket driver (22), `makeFetchDriver` + `latest` (23). Baseline `p3-net-baseline` done (see Baseline) |
| 1-A | Routing core | ✅ | `p3-1a-routing` | subagent | `3d1736f` (`96f6ec3`) | `src/extra/routing.ts` (sender tag, `makeRoutes`, SYG610 check); fetch driver + `driverFromAsync` route `ok`/`error` to the exact sender; `latest` per (sender, `key ?? ok ?? error`); abort by action/key; dispose completes routed streams synchronously (G-144); legacy `select('initial')` hydration, `HYDRATE_ACTION` dispatch, `requestSourceName` and `__sygnalFetch` removed; `xs.never()` kept in the action merge (else finite intents end `action$`). New **SYG610** (error: `then`/`catch` key, request not sent). 25 tests (17 failed first). **Size 42,111 B (−14)**; fetch driver 2,300 → 2,710 B, driverFromAsync 1,168 → 1,517 B standalone gz (incl. shared routing + SYG610). D65, G-150, G-151 |
| 1-B | EFFECT hardening | ✅ | `p3-1b-effect` | subagent | `d273e67` (`87fdd20`) | `makeEffectHandler`: a returned thenable gets `.then(null, failed)` (no SYG219; rejection → SYG214 via the same `caught()` as a sync throw, no unhandled rejection); EFFECT `next()` after dispose is a logged no-op; `props.signal` (EFFECT only): one lazy `AbortController` per instance, aborted in `dispose()` after DISPOSE is sent (`undefined` without AbortController); `index.d.ts` EFFECT props `& { signal?: AbortSignal }`. 13 tests (8 failed first). The subagent's installs were denied (G-153), so the gate ran only on the merge: **+89 B → 42,247 B (53 B headroom)** |
| 1-C | Test fakes (G-140, G-141, G-131) | ✅ | `p3-1c-fakes` | subagent | merge after `7600183`… (`afd14b3`) | Fake sources route like `makeFetchDriver` (`__sygnalRoutes`/`routed(sender)` via `makeRoutes`; latest/abort per sender; D65 half-routing; dispose drops); child-only fakes injected in `onIntent` so the core stamps/routes them. `t.respond`/`t.fail(name, v, target?)` match by content (action/key/category string, partial request by value, predicate, `{ request, category, status, body }`; identity only breaks ties), **throw at the call** when nothing matching is pending (unless input is still queued or not ready), return a Promise resolved after reduce+render. `t.requests` excludes `{ abort }`. G-131 tagging; dead `__sygnalFetch`/`'initial'` removed. Private copies of the driver's cancel rules (sharing them cost the driver +47 B). 25 tests (19 failed first); 2 older tests updated for intended changes. Testing docs rewritten |
| 1-D | Checker (SYG102 triggers, routed-action code, SYG508) | ✅ | `p3-1d-checker` | subagent | merge after `109a487` (`d894432`) | **SYG112** (error, static + dev entry, 0 core B): routed `ok`/`error` (or `connections` names) with no model entry, did-you-mean. SYG102 counts routed and `connections` names as triggers. **SYG508** (strict warn, static + runtime strict): `X.select/errors('c')` read back by the component that sends `category: 'c'` to a routing driver. SYG509 not adopted. HYDRATE removed from all checker built-ins (D66). inspect/graph trigger `'routed'` (`public.d.ts`, schema). `scripts/check-doc-samples.mjs` gained a temporary `PENDING` map for 8 SYG508 hits in 4-A's files (G-154). sygnal-check 224 tests |
| 1-T | Types (routed requests, G-142) | ✅ | `p3-1t-types` | subagent | `7600183` (`7f70a3f`), then `109a487` | `FetchRequest` `ok`/`error`/`key`, `then`/`catch?: never`, `abort: true \| string`; new `FetchFailure`, `RoutedRequest`, `AsyncRequest<F>`, `RenderableComponent`; HYDRATE removed from types. **G-142**: `renderComponent` infers state (view state, else `initialState`; second `INITIAL` param for calculated fields), `RenderResult<STATE = any>`. The type-level `ok`-name check was dropped by D70 (`109a487`) |
| 1-G | Haiku diagnostics/docs gaps (G-143) | ✅ | `p3-1g-haiku-gaps` | subagent | merge after `033d06e` (`5fd94af`) | Dev-entry only (0 core bytes; new `DEV_CODE_SEVERITY` table + `devReport()`): **SYG115** warn unknown `DOM.<name>` shorthand (second Proxy via `sources` hook; suggests `keydown(sel).key()`/near misses), **SYG116** error EVENTS value without a string `type`, **SYG221** error `set('field')` (also typed `Partial<S> & object`), **SYG421** error invalid `data` key (names camelCase fix). Escape pattern verified (mock + jsdom) and documented; DELETE object-form note; `export {}` explained in TS docs (no `events.ts` exists in templates/examples, item 7 N/A). 15 tests (9 failed first). llms.txt 235 lines. G-152 |
| 1-S | Core size trim, no behaviour change (target ≥ 150 B) | ✅ | `p3-1s-trim` | subagent | `51d74c3` | **42,247 → 41,994 B (−253; 306 B headroom)**, `component.ts` only, no test edits: log output fn (−14), one `component()` factory + Collection/initSinks/misc dead code (−134), calculated-field compute path (−28), `Object.assign` options + dispose loops + `xs.empty()` + Suspense wrapper (−71), tsc fixes (−6). Gzip finding: de-duplicating near-identical code usually *grew* the bundle; removing branches paid. Top contributors: component.ts 11.9k, xstream 3.5k, get-intrinsic 2.5k (+~2k chain, gated build only), devtools 2.3k, EventDelegator 1.9k, snabbdom init 1.8k. Not taken (behaviour/API): lazy DevTools (G-100, ~2.3k), lazy Switchable (~0.9k), validation texts to dev entry (100–200 B), DFS calc sort (60–100 B) |
| 2-A | `makeSocketDriver` | ✅ | `p3-2a-socket` | subagent | after `416cc13` (`c042864`) | Sink `{ connections: { name: spec\|falsy } }` (diff per (sender, name); URL/protocols/credentials/share change reconnects, other changes rebind) and `{ to, json\|text\|binary }` (queued while connecting, `queueLimit` 100). Spec `{ socket\|sse, message, open, close, error, reconnect, share, protocols, events, withCredentials }`. Routed `message` (JSON-parsed), `open {reconnected}`, `close {code, reason, willReconnect}` only for closes the driver didn't make (G-148), `error {error}`; unrouted `select(name?)`. Reconnect default 500 ms→10 s ±20%, fixed mode `{ delayMs, maxDelayMs, jitter: false }`. Shared by URL by default (ref-counted). SSE: native retry, driver reconnect only after CLOSED. SSR no-op. **SYG611** (error, `DEV_CODE_SEVERITY` to keep core at 0 B). 2,571 B gz standalone. 32 unit tests (incl. task-22 port) + 2 browser tests (Node built-in WS/SSE server as a Vite plugin) |
| 2-B | `connections` static | ✅ | `p3-2b-connections` | subagent | after `1c08bfd` (`6000efa`) | Read from `this.view?.connections` (no pragma/factory changes; `connections` added to `src/lazy.ts` statics and Astro `Wrapped`). Sent to every source marked `__sygnalConnections === true` (makeSocketDriver), from `STATE.stream` + a per-instance reducer hook (Collection items' state lags a debounce), identity `dropRepeats` → `{ connections: conn(addCalculated(s)) }` → `dropRepeats(objIsEqual)`; merged into `model$[n]` so it is sender-stamped and isolated; sent once at startup (`{}` too). **G-158**: the component's own values on that sink go two microtasks later. A throwing `connections` is SYG216. Runtime SYG112 for connection action names. **Core +104 B → 42,098 B (202 B headroom)**, so no budget change (D71). 23 tests (20 failed first) + `type-tests/connections.tsx` |
| 2-C | Socket fakes | ✅ | `p3-2c-socket-fakes` | subagent | after `1d09241` (`936b9f3`) | One fake source, no option: values with `connections`/`to` go to a socket half that runs the **real** `makeSocketDriver` over in-memory WebSocket/EventSource classes (diff, routing, sharing, queue, reconnect timers, SYG610/611 are the driver's code). `t.connections(name)`, `t.open`, `t.push(name, data, target?)` (`{ event }` for SSE named events), `t.drop(name, {code, reason}?, target?)`, `t.sent(name, to?)`; targets: name, URL, partial connection, predicate. Shared `scripted()` with `t.respond`/`t.fail` (sync throw, promise after render). `autoConnect` option (default true: opens a macrotask after declaration; `false` holds until `t.open`). 24 tests (all failed first) incl. task 22 port; `type-tests/socket-fakes.ts`; testing.md socket section. A minimal driver hook was denied by the permission classifier (driver unchanged). G-160 |
| 3-A | `resources` prototype | ✅ prototype; lands in 5-2 (D74) | `exp/p3-resources` (worktree `agent-aa4ea152c7b5f6cc8`) | subagent | not merged; `c260b5b` includes plan3-integration | `Component.resources = { name: state => url\|request\|falsy }`; `state[name] = { status, data, error }` written by a built-in `RESOURCE` action; refetch on a changed request (JSON), latest/abort; `{ refresh: 'name' }` on the HTTP sink; `ok`/`error` on a resource also dispatch; generic `__sygnalStatic` marker replaces `__sygnalConnections`; fake + `resourceSink` option; types `Resource<D, E>`; checker knows `resources`/`RESOURCE`. **Core +133 B → 42,231 B (69 B headroom)**; fetch driver +287 B. 17 tests. Reference solutions 05/11/17/23 pass hidden suites (fit: 05 poor, 11 good, 17 good with ok/error hooks, 23 ideal). Exp gate: all green except llms.txt 265 lines (> 250, test fails; trim only if adopted). Decision rule (D73) |
| 4-A | Agent + site docs | ✅ | `p3-4a-docs` | subagent | after `9199d8a` (`8d77656`) | Routed HTTP canonical everywhere (llms §3, SKILL, guides, api.md); new pages `guide/http`, `guide/sockets`, `guide/custom-drivers`, `integration/server-functions` (Telefunc via routed `driverFromAsync` + Option E security rules); `guide/drivers` is an overview (old anchors kept); alternative-forms (SYG508 round trip, model-sent connections, driverFromAsync for HTTP); async EFFECT section; HYDRATE removed from docs; diagnostics/strict guides list the new codes; README + 8 template `AGENTS.md` lines; PENDING map removed. 12 recipes run verbatim (scratch tests). **llms.txt 250 lines (at the limit), SKILL.md 345 → 346 lines, 30,140 → 32,421 B (+7.6%)**. Closed G-146, G-150 (docs), G-154, G-155, G-161 (docs), G-162 |
| 4-B | CHANGELOG [Unreleased] + ROADMAP §16 | 🔵 | `plan3-integration` | coordinator | `9199d8a`, links in this commit | Done except "Measured impact" (after 4-C) and the final ROADMAP status |
| 5-0 | R-10 rename + router size spike + D77 DevTools out of production | ⬜ | | | | |
| 5-1 | H-9: HTTP fake runs the real driver | ⬜ | | | | |
| 5-2 | H-1/D78 + land `resources` | ⬜ | | | | |
| 5-3 | Cache track (§1.6) | ⬜ | | | | |
| 5-4 | Router track + `HEAD` (§1.7) | ⬜ | | | | |
| 5-5 | SSR cache seeding + `{ prefetch }` | ⬜ | | | | |
| 5-6 | Eval tasks 24, 25 | ⬜ | | | | |
| 5-7 | Recipes, inspect, docs within D76 | ⬜ | | | | |
| 4-C | Eval (user's terminal) | ⬜ after Phase 5 (D75) | | | | Checkpoint done: `p3-final` (115/115); `p3-final-haiku` running. `p3-resources` not run (D74) |
| 4-D | REPORT-v3 | ⬜ | | | | |

## Gate Results

| Merge | build:all | vitest | examples | types | browser | sygnal-check | doc samples | error docs | docs build | kanban gz |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline (main `6b7144e`) | ✅ | | | | | | | | | 42,125 B ✅ |
| 4-A + G-163/164 | ✅ | 1,280 ✅ | ✅ | ✅ | 125 ✅ | 227 ✅ | 394 ✅ (0 pending) | ✅ | 51 pages ✅ | 42,098 B ✅ |
| 2-B + G-160 (Phase 2 done) | ✅ | 1,280 ✅ | ✅ | ✅ | 125 ✅ | 225 ✅ | 377 ✅ (+8 pending) | ✅ | 47 pages ✅ | 42,098 B ✅ (+104) |
| 2-C | ✅ | 1,252 ✅ | ✅ | ✅ | 125 ✅ | 225 ✅ | 377 ✅ (+8 pending) | ✅ | 47 pages ✅ | 41,994 B ✅ |
| 2-A | ✅ | 1,228 ✅ | ✅ | ✅ | 125 ✅ | 225 ✅ | 376 ✅ (+8 pending) | ✅ | 47 pages ✅ | 41,994 B ✅ |
| 1-S | ✅ | 1,196 ✅ ×2 | ✅ | ✅ | 123 ✅ | 224 ✅ | 376 ✅ (+8 pending) | ✅ | | 41,994 B ✅ (−253) |
| 1-C (Phase 1 done) | ✅ | 1,196 ✅ | ✅ | ✅ | 123 ✅ | 224 ✅ | 376 ✅ (+8 pending, G-154) | ✅ | 47 pages ✅ | 42,247 B ✅ |
| 1-D | ✅ | 1,171 ✅ | ✅ | ✅ | 123 ✅ | 224 ✅ | 376 ✅ (+8 pending) | ✅ | 47 pages ✅ | 42,247 B ✅ |
| 1-T | ✅ | 1,159 ✅ | ✅ | ✅ | 123 ✅ | 197 ✅ | 376 ✅ | ✅ | 47 pages ✅ | 42,247 B ✅ |
| 1-B | ✅ | 1,159 ✅ | ✅ | ✅ | 123 ✅ | 197 ✅ | 374 ✅ | ✅ | | 42,247 B ✅ (+89) |
| G-152 fix | ✅ | 1,146 ✅ | ✅ | ✅ | 123 ✅ | 197 ✅ | 374 ✅ | ✅ | | 42,158 B ✅ (+47) |
| 1-A + 1-G | ✅ | 1,144 ✅ | ✅ | ✅ | 123 ✅ | 197 ✅ | 374 ✅ | ✅ | 47 pages ✅ | 42,111 B ✅ |
| 1-A | ✅ | 1,128 ✅ | 9 ex / 105 ✅ | ✅ | 123 ✅ | 193 ✅ | 373 ✅ | ✅ | (not run: only errors.md regenerated) | 42,111 B ✅ |

## Open Questions (awaiting user)

| # | Question | Raised | Blocks | Answer |
|---|---|---|---|---|
| Q1–Q7 | PLAN-3 §8 | PLAN-3 | Phase 0 | ✅ All recommendations accepted (D57–D63) |
| Q9 | G-150: `HYDRATE` is no longer dispatched by anything. Remove it as a built-in in 6.0 (docs, types, checkers; breaking + migration), or keep it reserved/documented for a future SSR hook? | 1-A | 1-D, 1-T, 4-A | ✅ Remove (D66) |
| Q10 | G-152: fix the pragma so `data-task-id="…"` attributes become valid dataset keys (+50 B measured), or leave it to SYG421 + docs? | 1-G | — | ✅ Fix it (D68) |
| Q8 | The E2 report's "10 open design questions" were never committed (branch deleted); add any not covered by ROADMAP §16 Q-net-1…4 | PLAN-3 header | — | open |

## Decision Log

| # | Date | Decision | By | Rationale |
|---|---|---|---|---|
| D57 | 2026-10-02 | Q1: routing keys are `ok` / `error`; `then`/`catch` keys rejected on routing sinks | User | Mirrors `res.ok`; a `then` key makes a thenable |
| D58 | 2026-10-02 | Q2: an `ok` action's data is the parsed body only (`parse: 'response'` for the Response) | User | What agents expect; one less destructure |
| D59 | 2026-10-02 | Q3: drivers stay explicitly registered in `run()` (no built-in HTTP/WS) | User | 0 B unless used; E2 showed agents accept it |
| D60 | 2026-10-02 | Q4 / G-133: `select()`/`errors()` keep the D54 subtree semantics; routed replies go to the exact sending instance | User | Canonical path no longer exposes the subtree behaviour |
| D61 | 2026-10-02 | Q5: the declaration static is `connections` | User | `subscriptions` clashes with stream subscriptions |
| D62 | 2026-10-02 | Q6: `resources` state lives at a top-level key named by the resource | User | Reads best; revisit on collisions/eval |
| D63 | 2026-10-02 | Q7: size budget decided after the 0-B spike with measured bytes | User | Only 175 B headroom |
| D68 | 2026-10-02 | Q10 / G-152: the pragma camelCases `data-*` JSX attribute names into dataset keys (`data-task-id` → `taskId`); `data={{ 'task-id': … }}` stays an SYG421 error | User | Plain HTML data attributes must work; +47 B |
| D74 | 2026-10-02 | Amends D73: `resources` ships in 6.0.0; the final eval decides only canonical vs advanced form, by a skill-only A/B on the same build. `p3-resources` is not run | User | Handoff H-0a; caching hangs off `resources` |
| D75 | 2026-10-02 | Eval: the running Haiku run finishes; `p3-final` and `p3-final-haiku` are the network-layer checkpoint; 4-C runs once after Phase 5, with tasks 24 and 25 | User | H-0b; avoids measuring semantics that change |
| D76 | 2026-10-02 | Budgets: core stays 42,300 B and Phase 5 additions are driver-side; `llms.txt` cap 300 (PLAN-3 ≤ 285, PLAN-4 ≥ 15); SKILL.md ≤ 36 KB (PLAN-3 ≤ 35 KB); fetch driver ≤ 6 KB, router ≤ 3.5 KB gz standalone; learn time/peak context checked against `p3-final` (> ~10% worse → trim before release) | User | H-0c; G-166 (+6% tokens already) |
| D77 | 2026-10-02 | G-100 in 6.0: `sygnal/vite` injects DevTools in dev; production builds don't carry it (~2.3 KB core reserve); migration note | User | Budget reserve for PLAN-3/PLAN-4 |
| D78 | 2026-10-02 | H-1 modified: a same-request refetch keeps `data` with `refreshing: true`; a key change clears `data` unless `keepPrevious: true` | User | Detail views and task 23 must not show the previous record |
| D79 | 2026-10-02 | The query cache is opt-in: `makeFetchDriver({ cache })` turns on stale-while-revalidate for resources, de-duplication, and focus/reconnect refetch; `refetchEvery` is per-resource opt-in | User | Existing semantics and task specs unchanged by default |
| D80 | 2026-10-02 | Invalidation by explicit tags or URL prefix (no derived tags); retries default 0, opt-in; Standard Schema `validate`; SSR `dehydrate`/`hydrate` + `{ prefetch }`; the HTTP fake runs the real driver; `t.cache()` + inspect data, devtools panel a stretch item | User | H-2…H-11 as reviewed |
| D81 | 2026-10-02 | The router (R-1…R-9, R-11) and the `HEAD` driver (X-1) are part of PLAN-3; R-2 option (a): a declaration static names a reply action, the app's reducer stores the route | User | Same machinery as sockets; one eval cycle |
| D82 | 2026-10-02 | R-10 first: "routed requests" → **reply actions** (docs), `routing.ts` → `replies.ts`, SYG112 title, inspect trigger `'routed'` → `'reply'` | User | The router owns "route"; nothing released yet |
| D73 | 2026-10-02 | 3-A decision rule: adopt `resources` into 6.0.0 if, on tasks 05/11/17/23 (Sygnal arm, 5 trials), matched mean wall improves ≥ 10% vs the `p3-final` control with no pass-rate loss and no LOC-added increase, and task 05 alone doesn't regress; otherwise park for 6.1 | Coordinator (proposed to user) | 3-A report |
| D72 | 2026-10-02 | G-160: `renderComponent` option `socketSink` (default `'WS'`) names the driverless fake that receives the `connections` static (marked `__sygnalConnections`); it is injected for any component with a `connections` static even when no model entry names the sink. Other fakes never get connections | User | No duplicates; read-only SSE components testable; canonical name WS |
| D71 | 2026-10-02 | Size budget before 2-B: trim first (1-S, ≥ 150 B, no behaviour change) in parallel with 2-A; measure 2-B and re-baseline only if it still doesn't fit | User | 53 B headroom (G-153) |
| D70 | 2026-10-02 | 1-T's type-level `ok`/`error` action-name check is dropped: `ok`/`error` are plain strings in the types; SYG112 catches typos | User | A helper-built request widens to `ok: string` and needed `as const` (false positive); TS errors were the main Haiku TS cost |
| D69 | 2026-10-02 | Gates for subagent branches run on the coordinator's merge when the subagent can't install dependencies (G-153); a branch is kept only if the merge gate is green | Coordinator | 1-B |
| D66 | 2026-10-02 | Q9 / G-150: remove `HYDRATE` as a built-in action in 6.0 (docs, types, diagnostics checks, sygnal-check); breaking entry + migration (Vike `+data` / `hydrateState`). Split: 1-D (checkers, explanations), 1-T (`index.d.ts`), 4-A (llms.txt, skill, docs), 4-B (CHANGELOG) | User | Nothing dispatches it after 1-A |
| D67 | 2026-10-02 | Phase 1 rest (1-B, 1-C, 1-D, 1-T) launched in parallel from the 1-A+1-G merge; merged one at a time with the full gate | User | No file overlap |
| D65 | 2026-10-02 | Half-routed requests: `ok`-only sends failures to `errors()`, `error`-only sends successes to `select()` (unhandled outcomes stay observable/logged); `{ abort: true }` without key/category still cancels the whole scope incl. routed requests; G-147: EVENTS stamping unchanged (non-objects still spread; passing them through broke `EVENTS.select` listeners on `null`) | Coordinator (accepting 1-A) | 1-A report |
| D64 | 2026-10-02 | D63 outcome: routing core fits the current budget (+53 B → 122 B headroom); no re-baseline now. Revisit at 2-B (`connections` core) with measured bytes. 1-A follows the 0-B v3 shape | Coordinator | 0-B results |

## Bugs & Gaps Found

| ID | Found | Priority | Area | Description | Status |
|---|---|---|---|---|---|
| G-144 | 0-B | med | Routing | Dispose window: `action$` completes in a `setTimeout` after dispose, so a reply landing in that tick is still delivered to the disposed instance and the abort is a tick or two late. Fix with a `_disposed` check before routed actions apply | ✅ 1-A (routed streams completed synchronously on dispose) |
| G-145 | 0-B | low | Repo docs | CLAUDE.md fresh-worktree setup omits `npm ci --prefix sygnal-check`; without it `test/vite-plugin-dev.test.js` and `test/inspect-kanban.test.js` fail to load (`@babel/parser`) | ✅ CLAUDE.md (user-approved) |
| G-146 | 0-B | med | Docs | A routed request built from state that the same action's STATE sets sees the pre-action state (B-003 snapshot); agents may build the URL from stale state. Recipe must compute from `(state, data)` | ✅ 4-A |
| G-148 | 0-C | med | Socket driver | Task 22 needs a fixed 1 s retry (no jitter), a distinct reconnecting state, and no `close` action when the app closes a socket itself (removed/changed connection). `makeSocketDriver` needs a `reconnect: { delayMs, jitter: false }` option and must only report closes it didn't initiate | Open → 2-A |
| G-149 | 0-C | low | Eval harness | The Sygnal hidden-test harness can't dispose the app between tests; task 22's `afterEach` clicks "Leave room" to stop a leftover retry timer | Open (note) |
| G-147 | 0-B | low | Routing | Generalised stamp skips non-object EVENTS values (before: spread into objects); small behaviour change, needs a test and possibly a CHANGELOG line | ✅ 1-A (kept old behaviour, tested; D65) |
| G-150 | 1-A | med | HYDRATE | Nothing in the core dispatches `HYDRATE` now (its only source was the removed legacy path), but it is documented (llms.txt:41, SKILL.md:73, guide/model.md, integration/typescript.md), typed (`index.d.ts` `HYDRATE?`), and listed as built-in in diagnostics checks and sygnal-check (`modelEntries.js`, `graph.js`, SYG101/2xx explanations, README) | ✅ 1-D/1-T (D66); docs → 4-A |
| G-152 | 1-G | med | Pragma | JSX attribute `data-task-id="5"` becomes dataset key `task-id` (`deepifyKeys`, `src/pragma/fn.ts`) and the DOM throws a bare DOMException; SYG421 reports it in dev. Core fix (camelCase keys for the `data` module) measured +50 B | ✅ coordinator (D68): `deepifyKeys` camelCases `data-*`; +47 B; test `test/p3-g152-data-attr.test.js` (failed first); SYG421 text/test updated. CHANGELOG (Fixed): a `data-task-id="…"` JSX attribute threw a DOMException and stopped rendering |
| G-153 | 1-B | med | Process | A subagent's `npm ci`/`npm install` in its own worktree was denied by the permission classifier, so it couldn't run the full gate (D69: gate on merge). Size budget: 53 B headroom left after 1-B; 2-B (`connections` core) will need a re-baseline decision (D64) | Open → user before 2-B |
| G-154 | 1-D | med | Docs samples | `scripts/check-doc-samples.mjs` has a temporary `PENDING` map tolerating 8 SYG508 hits in `guide/drivers.md`, `llms.txt:145`, `SKILL.md:195`; 4-A must rewrite those recipes to the routed form and delete the map | ✅ 4-A (PENDING map removed, 0 SYG508 findings) |
| G-155 | 1-C | low | Docs | `guide/drivers.md:204–218` says answering a superseded request "delivers nothing" (it now throws) and shows the unrouted, un-awaited fake form | ✅ 4-A |
| G-156 | 1-S | low | Tests | One unidentified vitest failure on one run (1-S, after `2003056`), not reproduced; merge gate ran vitest twice: 1,196/1,196 both | Watch |
| G-157 | 1-S | low | Repo docs | CLAUDE.md test counts are stale (892 / 104 / 113 vs 1,196 / 105 / 123) | Open → 4-B (with user OK for CLAUDE.md) |
| G-158 | 2-A | med | connections | When one action changes state (new connection) and also sends `{ to }`, the `connections` value must reach the driver before the send, or the send is SYG611 | Open → 2-B (test the ordering) |
| G-159 | 2-A | low | Diagnostics | A code in `CODE_SEVERITY` costs core bytes (+3 B); opt-in driver codes go in `DEV_CODE_SEVERITY` (SYG611 does); consider renaming that table "non-core" | Note |
| G-160 | 2-C | med | Docs/tests | testing.md's socket example uses the `Chat.connections` static (2-B); no test runs it yet. After 2-B: a test that runs the docs sample, and a test of the static under `renderComponent` with no driver (the core must send the sender-stamped `{ connections }` through the sink so the fake's `record()` sees it; G-158 applies to the fake too) | ✅ coordinator (D72): `socketSink` option |
| G-161 | 2-B | low | connections | A component with `connections` but no registered connection-capable driver sends nothing and nothing reports it (SYG609 doesn't fire: no sink is named). Candidate dev warning | ✅ docs (4-A); a dev warning remains an idea |
| G-162 | 2-B | low | Docs | Both the static and a model entry can send `{ connections }` to the same sink; each is the whole set, so they override each other. Docs: use one or the other | ✅ 4-A |
| G-163 | 4-A | low | sygnal-check | SSE `events: { name: 'ACTION' }` names weren't counted as SYG102 triggers or checked by static SYG112 (runtime handled them) | ✅ coordinator: `connectionNames` reads `events` maps; test in `routing.vtest.js` (failed first) |
| G-164 | 4-A | low | sygnal-check | SYG508's `routingDrivers()` read `file.ast` of every project file, and unparsable files are kept as `null`: an extra SYG900 "rule threw" next to the parse error | ✅ coordinator: skip null files; test (failed first) |
| G-165 | 4-A | low | Docs | Unverified Vike details: `integration/server-functions.md` registers drivers in `+drivers.js`; `vike.md` computes drivers inside `+config.js` | Open (verify in a real Vike app before release) |
| G-166 | 4-A | med | Agent docs | `llms.txt` is at the 250-line limit; SKILL.md grew 2,281 B (+7.6%). Watch learn time/context in 4-C; trim if it costs | Watch → 4-C |
| G-151 | 1-A | low | Testing | Dead after 1-A: `__sygnalFetch` on the fake (testing.ts ~945), `x.sel !== 'initial'` (~1347). Routed requests under the fake: recorded in `t.requests` but never stamped, and `t.respond` throws "nothing receives it" — the fake needs `__sygnalRoutes`/`routed(sender)` | ✅ 1-C |

## Log

- 2026-10-02 — PLAN-3 approved with all §8 recommendations (D57–D63). 0-A done: baseline 42,125 B gated, llms.txt 235 lines. 0-B and 0-C started.
- 2026-10-02 — 0-B done: routing core +53 B (fits; D64), fetch driver +260 B; spike branch kept as the 1-A reference. G-144…G-147.
- 2026-10-02 — G-145 fixed in CLAUDE.md (user-approved). 0-C merged (`dc2ae34`): tier `net` (22, 23), verify 90/90, mutants all caught; G-148, G-149. Phase 0 code work done; the `net` baseline run is the user's (terminal).
- 2026-10-02 — `p3-net-baseline` (user's terminal, guard on): 20/20 pass; Sygnal +45.8 s on 22 (custom socket driver + generation ids in 5/5), +10.2 s on 23 (makeFetchDriver + latest in 5/5). Phase 0 complete. 1-A and 1-G running.
- 2026-10-02 — 1-A merged (`3d1736f`), full gate green on the merge, 42,111 B. D65; G-144/G-147 closed; G-150 (HYDRATE now dead → Q9), G-151 (→ 1-C).
- 2026-10-02 — Q9 answered (remove HYDRATE, D66). 1-G merged; explanations.json/errors.md regenerated-consistent (71 codes); full gate green incl. docs build. G-152 (data-attribute pragma bug → Q10). 1-B, 1-C, 1-D, 1-T launched (D67).
- 2026-10-02 — Q10 answered: G-152 fixed in the pragma (D68), +47 B → 42,158 B (142 B headroom); gate green.
- 2026-10-02 — 1-B merged (`d273e67`); its subagent couldn't install deps (G-153), full gate run on the merge: green, 42,247 B (+89; 53 B headroom). D69.
- 2026-10-02 — 1-T merged; D70 (type-level ok check dropped). 1-D and 1-C merged; full gate green after each (1,196 vitest, 224 sygnal-check). **Phase 1 complete.** Closed: G-131, G-140, G-141, G-142, G-151 (and G-150 in code; docs → 4-A). New: G-154, G-155 (→ 4-A). Next: size-budget decision before 2-B (G-153).
- 2026-10-02 — D71 (trim first). 1-S and 2-A launched.
- 2026-10-02 — 1-S merged (`51d74c3`): −253 B → 41,994 B, 306 B headroom; gate green (vitest run twice for G-156). 2-B can start from here after 2-A.
- 2026-10-02 — 2-A merged; gate green (1,228 vitest, 125 browser). SYG611. G-158, G-159. 2-B and 2-C launched.
- 2026-10-02 — 2-C merged; gate green (1,252 vitest). G-160 (verify docs sample + static under the fake once 2-B lands).
- 2026-10-02 — 2-B merged (+104 B → 42,098 B; trim covered it, no re-baseline). G-160 reproduced (static sent nothing under renderComponent) and fixed with the `socketSink` option (D72; `test/p3-g160-connections-fake.test.js` runs the docs sample). Full gate green: 1,280 vitest. **Phase 2 complete.** G-161, G-162.
- 2026-10-02 — 4-A and 3-A launched. 4-B draft: CHANGELOG [Unreleased] network section, codes, breaking, TS rows, migration; ROADMAP §16 in progress.
- 2026-10-02 — 4-A merged; G-163/G-164 fixed (checker); CHANGELOG links point at the new pages. Gate green, 0 pending doc samples. Waiting on 3-A, then 4-C (user's terminal).
- 2026-10-02 — 3-A done; coordinator merged plan3-integration into `exp/p3-resources` (conflicts in sygnal-check resolved, G-163 kept for connections only), exp gate green except the llms line limit. Stale SYG421 docs line fixed (`7b9c1bd`: a `data-task-id` attribute works since G-152). 4-C commands prepared.
- 2026-10-02 — `p3-final` done (115/115): network-layer checkpoint recorded. PLAN-4's handoff reviewed; D74–D82 approved (D77 included): query cache (opt-in), router, `HEAD` driver and the reply-actions rename join PLAN-3 as Phase 5; budgets re-planned (D76). `p3-resources` dropped; 4-C runs once after Phase 5.
