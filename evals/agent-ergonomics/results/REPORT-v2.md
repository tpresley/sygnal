# PLAN-2 final eval: report

This is the report for PLAN-2 §6 4-B. It has the same structure as PLAN-1's `REPORT.md`, plus tier-3 pass rates, the TypeScript tier and a model-sensitivity table.

Every number comes from a run named next to it:
- results: `results/<run>.json`;
- analyses: `results/analysis/<run>.{md,json}`;
- transcripts: `/private/tmp/sygnal-evals/trials/<run>/`.

Comparisons are task-matched with `analysis/compare.mjs`: each task's mean is taken first, then the mean over the tasks both sides share. The phase tables apply the same method to the analyzer's per-trial phase attribution.

## TL;DR

The primary comparison uses the same model (Opus 5.5) on the same day, in the same isolated posture:
- **Before:** Sygnal 5.4.0, starter v1, the 5.4.0 skill (`p4-baseline`, `p4-baseline-ts`).
- **After:** this branch at tag `plan2-p4-final-build-2`, starter v2, the branch skill (`p4-final2`).
- **React:** `p3-control-react` (tasks 01–17) and `p4-react-ts` (tasks 18–21).

| Tier (shared tasks) | React wall | Sygnal 5.4.0 wall | Gap before | Sygnal branch wall | Gap after | Gap change |
|---|---|---|---|---|---|---|
| 1 (6 tasks: 01–05, 08) | 20.2 s | 30.8 s | +10.7 s (1.53×) | **26.9 s** | **+6.8 s (1.34×)** | −37% |
| 2 (4 tasks: 09–12) | 35.6 s | 53.4 s | +17.8 s (1.50×) | **50.6 s** | **+15.0 s (1.42×)** | −16% |
| 3 (5 tasks: 13–17) | 46.8 s | 69.1 s | +22.2 s (1.47×) | **64.0 s** | **+17.2 s (1.37×)** | −23% |
| **1–3 (15 tasks)** | 33.2 s | 49.6 s | **+16.4 s (1.50×)** | **45.6 s** | **+12.4 s (1.37×)** | **−24%** |
| TS (4 tasks: 18–21) | 31.3 s | 44.0 s | +12.7 s (1.40×) | 44.5 s | +13.2 s (1.42×) | none (within noise) |

| | Sygnal 5.4.0 | Sygnal branch | React |
|---|---|---|---|
| Pass, tiers 1–3 | 85/85 | 85/85 | 75/75 |
| Pass, tier 3 | 25/25 | 25/25 | 25/25 |
| Pass, TS tier | 20/20 | 20/20 | 20/20 |
| Sygnal-only wall, 17 tasks | 46.3 s | **42.9 s (−3.5 s, −7.5%)** | — |
| Iterations, 17 tasks | 1.81 | 1.72 | 1.57 (15 tasks) |
| Failed build/test runs per trial, 17 tasks | 0.21 | 0.31 | 0.28 (15 tasks) |
| Cost per trial, 15 shared tasks | $0.302 (1.83× React) | $0.324 (1.96×) | $0.165 |
| Peak context, 15 shared tasks | 28.4k (1.72×) | 31.8k (1.92×) | 16.6k |

**On Opus the gap is 24% smaller in wall time, and every tier improved.**
- Pass rate is 100% in every arm and tier, so wall time is the signal.
- Cost moved the other way. The larger skill plus the starter v2 `AGENTS.md`/`CLAUDE.md` add about 3.4k context per turn.

**Smaller models give a pass-rate signal.**
- **Haiku 4.5** (`p4-haiku2`, final build, process guard on): Sygnal passes **71/95** on the shared tasks against React's **62/95** (74.7% vs 65.3%), and 81/105 including 06 and 07. The wall gap is large: +57.5 s (1.54×).
- **Sonnet 5.5** (`e7-sonnet`, Phase 3 build): pass rates are equal (73/75 vs 74/75), with a gap of +9.6 s (1.69×).

**For reference:** v2-baseline had +14.3 s (1.42×) and a 1.59× cost ratio (`V2-BASELINE.md`). It used the installed-skill posture, so it is cited here, not diffed.

