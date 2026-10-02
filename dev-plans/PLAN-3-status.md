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

## Workstreams

| ID | Title | Status | Branch | Agent | Merged | Notes |
|---|---|---|---|---|---|---|
| 0-A | Tracker, baseline, decisions Q1–Q7 | ✅ | `plan3-integration` | coordinator | this commit | Baseline above; D57–D63 |
| 0-B | Routing-core size spike (throwaway) | ✅ | `exp/p3-routing-spike` | subagent | not merged (`d67e2d2`, reference for 1-A) | **Core +53 B** gated (42,178 B; v1 +90 → v3 +53; variant D +40 rejected: no abort-on-dispose, couples driver to core). Fetch driver +260 B (1,944 → 2,204 B incremental, esbuild+gzip, no trim pass). Shape: EVENTS `__emitterId` stamp generalised to `['EVENTS', ...routing sources]` in `initSinks`; `initAction$` merges `sources[n].routed(_componentNumber)` for sources with `__sygnalRoutes === true` (strict: the DOM source Proxy returns a function for any key); driver owns a sender→listener Map, latest key (sender, `key ?? ok`), abort on stream stop; `tagRequest` must copy the sender tag. Full gate green (vitest 1,110, browser 123). Findings G-144…G-147 |
| 0-C | Eval tier `net`: 22-chat-socket, 23-quote-resource (both arms) | 🔵 | worktree | subagent | — | verify + mutants; trials run only from the user's terminal |
| 1-A | Routing core | ⬜ | | | | after 0-B |
| 1-B | EFFECT hardening | ⬜ | | | | after 1-A |
| 1-C | Test fakes (G-140, G-141, G-131) | ⬜ | | | | after 1-A |
| 1-D | Checker (SYG102 triggers, routed-action code, SYG508) | ⬜ | | | | after 1-A |
| 1-T | Types (routed requests, G-142) | ⬜ | | | | after 1-A |
| 1-G | Haiku diagnostics/docs gaps (G-143) | ⬜ | | | | independent |
| 2-A | `makeSocketDriver` | ⬜ | | | | |
| 2-B | `connections` static | ⬜ | | | | |
| 2-C | Socket fakes | ⬜ | | | | |
| 3-A | `resources` prototype + A/B eval | ⬜ | | | | eval-gated |
| 4-A…4-D | Agent docs, CHANGELOG/ROADMAP, eval, REPORT-v3 | ⬜ | | | | |

## Gate Results

| Merge | build:all | vitest | examples | types | browser | sygnal-check | doc samples | error docs | docs build | kanban gz |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline (main `6b7144e`) | ✅ | | | | | | | | | 42,125 B ✅ |

## Open Questions (awaiting user)

| # | Question | Raised | Blocks | Answer |
|---|---|---|---|---|
| Q1–Q7 | PLAN-3 §8 | PLAN-3 | Phase 0 | ✅ All recommendations accepted (D57–D63) |
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
| D64 | 2026-10-02 | D63 outcome: routing core fits the current budget (+53 B → 122 B headroom); no re-baseline now. Revisit at 2-B (`connections` core) with measured bytes. 1-A follows the 0-B v3 shape | Coordinator | 0-B results |

## Bugs & Gaps Found

| ID | Found | Priority | Area | Description | Status |
|---|---|---|---|---|---|
| G-144 | 0-B | med | Routing | Dispose window: `action$` completes in a `setTimeout` after dispose, so a reply landing in that tick is still delivered to the disposed instance and the abort is a tick or two late. Fix with a `_disposed` check before routed actions apply | Open → 1-A |
| G-145 | 0-B | low | Repo docs | CLAUDE.md fresh-worktree setup omits `npm ci --prefix sygnal-check`; without it `test/vite-plugin-dev.test.js` and `test/inspect-kanban.test.js` fail to load (`@babel/parser`) | ✅ CLAUDE.md (user-approved) |
| G-146 | 0-B | med | Docs | A routed request built from state that the same action's STATE sets sees the pre-action state (B-003 snapshot); agents may build the URL from stale state. Recipe must compute from `(state, data)` | Open → 4-A |
| G-147 | 0-B | low | Routing | Generalised stamp skips non-object EVENTS values (before: spread into objects); small behaviour change, needs a test and possibly a CHANGELOG line | Open → 1-A |

## Log

- 2026-10-02 — PLAN-3 approved with all §8 recommendations (D57–D63). 0-A done: baseline 42,125 B gated, llms.txt 235 lines. 0-B and 0-C started.
- 2026-10-02 — 0-B done: routing core +53 B (fits; D64), fetch driver +260 B; spike branch kept as the 1-A reference. G-144…G-147.
