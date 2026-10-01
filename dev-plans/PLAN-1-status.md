# PLAN-1 Status Tracker

Tracks progress for [PLAN-1.md](PLAN-1.md). Maintained by the coordinator.

**Integration branch:** `worktree-agent-ergonomics` · **Current phase:** 0 · **Last updated:** 2026-09-30

---

## Phase Overview

| Phase | Status | Tag | Notes |
|---|---|---|---|
| 0 — Foundations | 🟡 In progress | — | |
| 1 — Core capabilities | ⚪ Not started | — | |
| 2 — Strictness, introspection, integration | ⚪ Not started | — | |
| 3 — Agent context & docs | ⚪ Not started | — | |
| 4 — Measure & release | ⚪ Not started | — | |

Legend: ⚪ not started · 🟡 in progress · 🔵 in review / merging · ✅ done · 🔴 blocked

## Workstreams

| ID | Title | Status | Branch | Worktree | Agent | Merged | Notes |
|---|---|---|---|---|---|---|---|
| 0A | Baseline eval harness | ⚪ | `plan1/0a` | `.claude/worktrees/p1-0a` | — | — | |
| 0B | Diagnostics infrastructure (+ fix B-001) | ⚪ | `plan1/0b` | `.claude/worktrees/p1-0b` | — | — | |
| 0C | Canonical-forms spec | ⚪ | (coordinator, direct) | — | — | — | Needs user decisions |
| 1A | Runtime consistency checks | ⚪ | | | | | |
| 1B | Typed links | ⚪ | | | | | |
| 1C | DOM-level test helpers | ⚪ | | | | | |
| 1D | Static checker `sygnal-check` | ⚪ | | | | | Needs packaging decision |
| 1E | Error-message retrofit | ⚪ | | | | | |
| 2A | Strict mode | ⚪ | | | | | |
| 2B | Inspect | ⚪ | | | | | MCP decision pending |
| 2C | Vite plugin integration | ⚪ | | | | | |
| 2D | Example migration | ⚪ | | | | | |
| 3A | `llms.txt` | ⚪ | | | | | |
| 3B | Skill rewrite | ⚪ | | | | | |
| 3C | Docs site & repo docs | ⚪ | | | | | |
| 4A | Eval re-run | ⚪ | | | | | |
| 4B | Release prep | ⚪ | | | | | |

## Gate Results

| When | Commit | build | build:types | vitest | test:types | browser | gzip `index.esm.js` | Notes |
|---|---|---|---|---|---|---|---|---|
| Baseline (pre-work) | `18ce5c9` | ✅ (TS2322 warnings) | ❌ B-001 | ✅ 610 | ✅ | ✅ 83 | 57,405 B (raw 273,829 B) | Size-gate baseline: limit is 58,941 B (+1.5 KB) |

## Open Questions (awaiting user)

| # | Question | Raised | Blocks | Answer |
|---|---|---|---|---|
| Q1 | Canonical forms: single non-STATE sink (object vs shorthand) | Phase 0 | 0C → 2A, 2D, 3 | |
| Q2 | Canonical forms: global event emit (`emit()` vs `{ EVENTS }`) | Phase 0 | 0C → 2A, 2D, 3 | |
| Q3 | `sygnal-check` packaging | Phase 0 | 1D | |
| Q4 | Eval trial budget | Phase 0 | 0A baseline run | |

## Decision Log

| # | Date | Decision | By | Rationale |
|---|---|---|---|---|
| D1 | 2026-09-30 | Element-bound triggers rejected | User + coordinator | Keeps actions defined only in `.intent`; static and runtime selector checks cover the bug class |
| D2 | 2026-09-30 | Fixing B-001 (`build:types`) is assigned to 0B | Coordinator | 0B owns `src/index.d.ts` in Phase 0 and needs the gate green |

## Bugs & Gaps Found

Pre-existing issues and gaps found during the work. Severity: high (blocks a gate or breaks users), med (wrong behavior or misleading), low (cosmetic or docs).

| ID | Found | Severity | Area | Description | Status / Owner |
|---|---|---|---|---|---|
| B-001 | Baseline | high | Build / types | `npm run build:types` fails at HEAD (`18ce5c9`): rollup-plugin-dts "Syntax not yet supported" on the runtime statement `(_Fragment as any).__sygnalFragment = true` in `src/cycle/dom/snabbdom.ts:22`, which is pulled into the `.d.ts` bundle graph from `src/index.d.ts`. Same plugin/TS versions as the main checkout, so it's not an environment issue. The published `dist/index.d.ts` is only produced by the `cp` in `npm run build`, so this likely went unnoticed. | Open → 0B |
| B-002 | Baseline | low | Build | `npm run build` emits several `TS2322` warnings in the DOM source (`DevToolEnabledSource & MemoryStream<Element[]>` not assignable to `MemoryStream<(Element \| Document)[]>`). Non-fatal, but noisy, and it hides new warnings. | Open (unassigned; candidate for 1E or follow-up) |
| G-001 | Baseline | low | Docs | `CLAUDE.md` says "Vitest (318 tests)"; actual is 610 vitest + type tests + 83 browser tests. | Open → 3C |
| G-002 | Baseline | med | Dev setup | A fresh worktree needs `npm ci`, `npm ci --prefix browser-tests`, **and** `npm install` in `examples/kanban` (its `file:../..` link). Otherwise the kanban tests fail with "Cannot find package 'sygnal'". This isn't documented. | Open → 3C (document); setup steps added to subagent briefs |

## Worktree Setup (for every subagent worktree)

```bash
git worktree add .claude/worktrees/p1-<id> -b plan1/<id> worktree-agent-ergonomics
cd .claude/worktrees/p1-<id>
npm ci --no-audit --no-fund
npm ci --prefix browser-tests --no-audit --no-fund
(cd examples/kanban && npm install --no-audit --no-fund)
```

## Activity Log

- 2026-09-30 — Plan committed. Baseline gates recorded. B-001, B-002, G-001 and G-002 logged.