**Eval cost, API-equivalent, on the user's subscription:**
- confirming chain: $87.90 (`p4-final2` $33.11, `p4-baseline-ts` $6.00, `p4-react-ts` $2.99, `p4-haiku2` $45.80);
- earlier Phase 4 runs: `p4-baseline` $24.43, `p4-final` $26.34.

## Method

| | |
|---|---|
| Runner | `orchestrate.mjs` headless (one `claude -p` per trial), 5 trials per (arm, task), concurrency 4 |
| Model | `claude-opus-5-5`, checked per trial (Haiku: `claude-haiku-4-5-20251001`; Sonnet: `claude-sonnet-5-5`) |
| Posture | **Isolated** (3-H): `--setting-sources project,local`, and the skill comes from the variant via `--add-dir`, never from `~/.claude`. Every run in this report uses it. `v2-baseline` and `p2-targeted` used the older installed-skill posture, so they are cited, not diffed. |
| Before | Variant `baseline-5.4.0`: published `sygnal@5.4.0`, the 5.4.0 skill from git, **starter v1** (bare starters, no sygnal-check) |
| After | Variant `branch` at `plan2-p4-final-build-2`: branch build, `skills/sygnal-dev` (345 lines, 29.4 KB), **starter v2** (vendored `sygnal-check` plus template `AGENTS.md`/`CLAUDE.md`; 4-E). `p4-final` is the same set-up at `plan2-p4-final-build`, i.e. before 4-R, 4-T and 4-F. |
| React | `p3-control-react`, run 2026-10-01 with the `branch` variant. The React arm has no skill or starter kit, so neither change touches it. `p4-react-ts` ran 2026-10-02 on the TS tasks. Caveat: the React tier 1–3 numbers are one day older than the Sygnal ones. |
| Process guard | G-127: `pkill`, `killall` and `kill` are denied, and per-trial PATH shims block them. On for `p4-final2`, `p4-baseline-ts`, `p4-react-ts` and `p4-haiku2`. `p4-baseline`, `p4-final` and `p3-control-react` ran before the guard existed; their transcripts contain no kill commands. |
| Excluded | `e7-haiku` and `p4-haiku`, contaminated by machine-wide kills (G-127). |
| Noise | n = 5 per cell. Per-task differences under about **5 s or 10%** are within noise unless they repeat across tasks. Means over a tier or over all tasks (20–85 trials) are more reliable. |

## Tier 1 (01–08)

| Task | React | Sygnal 5.4.0 | `p4-final` | **Sygnal branch** | Gap before → after | Iterations, 5.4.0 → branch |
|---|---|---|---|---|---|---|
| 01 clear completed | 19.9 | 23.4 | 27.0 | **21.9** | +3.5 → +2.0 | 1.0 → 1.0 |
| 02 pin via Collection | 17.7 | 24.8 | 22.3 | **23.7** | +7.2 → +6.0 | 1.0 → 1.0 |
| 03 status via EVENTS | 21.1 | 30.6 | 25.3 | **26.1** | +9.4 → +4.9 | 1.2 → 1.0 |
| 04 derived total | 19.3 | 27.0 | 27.5 | **27.9** | +7.7 → +8.6 | 1.6 → 1.4 |
| 05 async driver | 22.8 | 38.0 | 25.8 | **26.2** | +15.2 → **+3.4** | 1.2 → 1.0 |
| 06 fix selector typo | — | 20.8 | 22.0 | **20.8** | — | 1.0 → 1.0 |
| 07 fix isolation bug | — | 22.7 | 25.5 | **23.6** | — | 1.4 → 1.2 |
| 08 extract component | 20.2 | 41.1 | 44.3 | **35.8** | +20.9 → +15.6 | 3.4 → 2.2 |
| **Tier mean (6 shared)** | 20.2 | 30.8 | 28.7 | **26.9** | **+10.7 → +6.8** | |

- **Task 05:** −11.9 s, from `makeFetchDriver` (E2). In 5.4.0, all 5 trials put `fetch` in the component and 2 of 5 hand-rolled a request id. On the branch, all 5 used `makeFetchDriver` with `latest: true` and none needed request ids.
- **Task 08:** −5.3 s, with iterations down from 3.4 to 2.2 (the 2-D2 extract-component recipe). It is still the largest tier-1 gap (+15.6 s), driven by a verify-heavy snapshot loop.
- **Tasks 01–04, 06 and 07:** changes are within noise.

## Tier 2 (09–12)

