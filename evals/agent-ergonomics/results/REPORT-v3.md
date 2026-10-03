# PLAN-3 final eval: report

This is the report for PLAN-3 §4 4-D. It follows `REPORT-v2.md` and adds:
- the `net` tier (tasks 22–25);
- the PLAN-3 checkpoints;
- adoption of the new network APIs;
- the `resources` A/B decision (D74);
- the D76 learn-time check;
- significance tests.

Every number comes from a run named next to it: results in `results/<run>.json`, analyses in `results/analysis/<run>.{md,json}`, transcripts in `/private/tmp/sygnal-evals/trials/<run>/`. Comparisons are task-matched (`analysis/compare.mjs`): each task's mean first, then the mean over the tasks both sides share. Phase tables apply the same method to the analyzer's per-trial phase attribution.

## TL;DR

The final runs used the PLAN-3 build: one tarball (sha256 `9096b4b1…`; `gitSha` `0e39a6a`, and `82f7e6e` for the later runs), starter v2, and the process guard on.

| Run | What | Pass | Cost |
|---|---|---|---|
| `p3-v6` | Opus 5.5, Sygnal, all 25 tasks × 5 | 125/125 | $46.06 |
| `p3-v6-react` | Opus 5.5, React, tasks 24 and 25 × 5 | 10/10 | $3.00 |
| `p3-v6-skill-ab` | Opus 5.5, Sygnal, resources-first skill (D91), tasks 05, 11, 17, 23, 24 × 5 | 25/25 | $12.67 |
| `p3-v6-haiku` | Haiku 4.5, Sygnal, tiers 1–3 + `net` × 5, plus trials 6–10 on 02, 10, 11, 17, 22 (D86) | 91/130 | $42.47 |
| `p3-v6-react-haiku` | Haiku 4.5, React, tasks 24 and 25 × 5 | 0/10 | $3.54 |
| `p3-v7` | Opus 5.5, Sygnal, tasks 23, 24, 25 × 5, after G-184/G-185/G-189 (D94; see [the re-run](#targeted-re-run-after-g-184-and-g-185-d94)) | 15/15 | $8.29 |
| `p3-v7-haiku` | Haiku 4.5, Sygnal, tasks 14, 24, 25 × 5, same build | 3/15 | $7.42 |

React baselines:
- `p3-control-react`: tasks 01–17, run 2026-10-01;
- `p4-react-ts`: tasks 18–21, run 2026-10-02;
- `p3-net-baseline`, React arm: tasks 22 and 23;
- `p3-v6-react`: tasks 24 and 25.

| Tier (shared tasks) | React wall | Sygnal 5.4.0 (`p4-baseline`) | `p4-final2` (PLAN-2 end) | `p3-final` (checkpoint) | **`p3-v6` (PLAN-3 end)** | Gap now |
|---|---|---|---|---|---|---|
| 1 (01–05, 08) | 20.2 s | 30.8 (1.53×) | 26.9 (1.34×) | 24.7 (1.23×) | **23.1 s** | **+2.9 s (1.15×)** |
| 2 (09–12) | 35.6 s | 53.4 (1.50×) | 50.6 (1.42×) | 46.4 (1.30×) | **45.8 s** | **+10.2 s (1.29×)** |
| 3 (13–17) | 46.8 s | 69.1 (1.47×) | 64.0 (1.37×) | 62.6 (1.34×) | **57.0 s** | **+10.2 s (1.22×)** |
| **1–3 (15 tasks)** | 33.2 s | 49.6 (1.50×) | 45.6 (1.37×) | 43.1 (1.30×) | **40.5 s** | **+7.3 s (1.22×)** |
| TS (18–21) | 31.3 s | 44.0 (1.40×) | 44.5 (1.42×) | 44.5 (1.42×) | **40.6 s** | **+9.3 s (1.30×)** |
| `net` 22–23 | 35.7 s | — | — | 44.4 (1.24×); `p3-net-baseline` 63.7 (1.78×) | **61.2 s** | +25.5 s (1.71×) |
| `net` 24–25 (new) | 77.0 s | — | — | — | **134.7 s** | +57.7 s (1.75×) |
| **All 23 shared tasks** | 36.9 s | | | | **50.5 s** | **+13.6 s (1.37×)** |

- **Pass rate.** Opus passes every trial in every arm: 125/125 Sygnal, and 10/10 React on 24 and 25. Wall time is the signal.
- **On the 21 tasks that existed at the end of PLAN-2, Sygnal is 11% faster than `p4-final2`.** Wall went from 43.2 to 38.5 s (task-paired p = 0.0001; 95% CI of the change −6.5 to −2.9 s).
  - The gap to React on tiers 1–3 fell from +12.4 s (1.37×) to +7.3 s (1.22×).
  - Cost rose 5% (p = 0.04) and peak context rose by 2.3k tokens (+7%).
- **Since the `p3-final` checkpoint, nothing moved significantly** on the 23 shared tasks (41.4 → 40.4 s, p = 0.57). Two exceptions:
  - **Task 23 got slower:** 39.8 → 59.3 s (p = 0.024).
  - Task 22 rose from 49.0 to 63.0 s, but that is one trial with a 57-second stall, and it isn't significant (p = 0.37).
- **New tasks.**
  - Task 25 (router) is close to React: 79.2 vs 69.3 s (1.14×, p = 0.09).
  - **Task 24 (list/detail cache) is the largest gap in the eval:** 190.2 vs 84.6 s (2.25×, p = 0.008). No Opus trial used `resources` or `queryCache` on it; every trial hand-built a cache in state.
- **`resources` stays an advanced form (D74).** The resources-first skill was 3% slower (73.6 → 75.9 s, p = 0.13), not at least 10% faster.
- **Haiku.**
  - Tasks 01–17: 66/85 (77.6%). That sits between `p4-haiku2` (81.2%) and `p3-final-haiku` (71.8%); neither difference is significant (p = 0.71 and 0.48).
  - Task 22 went from 1/5 to **10/10** (p = 0.004).
  - Tasks 24 and 25 are beyond Haiku in both arms: Sygnal 1/5 and 0/5, React 0/5 and 0/5.
  - On task 24 Sygnal passes more hidden tests per trial: 4.2 vs 1.4 of 6 (p = 0.03).
- **D76 passes.** Learn time per trial went from 5.4 to 5.3 s across all trials, and from 5.4 to 4.4 s task-matched. Peak context rose by 0.6k (+1.8%) vs `p3-final`.

**Eval cost:** $107.74 for the five final runs (API-equivalent, on the user's subscription). The three interrupted trials (see Method) reported no cost.

## Method

| | |
|---|---|
| Runner | `orchestrate.mjs`, headless (one `claude -p` per trial), 5 trials per (arm, task). Claude Code 2.1.287 in every run |
| Models | `claude-opus-5-5`; Haiku is `claude-haiku-4-5-20251001` |
| Posture | Isolated (3-H): `--setting-sources project,local`, with the skill from the variant via `--add-dir` |
| Sygnal build | One packed tarball for all Sygnal runs (sha256 `9096b4b1c8…`). `p3-v6`, `p3-v6-react` and `p3-v6-haiku` record `gitSha` `0e39a6a`; `p3-v6-skill-ab` and `p3-v6-react-haiku` record `82f7e6e` (a tracker-only commit on top). Variant `branch@748233fc68fa` (default skill, SKILL.md 34,343 B, 363 lines); `p3-skill-resources-first@10649aba6719` for the A/B |
| Process guard | On (`processGuard: 1`) in every run. Kill attempts refused: Opus 0, Haiku Sygnal 46/130 trials, Haiku React 8/10 |
| Checkpoints | `p4-final2` (PLAN-2 end), `p3-net-baseline` (pre-routing build `cf9c641`), `p3-final` (network layer before Phase 5, `2337e3c`), `p3-final-haiku`, `p3-resources` (informational) |
| Noise and tests | n = 5 per cell (10 on the D86 Haiku tasks). Per-task differences under about 5 s or 10% are within noise unless they repeat. Tests used: exact two-sample permutation on trial wall times (per task); task-paired sign-flip permutation and a within-task trial bootstrap (matched means); Fisher's exact test (pass counts) |

**How `p3-v6` was run.** 117 of its 125 trials were started by mistake from the coordinator's session. A dry run was mis-parsed: zsh doesn't word-split an unquoted variable, so `--dry-run` never reached the orchestrator, and the real run started.
- That session stopped the run at 03:45 UTC. Three task-24 trials still in flight were killed (exit 143, "no result"). The orchestrator moved their dirs and transcripts aside as `*.stale-2026-10-03T03-48-34-*` and didn't score them.
- The user then resumed the run from their own terminal. That ran those three trials again, plus the five task-25 trials.
- Both parts used the same tarball, variant hash, model, Claude Code version and process guard (`manifest.json` records one value for each).
- The resumed 24-t2, t4 and t5 (191–221 s) are in line with 24-t1 and t3 (151–178 s). All five spent long design turns before writing code.

**Caveats.**
- **The React arms for tiers 1–3 and TS are one to two days older** than `p3-v6`. Sygnal also got faster on tasks with nothing new to learn: vs `p4-final2`, task 06 went 20.8 → 17.1 s, 07 went 23.6 → 21.2 s and 01 went 21.9 → 18.3 s. So part of the 11% may be service-side speed. The gap-to-React figures for tiers 1–TS carry that drift. The React arm for tasks 24 and 25 ran the same hour.
- **The A/B ran 3.5 hours after `p3-v6`,** so its absolute wall times aren't strictly comparable either. The rule's 10% bar is larger than the drift seen between same-build runs.
- **The docs site doesn't serve the PLAN-3 guides yet.** The skill links `https://sygnal.js.org/guide/resources/`; 4 of 10 Opus task-24 trials fetched it and got HTTP 404.

## Tier 1 (01–08)

| Task | React | `p4-final2` | `p3-final` | **`p3-v6`** | Gap now |
|---|---|---|---|---|---|
| 01 clear completed | 19.9 | 21.9 | 22.1 | **18.3** | −1.6 |
| 02 pin via Collection | 17.7 | 23.7 | 19.9 | **22.4** | +4.7 |
| 03 status via EVENTS | 21.1 | 26.1 | 23.1 | **21.4** | +0.2 |
| 04 derived total | 19.3 | 27.9 | 22.2 | **24.7** | +5.4 |
| 05 async driver | 22.8 | 26.2 | 19.7 | **20.9** | **−1.9** |
| 06 fix selector typo | — | 20.8 | 18.9 | **17.1** | — |
| 07 fix isolation bug | — | 23.6 | 19.6 | **21.2** | — |
| 08 extract component | 20.2 | 35.8 | 41.2 | **31.0** | +10.8 |
| **Tier (6 shared)** | 20.2 | 26.9 | 24.7 | **23.1** | **+2.9 (1.15×)** |

- **Task 05 is now faster than React.** That meets PLAN-3's bar of React + 2 s or better. All 5 trials use `makeFetchDriver` with reply actions and `latest: true`, and none puts `fetch` in a component.
- Task 08 is still the largest tier-1 gap. Its −10.2 s since `p3-final` isn't significant (p = 0.24).

## Tier 2 (09–12)

| Task | React | `p4-final2` | `p3-final` | **`p3-v6`** | Gap now |
|---|---|---|---|---|---|
| 09 board moves | 32.6 | 38.9 | 39.5 | **37.3** | +4.7 |
| 10 signup wizard | 40.9 | 55.2 | 56.7 | **53.9** | +13.0 |
| 11 search debounce | 34.2 | 59.4 | 42.9 | **41.8** | **+7.5** |
| 12 selection panel | 34.7 | 49.0 | 46.6 | **50.4** | +15.8 |
| **Tier** | 35.6 | 50.6 | 46.4 | **45.8** | **+10.2 (1.29×)** |

**Task 11's gap fell by 70%** (+25.2 → +7.5 s), well over PLAN-3's 25% bar. Reply actions and the reworked fake (`t.respond` throws at the call, G-140) removed the `toThrow()` trap: iterations went from 3.2 to 1.8.

## Tier 3 (13–17)

| Task | Pass (React / Sygnal) | React | `p4-final2` | `p3-final` | **`p3-v6`** | Gap now |
|---|---|---|---|---|---|---|
| 13 course portal | 5/5 · 5/5 | 45.8 | 67.4 | 63.4 | **62.0** | +16.2 |
| 14 fix support inbox | 5/5 · 5/5 | 20.4 | 31.3 | 34.2 | **33.7** | +13.3 |
| 15 fix reading list | 5/5 · 5/5 | 35.4 | 46.6 | 35.9 | **37.1** | +1.6 |
| 16 split checkout | 5/5 · 5/5 | 92.0 | 104.2 | 119.6 | **96.8** | +4.8 |
| 17 address lookup | 5/5 · 5/5 | 40.6 | 70.7 | 59.7 | **55.6** | **+15.0** |
| **Tier** | 25/25 each | 46.8 | 64.0 | 62.6 | **57.0** | **+10.2 (1.22×)** |

- **Task 17's gap halved** (+30.0 → +15.0 s), over the 25% bar.
- Task 16 dropped 22.8 s since `p3-final` (iterations 6.0 → 3.8), which is borderline (p = 0.06). Its `p3-final` time of 119.6 s was itself above `p4-final2`.

## TypeScript tier (18–21)

| Task | React | `p4-final2` | `p3-final` | **`p3-v6`** |
|---|---|---|---|---|
| 18 ts collection pin | 22.6 | 33.1 | 31.6 | **26.5** |
| 19 ts events status | 22.8 | 32.4 | 30.3 | **26.4** |
| 20 ts board moves | 36.1 | 47.3 | 49.3 | **43.3** |
| 21 ts selection panel | 43.8 | 65.3 | 66.9 | **66.2** |
| **Tier** | 31.3 | 44.5 | 44.5 | **40.6 (1.30×)** |

The TS tier improved for the first time (44.5 → 40.6 s), after `renderComponent` gained state-type inference (G-142, 1-T). Task 21 didn't move and is the largest TS gap (+22.3 s).

## The `net` tier (22–25)

| Task | React | `p3-net-baseline` | `p3-final` | **`p3-v6`** (median) | Gap now | p (v6 vs React) | Sygnal / React LOC |
|---|---|---|---|---|---|---|---|
| 22 chat socket | 41.8 | 87.6 | 49.0 | **63.0** (55.9) | +21.2 (1.51×) | 0.008 | 136 / 140 |
| 23 quote resource | 29.5 | 39.7 | 39.8 | **59.3** (53.8) | +29.8 (2.01×) | 0.008 | 109 / 54 |
| 24 list/detail cache | 84.6 | — | — | **190.2** (191.1) | **+105.6 (2.25×)** | 0.008 | 301 / 216 |
| 25 router SPA | 69.3 | — | — | **79.2** (81.9) | +9.9 (1.14×) | 0.09 | 230 / 179 |
| **Tier** | 56.3 | | | **97.9** | **+41.6 (1.74×)** | | |

Every `net` task passes 5/5 on Opus, which meets the PLAN-3 bar.

### Why 22 and 23 got slower than at `p3-final`

**Task 22: +14.0 s, not significant (p = 0.37).** The API, the socket recipe and the code are the same as at `p3-final`:
- 5/5 trials use `makeSocketDriver` with `connections`;
- none hand-rolls connection ids;
- code size is unchanged (133 → 136 LOC).

**One trial explains the mean.** `sygnal-22-t1` took 111.6 s: its last tool call returned at 54.1 s, and the final summary (690 output tokens) arrived 57.5 s later. That gap is the whole "think" phase (18.7 s per trial on average). The other four trials average 50.9 s, against 49.0 s at `p3-final`. Learn time (10.9 → 10.8 s) and test authoring (12.9 → 13.8 s) didn't move. The only additions to the socket section of the skill were the G-173 lines (ABORT on JOIN, a guard against blank SAY).

**Task 23: +19.5 s (p = 0.024).** The time went to tests, not to the app or to the D89 rule.

| Phase (s/trial) | `p3-final` | `p3-v6` | Δ |
|---|---|---|---|
| implement | 13.6 | 13.2 | −0.4 |
| test authoring | 10.4 | 16.8 | +6.4 |
| verify | 3.8 | 6.8 | +3.0 |
| debug | 1.6 | 10.4 | **+8.8** |
| learn | 2.3 | 2.5 | +0.2 |
| iterations | 2.4 | **4.2** | +1.8 |

- **The D89 rule ("treat `refreshing` as loading") cost nothing.** All 3 trials that used `resources` (t3, t4, t5) wrote `quote.refreshing` into the loading condition in their first edit.
- **`t.query()` on the mock DOM: 4 of 5 trials.** Each wrote `t.query(...)`, got `t.query() needs real DOM elements: renderComponent(C, { dom: 'real' })`, and reran.
  - Across all tasks this went from 5/115 trials (`p3-final`) to **17/125** (`p3-v6`): 4/5 on task 23, 3/5 on task 25, and 8/25 in the A/B.
  - The v6 skill moved `t.query` into the same sentence as the `dom: 'real'` bullet.
- **Testing a superseded identical request: 4 of 5 trials.** With `resources`, Refresh sends the same `{ url, resource }` request again, so a URL target can't tell the stale request from the live one. Agents switched to identity predicates such as `(r) => r === reqs[1]`, and ran probe tests to check that `toThrow()` failed for the right reason. In 23-t4 that took about 30 s.
- **A checker false positive: 2 of 5 trials.** 23-t2 built the request in a helper function. `sygnal-check` then reported SYG102 ("never triggered") for its `ok` action, and the agent inlined the request.
- Both reply-action trials (41.6 and 68.0 s) and `resources` trials (53.8, 82.8 and 50.4 s) got slower. With n this small, the two can't be separated.

### Why task 24 is 2.25× React: agents skip `queryCache`

**Where the time goes.** 97% of a task-24 trial is model time.

| | Sygnal (`p3-v6`) | React (`p3-v6-react`) |
|---|---|---|
| Wall | 190.2 s | 84.6 s |
| Output tokens per trial | 19.6k | 8.5k |
| Model turns per trial; longest turn (mean) | 22.6; 62 s | 13.4; 33 s |
| Phases: orient / learn / implement / tests | 39.6 / 20.2 / 85.5 / 25.1 s | 5.0 / 0 / 37.4 / 15.9 s |
| App LOC (excluding tests) | 152 | 153 |
| Peak context | 70.3k | 23.2k |
| Cost | $0.98 | $0.30 |

The "orient" time is long design turns. After reading `fetchDriver.ts` (487 lines) and `queryCache.ts`, trials spent 48–93 s in a single turn before writing `App.jsx`.

**Discovery isn't the problem.** All 5 trials grepped `llms.txt` for `queryCache|invalidat|staleTime` in their first minute, then read the driver or `queryCache` source (2 of them after the guide link returned 404). Each then chose to hand-roll a cache in state, using reply actions and `latest` lanes; 4 of 5 also used request sequence numbers. The reasons they gave:

| Trial | Reason given for not using `queryCache` |
|---|---|
| t1, t2, t3 | The cache is configured in `main.js`, so a test that renders `App` directly "would get no caching" |
| t4 | It "can't tell a reply sent before a save from one sent after it" (the no-stale-overwrite rule) |
| t5 | There is "no way to write the saved title into cached data" |

Each reason points to a real gap:
- **Cache in tests.** `renderComponent(C, { http: { cache: queryCache(...) } })` exists (SKILL §7), but nothing says the cache belongs in `main.js` *and* in the test. React keeps the client inside the component tree (`QueryClientProvider` in `App.jsx`).
- **Stale replies.** Invalidation aborts a reload already in flight, and the reference solution relies on that, but neither SKILL.md nor `llms.txt` says so.
- **Writing into the cache.** There's no model-level way to write a reply into the cache. `cache.set(request, data)` exists only on the cache object, and is documented only for SSR seeding. **All 5 React trials used `setQueryData` together with `invalidateQueries`.**

**When agents did use it, the code was shorter.** In the A/B run, 2 of 5 trials used `resources` + `queryCache` + `invalidates`. They wrote 99 app LOC each, against 99–188 (mean 135) for the hand-rolled trials. Their wall times were 120 s, the fastest task-24 trial in either Sygnal run, and 200 s, of which 51.6 s went to debugging how a hidden resource writes `idle`.

**Fixes, with expected impact** (ranked in Recommendations):
1. **Make the guides reachable offline:** ship `guide/resources` and `guide/http` in the package, or publish the site before agents rely on its links. 4/10 trials hit the 404 and fell back to reading about 600 lines of source.
2. **A list/detail + save recipe in SKILL.md:** about 12 lines, replacing prose. It should cover:
   - `resources` that declare a read only while shown;
   - `queryCache({ staleTime })` in `main.js` **and** `renderComponent({ http: { cache } })` in tests;
   - `invalidates: '/api/items'` on the write;
   - "invalidation aborts older in-flight reads, so an older reply never overwrites".
3. **API: write a reply into the cache from the model,** as the `setQueryData` analogue. For example, `{ ok: 'SAVED', updates: 'item' }` on a write, or a `{ set: { request, data } }` sink command.
4. **Optionally, a component-level cache declaration,** so app and tests can't disagree.

At the level of the two A/B adopters, task 24 would land around 120–200 s with about 100 app LOC. The time estimate rests on n = 2 and is weak; the LOC and the stated reasons are firmer evidence.

### Task 25: the router is close to React

Task 25 is 1.14× React (79.2 vs 69.3 s, p = 0.09).
- All 5 trials used `makeRouter`, the `route` static, `<Switchable instance>`, `makeHeadDriver` with `head`, and the `block` guard.
- The extra time is in tests (17.1 vs 9.4 s) and debugging (8.5 vs 4.1 s); 3/5 trials hit the `t.query()` mock-DOM error.
- **The checker flagged every trial:** SYG102 [info] for `CONFIRM_LEAVE` in 5/5 (G-180). Agents wrote `block: dirty ? 'CONFIRM_LEAVE' : false`, and rewrote it as two literals.

## PLAN-3 checkpoints over time (Opus, Sygnal arm)

| Checkpoint | Build | Matched wall, 21 PLAN-2 tasks | Tasks 22 / 23 | Cost / peak context, 21 tasks | Pass |
|---|---|---|---|---|---|
| `p4-final2` | PLAN-2 end | 43.2 s | — | $0.315 / 31.5k | 105/105 |
| `p3-net-baseline` | pre-routing (`cf9c641`) | — | 87.6 / 39.7 s | — | 10/10 (net) |
| `p3-final` | network layer, before Phase 5 | 41.1 s (−5%) | 49.0 / 39.8 s | $0.335 / 33.4k | 115/115 |
| **`p3-v6`** | PLAN-3 end | **38.5 s (−11%)** | 63.0 / 59.3 s | $0.330 / 33.8k | 125/125 |

| Comparison | Δ | Task-paired p | 95% bootstrap CI of Δ | Reading |
|---|---|---|---|---|
| `p4-final2` → `p3-v6` wall, 21 tasks | −4.7 s (−11%) | **0.0001** | −6.5 … −2.9 s | Real (part may be service-side speed) |
| `p3-final` → `p3-v6` wall, 23 tasks | −1.0 s (−2%) | 0.57 | −2.8 … +0.9 s | No change |
| `p4-final2` → `p3-v6` cost | +5% | 0.04 | +$0.01 … +$0.02 | Small real rise |
| `p4-final2` → `p3-v6` peak context | +2.3k (+7%) | 0.0001 | +1.7k … +2.8k | Real: the larger SKILL.md |

Per task (n = 5 vs 5, exact permutation), only these reach p < 0.05: task 23 slower than `p3-final` (p = 0.024), and tasks 22, 23 and 24 slower than React (p = 0.008 each). The changes on 16 (−22.8 s, p = 0.06), 17 (−4.1 s, p = 0.16) and 08 (−10.2 s, p = 0.24) aren't significant on their own.

## Adoption of the new APIs (final code)

| API | Default skill (`p3-v6`) | Resources-first (`p3-v6-skill-ab`) | Haiku (`p3-v6-haiku`) |
|---|---|---|---|
| `fetch` in a component (all tasks) | **0/125** | 0/25 | 0/130 |
| `makeFetchDriver` + reply actions on 05/11/13/17 | 20/20 | 15/15 (05/11/17) | 34/45 trials |
| `makeSocketDriver` + `connections` (22) | 5/5, 0 hand-rolled connection ids | — | 10/10 |
| `resources` on 23 | 3/5 (+ `{ refresh }`) | **5/5** | 2/5 |
| `resources` on 05 / 11 / 17 | 0 / 0 / 0 | 0 / 1 / 0 | 0 |
| `resources` + `queryCache` + `invalidates` on 24 | **0/5** (4/5 hand-rolled sequence numbers) | 2/5 | 3/5 (2 with `invalidates`) |
| `makeRouter` + `route` + `head` + `Switchable instance` (25) | 5/5 | — | 5/5 (1 also called `history.pushState`) |
| Reply-action typos in final code (SYG112) | 0 | 0 | 0 |
| `sygnal-check --strict` clean on final `src/` | 124/125 (1 SYG102 info) | 25/25 | 128/130 |

## The `resources` decision (D74)

D74 (amending D73) says: adopt the resources-first skill as canonical only if, on tasks 05, 11, 17, 23 and 24, matched wall improves by at least 10%, with no pass-rate loss and no increase in LOC added.

| Task | Default skill | Resources-first | Δ | LOC Δ |
|---|---|---|---|---|
| 05 | 20.9 | 24.2 | +3.3 | −2.0 |
| 11 | 41.8 | 40.3 | −1.4 | −3.4 |
| 17 | 55.6 | 59.5 | +3.9 | −1.4 |
| 23 | 59.3 | 63.5 | +4.2 | +27.8 |
| 24 | 190.2 | 191.9 | +1.7 | −10.2 |
| **Matched** | **73.6** | **75.9** | **+2.3 s (+3.2%)**, p = 0.13, CI −7.1 … +11.0 | +2.2 (+1.5%) |

**The bar isn't met, so `resources` stays an advanced form.** Pass rate is equal (25/25 in both arms).
- The variant raised adoption where it fits (23: 3/5 → 5/5; 24: 0/5 → 2/5) but didn't make those tasks faster. Test friction and source reading absorbed the gain; on 24, learn time was 45.7 s against 20.2 s.
- Failed runs per trial rose from 0.48 to 0.80, and iterations from 2.48 to 2.80.
- This matches the informational `p3-resources` run (+13%).

The default skill keeps reply actions canonical, with `resources` described as "reads that follow state" (D91). The task-24 fixes apply to both skills.

## Where the remaining gap goes

Seconds per trial, task-matched.

| Phase | React, tiers 1–3 | `p4-final2` | **`p3-v6`** | Gap now | React, net 22–25 | `p3-v6` net | Gap |
|---|---|---|---|---|---|---|---|
| Learn | 0 | 5.0 | 4.2 | +4.2 (58%) | 3.5 | 11.0 | +7.5 |
| Implement | 11.7 | 12.8 | 13.1 | +1.3 | 24.9 | 34.8 | +9.9 |
| Verify | 2.2 | 5.8 | 3.3 | +1.1 | 2.5 | 4.7 | +2.2 |
| Think | 5.3 | 5.8 | 6.0 | +0.7 | 6.7 | 10.6 | +3.9 |
| Test authoring | 7.9 | 9.7 | 8.6 | +0.7 | 10.3 | 18.2 | +7.9 |
| Debug | 1.3 | 2.9 | 1.7 | +0.4 | 4.5 | 6.9 | +2.4 |
| Orient | 4.8 | 3.5 | 3.7 | −1.1 | 4.0 | 11.8 | +7.8 |
| **Wall** | 33.2 | 45.6 | **40.5** | **+7.3** | 56.3 | 97.9 | +41.6 |

- **Tiers 1–3:** the remaining gap is mostly **learn**: skill load 1.4 s, framework source 2.3 s and types 0.8 s per trial. Since `p4-final2`, the verify gap fell from +3.6 to +1.1 s and the debug gap from +1.7 to +0.4 s.
- **`net`:** the gap is spread across implement, tests, orient and learn, and **task 24 accounts for 62% of it**.

## Model sensitivity (Haiku 4.5)

**Pass rates, trials 1–5.**

| Tasks | `p4-haiku2` Sygnal | `p3-final-haiku` | **`p3-v6-haiku`** | Haiku React (`p4-haiku2` / `p3-v6-react-haiku`) |
|---|---|---|---|---|
| 01–17 | 69/85 (81.2%) | 61/85 (71.8%) | **66/85 (77.6%)** | — |
| 15 shared with React | 59/75 | 52/75 | **56/75 (74.7%)** | 49/75 (65.3%) |
| Async (05, 11, 13, 17) | 11/20 | 10/20 | **12/20** | 6/20 |
| 22 / 23 | — | 1/5 · 4/5 | **5/5 · 3/5** | — |
| 24 / 25 | — | — | **1/5 · 0/5** | 0/5 · 0/5 |

**Ten-trial tasks (D86).**

| Task | `p4-haiku2` | `p3-final-haiku` | `p3-v6-haiku` t1–5 / t6–10 | **10 trials (95% Wilson CI)** |
|---|---|---|---|---|
| 02 | 5/5 | 1/5 | 3/5 · 4/5 | **7/10 (40–89%)** |
| 10 | 5/5 | 2/5 | 2/5 · 3/5 | **5/10 (24–76%)** |
| 11 | 3/5 | 1/5 | 1/5 · 3/5 | **4/10 (17–69%)** |
| 17 | 2/5 | 2/5 | 2/5 · 1/5 | **3/10 (11–60%)** |
| 22 | — | 1/5 | 5/5 · 5/5 | **10/10 (72–100%)** |

**Significance.**

| Comparison | Result |
|---|---|
| `p4-haiku2` → `p3-v6-haiku`, 01–17 | 69 → 66/85; Fisher p = 0.71; task-paired p = 0.79 |
| `p3-final-haiku` → `p3-v6-haiku`, 01–17 | 61 → 66/85; Fisher p = 0.48; task-paired p = 0.49 |
| Haiku Sygnal v6 vs Haiku React (`p4-haiku2`), 15 tasks | 56 vs 49/75; Fisher p = 0.29; task-paired p = 0.45; bootstrap CI of Δ 0 … +19 points |
| Task 22, `p3-final-haiku` → v6 | 1/5 → 10/10; **Fisher p = 0.004** (the G-173 socket recipe lines) |
| Task 14, `p4-haiku2` → v6 | 5/5 → 2/5; p = 0.17 |
| Task 24, hidden tests passed per trial, Sygnal vs React | 4.2 vs 1.4 of 6; **p = 0.03** |
| Task 25, hidden tests passed per trial | 2.8 vs 2.8 of 9; p = 1.0. Wall 530 vs 179 s; **p = 0.016** |

**Reading.**
- The ten-trial cells show how wide n = 5 is: the earlier "drops" on 02 and 10 (`p3-final-haiku`) fall inside the 10-trial intervals. **No Haiku pass-rate change on 01–17 is significant across the three checkpoints.**
- The G-170 skill-args lead no longer separates trials: with args 38/49 pass, without args 28/36, both 78%.
- **Haiku is still slower with Sygnal.** On the 15 shared tasks Haiku Sygnal takes 1.58× Haiku React's wall time (172.8 vs 109.3 s, p = 0.009) and costs 1.82× as much.

### Haiku failures on 14, 24 and 25 (first root cause; G-170 categories)

The Sygnal rows were checked at code level: the hidden tests were re-run on scratch copies, patching suspected causes one at a time.

| Task | Arm | Spec misread | Sygnal-API or library-API misuse | Logic | Explain-only | Framework bug | Docs-induced |
|---|---|---|---|---|---|---|---|
| 14 | Sygnal (3) | 0 | **3:** `CHILD.select(TicketCard)` in `App`, while the card is a Collection item inside `TicketList` (a grandchild), so PARENT never reaches it ×2; a reducer reading `context` as its third argument ×1 | 0 | 0 | 0 | contributes: SKILL.md never says PARENT reaches only the direct parent |
| 24 | Sygnal (4) | 0 | **3:** class `.edit` on both the Edit button and `div.edit`, so `DOM.click('.edit')` also fires for the Save click inside `div.edit` and resets the draft ×3 (t2 passes **6/6** with the class renamed); `resources` declared while hidden, so re-showing never refetches ×1 | 1, plus 2 underneath the class trap: hand-rolled cache, no invalidation / older reply overwrites | 0 | 0 | contributes: no "declare a read only while shown" line |
| 24 | React (5) | 1: `QueryClientProvider` in `main.jsx` despite the starter comment (0/6) | 0 | **4:** hand-rolled cache (crash on `undefined.timestamp`, list never loads, "Updating…" on first load, stale overwrite) | 0 | 0 | — |
| 25 | Sygnal (5) | **4:** the edit page's `<h1>` changed from "Edit task" to "Edit <title>" (the document-title rule applied to the heading) | **5 underneath it:** the unsaved-changes `block` sent from the `ROUTE` reply, after the navigation (t1, t3, t4, t5); Save navigation wrong (t2) | 0 | 0 | 0 | contributes: the redirect example is commented "a guard refuses the route", so "guard" names two mechanisms |
| 25 | React (5) | 2: the same `<h1>` misread | **3:** `useBlocker` outside a data router ×2; links that don't navigate ×1 | 1: the guard never shows | 0 | 0 | — |

With the heading patched, the Sygnal task-25 trials pass 8, 6, 7 and 3 of 9 hidden tests. The remaining failures are the guard and Save navigation.

**Task difficulty vs framework-specific.**
- **25 is task difficulty.**
  - Both arms fail the in-page navigation guard in 5/5 trials, each through its own library's guard API.
  - Both misread the heading spec: Sygnal 4/5, React 2/5 (p = 0.52).
  - Both end at the same 2.8/9 hidden tests.
  - What is Sygnal-specific is the time: 3× React (226 s of debugging per trial vs 14 s).
- **24 is task difficulty plus one Sygnal-specific trap.**
  - Without a library, React Haiku hand-rolled the cache in 4/5 trials and got 1.4/6 hidden tests. Sygnal Haiku used `resources` + `queryCache` in 3/5 and got 4.2/6 (p = 0.03).
  - The Sygnal-specific failure is ancestor matching in DOM selectors (3/5). A React `onClick` can't hit it, and Opus avoided it by naming the button `.edit-open`.
- **14 is Sygnal-specific component wiring:** PARENT reaches only the direct parent. Earlier Haiku runs passed 5/5 by relaying through `TicketList` or using EVENTS. The drop isn't significant (p = 0.17), but a static check can catch it.
- **No framework bug** was found in either arm.

## D76: the learn-time and peak-context check

| Measure | `p3-final` | `p3-v6` | Change | Verdict |
|---|---|---|---|---|
| SKILL.md | 32,445 B, 347 lines | 34,343 B, 363 lines | +5.8% | within the D76 cap (≤ 35 KB) |
| Learn time per trial, sum of topics, all trials | 5.4 s | 5.3 s | −2% | pass |
| Learn time, task-matched (23 tasks) | 5.43 s | 4.42 s | −19% (p = 0.03) | pass |
| Peak context, task-matched (23 tasks) | 33.4k | 34.0k | +1.8% (p = 0.09) | pass |
| Cost, task-matched (23 tasks) | $0.336 | $0.334 | −0.3% | pass |

**D76 passes, so no trim is needed before release.** Framework-source reading rose from 1.8 to 2.3 s per trial (all trials). Task 24 accounts for that rise: 20.2 s of learn time, reading `fetchDriver.ts` and `queryCache.ts`. That's a docs-reachability problem, not skill length.

## Cost

| | React | Sygnal `p3-v6` | Ratio |
|---|---|---|---|
| Cost per trial, tiers 1–3 (15 tasks) | $0.165 | $0.335 | 2.03× (1.96× at `p4-final2`) |
| Cost per trial, TS | $0.150 | $0.357 | 2.38× |
| Cost per trial, `net` | $0.235 | $0.572 | 2.43× |
| Peak context, tiers 1–3 | 16.6k | 33.9k | 2.05× |
| Peak context, `net` | 19.8k | 46.9k | 2.37× |
| LOC added, tiers 1–3 / `net` | 90 / 147 | 110 / 194 | 1.22× / 1.32× |

Cost tracks peak context, which tracks the injected skill (34 KB, read whole in 125/125 trials). The wall-time gap shrank, but the cost ratio stayed near 2×.

## Failures

- **Opus:** no failures in `p3-v6` (125/125), `p3-v6-react` (10/10) or `p3-v6-skill-ab` (25/25). The three interrupted `p3-v6` trials were stopped and re-run, not failed.
- **Haiku Sygnal** (`p3-v6-haiku`, 39 failures): tasks 14, 24 and 25 are classified above. The rest, counting trials 6–10 on 10, 11 and 17: 02 ×3, 08 ×1, 10 ×5, 11 ×6, 13 ×1, 16 ×2, 17 ×7, 23 ×2.
- **Haiku React** (`p3-v6-react-haiku`): all 10 trials failed; classified above.

## Limitations

- **n = 5 per cell.** Only these are significant at p < 0.05:
  - the matched 21-task gain;
  - the rises in cost and context;
  - task 23's slowdown;
  - the 22/23/24 gaps to React;
  - Haiku's improvement on 22, its hidden-test lead on 24, and its wall time on 25.

  Per-task p-values aren't corrected for multiple comparisons, so treat a single p ≈ 0.02 as a lead.
- **Day and time effects.** The React arms for tiers 1–TS are one to two days older, and the A/B ran 3.5 hours after `p3-v6`.
- **Pass rate is saturated on Opus.** The pass-rate signal rests on Haiku, which is noisy even at n = 10.
- **Phase attribution is heuristic.** A long model turn is charged to the next tool call, so a design turn before writing `App.jsx` shows up as "orient" or "implement".

## Targeted re-run after G-184 and G-185 (D94)

After recommendations 1 and 2 were implemented, two runs on the changed build re-measured the affected cells: `p3-v7` and `p3-v7-haiku`, with the `branch` variant, starter v2 and the guard on, as before.
- G-184: `updates` on a request, guides shipped in `dist/guide/`, and the list/detail + save recipe.
- G-185: `t.query` on the mock DOM, and the `{ nth }` reply target.
- G-189, found while doing G-184: a reply call right after a `simulate*` call on a sink that carries `resources` waits for the request.

**Opus (`p3-v7` against `p3-v6`, task-matched):**
- Every trial passed in both runs. Matched wall time fell from 109.6 s to **80.3 s** (0.73×), iterations from 3.6 to 2.3, failed runs per trial from 1.13 to 0.47, and cost from $0.64 to $0.55 per trial.

| Task | `p3-v6` wall | `p3-v7` wall | React | Ratio to React (`p3-v6` → `p3-v7`) | Iterations |
|---|---|---|---|---|---|
| 23 quote resource | 59.3 s | **42.1 s** | 29.5 s (`p3-net-baseline`) | 2.01× → 1.43× | 4.2 → 1.8 |
| 24 list/detail cache | 190.2 s | **116.2 s** | 84.6 s (`p3-v6-react`) | 2.25× → **1.37×** | 3.4 → 2.8 |
| 25 router | 79.2 s | 82.7 s | 69.3 s (`p3-v6-react`) | 1.14× → 1.19× | 3.2 → 2.4 |

Adoption, measured from the final code:
- **Task 24:** `queryCache` went from 0/5 to **5/5** trials, `staleTime` on the request to 5/5, `invalidates` to 5/5 and `updates` to 3/5.
- **Tests:**
  - `t.query` without `dom: 'real'`: 15/15 trials on 23–25, and none used `dom: 'real'` (`p3-v6`: 8/15 used `dom: 'real'`).
  - `{ nth }`: 5/5 trials on 23 and 3/5 on 24, with no identity predicates.
  - `t.settle()`: 9/15 trials, the same as at `p3-v6`.
- **Size of the sample:** n = 5 per cell, so only the task 24 drop (−74 s) is large next to the trial spread. Task 25 didn't change; its fixes weren't in this round.

**Haiku (`p3-v7-haiku` against `p3-v6-haiku`):**
- Pass counts: 14 went from 2/5 to 3/5, 24 from 1/5 to 0/5, and 25 stayed at 0/5. None of these changes is significant at n = 5.
- **Task 24:** 4 of 5 trials used `queryCache` and 3 of 5 used `updates`, so the new path reaches Haiku too.
  - Its failures are mostly the `DOM.click` selector clash of recommendation 4(a), in 3/5 trials (`p3-v6-haiku`: 3/5). The spec asks for `div.edit`; the agents also give the Edit button the class `edit`. `DOM.click('.edit')` then fires for a click on Save inside `div.edit`, so `EDIT` resets the typed title.
  - The other two failures are logic errors: one form never closes, and one trial failed 5 tests.
- **Task 25:** every trial still titles the edit page "Edit <title>" where the spec says "Edit task", as in `p3-v6-haiku` 4/5. That is spec misreading; React Haiku scored 0/5 there too.
- None of these failures is in the G-184/G-185 paths. The remaining Haiku traps are G-187 in PLAN-4's backlog.

**Status of the recommendations below:**
- 1(a)–(c) and 2(a)–(b) are done, and the re-run shows their effect.
- Recommendation 6 (keep `resources` advanced) is unchanged: this re-run doesn't retest D74.
- The rest are in PLAN-4's backlog (G-186, G-187) or are release steps (G-188).

## Recommendations (ranked by expected impact)

1. **Fix the task-24 path to `queryCache`** (+105.6 s, 2.25×, p = 0.008).
   - (a) Ship the guides with the package, or publish the site before agents depend on its links. 4/10 Opus trials hit the 404, and 10/10 then read the driver source.
   - (b) Add a list/detail + save recipe to SKILL.md, replacing prose to stay within D76. Cover: declaring a read only while shown; the cache in both `main.js` and `renderComponent({ http: { cache } })`; `invalidates` on the write; "invalidation aborts older in-flight reads".
   - (c) Add a model-level way to write a reply into the cache (`updates: 'item'` on a write, or a `{ set }` sink command). This is the `setQueryData` analogue that all 5 React trials used.

   Evidence: 0/5 adoption, with 3 stated objections. The 2 A/B adopters wrote about 100 app LOC instead of about 135.
2. **Remove the two test-harness traps that slowed tasks 23 and 25.**
   - (a) Make `t.query()` work on the mock DOM, or switch to `dom: 'real'` automatically under jsdom. 17/125 trials hit the error, up from 5/115 at `p3-final`.
   - (b) Document how to answer one of two identical pending requests, or add a target for it (an `nth` or "oldest" target). 4/5 trials on 23 wrote identity predicates and probe tests.

   Expected: task 23 back toward about 45 s, and one failed run fewer in about 14% of trials.
3. **Fix the SYG102 false positives in `sygnal-check` (G-180).** Resolve reply-action names inside local helper functions and conditional expressions, such as `block: dirty ? 'X' : false` and request builders. It fired in 5/5 trials on 13, 24 and 25, and 2/5 on 23. Each hit costs a rewrite and a rerun, and it teaches agents to avoid helpers.
4. **Close the Haiku-specific Sygnal traps.** Each is cheap and showed up in this run. Each is worth 1–3 Haiku trials per task, which n = 5 can't confirm.
   - (a) A dev warning when a `DOM.click` selector matches an ancestor of another click target, plus one docs line. Haiku task 24: 3/5 trials; t2 passes once the class is renamed.
   - (b) Router guard: say that `block` must be on while the form is dirty, because the `ROUTE` action arrives after the navigation. Rename the redirect comment, and warn when `{ block }` comes from the `route` reply. Haiku task 25: 4 of the 4 trials that got past the heading.
   - (c) A static check for `CHILD.select(X)` when X isn't rendered by this component, plus "PARENT reaches the direct parent only". Haiku task 14: 2 of the 3 failures.
   - (d) One `resources` line: a stale read refetches when it's declared again, so declare it only while shown. Haiku 24-t1.
5. **Eval method.**
   - A same-day React control for tasks 01–21.
   - 10 trials on `net` cells (22's +14 s was a single 57-second stall).
   - Keep the Haiku React arm on 24 and 25.
6. **Keep `resources` advanced (D74).** Revisit only after items 1 and 2, with the same skill-only A/B.
