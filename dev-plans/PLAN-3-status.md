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

## Workstreams

| ID | Title | Status | Branch | Agent | Merged | Notes |
|---|---|---|---|---|---|---|
| 0-A | Tracker, baseline, decisions Q1–Q7 | ✅ | `plan3-integration` | coordinator | this commit | Baseline above; D57–D63 |
| 0-B | Routing-core size spike (throwaway) | ✅ | `exp/p3-routing-spike` | subagent | not merged (`d67e2d2`, reference for 1-A) | **Core +53 B** gated (42,178 B; v1 +90 → v3 +53; variant D +40 rejected: no abort-on-dispose, couples driver to core). Fetch driver +260 B (1,944 → 2,204 B incremental, esbuild+gzip, no trim pass). Shape: EVENTS `__emitterId` stamp generalised to `['EVENTS', ...routing sources]` in `initSinks`; `initAction$` merges `sources[n].routed(_componentNumber)` for sources with `__sygnalRoutes === true` (strict: the DOM source Proxy returns a function for any key); driver owns a sender→listener Map, latest key (sender, `key ?? ok`), abort on stream stop; `tagRequest` must copy the sender tag. Full gate green (vitest 1,110, browser 123). Findings G-144…G-147 |
| 0-C | Eval tier `net`: 22-chat-socket, 23-quote-resource (both arms) | ✅ | `p3-0c-net-tier` | subagent | `dc2ae34` (`a7bc8eb`) | verify `--reruns 3` 90/90 (starters 0/7, solutions 7/7, both arms); 11 mutants × 2 arms all caught; hidden tests byte-identical across arms; harness 57/57 + analysis 45/45; Sygnal solutions/starters strict-clean. 22: `/ws/rooms/<general\|random>`, statuses Not connected/Connecting…/Online/Reconnecting…, fixed 1 s retry, own close never retries; fake `WebSocket` via `vi.stubGlobal` (CLOSING until acked). 23: `GET /api/quotes/<id>`, latest-only incl. same-id refetch, Refresh. Sygnal refs: custom socket driver (22), `makeFetchDriver` + `latest` (23). Baseline `p3-net-baseline` done (see Baseline) |
| 1-A | Routing core | ✅ | `p3-1a-routing` | subagent | `3d1736f` (`96f6ec3`) | `src/extra/routing.ts` (sender tag, `makeRoutes`, SYG610 check); fetch driver + `driverFromAsync` route `ok`/`error` to the exact sender; `latest` per (sender, `key ?? ok ?? error`); abort by action/key; dispose completes routed streams synchronously (G-144); legacy `select('initial')` hydration, `HYDRATE_ACTION` dispatch, `requestSourceName` and `__sygnalFetch` removed; `xs.never()` kept in the action merge (else finite intents end `action$`). New **SYG610** (error: `then`/`catch` key, request not sent). 25 tests (17 failed first). **Size 42,111 B (−14)**; fetch driver 2,300 → 2,710 B, driverFromAsync 1,168 → 1,517 B standalone gz (incl. shared routing + SYG610). D65, G-150, G-151 |
| 1-B | EFFECT hardening | ✅ | `p3-1b-effect` | subagent | `d273e67` (`87fdd20`) | `makeEffectHandler`: a returned thenable gets `.then(null, failed)` (no SYG219; rejection → SYG214 via the same `caught()` as a sync throw, no unhandled rejection); EFFECT `next()` after dispose is a logged no-op; `props.signal` (EFFECT only): one lazy `AbortController` per instance, aborted in `dispose()` after DISPOSE is sent (`undefined` without AbortController); `index.d.ts` EFFECT props `& { signal?: AbortSignal }`. 13 tests (8 failed first). The subagent's installs were denied (G-153), so the gate ran only on the merge: **+89 B → 42,247 B (53 B headroom)** |
| 1-C | Test fakes (G-140, G-141, G-131) | ⬜ | | | | after 1-A |
| 1-D | Checker (SYG102 triggers, routed-action code, SYG508) | ⬜ | | | | after 1-A |
| 1-T | Types (routed requests, G-142) | ⬜ | | | | after 1-A |
| 1-G | Haiku diagnostics/docs gaps (G-143) | ✅ | `p3-1g-haiku-gaps` | subagent | merge after `033d06e` (`5fd94af`) | Dev-entry only (0 core bytes; new `DEV_CODE_SEVERITY` table + `devReport()`): **SYG115** warn unknown `DOM.<name>` shorthand (second Proxy via `sources` hook; suggests `keydown(sel).key()`/near misses), **SYG116** error EVENTS value without a string `type`, **SYG221** error `set('field')` (also typed `Partial<S> & object`), **SYG421** error invalid `data` key (names camelCase fix). Escape pattern verified (mock + jsdom) and documented; DELETE object-form note; `export {}` explained in TS docs (no `events.ts` exists in templates/examples, item 7 N/A). 15 tests (9 failed first). llms.txt 235 lines. G-152 |
| 2-A | `makeSocketDriver` | ⬜ | | | | |
| 2-B | `connections` static | ⬜ | | | | |
| 2-C | Socket fakes | ⬜ | | | | |
| 3-A | `resources` prototype + A/B eval | ⬜ | | | | eval-gated |
| 4-A…4-D | Agent docs, CHANGELOG/ROADMAP, eval, REPORT-v3 | ⬜ | | | | |