| Task | React | Sygnal 5.4.0 | `p4-final` | **Sygnal branch** | Gap before → after | Iterations / failed runs, 5.4.0 → branch |
|---|---|---|---|---|---|---|
| 09 board moves | 32.6 | 39.0 | 38.2 | **38.9** | +6.4 → +6.3 | 1.4 / 0.4 → 1.2 / 0 |
| 10 signup wizard | 40.9 | 60.2 | 53.6 | **55.2** | +19.3 → +14.2 | 2.0 / 0.2 → 1.6 / 0 |
| 11 search debounce | 34.2 | 64.5 | 49.5 | **59.4** | +30.3 → +25.2 | 1.4 / 0.2 → **3.2 / 2.0** |
| 12 selection panel | 34.7 | 50.0 | 69.6 | **49.0** | +15.4 → +14.4 | 2.0 / 0.4 → 2.2 / 0 |
| **Tier mean** | 35.6 | 53.4 | 52.7 | **50.6** | **+17.8 → +15.0** | 1.70 / 0.30 → 2.05 / 0.50 |

**Task 10 (−5.0 s):** the second test suite is gone (E4).
- 5.4.0: every trial wrote a `run()` + jsdom suite, for 9 test files across the 5 trials.
- Branch: every trial used `renderComponent(App, { dom: 'real' })`, with one file each.

**Task 11 (−5.1 s, within noise):** fake timers and `makeFetchDriver({ latest: true })` were used in 5/5 trials (E11, E2). Part of the gain went to a new test-authoring trap:
- Agents wrote `expect(() => t.respond(... superseded request ...)).toThrow()`, but `t.respond` returns `void` and fails asynchronously. This caused 4 of the 5 trials' failed runs.
- A further 2 failed runs were deliberate: agents temporarily removed `latest: true` to check that their own tests catch it.

## Tier 3 (13–17): pass rates and wall time

| Task | Pass: React / 5.4.0 / branch | React | Sygnal 5.4.0 | `p4-final` | **Sygnal branch** | Gap before → after | Iterations, 5.4.0 → branch |
|---|---|---|---|---|---|---|---|
| 13 course portal (multi-file) | 5/5 · 5/5 · 5/5 | 45.8 | 73.5 | 82.6 | **67.4** | +27.7 → +21.6 | 1.8 → 1.8 |
| 14 fix support inbox (debug) | 5/5 · 5/5 · 5/5 | 20.4 | 31.9 | 64.2 | **31.3** | +11.5 → +10.9 | 2.0 → 1.4 |
| 15 fix reading list (debug) | 5/5 · 5/5 · 5/5 | 35.4 | 47.4 | 43.8 | **46.6** | +12.0 → +11.1 | 1.4 → 1.6 |
| 16 split checkout (refactor) | 5/5 · 5/5 · 5/5 | 92.0 | 123.8 | 110.9 | **104.2** | +31.8 → +12.2 | 5.4 → 4.2 |
| 17 address lookup (form + async) | 5/5 · 5/5 · 5/5 | 40.6 | 68.9 | 72.5 | **70.7** | +28.3 → +30.0 | 1.6 → 2.2 |
| **Tier mean** | 25/25 each | 46.8 | 69.1 | 74.8 | **64.0** | **+22.2 → +17.2** | 2.44 → 2.24 |

**Tier 3 doesn't separate the arms on Opus** (D46): every arm passed every trial. The pass-rate signal comes from Haiku (below).

- **Task 16:** −19.6 s, the largest single gain.
- **Task 13:** −6.1 s, from the Switchable fixes (3-F) plus E2. No trial hit a stuck page.
- **Task 17:** the largest remaining gap (+30.0 s).
  - All 5 trials switched to `dom: 'real'` and `t.respond`, so no `run()` + jsdom suites remain.
  - 4 trials asserted that `t.requests('HTTP')` was empty, but the `{ abort: true }` command is recorded there too, so those assertions failed.
  - Learn time on this task is 14.5 s per trial.

## The p4-final regression and its fix

`p4-final` was run before 4-R, 4-T and 4-F. Compared with 5.4.0 it was slower and failed more test runs:
- wall time: 47.3 s against 46.3 s;
- failed runs per trial: 0.66 against 0.21.

