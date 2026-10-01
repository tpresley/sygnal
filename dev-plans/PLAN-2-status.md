# PLAN-2 Status Tracker

Tracks progress for [PLAN-2.md](PLAN-2.md). Maintained by the coordinator. The PLAN-1 tracker ([PLAN-1-status.md](PLAN-1-status.md)) remains the record for B-001…B-029, G-001…G-071 and D1–D38; new items here continue that numbering.

**Integration branch:** `plan2-integration` (cut from `main` at `64d5767`, the 5.4.0 merge) · **Current phase:** 0 + 1 · **Last updated:** 2026-10-01

---

## Phase Overview

| Phase | Status | Tag | Notes |
|---|---|---|---|
| 0 — Release follow-through, eval infrastructure | 🟡 In progress | — | 0-A ✅ · 0-B 🟡 · 0-C 🟡 |
| 1 — Correctness backlog | 🟡 In progress | — | 1-A … 1-F 🟡 |
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
| 1-B | State and components (B-016, G-027/G-044, G-036, G-007 SYG106) | 🟡 | | subagent | | |
| 1-C | Drivers (G-069) | ✅ | `worktree-agent-ac88e05e39e97d91f` | subagent | `fd3fc7c` | Replies that resolve before the first `select()` listener are buffered (≤ 100, oldest dropped) and flushed on a microtask after the first subscribe, so a BOOTSTRAP request gets its reply; later replies with no listener are dropped; `stop()` clears `sendFn`. 5 tests, failing first |
| 1-D | Integrations (B-020, G-046, G-037) | 🟡 | | subagent | | |
| 1-E | Types and build hygiene (B-002/G-012, G-019, G-075, G-076) | 🟡 | | subagent | | G-007 decided (D41) and moved to 1-B |
| 1-F | Examples (G-052, G-063) | ✅ | (same branch as 1-C) | subagent | `fd3fc7c` | todomvc ids = max id + 1; `LOG` sink uses the reducer form (type gap → G-077); build runs `tsc --noEmit`; custom pollers removed from `app.test.ts`, which uses `next`/`settle`/`html`; new id test. Strict-clean |

## Gate Results

| Merge | build:all | vitest | examples | types | browser | sygnal-check | doc samples | error docs | docs build | kanban gz |
|---|---|---|---|---|---|---|---|---|---|---|
| 0-A | ✅ | 942 ✅ | | | | | | | | |
| 1-C/1-F | ✅ | 947 ✅ | 105 ✅ | ✅ | 114 ✅ | 178 ✅ | 373 ✅ | | | 41,435 B |

## Open Questions (awaiting user)

| # | Question | Raised | Blocks | Answer |
|---|---|---|---|---|
| Q1 | G-007: rename/alias `event()`? Should strict mode make SYG106 (reserved view-prop names) an error? | PLAN-2 §3 | 1-E (G-007 part) | ✅ Keep `event`; SYG106 is an error in strict mode (D41, assigned to 1-B) |
| Q2 | Eval budget for Phase 0: React re-run + Sygnal reference (12 tasks × 5 × 2 arms = 120 trials) and the tier-3 pilot (4–6 tasks × 2 trials × 2 arms) | Phase 0 | 0-B steps 2–3, 0-C pilot | ✅ Full v2-baseline approved: tier-3 pilot, then tiers 1–3 × both arms × 5 trials (D42) |

## Decision Log

| # | Date | Decision | By | Rationale |
|---|---|---|---|---|
| D39 | 2026-10-01 | `plan2-integration` cut from `main` after the 5.4.0 merge; PLAN-2 commits cherry-picked onto it | Coordinator | PLAN-2 §1 |
| D41 | 2026-10-01 | G-007: keep `event()` as is; SYG106 becomes an error under strict mode (runtime and `--strict`), a warning otherwise | User | `event` already in 5.4.0 docs and used correctly |
| D42 | 2026-10-01 | Phase 0 eval budget: tier-3 pilot (≈2 trials × task × arm), then the full v2-baseline (tiers 1–3, both arms, 5 trials) | User | Q2 |
| D40 | 2026-10-01 | 0-B and 0-C build and self-verify without paid eval runs (0-B may run ≤ 2 smoke trials, `v2-smoke`, to validate the headless runner); full runs and pilots wait for Q2 | Coordinator | PLAN-2 §8 (user approves budgets per phase) |

## Bugs & Gaps Found

| ID | Found in | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| G-072 | 5.4.0 release | medium | Build | `build` didn't clear `dist/`; stale files (284 vs 163) went into the pack | ✅ 0-A: `clean` step |
| G-073 | 5.4.0 release | low | Tests | Root vitest collected ~1,560 files from `.claude/worktrees` | ✅ 0-A: excluded |
| G-074 | 5.4.0 release | low | Packaging | npm 11 warns "bin … invalid and removed" for `./`-prefixed bin paths (harmless normalization) | ✅ 0-A |
| G-075 | 5.4.0 release | low | Dev deps | `npm audit`: 12 findings, all in dev tooling (runtime 0) | Open → 1-E |
| G-077 | 1-F | low | Types | Runtime accepts a constant non-STATE sink value (`mapTo(value)`), but `SinkValue` in `index.d.ts` allows only `true` or a reducer, so `LOG: 'text'` fails tsc | Open → 1-E |
| G-078 | 1-C/1-F | low | Gate setup | The setup didn't install every example (`npm test` fails until `TEST_EXAMPLES_INSTALL=1`), and `npm --prefix …/kanban exec -- vite build` resolves from the current dir | ✅ Setup below fixed |
| G-076 | 5.4.0 release | low | browser-tests | The browser run prints expected console errors from error-path tests, which look like failures | Open → 1-E |

## Worktree Setup (each subagent, inside its own isolated worktree)

```bash
git merge --ff-only plan2-integration
npm ci --no-audit --no-fund
npm ci --prefix browser-tests --no-audit --no-fund
npm install --prefix sygnal-check --no-audit --no-fund
npm install --prefix examples/kanban --no-audit --no-fund
npm run build
TEST_EXAMPLES_INSTALL=1 npm run test:examples   # installs every example once
```

Kanban size gate (absolute paths; vite needs the example dir as its root):

```bash
npm --prefix <abs>/examples/kanban exec -- vite build <abs>/examples/kanban --outDir /tmp/kb --emptyOutDir
gzip -c /tmp/kb/assets/index-*.js | wc -c      # budget 41,805 B
```

## Activity Log

- 2026-10-01 — 1-C/1-F merged (G-069, G-052, G-063); gates green; G-077 sent to 1-E.
- 2026-10-01 — PLAN-2 started. `plan2-integration` created; 0-A done (smoke 8/8 on the live registry, housekeeping); 0-B, 0-C and 1-A…1-F launched in parallel.
