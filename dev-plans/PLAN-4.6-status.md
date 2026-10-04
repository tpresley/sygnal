# PLAN-4.6 Status Tracker

Tracks progress for [PLAN-4.6.md](PLAN-4.6.md) (component core rewrite). The coordinator maintains it.

**Numbering:** decisions from **D160**, gaps from **G-290** (PLAN-4.5 ended at D159 / G-289).

**Integration branch:** `plan46-integration`, cut from `plan45-complete` (`d900c522`) on 2026-10-04, with `claude/component-core-rewrite-experiment` (the study) merged (`45eefb2`). Worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** draft plan for the user's review; spike 0-S running.

## Phases

| ID | Phase | Status | Branch | Merge | Notes |
|---|---|---|---|---|---|
| 0-S | Spike: prototype + hard features, measure, project size | 🟡 running | `p46-spike` | | go/no-go per PLAN-4.6 §4 |
| R0 | Decisions, hooks contract, parity/reentrancy/race tests | ⬜ | | | after 0-S and §9 |
| R1 | Runtime core (both cores selectable) | ⬜ | | | |
| R2 | Hosts and markers | ⬜ | | | |
| R3 | Extensions (statics, replies, commands, behaviors) | ⬜ | | | |
| R4 | Tooling and integrations | ⬜ | | | |
| R5 | Cut-over, delete old core, gates, eval | ⬜ | | | |

## Decisions

| ID | Date | Decision | By |
|---|---|---|---|
| D160 | 2026-10-04 | Pursue the core rewrite as PLAN-4.6 before PLAN-5, starting with spike 0-S and a draft plan; commitment after the spike and §9 | User |

## Gaps

| ID | Found | Sev | Area | Description | Status |
|---|---|---|---|---|---|

## Log

- 2026-10-04 — Study reviewed (`claude/component-core-rewrite-experiment`). `plan46-integration` cut from `plan45-complete` with the study merged. Spike 0-S started; PLAN-4.6 drafted. D160.