It regressed tasks 12, 13 and 14 while improving 05, 10 and 11. `P4-REGRESSION-DIAGNOSIS.md` traced 33 of the 39 failed runs on tasks 12–14 to three test-harness problems. None of them was a framework regression.

| Cause | Failed runs | Fix (4-F) |
|---|---|---|
| G-135: after a child's lens write, the stored root state kept stale `calculated` values (pre-existing, but now hit through the documented `t.state`) | 20 | Core: the `withCalculated` lens `set` recomputes calculated fields (+20 B) |
| G-136: the fake HTTP source tracked requests by object identity, so re-sending a constant request was treated as "already answered" | 9 (every task-13 trial) | Track each send separately |
| G-137: `t.html()` escaped `'` as `&#39;` | 4 | Serialise like `innerHTML` |
| G-138: the AGENTS.md recipe piped test output through `tail`, cutting off the error | ≈7 reruns | Grep around the `FAIL` line instead |

`p4-final2` confirms the fixes:

| Task | Wall, `p4-final` → `p4-final2` | Iterations | Failed runs per trial |
|---|---|---|---|
| 12 selection panel | 69.6 → 49.0 | 3.6 → 2.2 | 1.8 → 0 |
| 13 course portal | 82.6 → 67.4 | 4.2 → 1.8 | 2.6 → 0 |
| 14 fix support inbox | 64.2 → 31.3 | 6.0 → 1.4 | 3.4 → 0.4 |
| All 17 tasks | 47.3 → 42.9 | 2.07 → 1.72 | 0.66 → 0.31 |

## Where the remaining gap goes

Seconds per trial, task-matched over the 15 shared tasks:

| Phase | React | Sygnal 5.4.0 | Δ (share of 16.4 s gap) | Sygnal branch | Δ (share of 12.4 s gap) |
|---|---|---|---|---|---|
| Learn | 0.0 | 7.0 | +7.0 (42%) | 5.0 | **+5.0 (40%)** |
| Verify (build/test/check runs) | 2.2 | 6.8 | +4.6 (28%) | 5.8 | +3.6 (29%) |
| Test authoring | 7.9 | 9.8 | +1.9 (12%) | 9.7 | +1.8 (15%) |
| Debug | 1.3 | 1.6 | +0.3 (2%) | 2.9 | +1.7 (13%) |
| Implement | 11.7 | 13.4 | +1.7 (10%) | 12.8 | +1.1 (9%) |
| Think | 5.3 | 6.4 | +1.1 (7%) | 5.8 | +0.6 (4%) |
| Orient | 4.8 | 4.6 | −0.2 | 3.5 | −1.3 |
| Tooling friction | 0 | 0 | 0 | 0 | 0 |
| **Wall** | 33.2 | 49.6 | +16.4 | 45.6 | +12.4 |

- **Learn (+5.0 s):**
  - Reading framework source fell from 4.2 to 1.9 s per trial (the E5 facts).
  - Loading the skill rose from 1.0 to 1.5 s: SKILL.md is now 345 lines and is read whole in all 105 trials.
  - Learn time is concentrated in the async and form tasks: 17 (14.5 s), 13 (11.2 s), 10 (9.3 s) and 12 (7.7 s).
- **Verify (+3.6 s):** Sygnal agents run `npm test`, `sygnal-check --strict` and often `npm run build`. Both arms wrote tests in every trial, so testing habits are not the difference (E9).
- **Tooling friction and known defects:** 0 s. `sygnal-check --strict` is clean on the final `src/` in 105/105 trials.

## What moved it

