# PLAN-4 final eval: report

This is the report for PLAN-4 §4 4-F. It follows `REPORT-v3.md` and adds:
- the `ergo` tier (tasks 26–29) against its 0-E baseline;
- the 1-E controls A/B (summary; the decision is D141);
- adoption of the PLAN-4 APIs on the `ergo` tasks;
- the GS-14 Testing Library A/B (the getters decision);
- the D132 action-log measure;
- the D76 learn-time and peak-context check.

Every number comes from a run named next to it: results in `results/<run>.json`, analyses in `results/analysis/<run>.{md,json}`, transcripts in `/private/tmp/sygnal-evals/trials/<run>/`. Comparisons are task-matched (`analysis/compare.mjs`; each task's mean first, then the mean over the shared tasks). The recipe tables are saved as `results/analysis/compare-p4-*.md`. Means come from the analyses; p-values come from the result records' wall times, so a mean can differ from the record mean by a few tenths. The tests are the same as in REPORT-v3: exact two-sample permutation per task, task-paired sign-flip permutation and a within-task bootstrap for matched means, and Fisher's exact test for pass counts.

## TL;DR

**Three of the five §7 bars are missed.** Each miss has a cause that can be named, and none of the causes is a regression in the existing tiers.

| §7 bar | Value | Met? |
|---|---|---|
| `ergo` Opus 20/20 | **18/20**. 27-t3 used `undo()`, whose `coalesceMs` merges two quick Larger clicks into one step. 28-t2 used a 20 ms timer, so the hidden suite's 11-minute fake-clock advance timed out | ❌ |
| Sygnal–React gap on `ergo` ≤ PLAN-3 tier-2 gap (+10.3 s, 1.29×) | **+28.1 s, 1.63×** (72.5 vs 44.5 s). The 0-E baseline was +31.1 s, 1.68× | ❌ |
| Haiku `ergo` pass ≥ React Haiku | **3/20 vs 6/20** (Fisher p = 0.45). Both arms fail mostly on the same task logic | ❌ (not significant) |
| No regression on existing tiers beyond noise | Opus 125/125 on 01–25. Matched wall 39.6 → 40.9 s on 01–22 (p = 0.35). Tier 1 was 1.10× and TS 1.16×, all from the 8 starters that now print SYG702 (G-205; see "Existing tiers"). Haiku 77.6% vs 79.4% (p = 0.84) | ✅ with one explained exception |
| 0 SYG7xx in Opus final code on task 29 (measured) | 0 in 5/5. Also 0 in the GS-14 runs' 10 task-29 trials | ✅ |
| D76: learn time and peak context ≤ ~10% worse than PLAN-3 | Learn **4.42 → 3.93 s (−11%)**. Peak context **34.0k → 35.9k (+5.5%)**. Same 23 tasks as REPORT-v3's D76 row | ✅ no trim needed |

Other findings:
- **GS-14: don't build `t.screen`/`t.user`.** B's first-test-write → end time was 16.1 → 15.6 s (−3%, bar −10%). Test authoring went up (12.6 → 14.4 s). B used Testing Library in 73% of trials.
- **D132: agents rarely use `t.actions`/`t.inspect`/`t.explain`.** Opus used them in 4/145 trials and Haiku in 11/105. Use isn't associated with passing: Haiku trials that hit a failing test passed 6/11 with the log and 49/79 without.
- **Feature adoption on `ergo` is mostly fine for Opus. The time goes to reading source.**
  - Opus used `persist` in 5/5 trials, `timers` in 5/5, `ELEMENT` in 5/5 and `uid` in 1/5 (8/15 counting the GS-14 runs). It used `undo()` in 1/5 and `STATE.watch` in 0/5.
  - Learn time on `ergo` is 19.2 s per trial, 68% of the gap to React. Of that, 10.5 s is reading the bundled `dist/index.esm.js` or `src/`.
  - The cause: none of the PLAN-4 guides ships offline. `dist/guide/` holds only `http.md` and `resources.md`. All 6 WebFetches of the new guide URLs returned 404.
  - Some facts are missing from the agent docs: `preventDefault`, and persist's stored format.
  - Two API gaps showed up: `undo()` can't group only one action, and `persist` can't write a plain format.
- **Spend:** $221.29 for all PLAN-4 evals. That is $15 over the ≈ $206 approved in total (D117 + D126 + D140 + D142); the 1-E Haiku repair is most of the excess.

## Method

| | |
|---|---|
| Runner | `orchestrate.mjs`, headless, 5 trials per (arm, task). Claude Code 2.1.287 in every run |
| Models | `claude-opus-5-5`; Haiku is `claude-haiku-4-5-20251001` |
| Posture | Isolated (variant `p4-final6` = `branch`, hash `9afaa841847c`; GS-14 pair `p4-gs14-a` / `p4-gs14-b`), starter v2, process guard on |
| Sygnal build | One tarball for every 4-E Sygnal run: sha256 `a7da1ea2…`, build sha `a7efb5d` (integration branch after 4-E prep). SKILL.md 38,889 B, 385 lines; `llms.txt` 290 lines |
| Runs (2026-10-04, 06:16–09:00 UTC) | `p4-final6-opus` (Sygnal, all 29 tasks, 145), `p4-final6-react-ergo` (React `ergo`, 20), `p4-final6-haiku` (Sygnal tiers 1–3 + `ergo`, 105), `p4-final6-react-ergo-haiku` (20), `p4-final6-gs14-a` / `-b` (tasks 03, 10, 29, 15 each). The React arms ran the same morning as the Sygnal arms |
| References | `p3-v6` (Opus, 01–25), `p3-v7` (Opus, 23–25 after G-184/G-185), `p3-v6-haiku` (10 trials on 02, 10, 11, 17), `p3-control-react` (01–17), `p4-ergo-baseline` (0-E: PLAN-3 build, both arms, Opus; re-analyzed with this checkout for the new measures) |
| Process guard | Kill attempts were refused in some Haiku trials (both arms), and in no Opus trial |
| Failures | All 52 failed trials are classified (run.md step 5): Opus 2, Haiku Sygnal 36, Haiku React 14. Code-level checks: the hidden suites were re-run on scratch copies with suspected causes patched (02, 12, 14, 27, 28, 29, Opus 28-t2) |

**Caveats.**
- **Starters changed under the reference (G-205).** Since 2-D, the vendored `sygnal-check` reports SYG702 (unlabelled control) on 9 starters: 01, 02, 07, 09, 12, 18, 20, 21 and 25. Starter v2's AGENTS.md says `sygnal-check --strict` "must report nothing", and 7xx is an error under `--strict` (D111). So agents fix markup they didn't write. PLAN-3's runs didn't have this.
- **SKILL.md grew from 34,343 B to 38,889 B**, so some peak-context rise is expected.
- **n = 5 per cell.** Pass rate is saturated on Opus outside `ergo`. Haiku pass-rate differences of one or two trials per task are inside noise.

## 1-E controls A/B (from the tracker, D141)

These four runs were on build `ef038e0`, with 12 tasks × 5 trials. A is the default skill and starters. B is the controls skill and starters converted with `--fix --controls --keep-classes`.

| Metric (matched mean) | Opus A → B | Haiku A → B | Bar |
|---|---|---|---|
| pass rate | 100% → 100% | **91.7% → 73.3%** | Haiku not lower ❌ |
| wall (s) | 44.4 → 47.1 (**1.06×**) | 138.2 → 139.3 (1.01×) | Opus ≤ +5% ❌ (marginal) |
| learn (s) | 3.4 → 3.9 (+0.6) | 11.1 → 9.4 (−1.7) | ≤ +1 s ✅ |
| wiring failures | 0% → 0% | 0% → 0% | not higher ✅ |
| SYG104/110/124 hits | 0.17 → 0.20 | 0.10 → 0.07 | — |
| peak context (k) | 35.1 → 36.1 | 51.8 → 51.9 | — |

- Haiku's drop is mostly the collection-pin tasks 02 and 18. In 9 of 10 B trials Haiku wrote `<Pin className="pin">📌</Pin>`: the control's name was taken as the label, and the visible text "Pin" was dropped.
- Two of four bars were missed, so under the §7 rule controls became an alternative form (D141).
- `p4-ct1-b-haiku` was run from the wrong worktree (build `de5ea2b`). It is excluded and replaced by `p4-ct1-b-haiku2` (D140). Its cost is in the Cost table.

## `ergo`: 0-E baseline against the final build

| Task | React 0-E → final | Sygnal 0-E (`p4-ergo-baseline`) | **Sygnal final (`p4-final6-opus`)** | p (0-E → final) | Gap now | p (vs React) |
|---|---|---|---|---|---|---|
| 26 autosave draft | 44.7 → 40.3 | 66.6 | **71.2** | 0.40 | +30.9 | 0.008 |
| 27 undo editor | 50.0 → 43.9 | 65.7 | **78.0** (4/5 pass) | 0.06 | +34.1 | 0.008 |
| 28 stopwatch | 37.8 → 35.0 | 81.5 (4/5) | **64.4** (4/5) | 0.68 | +29.3 | 0.008 |
| 29 accessible signup | 50.5 → 58.6 | 93.6 | **76.5** | **0.03** | +17.9 | 0.10 |
| **Matched** | 45.8 → 44.5 | 76.8 (1.68×) | **72.5 (1.63×)** | 0.50 | **+28.1** | |

Pass rates: Sygnal 19/20 → 18/20; React 20/20 → 20/20.

| Measure (matched, Opus) | 0-E | Final | Δ |
|---|---|---|---|
| iterations | 3.05 | 2.20 | −0.85 |
| failed test runs | 0.65 | 0.10 | −0.55 |
| debug phase (s) | 6.2 | 1.3 | −4.9 |
| learn (s) | 17.6 | 19.2 | +1.6 |
| peak context (k) | 42.2 | 45.1 | +3.0 |
| cost ($) | 0.519 | 0.533 | +0.014 |
| LOC added | 197.9 | 195.1 | −2.7 |
| first test write → end (s) | 21.8 | 16.0 | −5.9 |

**Reading.**
- The PLAN-4 APIs removed debugging, not learning. Iterations fell 28% and failed test runs by 85%. Task 29, where ELEMENT replaces refs and `document.querySelector` focus, got 17 s faster (p = 0.03). Task 28 lost its 0-E outlier (one trial with 14 iterations).
- Learn time went up on 26 and 27 (+8.8 and +9.2 s). Agents had a new API to look up and no offline guide for it.

### Where the `ergo` gap goes (Opus, seconds per trial, task-matched)

| Phase | React | Sygnal 0-E | **Sygnal final** | Gap now |
|---|---|---|---|---|
| Learn | 0 | 17.6 | **19.2** | **+19.2 (68%)** |
| — framework source (`dist/*.js`, `src/`) | 0 | 7.3 | 10.5 | +10.5 |
| — DOM events (`preventDefault`, keys) | 0 | 5.6 | 4.4 | +4.4 |
| — skill load / types / other | 0 | 4.7 | 4.4 | +4.4 |
| Test authoring | 9.7 | 17.5 | 17.2 | +7.5 |
| Verify | 1.8 | 5.3 | 4.8 | +3.0 |
| Think | 6.4 | 7.3 | 8.0 | +1.6 |
| Implement | 19.9 | 19.9 | 20.0 | +0.1 |
| Debug | 2.2 | 6.2 | 1.3 | −0.9 |
| Orient | 4.5 | 2.9 | 2.0 | −2.5 |
| **Wall** | 44.5 | 76.8 | **72.5** | **+28.0** |

Implementing takes the same time in both arms. The gap is learning (two thirds) and writing tests (a quarter). React agents needed no lookup at all for these four tasks.

## Feature adoption on `ergo`

From each trial's final `src/` (tests excluded) and its transcript. "Adopted" means the designed API is in the final code.

| Task | Designed API | Opus final (5) | Haiku final (5) | Opus 0-E (5) |
|---|---|---|---|---|
| 26 | `persist` | **5/5** (all with a custom `storage` adapter) | 0/5 (raw `localStorage`) | 0/5 |
| 26 | `STATE.watch` | 0/5 (debounced intent streams instead) | 2/5 | 0/5 |
| 27 | `undo()` / `undoable` | **1/5** (the one that failed) | 0/5 | 0/5 |
| 28 | `timers` + `makeTimerDriver` | **5/5**, no `setInterval` | **5/5** | 0/5 (`setInterval` in EFFECT) |
| 29 | ELEMENT (`focus`, `showModal`, `close`) | **5/5** | 5/5 (`showModal` 2/5) | 0/5 (refs, `.focus()`) |
| 29 | `uid()` | 1/5 (GS-14 runs: A 3/5, B 4/5; **8/15** in all) | 0/5 | 0/5 |

**Adopters against non-adopters.** Only task 27 splits on Opus. The adopter took 75.2 s against a 78.7 s mean for the four hand-rolled trials, and it failed. Every other Opus task is all-or-none. On Haiku task 26, the two `STATE.watch` trials (184 and 420 s; one passed) were no faster than the three without it (144–153 s; all failed on the stale-reply test). At n = 5 these comparisons say nothing about speed. The adoption counts and the stated reasons below are firmer evidence.

### What agents read, and why the learn time is high

Every Opus `ergo` trial loaded the skill (385/385 lines). Then, in the transcripts:

- **26 (learn 30.1 s).** All 5 grepped `llms.txt` for `persist|storage|serialize`, then `ls node_modules/sygnal/dist/guide/`. That directory holds only `http.md` and `resources.md`. So all 5 read persist's implementation in the bundle (`sed -n 8850,9010p dist/index.esm.js`), and one WebFetch of `/guide/persistence/` returned 404.
  - The reason they gave: "Persist stores `{version, state}`, so I'll check how its storage adapter is called to write the raw `{title, body}` format" (t3).
  - The spec asks for a plain `{ "title", "body" }` under `note-draft`. So every adopter wrote a storage adapter that unwraps and wraps the envelope. That works, but the agent can only find the envelope in the source.
  - None used `STATE.watch`. They debounced the merged input streams, which is equivalent here.
- **27 (learn 21.0 s).** All 5 grepped `llms.txt` for "undo", which has one clause in the behaviors line. They found `src/extra/undo.ts` (4/5 read it whole), and 3 WebFetched `/advanced/undo/` (404).
  - **4 of 5 then chose not to use it.** Three of them gave the grouping rule as the reason:
    - "That behavior groups any two quick changes made by the same control, so two fast clicks on Larger would become one step" (t1);
    - "its grouping rules don't match the spec" (t2);
    - "it groups any repeated action within the time window" (t5).
  - That reading is correct. `coalesceMs` joins any repeat of the same action, but the spec groups only Headline edits. The one adopter (t3) failed on exactly that: 4/7 hidden tests, with two quick Larger clicks counted as one step.
  - Separately, 10–17 s per trial went to finding how to `preventDefault` a keydown on `document`. Neither `llms.txt` nor SKILL.md mentions `preventDefault` (0 hits).
- **28 (learn 15.0 s).** All 5 looked for `dist/guide/timers.md` (missing) and fell back to `llms.txt`, then read `makeTimerDriver` in the bundle (`sed -n 7175,7275p dist/index.esm.js`). They were looking for the tick payload. `llms.txt` says "`TICK` gets `{ n, t }`", but SKILL.md's timers line doesn't, and SKILL.md is what agents read first.
- **29 (learn 10.6 s).** It took the least learning. The ELEMENT line in SKILL.md and `llms.txt` was enough (2 of 5 also WebFetched `/guide/element-commands/`: 404). Time went to `preventDefault` on submit, again undocumented: 4/5 read `index.d.ts` to find `{ preventDefault }`. `uid()` was used once, and the other trials hard-coded ids, which is correct for a single instance.

**Why the gap didn't close.**
1. **The PLAN-4 guides aren't reachable from an installed package.** `scripts/copy-guides.mjs` ships only `GUIDES = ['resources', 'http']` (the G-184 list). The skill's and `llms.txt`'s links to `/guide/persistence/`, `/guide/timers/`, `/guide/element-commands/` and `/advanced/undo/` are site URLs, and the site doesn't serve them yet. All 6 WebFetches in the Opus `ergo` trials got 404. This repeats REPORT-v3's task-24 finding (4/10 Opus trials hit a 404 and then read the source). Framework-source reading is 10.5 s per trial on `ergo` (26: 26.3 s), against 0.9 s on tiers 1–3.
2. **Two facts are missing from the agent docs.**
   - `preventDefault` (the `events(type, { preventDefault })` option): 4.4 s per trial on `ergo` (27: 12.0 s). It also contributed to one Haiku failure (29-t5).
   - The timer tick payload is missing from SKILL.md.
3. **API gaps found by the tasks.**
   - `undo()` has no way to group only some actions. 3/5 Opus trials rejected it for that reason, and the one adopter failed.
   - `persist` has no plain-format option, so every adopter wrote a storage adapter after reading the source.
4. **Test authoring is +7.5 s against React** (17.2 vs 9.7 s). The fake-timer and real-DOM keyboard tests on 26–28 are longer in Sygnal. GS-14 didn't shorten them.

Agents did read past the first lines. Every trial read all of SKILL.md, and the "More:" line points at the right pages, but those pages 404. The failure is in reachability, not in the order of the docs.

## Existing tiers: no regression, except the G-205 starters

Opus, `p3-v6` against `p4-final6-opus` (tasks 23–25 against `p3-v7`). Every trial passes in both runs.

| Tier | `p3-v6` | **`p4-final6-opus`** | Δ | Ratio | p (task-paired) |
|---|---|---|---|---|---|
| 1 (01–08) | 22.1 | **24.3** | +2.1 | 1.10× | 0.09 |
| 2 (09–12) | 45.8 | **45.2** | −0.6 | 0.99× | 0.88 |
| 3 (13–17) | 57.0 | **57.6** | +0.5 | 1.01× | 0.88 |
| TS (18–21) | 40.6 | **47.0** | +6.4 | 1.16× | 0.13 |
| `net` 22 | 63.0 | **48.0** | −15.1 | 0.76× | 0.27 (per task) |
| `net` 23–25 (vs `p3-v7`) | 80.3 | **74.7** | −5.7 | 0.93× | 0.25 |
| **01–22 matched** | 39.6 | **40.9** | +1.3 | 1.03× | 0.35 |

**The rise in tier 1 and TS comes from G-205.** The 8 tasks among 01–21 whose starter now prints SYG702 move together; the other 13 don't move:

| Tasks (01–21) | `p3-v6` | Final | Δ | p (task-paired) | 95% CI |
|---|---|---|---|---|---|
| SYG702 starters: 01, 02, 07, 09, 12, 18, 20, 21 | 36.7 | 42.4 | **+5.8 (1.16×)** | **0.008** | +3.0 … +8.4 |
| Other 13 | 41.1 | 41.1 | −0.1 | 0.95 | −2.3 … +2.1 |

- In every trial on 01, 02, 07, 09, 18, 20, 21 and 25, the strict check showed SYG702 and the agent fixed markup it hadn't written. The same happened in 4/5 on 12.
  - "The strict check flags a problem that was already there: the existing checkbox has no label. I'll give it an `aria-label` so the check passes" (01-t2).
  - In 20-t2 the agent added the label, removed it, and put it back.
- The largest per-task moves are 20 (+15.3 s, p = 0.016), 01 (+5.7 s, p = 0.024) and 18 (+9.0 s, p = 0.06). All three are G-205 starters.
- This is an eval artifact: the frozen starters predate the 7xx lane. It is also a preview of what upgrading costs: an existing app gets strict-mode errors for markup nobody touched.

**Haiku** (`p3-v6-haiku` against `p4-final6-haiku`, Sygnal, 17 tasks):

| Tier | `p3-v6-haiku` pass | **Final pass** | Fisher p | Wall (matched) |
|---|---|---|---|---|
| 1 (01–08) | 41/45 | **38/40** | 0.68 | 76.0 → 62.5 s |
| 2 (09–12) | 19/30 | **14/20** | 0.76 | 237.3 → 225.1 s |
| 3 (13–17) | 17/30 | **14/25** | 1.00 | 238.8 → 236.0 s |
| **01–17 matched** | 79.4% | **77.6%** | task-paired p = 0.84 | 160.8 → 150.8 s (0.94×) |

- No tier and no task changed significantly.
- The largest drops are 13 (4/5 → 1/5, p = 0.21) and 17 (3/10 → 0/5, p = 0.51).
- The largest gains are 16 (3/5 → 5/5) and 08 (4/5 → 5/5).
- Learn rose 16.3 → 18.7 s. Haiku's learn time is mostly a long code-writing turn charged to the preceding Skill call (a phase-attribution artifact), not reading.

## Haiku on `ergo`

| Task | React Haiku | **Sygnal Haiku** | Sygnal wall / React wall |
|---|---|---|---|
| 26 | 1/5 | 1/5 | 208 / 160 s |
| 27 | 1/5 | 0/5 | 221 / 177 s |
| 28 | 2/5 | 0/5 | 304 / 139 s |
| 29 | 2/5 | 2/5 | 246 / 228 s |
| **All** | **6/20** | **3/20** (p = 0.45) | 245 / 176 s (1.39×) |

Most failures are task logic that both arms share:
- **26:** the stale-reply test. 4/4 Sygnal failures and 4/4 React failures accept the older save's reply while the newer edit is still waiting out its debounce. Three Sygnal trials trusted `latest: true` alone. `llms.txt` says a superseded reply "never arrives", which holds only once the newer request has been sent.
- **27:** keyboard shortcuts. All 5 Sygnal failures, and 3 React trials with a key bug, match `e.key === 'z'` with Shift held (the key is `'Z'`) or test `navigator.platform`. Grouping and redo passed in every Sygnal trial. Three React trials also built the typing group as a trailing debounce.
- **28: the one Sygnal-specific pattern.** 4/5 Sygnal trials scored 0/7 because they gave the child `Stopwatch` an `initialState` while `App` mounts it with `state="stopwatch"`. That throws SYG405 at runtime, and the error fallback renders without `.time`.
  - Their own tests rendered `Stopwatch` as the root, which hides it, and `sygnal-check --strict` has no static SYG405 rule.
  - With that fixed, the trials pass 6/7 (lap arithmetic, re-show reset).
  - All 5 used `timers` correctly.
- **29:** the modal dialog. Two Sygnal trials opened it with `open={…}` instead of `showModal()`, and one React trial never called `close()`. One Sygnal trial (t5) didn't prevent the default submit; `preventDefault` is undocumented.

Haiku Sygnal is still slower than Haiku React (1.39×) and costs more ($0.43 vs $0.28 per trial). On a pass-rate bar at 3 vs 6 of 20, n = 5 can't separate the arms.

## D76: the learn-time and peak-context check

| Measure (Opus, 23 tasks 01–23, task-matched) | `p3-v6` | `p4-final6-opus` | Change | Verdict |
|---|---|---|---|---|
| SKILL.md | 34,343 B | 38,889 B | +13.2% | within the 38 KB cap (D115); 23 B left |
| `llms.txt` | 283 lines | 290 lines | +7 | within 315 (D115) |
| Learn time | 4.42 s | 3.93 s | **−11%** | pass |
| Peak context | 34.0k | 35.9k | **+5.5%** | pass |
| Cost | $0.334 | $0.353 | +5.5% | — |
| Wall | 40.4 s | 40.8 s | +1.0% | — |

**D76 passes, so no trim is needed before release.** Peak context rose by about the size of the SKILL.md growth (≈ 4.5 KB ≈ 1.3k tokens, plus the SYG702 fixes). On tasks 23–25 against `p3-v7`, learn went 16.5 → 15.9 s and peak context 44.5k → 44.6k.

## GS-14: Testing Library A/B

Sygnal, Opus, tasks 03, 10, 29 × 5. Both arms have `@testing-library/dom` and `user-event` installed and the suffix "Add a test for your change"; B also has a Testing Library section in AGENTS.md.

| Measure (matched) | A (default) | B (TL guidance) | Δ | Rule |
|---|---|---|---|---|
| first test write → end (s) | 16.1 | 15.6 | −0.4 (−3%) | ≥ 10% lower ❌ |
| test-authoring phase (s) | 12.6 | 14.4 | +1.9 | not higher ❌ |
| pass rate | 100% | 100% | 0 | not lower ✅ |
| kept tests use Testing Library | 0% | 73.3% (03: 1/5, 10: 5/5, 29: 5/5) | | ≥ 60% ✅ |
| wall (s) | 55.9 | 57.9 | +2.0 (p = 1.0) | — |
| failed test runs | 0.07 | 0.27 | +0.2 | — |

**Decision under the D142 rule: don't build the `t.screen`/`t.user` getters.** B's agents did use Testing Library when told to. It made 29's test window shorter (29.9 → 20.7 s) and 10's longer (11.3 → 18.9 s), with no net gain. The docs (the testing guide's Testing Library section) stand alone.

## D132: the action-log pointer

| Run | Trials using `t.actions` / `t.inspect()` / `t.explain()` | Among trials with a failing test run: pass with / without |
|---|---|---|
| `p4-final6-opus` | 4/145 (2.8%: 08, 12, 20, 22) | 3/3 vs 48/48 |
| `p4-final6-haiku` | 11/105 (10.5%) | 6/11 vs 49/79 |
| GS-14 A/B, 0-E | 0/50 | — |

- Use is rare, and it is not associated with debugging success.
- Haiku reaches for it in the trials that are already stuck: the 11 users averaged 13.7 iterations and 323 s. So the "with" group is self-selected and the comparison can't show an effect either way.
- Haiku ran `sygnal-check --graph` in 26 trials.
- The line costs about 110 B of SKILL.md. Keep it; nothing here argues for more space.

## Failures (first root cause)

**Opus (`p4-final6-opus`, 2/145):**

| Trial | Category | Tests | Cause |
|---|---|---|---|
| 27-t3 | other | 4/7 | `undo({ key: 'poster', coalesceMs: 1000 })` joins any repeat of the same action within 1 s, so two quick Larger clicks are one step. The spec groups only Headline edits. API gap |
| 28-t2 | other | 1/7 (5/7 re-run unloaded) | `timers` with `every: 20`. The hidden test's 11-minute fake-clock advance means about 33,000 ticks and renders, which exceed the 10 s test timeout; the timed-out app's timer then leaks into the next test. With `every: 50` it passes 7/7. Also a hidden-test sensitivity to tick rate |

**Haiku Sygnal (`p4-final6-haiku`, 36/105):** wiring 4, other 32.

| Task | Failed | Causes |
|---|---|---|
| 02 | t1, t5 | Pin button text is "📌" (aria-label only), so no button matches /pin/i; with "Pin" both pass 4/4 |
| 10 | t2, t5 | The email check ignores the "no spaces" rule |
| 11 | t1, t4, t5 | "No results" rendered as an `<li>` inside `ul.results` (arguably ambiguous spec) |
| 12 | t3 (wiring) | `CHILD.select(TaskRow)` in `App`, while TaskRow is a Collection item inside ProjectSection (a grandchild), so PARENT never reaches App; with a relay it passes 8/8 |
| 13 | t2 (wiring), t3, t4, t5 | t2: `main.js` still `run(App)` with no `makeFetchDriver` (its own tests passed on the fake HTTP sink); t3: "Full" not disabled; t4, t5: the "loaded" flag is set only on success, so a failed load refetches |
| 14 | t1, t5 (wiring) | `CHILD.select(TicketCard)` of a grandchild, as in PLAN-3; a relay through TicketList passes 6/6 |
| 17 | t1–t5 | Checkbox rules (auto-check, never uncheck or disable) ×3; no `{ abort }` when the ZIP drops below 5 digits ×2; lookup only on incomplete → complete ×1 |
| 26 | t1, t2, t3, t5 | Stale reply during the debounce sets "Saved" (t1, t3, t5 relied on `latest` alone); t2 had no `latest` |
| 27 | t1–t5 | Ctrl+Shift+Z checks lowercase `'z'` ×4; a `navigator.platform` switch ×1 |
| 28 | t1–t5 | `initialState` on a lensed child → SYG405 ×4 (0/7); lap counts paused time ×1 |
| 29 | t2, t4, t5 | `<dialog open={…}>` instead of / as well as `showModal()` ×3; t5 also no `preventDefault` on submit |

Sygnal-specific: the grandchild `CHILD.select` (3 trials; PLAN-3's G-187, no static rule yet), SYG405 on a lensed child (4), a driver never registered with tests passing on the fake (1), and the undocumented `preventDefault` (contributes to 1). The rest are spec misreads or logic errors.

**Haiku React (`p4-final6-react-ergo-haiku`, 14/20):** all `other`.
- 26 ×4: stale reply, guard keyed to the send rather than the edit.
- 27 ×4: grouping as a trailing debounce ×3; `'z'` vs `'Z'` and `navigator.platform` ×3.
- 28 ×3: time read from the last animation frame, not at the click ×2; lap base reset on resume ×1.
- 29 ×3: dialog never `close()`d; `.done` removed from the markup; blank name not trimmed.

**Opus React, GS-14 A/B, 0-E:** no new failures (0-E's 28-t2 was classified in 0-E).

## Cost

| Phase | Run | Trials | Pass | Cost |
|---|---|---|---|---|
| 0-E | `p4-ergo-baseline` (both arms, Opus) | 40 | 39 | $14.48 |
| 1-E | `p4-ct1-a` (Opus) | 60 | 60 | $20.95 |
| 1-E | `p4-ct1-b` (Opus) | 60 | 60 | $21.94 |
| 1-E | `p4-ct1-a-haiku` | 60 | 55 | $16.43 |
| 1-E | `p4-ct1-b-haiku2` | 60 | 44 | $17.19 |
| 1-E | `p4-ct1-b-haiku` (**excluded**, wrong build, D140) | 60 | — | $16.69 |
| 4-E | `p4-final6-opus` | 145 | 143 | $57.39 |
| 4-E | `p4-final6-haiku` | 105 | 69 | $33.47 |
| 4-E | `p4-final6-react-ergo` | 20 | 20 | $4.09 |
| 4-E | `p4-final6-react-ergo-haiku` | 20 | 6 | $5.59 |
| 4-E | `p4-final6-gs14-a` / `-b` | 30 | 30 | $13.07 |
| | **0-E $14.48 · 1-E $93.20 (incl. $16.69 excluded) · 4-E $113.61** | 660 | | **$221.29** |

The approved figures were 0-E ≈ $15, 1-E ≈ $85 after D140, and 4-E ≈ $106 (D142), ≈ $206 in all. 4-E ran 7% over its estimate and 1-E 10% over.

| | React | Sygnal (final) | Ratio |
|---|---|---|---|
| Cost per trial, `ergo` Opus | $0.205 | $0.533 | 2.61× (0-E 2.54×) |
| Peak context, `ergo` Opus | 18.1k | 45.1k | 2.49× |
| Cost per trial, `ergo` Haiku | $0.279 | $0.428 | 1.53× |

## Limitations

- **n = 5 per cell.** These are significant at p < 0.05:
  - the per-task Sygnal–React `ergo` gaps on 26, 27 and 28;
  - task 29's 0-E → final gain;
  - the G-205 starter group's +5.8 s;
  - tasks 01 and 20 individually.

  Nothing on Haiku is significant. The `ergo` bar misses on Haiku (3 vs 6 of 20) and on Opus pass (18/20) are within what n = 5 produces by chance. The Opus causes are real, though: both reproduce.
- **The React arm needed no learning** on these tasks. The `ergo` gap bar compares against PLAN-3's tier-2 gap, where React needed none either, but `ergo` tasks are longer and each exercises one new Sygnal API by design. A ratio bar at 1.29× may not be reachable on `ergo` by docs alone (see the estimate under Recommendations).
- **Phase attribution is heuristic** (a long model turn is charged to the next tool call). That inflates Haiku's "skill-load" learn time in particular.
- **Hidden-test sensitivity:** task 28's suite advances the fake clock 11 minutes in one test. Fine-grained timers (≤ 20 ms, or `frame`) time out there regardless of correctness.

## Recommendations (ranked by expected impact)

1. **Ship the PLAN-4 guides offline and link them locally.**
   - Add `persistence`, `timers`, `element-commands`, `behaviors` and `accessibility` to `GUIDES` in `scripts/copy-guides.mjs`. Add `advanced/undo`, which needs the script to accept a section prefix.
   - In SKILL.md §3 and the "More:" line, and in `llms.txt` lines 125–127 and 246, use `node_modules/sygnal/dist/guide/<page>.md` where a site URL is given today (the G-184 form used for `resources.md`).
   - Evidence: 6/6 WebFetches returned 404, and framework-source reading was 10.5 s per trial on `ergo` (26: 26.3 s; 28: 10.4 s).
   - Expected: −5 to −10 s per `ergo` trial.
   - Budget: `llms.txt` ±0 lines. SKILL.md about +100 B (a local path is longer than a URL), so it needs a matching trim, e.g. drop the API-reference and DevTools URLs from the "More:" line. Package: about +25 KB unpacked markdown.
2. **Add the missing facts.**
   - (a) `preventDefault`. One clause in SKILL.md §4 and `llms.txt`'s shorthands line: `DOM.select('form').events('submit', { preventDefault: true })` and `DOM.select('document').events('keydown', { preventDefault: e => … })`. Expected −4 s per trial on 27 and 29, and one Haiku failure fewer. +1 `llms.txt` line or ±0 inline; SKILL.md about +120 B.
   - (b) The tick payload on the SKILL.md timers line ("`TICK` gets `{ n, t }`"): +20 B. Expected: removes the bundle reading on 28 (about 10 s).
   - (c) persist's stored format (`{ version, state }`), on the persistence line: about +40 B.
   - (d) "A child mounted with `state=` has no `initialState`: the parent's `initialState` holds its start values (SYG405)": about +110 B. 4/5 Haiku task-28 failures.

   Together about +290 B against 23 B left. That needs trims of about 300 B; candidates are the duplicated pager wording in §3, and prose in §7 that `llms.txt` already carries.
3. **Close two API gaps that `ergo` exposed** (each needs the user; 0 B core, helper-only):
   - (a) `undo({ coalesce: ['HEADLINE'], coalesceMs })`, or `coalesceMs` applying only to `track`ed typing actions. Evidence: 3/5 Opus rejected `undo()` for this reason, and the 1 adopter failed on it.
   - (b) A plain-format option for `persist` (e.g. `format: 'plain'`, or `serialize`/`deserialize`). Evidence: 5/5 adopters wrote an adapter after reading the source.
4. **Static checks for the Haiku Sygnal traps** (sygnal-check, no doc budget):
   - (a) SYG405 statically: a component with `initialState` that is also rendered as `<X state=…>`. 4 Haiku trials.
   - (b) `CHILD.select(X)` where X isn't rendered by this component (G-187, carried from REPORT-v3). 3 Haiku trials, on 12 and 14.
   - (c) A component sending to `HTTP` (or another driver sink) while `main.js`'s `run()` registers no such driver: the SYG643 family. 1 trial, hidden by the test fake.
5. **G-205: make the eval starters a11y-clean** (label the 9 starters' controls; task text and hidden tests unchanged). Without it, every later comparison carries +5.8 s on those 8 tasks (p = 0.008). Separately, the user should decide whether `--strict` should fail on 7xx findings in code the agent didn't touch. This is the upgrade experience for existing apps (D111 made 7xx errors under strict).
6. **Keep:** no GS-14 getters (rule not met); the D132 line as is; D76 needs no trim.
7. **Re-run, only after 1–2 (and 3 if adopted).** A targeted run of `ergo` on Opus, both arms, same hour: 20 Sygnal trials ($10.70) plus 20 React ($4.10), **≈ $15**. It checks 20/20 and the gap.
   - Realistic expectation: learn about 19 → 9 s gives wall about 63 s and **≈ 1.4×**. That is better than 1.63×, but likely still above 1.29×, because test authoring (+7.5 s) and the remaining lookups stay.
   - Adding Haiku `ergo` at 10 trials per cell in both arms (≈ $56) is the only way to test the Haiku bar meaningfully. At 5 trials, 3 vs 6 of 20 can't be resolved.
   - If 5 is done, also re-run tiers 1 and TS on Opus (60 trials, ≈ $20) to confirm the G-205 attribution.
