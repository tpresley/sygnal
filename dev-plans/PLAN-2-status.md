# PLAN-2 Status Tracker

Tracks progress for [PLAN-2.md](PLAN-2.md). Maintained by the coordinator. The PLAN-1 tracker ([PLAN-1-status.md](PLAN-1-status.md)) remains the record for B-001…B-029, G-001…G-071 and D1–D38; new items here continue that numbering.

**Integration branch:** `plan2-integration` (cut from `main` at `64d5767`, the 5.4.0 merge) · **Current phase:** 0 + 1 · **Last updated:** 2026-10-01

---

## Phase Overview

| Phase | Status | Tag | Notes |
|---|---|---|---|
| 0 — Release follow-through, eval infrastructure | 🟡 In progress | — | 0-A ✅ · 0-B 🟡 · 0-C 🟡 |
| 1 — Correctness backlog | 🟡 In progress | — | 1-A … 1-F 🟡 (G-007 awaits the user) |
| 2 — Known ergonomics improvements | ⚪ | — | |
| 3 — Experiments | ⚪ | — | |
| 4 — Adopt, measure, release | ⚪ | — | |

Legend: ⚪ not started · 🟡 in progress · 🔵 in review / merging · ✅ done · 🔴 blocked

## Workstreams

| ID | Title | Status | Branch | Agent | Merged | Notes |
|---|---|---|---|---|---|---|
| 0-A | Post-release verification + housekeeping | ✅ | (coordinator, direct) | coordinator | this commit | Smoke against the live registry: 8/8 templates (scaffold, sygnal 5.4.0 + sygnal-check 0.1.0, llms.txt, tests, `--strict`, build). G-068/G-071 gone. Stale PLAN-1 worktrees removed by the user (G-006). Housekeeping: `build` clears `dist/` first (G-072); vitest excludes `.claude/**` (G-073); `CHANGELOG.md` in root `files`; `create-sygnal-app/README.md`; `bin` paths without `./` (G-074); RELEASING.md notes on the sygnal-check install and npm 11 staged publishes (E409) |
| 0-B | Eval harness v2 | 🟡 | | subagent | | |
| 0-C | Tier 3 tasks | 🟡 | | subagent | | |
| 1-A | Rendering and props (B-014, B-015, B-017, G-033) | 🟡 | | subagent | | |
| 1-B | State and components (B-016, G-027/G-044, G-036) | 🟡 | | subagent | | |
| 1-C | Drivers (G-069) | 🟡 | | subagent | | |
| 1-D | Integrations (B-020, G-046, G-037) | 🟡 | | subagent | | |
| 1-E | Types and build hygiene (B-002/G-012, G-019, G-075, G-076) | 🟡 | | subagent | | G-007 held for the user |
| 1-F | Examples (G-052, G-063) | 🟡 | | subagent | | |

## Gate Results

| Merge | build:all | vitest | examples | types | browser | sygnal-check | doc samples | error docs | docs build | kanban gz |
|---|---|---|---|---|---|---|---|---|---|---|
| 0-A | ✅ | 942 ✅ | | | | | | | | |

## Open Questions (awaiting user)

| # | Question | Raised | Blocks | Answer |
|---|---|---|---|---|
| Q1 | G-007: rename/alias `event()`? Should strict mode make SYG106 (reserved view-prop names) an error? | PLAN-2 §3 | 1-E (G-007 part) | |
| Q2 | Eval budget for Phase 0: React re-run + Sygnal reference (12 tasks × 5 × 2 arms = 120 trials) and the tier-3 pilot (4–6 tasks × 2 trials × 2 arms) | Phase 0 | 0-B steps 2–3, 0-C pilot | |

## Decision Log

| # | Date | Decision | By | Rationale |
|---|---|---|---|---|
| D39 | 2026-10-01 | `plan2-integration` cut from `main` after the 5.4.0 merge; PLAN-2 commits cherry-picked onto it | Coordinator | PLAN-2 §1 |
| D40 | 2026-10-01 | 0-B and 0-C build and self-verify without paid eval runs; full runs and pilots wait for Q2 | Coordinator | PLAN-2 §8 (user approves budgets per phase) |

## Bugs & Gaps Found

| ID | Found in | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| G-072 | 5.4.0 release | medium | Build | `build` didn't clear `dist/`; stale files (284 vs 163) went into the pack | ✅ 0-A: `clean` step |
| G-073 | 5.4.0 release | low | Tests | Root vitest collected ~1,560 files from `.claude/worktrees` | ✅ 0-A: excluded |
| G-074 | 5.4.0 release | low | Packaging | npm 11 warns "bin … invalid and removed" for `./`-prefixed bin paths (harmless normalization) | ✅ 0-A |
| G-075 | 5.4.0 release | low | Dev deps | `npm audit`: 12 findings, all in dev tooling (runtime 0) | Open → 1-E |
| G-076 | 5.4.0 release | low | browser-tests | The browser run prints expected console errors from error-path tests, which look like failures | Open → 1-E |

## Worktree Setup (each subagent, inside its own isolated worktree)

```bash
git merge --ff-only plan2-integration
npm ci --no-audit --no-fund
npm ci --prefix browser-tests --no-audit --no-fund
npm install --prefix sygnal-check --no-audit --no-fund
npm install --prefix examples/kanban --no-audit --no-fund
npm run build
```

## Activity Log

- 2026-10-01 — PLAN-2 started. `plan2-integration` created; 0-A done (smoke 8/8 on the live registry, housekeeping); 0-B, 0-C and 1-A…1-F launched in parallel.
