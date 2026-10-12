# PLAN-9 Status Tracker

Tracks progress for [PLAN-9.md](PLAN-9.md) (composing UI from prepared parts in `sygnal/ai`).

**Numbering:** a reserved block, decisions **D450–D499**, gaps **G-750–G-799**.

**Integration branch:** `plan9-integration`, cut from `main` `06560b4a` on 2026-10-11 (the research branch
fast-forwarded into `main` first), in the worktree `.claude/worktrees/sygnal-ide-plugins-research-4d5a79`.

**State:** Phase 0 in progress (spikes 0-S1, 0-S2, 0-S3 running). The plan and the research are written, and §5's questions are answered (D460–D465, 2026-10-11).

## Decisions

| # | Date | Decision |
|---|---|---|
| D450 | 2026-10-11 | One catalog for both backends; one layout format (node map, identity keys) (user) |
| D451 | 2026-10-11 | Backends chain off `compose`: `compose.decisions()`, `compose.llm()` (user) |
| D452 | 2026-10-11 | `<Composed>` marker: spike (0-S1) first; ship on its core impact, user decides (user) |
| D453 | 2026-10-11 | The `compose` behavior plus `catalog.render()`; the builder layer documented; no `<Composed>` component (user) |
| D454 | 2026-10-11 | Chat cards built into `chat` (`ask`, client tools) (user) |
| D455 | 2026-10-11 | `ask_user({ need })` two-step by default; `direct: true` opt-in (user) |
| D456 | 2026-10-11 | Core: instance identity from the vnode `key`, after 0-S2 measures it (user) |
| D457 | 2026-10-11 | No json-render dependency, renderer or wrapper; interop only on request (user) |
| D458 | 2026-10-11 | Containers are view functions; the model never chooses one (`in`, built-in `row`) |
| D459 | 2026-10-11 | Names: `defineCatalog`, `compose` (+ `.decisions`, `.llm`, `.answer`), `composeWith`, `chat({ ask })`; `byId` in `sygnal` |
| D460 | 2026-10-11 | Release 6.3.0, sygnal-check minor if X-2 ships (user, P9-Q1) |
| D461 | 2026-10-11 | `llms.txt` limit 322 (+2 lines) (user, P9-Q2) |
| D462 | 2026-10-11 | Result helper `compose.answer(props, value)` (user, P9-Q3) |
| D463 | 2026-10-11 | `byId` in `sygnal` (user, P9-Q4) |
| D464 | 2026-10-11 | Docs demos on fixtures; optional Jev dev proxy in the example, key from an env file outside the repo (user, P9-Q5) |
| D465 | 2026-10-11 | E-4 eval spend asked for at Phase 4 (user, P9-Q6) |

## Items

| Item | State | Notes |
|---|---|---|
| Phase 0: merge research, cut branch | done | `06560b4a` on `main` (pushed); `plan9-integration` cut there; §4 code reservations confirmed free in `codes.ts` (SYG160–169, 250–259, 450–459, 680–689) |
| 0-S1 `<Composed>` marker spike | todo | bytes, core diff, parity, perf, inspect/HMR → user decision |
| 0-S2 identity from vnode `key` | todo | ≤ ~30 B and parity, else a gap |
| 0-S3 chat client tools design | done | [`research/ai-compose/chat-client-tools.md`](research/ai-compose/chat-client-tools.md): `clientTools` option, `TOOL_OUTPUT` (AI SDK 7's `addToolOutput`; replaces the plan's TOOL_RESULT), `TOOL_CALL` host entry, `ANSWER`; 12 edge-case rules; card on `part.ui`; SYG684–686; 5 open questions with recommendations. Possible existing bug to check in H-1: a persisted busy status may lock SEND after reload |
| P9-Q1…Q6 | done | accepted as recommended (D460–D465) |
| K-1 `defineCatalog` | todo | |
| K-2 `catalog.render` | todo | |
| K-3 layout utilities | todo | |
| B-1 decisions: select + layout | todo | |
| B-2 decisions: params + records | todo | |
| B-3 `compose.llm()` | todo | |
| B-4 edits | todo | |
| B-5 large catalogs | todo | |
| C-1 `compose` behavior | todo | |
| C-2 agents | todo | |
| H-1 client tools | todo | after 0-S3 |
| H-2 `chat({ ask })` | todo | |
| H-3 `direct: true` | todo | |
| T-1 `composeWith` | todo | |
| T-2 per-backend matrix | todo | |
| M-1 `<Composed>` | gated | on 0-S1 + user |
| X-1 runtime diagnostics | todo | codes SYG160–169, 250–259, 450–459, 680–689 |
| X-2 sygnal-check rules + description lint | todo | |
| D-1…D-4 docs | todo | |
| E-1 `examples/ai-compose` on the API | todo | |
| E-2 `examples/ai-ask` | todo | |
| E-3 live accuracy check | todo | |
| E-4 agent eval | todo | spend asked first |

## Research baseline (2026-10-11, for E-3 and the §3 thresholds)

| | Jev | nimble | qwen3:8b + schema | Claude (blind) |
|---|---|---|---|---|
| Flat dashboard (11) | 9/11 | 9/11 | 11/11 | 10/11 |
| Structure (5 catalogs) | 189/210 | 38/68 | 15/15, 14/15 (dashboard, ops) | 14/15, 14/15 |
| Enum params | 54/60 | 19/20 | 20/20 | 20/20 |
| Records | 35–36/40 | 18/20 | — | — |
| Edits | 66/66, 43/48 held-out | 18/22, 10/16 | 27/31 | 31/31 |
| Time per composition | ~0.35 s | ~3 s | ~3.4 s | — |

## Verification log

(empty)

## Gaps

(none yet)
