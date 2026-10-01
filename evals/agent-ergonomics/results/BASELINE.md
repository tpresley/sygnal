# Baseline run — summary

- **Run:** `baseline`. 70 trials: 8 Sygnal tasks × 5 trials, plus 6 React tasks × 5 trials.
- **Framework under test:** sygnal tarball packed at integration commit `57499d1` (pre-0B; identical to `main` @ `18ce5c9` plus plan docs and the eval harness).
- **Trial agents:** general-purpose subagents (Claude Opus 5.5), each given only the task prompt. Sygnal-arm agents were also told to use the installed `sygnal-dev` skill (G-008: the installed copy lags the repo copy slightly).
- **Raw data:** `baseline.json`. Scoring: hidden acceptance tests, per run.md.

## Headline

| Arm | Trials | Pass | Wall time mean / median (s) | Build/test iterations mean | Edit rounds mean |
|---|---|---|---|---|---|
| Sygnal | 40 | **40 (100%)** | 74.5 / 72 | **4.80** | **2.13** |
| React | 30 | **30 (100%)** | 39.1 / 40 | **2.77** | **1.03** |

> **Corrected 2026-10-01 (G-017).** The original counter missed common invocation forms (`npm --prefix X test`, `cd X && …`, `npx vitest`), so 52 of 70 records undercounted iterations. All records were recounted with the fixed counter (`lib/transcript.mjs`). The old values are kept as `iterationsOld` in `baseline.json`. The originally reported means were 2.3 (Sygnal) and 1.0 (React).

On the 6 tasks both arms share (01–05, 08), the mean Sygnal trial took **~85 s vs ~39 s for React, about 2.2×**.

**Pass rate is saturated** in both arms, so it can't show improvement. All of the measurable difference is in efficiency: time, iterations and edit rounds. See "Harness notes" below.

## Per task (wall time mean/median; iterations mean, corrected counter)

| Task | Sygnal wall | Sygnal iter | React wall | React iter |
|---|---|---|---|---|
| 01 clear completed | 53.4 / 53 | 5.0 | 38.6 / 39 | 3.0 |
| 02 pin via Collection (PARENT) | 81.6 / 78 | 7.0 | 36.2 / 39 | 2.0 |
| 03 status bar via EVENTS | 98.6 / 78 | 6.2 | 39.2 / 40 | 3.0 |
| 04 derived total via context | 68.2 / 68 | 3.8 | 44.6 / 44 | 3.0 |
| 05 async driver | 100.4 / 104 | 5.4 | 37.2 / 38 | 2.6 |
| 06 fix selector typo (Sygnal only) | 20.0 / 19 | 1.0 | — | — |
| 07 fix isolation bug (Sygnal only) | 66.6 / 71 | 4.6 | — | — |
| 08 extract sub-component | 107.6 / 99 | 5.4 | 38.8 / 39 | 3.0 |

Tier-2 tasks (09–12) were added after this run (decision D16). Their baseline is recorded separately as run `baseline-t2`, on the same pre-change tarball.

## Tier 2 (`baseline-t2.json`, 40 trials, same pre-change tarball)

| Arm | Trials | Pass | Wall mean (s) | Iterations mean | Edit rounds mean |
|---|---|---|---|---|---|
| Sygnal | 20 | **20 (100%)** | 92.3 | 4.5 | 2.0 |
| React | 20 | **20 (100%)** | 63.2 | 2.5 | 1.4 |

| Task | Sygnal wall / iter | React wall / iter |
|---|---|---|
| 09 board moves (nested Collections) | 79.2 / 5.4 | 61.4 / 3.0 |
| 10 signup wizard (validation, steps) | 101.6 / 3.6 | 68.6 / 2.2 |
| 11 search debounce + stale responses | 93.8 / 4.6 | 48.8 / 2.2 |
| 12 selection panel (5 components) | 94.6 / 4.6 | 74.0 / 2.8 |

The harder tier **did not break the pass-rate ceiling**: both arms pass every trial, so strong agents handle the harder wiring in either framework. The Sygnal/React wall ratio is lower on tier 2 (**~1.46×**) than tier 1 (~2.2×): React's own cost rises with task complexity, while Sygnal carries a roughly fixed overhead (skill loading, the test-tooling defects B-007/B-006, driver plumbing). Sygnal trials again report B-007 workarounds in most cases where the agent wrote its own tests, B-011 (stale text) in task 12, and B-005 (driverFromAsync) in task 11.

**Implication for Phase 4:** improvement will show up as reduced wall time, iterations and tokens, not pass rate. The friction analyzer (`results/analysis/`) attributes the delta to specific causes.

## Where Sygnal time went (from the agents' own reports)

Agents writing their own verification tests in Sygnal repeatedly hit framework and tooling defects before they could test their change. React agents hit none of these.

| Issue | Tracker | Trials affected (approx.) | Status |
|---|---|---|---|
| Vite plugin rewrites `run(` in test files (`__sygnal is not defined`, `app is not defined`, syntax error) | B-007 | ~20 of 40 | Fixed in `44daa86` (after baseline) |
| `renderComponent` mock DOM lacks `.data()` / `.value()` | B-006 | ~8 | → 1C |
| First event/action after `renderComponent` silently lost | G-016 | ~5 | → 1C |
| `simulateAction` doesn't drive EVENTS or driver sinks | G-015 | ~5 | → 1C |
| `driverFromAsync` swallows rejections (agents worked around it every time in task 05) | B-005 | 10 of 10 task-05 trials | → 1F |
| Same-tick stale state between sinks | B-003 | 2 (noticed) | → 1F |
| `data-sygnal-ready` attribute added to child roots | G-018 | task 08, most trials | PLAN-2 candidate |

The simple tasks (01, 06) are close to React speed. The gap opens on tasks that need cross-component wiring (02, 03, 08) and drivers (05). That's also where agents write their own tests, and hit the tooling defects above.

## Harness notes

- **Ceiling effect:** 70/70 passes. The hidden tests wait 50 ms between interactions, which also hides B-003/B-004. A harder task tier is under consideration (open question to the user).
- **G-017 (fixed):** the counter was fixed and all records recounted (see the note under Headline).
- Trial agents run with this session's worktree guard, which occasionally refused compound shell commands in both arms (small, roughly symmetric noise).
- No trial accessed hidden tests or the eval harness (audit clean on all 70).
