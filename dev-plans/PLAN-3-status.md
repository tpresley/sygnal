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
| 0-B | Routing-core size spike (throwaway) | 🔵 | `exp/p3-routing-spike` | subagent | — | Gate: ≤ 250 B gz on kanban (Q7) |
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

## Bugs & Gaps Found

| ID | Found | Priority | Area | Description | Status |
|---|---|---|---|---|---|

## Log

- 2026-10-02 — PLAN-3 approved with all §8 recommendations (D57–D63). 0-A done: baseline 42,125 B gated, llms.txt 235 lines. 0-B and 0-C started.