| Change | Evidence in the final run |
|---|---|
| **E2** `makeFetchDriver({ latest })` plus test fakes `t.respond` / `t.fail` / `t.requests` (D52, D54) | Tasks 05/11/13/17: `fetch` in components went from 20/20 to 0/20, and hand-rolled request ids from 9/20 to 3/20. Task 05 −11.9 s, task 13 −6.1 s |
| **E11** harness waits driven by fake timers | Task 11: `vi.useFakeTimers()` went from 0/5 to 5/5 suites |
| **E4** `renderComponent({ dom: 'real' })` with real-mode waits (4-A1) | `run()` + jsdom suites went from 15/15 to 0/15 on tasks 10/13/17. Task 10: 9 test files → 5, −5.0 s |
| **E5 facts** (4 facts ported; `component-patterns.md` removed; lean variants dropped) | Framework-source learn time 3.7 → 1.7 s per trial (17 tasks) |
| **E1 → starter v2** (sygnal-check plus template AGENTS.md; pretest hook dropped) | No more "npx canceled" (G-123); `--strict` clean in 105/105. Cost: about 3.4k more peak context |
| **2-D2** extract-component recipe | Task 08 −5.3 s; iterations 3.4 → 2.2 |
| **Fixes** | 3-F (Switchable PARENT, stuck pages, context lag), 4-F (G-135–G-138), 4-T (typed links, G-130), and the Phase 1–2 correctness backlog |
| **Not adopted** | E5 lean skills (+3.6 to +5.2 s slower), E8 MCP in agent docs, E9 (the testing norm isn't the gap), the E1 pretest hook |

## Model sensitivity (E7)

| Model / run | Tier | Sygnal pass | React pass | Wall, Sygnal / React | Gap |
|---|---|---|---|---|---|
| **Opus 5.5** (`p4-final2` vs React) | 1 / 2 / 3 / TS | 30/30 · 20/20 · 25/25 · 20/20 | same | 26.9/20.2 · 50.6/35.6 · 64.0/46.8 · 44.5/31.3 | 1.34× · 1.42× · 1.37× · 1.42× |
| **Sonnet 5.5** (`e7-sonnet`, Phase 3 build) | 1 / 2 / 3 | 30/30 · 20/20 · **23/25** | 30/30 · 20/20 · 24/25 | 15.2/9.7 · 25.1/14.7 · 31.9/18.1 | 1.56× · 1.71× · 1.76× |
| **Haiku 4.5** (`p4-haiku2`, final build, guard on) | 1 / 2 / 3 / TS | **30/30** · **13/20** · 16/25 · 12/20 | **25/30** · **8/20** · 16/25 · 13/20 | 77.9/75.1 · 206.6/129.4 · 221.9/134.2 · 180.4/98.4 | 1.04× · 1.60× · 1.65× · 1.83× |

| Model | Sygnal pass (shared) | React pass | Gap (all shared tasks) | Cost ratio | Peak context, Sygnal / React |
|---|---|---|---|---|---|
| Opus 5.5 | 95/95 | 95/95 | +12.4 s (1.37×), tiers 1–3 | 1.96× | 31.8k / 16.6k |
| Sonnet 5.5 | 73/75 | 74/75 | +9.6 s (1.69×) | 2.32× | 27.3k / 14.3k |
| Haiku 4.5 | **71/95 (74.7%)** | **62/95 (65.3%)** | +57.5 s (1.54×) | 1.73× | 51.8k / 36.2k |

- **Haiku is the first model where pass rate separates the arms, and Sygnal is ahead.** The lead comes from tier 1 (+5 trials) and tier 2 (+5). Tier 3 is level, and the TS tier is −1.
- **Haiku agents tried to kill processes in 82 of 200 trials.** The guard refused every attempt, and no trial was invalidated.
- **Sonnet:** both Sygnal failures came from the Switchable PARENT bug (G-120), since fixed in 3-F. Sonnet's React agents wrote no tests at all (0/75), which explains most of its wider wall-time ratio.

### Haiku failure categories (first root cause)

Classification is from the hidden-test messages and the agents' final reports. The Sygnal "logic" rows are not yet confirmed at code level.

| Arm | Spec misread | Logic | TS typecheck (agent's own test file) | Incomplete | Wiring / isolation / reducer shape / stream operator |
|---|---|---|---|---|---|
| Sygnal (24) | 7 | 12 (selection on Escape/delete, error/Retry across switches, lookup state, stale-closure fix, moved cards) | 3 | 2 | 0 confirmed |
| React (33) | 23 (icon-only Pin buttons, edge Prev/Next, email rule, search text, enrollment order) | 10 (6 are stale requests not invalidated on 11/17) | 0 | 0 | 0 |

**Reading:**
- On the async tasks the framework's structure helped the smaller model. Haiku's React agents missed request invalidation on tasks 11 and 17 in 10 of 10 trials. Sygnal's `latest: true` gave 3/5 on task 11 against React's 0/5.
- No Sygnal failure was a silent wiring error.
- Haiku with Sygnal is still much slower (1.54×). The remaining cost is comprehension, not correctness.

## TypeScript tier (E10, tasks 18–21)

| Run | Pass | Wall | Iterations | Failed runs | Peak context | Trials with any `tsc` error |
|---|---|---|---|---|---|---|
| React (`p4-react-ts`) | 20/20 | 31.3 | 1.85 | 0.30 | 16.1k | 0/20 |
| Sygnal 5.4.0 (`p4-baseline-ts`) | 20/20 | 44.0 | 1.80 | 0.30 | 29.5k | **9/20** |
| **Sygnal branch** (`p4-final2`) | 20/20 | 44.5 | **1.50** | **0.15** | 32.8k | **5/20** |
| Haiku Sygnal | 12/20 | 180.4 | 6.30 | 0.90 | 54.8k | 18/20 |
| Haiku React | 13/20 | 98.4 | 4.45 | 0.90 | 35.2k | 0/20 |

**The 4-T typing fixes show up as fewer type errors, not less time.**
- Trials hitting a `tsc` error fell from 9/20 to 5/20.
- Iterations dropped by 0.3, and failed runs halved.
- Wall time is unchanged.

**The remaining errors are mostly in agents' own test files.** The most common is TS7006 in `t.next(s => …)`, because `renderComponent` and `RenderResult` aren't generic in the state type.

**On Haiku, the typed API surface costs time.** 18 of 20 Sygnal TS trials hit `tsc` errors, against 0 of 20 for React.

## Failures

- **Opus, every run in this report:** 0 failures.
  - `p4-baseline` 85/85, `p4-baseline-ts` 20/20, `p4-final` 85/85, `p4-final2` 105/105.
  - `p3-control-react` 75/75, `p4-react-ts` 20/20.
- **Sonnet** (`e7-sonnet`): 3 failures.
  - `sygnal-13-t2` and `sygnal-13-t5`: the Switchable PARENT drop (G-120, a framework bug, fixed).
  - `react-15-t3`: a partial fix.
- **Haiku** (`p4-haiku2`): 57 failures (24 Sygnal, 33 React), classified in the categories table above.

## Limitations

- **Sample size:** n = 5 per cell. The 17-task Sygnal gain (−3.5 s, −7.5%) is an aggregate carried by tasks 05, 08, 10, 11, 13 and 16.
- **Different days:** the React tier 1–3 arm ran one day before the Sygnal runs.
- **Three changes measured together:** the starter (v1 → v2), the skill and the build all changed between before and after. Effects are attributed by mechanism, not by isolated A/B runs. E1's isolated A/B run showed no change in time.
- **Pass rate is saturated on Opus.** The pass-rate comparison rests on one Haiku run and one Sonnet run (the Sonnet run used the Phase 3 build).
- **Phase attribution is heuristic.** Context and cost capture what the learn phase undercounts.
- **Some failed runs are deliberate:** agents reverting their own fix to check that their tests catch it.

## What's left

**New from this run:**
- `t.respond` / `t.fail` on a superseded request return `void` and fail asynchronously, so assertions such as `toThrow()` don't catch it. 4 of 5 task-11 trials hit this. Return a rejecting promise, or document how to test that a stale reply is ignored.
- `t.requests('HTTP')` includes `{ abort: true }` commands. 4 of 5 task-17 trials hit this. Filter them out, or document it.
- `renderComponent` / `RenderResult` are not generic in the state type. This is the top TS error on both Opus and Haiku.
- **Context and cost:** Sygnal's peak context is 1.92× React's, and its cost 1.96×. The levers are how the skill loads and how agents read `llms.txt`; E5 showed that simply shrinking the skill costs time.
- **Largest remaining per-task gaps:** 17 (+30 s), 11 (+25 s), 13 (+22 s) and 08 (+16 s).

**Open tracker items:**
- Collection and calculated fields: G-103, G-104, G-105, G-115, G-116.
- devtools in production builds: G-100.
- fetchDriver: G-131, G-133, G-134.
- testing: G-111, G-139.
- eval: G-128.
- integrations: G-112, G-113, G-117.
- shared `selectModule` queue: G-080.

**Next major (N-1):** a rethink of network calls, HTTP and WebSocket, as a first-class layer. Inputs from PLAN-2:
- E2's design notes and open questions;
- D54's per-scope isolation;
- the `t.respond` and `t.requests` traps above;
- the Haiku async results.

The 6.0.0 release is held open (D56).
