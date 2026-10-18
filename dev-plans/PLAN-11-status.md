# PLAN-11 Status Tracker

Tracks progress for [PLAN-11.md](PLAN-11.md) (friction fixes from building an app).

**Numbering:** a reserved block, decisions **D550–D599**, gaps **G-850–G-899**.

**Integration branch:** `claude/sygnal-friction-assessment-8ec6df`, cut from `main` 49c2f6d4.

**State:** S-1 done; Phase 1 in progress.

## Decisions

| # | Date | Decision |
|---|---|---|
| D550 | 2026-10-17 | Fix the confirmed friction points as assessed (user) |
| D551 | 2026-10-17 | Full upload progress support, not only a recipe (user) |
| D552 | 2026-10-17 | Spike the progress API first (user) |
| D553 | 2026-10-17 | Sinks keep the pre-action state; a checker hint is G-850 (user) |
| D554 | 2026-10-17 | sygnal-check stays type-free; templates and docs say to run tsc too (user) |
| D555 | 2026-10-17 | Progress over XHR, `progress: 'ACTION' \| true`, `HTTP.progress()`, throttled, `t.progress()` (coordinator, on S-1) |

## Items

| Item | State | Notes |
|---|---|---|
| S-1 | done | [`research/upload-progress/`](research/upload-progress/README.md) |
| Q-1 | todo | |
| Q-2 | todo | |
| Q-3 | todo | |
| Q-4 | todo | |
| Q-5 | todo | |
| Q-6 | todo | |
| U-1 | todo | |
| U-2 | todo | |
| U-3 | todo | |
| U-4 | todo | |
| E-1 | todo | |
| F-1 | todo | |
| T-1 | todo | |
| D-1…D-5 | todo | |

## Gaps

| # | Gap |
|---|---|
| G-850 | sygnal-check hint when a sink handler reads a state field that the same action's STATE reducer writes (it sees the old value) |
| G-851 | `processForm` keeps only the last value of a repeated field name (several files, multi-select): changing it to arrays is breaking |
