# PLAN-4.6 Status Tracker

Tracks progress for [PLAN-4.6.md](PLAN-4.6.md) (component core rewrite). The coordinator maintains it.

**Numbering:** decisions from **D160**, gaps from **G-290** (PLAN-4.5 ended at D159 / G-289).

**Integration branch:** `plan46-integration`, cut from `plan45-complete` (`d900c522`) on 2026-10-04, with `claude/component-core-rewrite-experiment` (the study) merged (`45eefb2`). Worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** spike 0-S met all go criteria; §9 questions with the user.

## Phases

| ID | Phase | Status | Branch | Merge | Notes |
|---|---|---|---|---|---|
| 0-S | Spike: prototype + hard features, measure, project size | ✅ merged | `p46-spike` (`3d8af23`) | 2026-10-04 | **Go**: 40/40 tests; mount 1.9–2.2×, Collection 1.6–9× faster; kanban 30.4 KB (proj. 35–37 KB vs 41.3); streams/item 1; race class impossible. Findings → PLAN-4.6 §1a, Q18–Q23 |
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
| G-290 | 0-S | Med | DOM driver | `SymbolTree.delete` runs `Object.keys(siblings)` per removal: O(n²) on large removals (480 calls × 500 keys in one Switchable switch). Affects the current core too when many siblings go at once | → R1 |
| G-291 | 0-S | Low | Collection | Id-less items under filter/sort are keyed by filtered/sorted index (likely a latent bug) | → Q23 |

## Log

- 2026-10-04 — Spike 0-S merged (`3d8af23`): go. PLAN-4.6 updated (§1a, Q18–Q23). Perf gate green after merge; spike suite 40/40.
- 2026-10-04 — Study reviewed (`claude/component-core-rewrite-experiment`). `plan46-integration` cut from `plan45-complete` with the study merged. Spike 0-S started; PLAN-4.6 drafted. D160.
