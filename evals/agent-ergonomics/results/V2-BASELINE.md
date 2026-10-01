# v2 baseline: Sygnal 5.4.0 vs React (headless runner)

This is the reference point for PLAN-2. Every later PLAN-2 measurement is compared with it. PLAN-1's numbers (`REPORT.md`) come from a different method (subagent trials under the coordinator's worktree guard) and are **not** comparable.

## Method

| | |
|---|---|
| Run | `v2-baseline`, 2026-10-01 |
| Runner | `orchestrate.mjs` (headless `claude -p` per trial, PLAN-2 0-B), concurrency 4 |
| Model | `claude-opus-5-5` (checked by preflight and per trial), Claude Code CLI 2.1.287 |
| Sygnal | the published `sygnal@5.4.0` tarball, with the 5.4.0 `sygnal-dev` skill installed (D45) |
| React | the React arm starters (React 19 + Vitest + Testing Library) |
| Tasks | tiers 1–3: 17 tasks (Sygnal), 15 tasks (React, which has no 06/07), 5 trials each |
| Trials | 160, all passed the hidden acceptance tests (Sygnal 85/85, React 75/75) |
| Cost | $49.26 total (Sygnal $0.38, React $0.24 per trial on shared tasks) |

Raw data: `results/v2-baseline.json`, `results/transcripts/v2-baseline.tsv`, and the full analysis in `results/analysis/v2-baseline.md`. Transcripts are in `/private/tmp/sygnal-evals/trials/v2-baseline/` and are not committed.

## Headline (15 shared tasks)

| Metric | Sygnal | React | Ratio |
|---|---|---|---|
| Wall time per trial (mean) | **48.4 s** | **34.1 s** | 1.42× (+14.3 s) |
| Cost per trial | $0.38 | $0.24 | 1.59× |
| Peak context | 37.0k | 25.1k | 1.47× |
| Billed tokens | 232k | 119k | 1.94× |
| Tool calls | 8.3 | 5.1 | 1.63× |
| Build/test iterations | 2.0 | 1.4 | 1.43× |
| Failed build/test runs | 0.3 | 0.2 | — |
| Kept their own test | 75/75 | 55/75 | — |

Pass rate is 100% in both arms on all tiers. With Opus 5.5 it can't separate the arms, even on tier 3 (D46). Pass-rate differences are left to E7, which runs the same tasks on smaller models.

## By tier (mean wall time per trial, shared tasks)

| Tier | Tasks | Sygnal | React | Gap |
|---|---|---|---|---|
| 1 | 01–05, 08 (06/07 are Sygnal only: 17.3 s, 20.4 s) | 29.4 s | 21.5 s | +8.0 s |
| 2 | 09–12 | 51.1 s | 38.9 s | +12.3 s |
| 3 | 13–17 | 68.9 s | 45.4 s | +23.5 s |

The gap grows with task size. The largest per-task gaps:

| Task | Sygnal | React | Gap | Note |
|---|---|---|---|---|
| 16 split-checkout (refactor) | 112.2 s | 74.2 s | +38.0 s | 4.6 iterations vs 2.8; peak context 51k |
| 13 course-portal (multi-file) | 80.3 s | 47.0 s | +33.3 s | |
| 17 address-lookup (form + async) | 73.8 s | 43.6 s | +30.2 s | |
| 10 signup-wizard | 64.6 s | 42.9 s | +21.7 s | |
| 08 extract-rating | 41.8 s | 21.0 s | +20.8 s | **4.8 iterations vs 1.0**; React agents mostly didn't keep a test (0/5) |
| 11 search-debounce | 57.4 s | 37.3 s | +20.1 s | |

The two debugging tasks are close: task 14 is +4.3 s and task 15 is +11.9 s.

## Where the 14.3 s goes (task-matched, shares of the delta)

| Group | Δ s/trial | Share |
|---|---|---|
| Learning the framework: library files under `node_modules` (`llms.txt` read in 41/85 trials; 21 reads of `dist/index.*.js`), by topic | 6.4 | 45% |
| Writing tests | 2.3 | 16% |
| Implementation | 2.2 | 15% |
| Build/test runs | 2.2 | 15% |
| Loading the skill (22 KB, read whole in 85/85 trials) | 1.1 | 8% |
| Thinking | 1.0 | 7% |
| Debugging own mistakes | 0.5 | 3% |
| Orientation | −1.3 | −9% |

No time went to known framework or tooling defects (0 s), and no harness-guard refusals occurred.

## What this suggests for Phase 3

- **Learning cost (52% with the skill load).** About half the trials still open `llms.txt` or the bundle after loading the skill. The Sygnal arm also carries about 12k more context (1.47×), mostly the injected SKILL.md. These are the main inputs for **E5** (skill size and shape) and **E1**.
- **Testing norm.** Every Sygnal agent wrote and kept a test; React agents kept 55/75, and none on task 08. Part of the gap is the skill's "always add a test" rule, not the framework. That is **E9**.
- **Refactors and multi-file work (tasks 08, 13, 16).** Iterations and context grow fastest here. 2-D2 (the extract-component recipe, merged after this baseline) targets task 08, and the Phase 2 targeted eval measures it.
- **Async and form tasks (10, 11, 17).** These feed **E2**/**E3** (drivers, latest-only), **E4** (real-DOM tests) and **E11** (fake timers).