## Gate Results

| Merge | build:all | vitest | examples | types | browser | sygnal-check | doc samples | error docs | docs build | kanban gz |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline (main `6b7144e`) | ✅ | | | | | | | | | 42,125 B ✅ |
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
| G-146 | 0-B | med | Docs | A routed request built from state that the same action's STATE sets sees the pre-action state (B-003 snapshot); agents may build the URL from stale state. Recipe must compute from `(state, data)` | Open → 4-A |
| G-148 | 0-C | med | Socket driver | Task 22 needs a fixed 1 s retry (no jitter), a distinct reconnecting state, and no `close` action when the app closes a socket itself (removed/changed connection). `makeSocketDriver` needs a `reconnect: { delayMs, jitter: false }` option and must only report closes it didn't initiate | Open → 2-A |
| G-149 | 0-C | low | Eval harness | The Sygnal hidden-test harness can't dispose the app between tests; task 22's `afterEach` clicks "Leave room" to stop a leftover retry timer | Open (note) |
| G-147 | 0-B | low | Routing | Generalised stamp skips non-object EVENTS values (before: spread into objects); small behaviour change, needs a test and possibly a CHANGELOG line | ✅ 1-A (kept old behaviour, tested; D65) |
| G-150 | 1-A | med | HYDRATE | Nothing in the core dispatches `HYDRATE` now (its only source was the removed legacy path), but it is documented (llms.txt:41, SKILL.md:73, guide/model.md, integration/typescript.md), typed (`index.d.ts` `HYDRATE?`), and listed as built-in in diagnostics checks and sygnal-check (`modelEntries.js`, `graph.js`, SYG101/2xx explanations, README) | Open → Q9 (user) |
| G-152 | 1-G | med | Pragma | JSX attribute `data-task-id="5"` becomes dataset key `task-id` (`deepifyKeys`, `src/pragma/fn.ts`) and the DOM throws a bare DOMException; SYG421 reports it in dev. Core fix (camelCase keys for the `data` module) measured +50 B | ✅ coordinator (D68): `deepifyKeys` camelCases `data-*`; +47 B; test `test/p3-g152-data-attr.test.js` (failed first); SYG421 text/test updated. CHANGELOG (Fixed): a `data-task-id="…"` JSX attribute threw a DOMException and stopped rendering |
| G-153 | 1-B | med | Process | A subagent's `npm ci`/`npm install` in its own worktree was denied by the permission classifier, so it couldn't run the full gate (D69: gate on merge). Size budget: 53 B headroom left after 1-B; 2-B (`connections` core) will need a re-baseline decision (D64) | Open → user before 2-B |
| G-151 | 1-A | low | Testing | Dead after 1-A: `__sygnalFetch` on the fake (testing.ts ~945), `x.sel !== 'initial'` (~1347). Routed requests under the fake: recorded in `t.requests` but never stamped, and `t.respond` throws "nothing receives it" — the fake needs `__sygnalRoutes`/`routed(sender)` | Open → 1-C |

## Log

- 2026-10-02 — PLAN-3 approved with all §8 recommendations (D57–D63). 0-A done: baseline 42,125 B gated, llms.txt 235 lines. 0-B and 0-C started.
- 2026-10-02 — 0-B done: routing core +53 B (fits; D64), fetch driver +260 B; spike branch kept as the 1-A reference. G-144…G-147.
- 2026-10-02 — G-145 fixed in CLAUDE.md (user-approved). 0-C merged (`dc2ae34`): tier `net` (22, 23), verify 90/90, mutants all caught; G-148, G-149. Phase 0 code work done; the `net` baseline run is the user's (terminal).
- 2026-10-02 — `p3-net-baseline` (user's terminal, guard on): 20/20 pass; Sygnal +45.8 s on 22 (custom socket driver + generation ids in 5/5), +10.2 s on 23 (makeFetchDriver + latest in 5/5). Phase 0 complete. 1-A and 1-G running.
- 2026-10-02 — 1-A merged (`3d1736f`), full gate green on the merge, 42,111 B. D65; G-144/G-147 closed; G-150 (HYDRATE now dead → Q9), G-151 (→ 1-C).
- 2026-10-02 — Q9 answered (remove HYDRATE, D66). 1-G merged; explanations.json/errors.md regenerated-consistent (71 codes); full gate green incl. docs build. G-152 (data-attribute pragma bug → Q10). 1-B, 1-C, 1-D, 1-T launched (D67).
- 2026-10-02 — Q10 answered: G-152 fixed in the pragma (D68), +47 B → 42,158 B (142 B headroom); gate green.
- 2026-10-02 — 1-B merged (`d273e67`); its subagent couldn't install deps (G-153), full gate run on the merge: green, 42,247 B (+89; 53 B headroom). D69.
