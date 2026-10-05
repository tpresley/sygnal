# PLAN-5 Status Tracker

Tracks progress for [PLAN-5.md](PLAN-5.md) (ecosystem components and integrations). The coordinator maintains it.

**Numbering:** decisions continue from **D189**, gaps from **G-355** (PLAN-4.6 ended at D188 / G-354). Earlier PLAN-5 decisions D101–D105 (recorded in `PLAN-4-status.md`) apply.

**Integration branch:** `plan5-integration`, cut from `plan46-complete` (`7146161`) on 2026-10-05, in worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** Phase 0: 0-A, 0-S1, 0-S2, 0-S3 running; 0-S4…S6 next.

## 0-A baseline (2026-10-05)

PLAN-5 was written against the PLAN-4 core. It now runs on the PLAN-4.6 core (`src/core/`): read `PLAN-4.6-status.md` (close-out), `HANDOFF-to-PLAN-5.md` (PLAN-4.6 sections) and `docs/.../guide/migrating-to-6.md` first.

**Budgets (P5-Q6: "address as we go"):**

| Budget | Left for PLAN-5 |
|---|---|
| Core (kanban gzip, nativeGlobalThis false; gate 42,300 B, D185) | **904 B** (41,396 B) |
| `llms.txt` | **24 lines** (291 / 315) |
| SKILL.md | **39 B** (38,873 / 38,912 B) |

PLAN-5's docs rules assumed ≈ 1 KB of SKILL.md; 39 B means F-1/W-1 agent lines need trims or a cap decision (raised with eval numbers when it comes up, P5-Q6).

**Code reservations (§4):** SYG140–149, 230–239, 430–439, 660–669, 720–729 are all free in `codes.ts` (checked 2026-10-05). PLAN-4's reservations are closed (PLAN-4.6 used SYG423–425 and SYG612 from PLAN-4's spare ranges). Highest codes per lane: 133, 226, 302, 425, 508, 645, 708, 903.

**PLAN-4 / PLAN-4.6 decisions that shape PLAN-5:**

| Decision | Effect on PLAN-5 |
|---|---|
| D101/D116 control spec contract (`{ kind, vnode(props, children, h), commands?, __props? }`), D102 widget commands via `ELEMENT`, D105 `onError` phase `'widget'` | W-1 builds on them; 0-A/0-S1 verify they still hold on the PLAN-4.6 core |
| **D141: controls are an alternative form** (selectors canonical; docs, examples and agent docs use canonical forms) | Resolved by D189: widgets are tags (canonical) that also work as controls |
| D114 `uses` behaviors, built-in `ELEMENT`, `persist()` helper, registered `makeTimerDriver()` | F-1 as a behavior; T-1/B-3 reuse the timers declaration shape |
| D127 GS-13 `sygnal/element` adopted | PLAN-5 owns the "Web components" guide (D104) |
| PLAN-4 View Transitions: form B (static + `makeViewTransitionDOMDriver`); form A out (D137) | A-1 (S-6): per-item `view-transition-name` on form B, FLIP only as a fallback |
| PLAN-4.6: hooks (`transformDef`, statics, marker registry, dev layers); no instance patching; removed forms (D162–D164) | Every PLAN-5 feature attaches through hooks; no removed forms in specs |
| PLAN-4.6 performance (select ≈ 3× React, Collection create 10k faster than React) | V-1's targets and default threshold (S-7) are re-based on these numbers |

## Phases

| ID | Work | Status | Branch | Merge | Notes |
|---|---|---|---|---|---|
| 0-A | Interfaces on the new core, E1–E6 re-run, ROADMAP | 🟡 running | `exp/p5-0a` | | |
| 0-S1 | Widget as a tag + control kind (D189) | 🟡 running | `exp/p5-s1` | | |
| 0-S2 | Forms: behavior vs helpers | 🟡 running | `exp/p5-s2` | | |
| 0-S3 | Native Dialog, Popover, Tooltip (3 engines) | 🟡 running | `exp/p5-s3` | | |
| 0-S4 | Toast top layer | ⬜ | | | |
| 0-S5 | `sortable` behavior | ⬜ | | | |
| 0-S6 | Web components via controls | ⬜ | | | |

## Decisions

| ID | Date | Decision | By |
|---|---|---|---|
| D189 | 2026-10-05 | P5-Q10 (widgets vs D141): `defineWidget` returns a **tag** rendered and selected canonically (`<DatePicker className="due" value={…} />`, `DOM.select('.due').events('change').detail()`, ELEMENT commands resolved through the host element), and the same spec also works as a control (`controls({ Due: datePicker })`, alternative form). Docs and agent docs show the tag + selector form. Implemented through the PLAN-4.6 marker registry (0 B when unused). Supersedes D101's "widget is a kind of control" as the only form | User |

## Gaps

| ID | Found | Sev | Area | Description | Status |
|---|---|---|---|---|---|

## Log

- 2026-10-05 — D189 (P5-Q10). 0-A, 0-S1, 0-S2, 0-S3 started.
- 2026-10-05 — `plan5-integration` cut from `plan46-complete`. Tracker created; budgets and code reservations recorded. 0-A started.
