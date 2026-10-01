# Phase 4 eval re-run — report

- **Runs:** `phase3` (tier 1, tasks 01–08) and `phase3-t2` (tier 2, tasks 09–12). Each run has 5 Sygnal trials per task, 60 Sygnal trials in total.
- **Framework under test:** the sygnal tarball packed at `plan1-phase3`, plus the tracker commits. It includes the Phase 1–3 work: diagnostics, canonical forms and `event()`, test helpers, strict mode, the rewritten `sygnal-dev` skill, `llms.txt`, and the B-007 fix.
- **Skill:** the Phase 3 `sygnal-dev` skill, installed at `~/.claude/skills/sygnal-dev` (D35).
- **React arm:** reused from `baseline` / `baseline-t2` (D37). The React starters and harness didn't change, so those records are copied into `phase3*.json` with `reusedFrom`.
- **Method:** same as the baseline.
  - Fresh general-purpose subagents, each given only the exact `prompt.txt`.
  - The same coordinator session, so the harness-guard noise is the same in both runs.
  - Six trials ran at a time.
  - Hidden tests scored by `score.mjs`. The audit flagged no trial (0 suspicious reads).
- **Analysis:**
  - `analysis/phase3{,-t2}.{md,json}` (friction analyzer).
  - `analysis/compare-t1.md` and `analysis/compare-t2.md` (baseline → phase3).
  - Token and tool-call usage per trial, from the Agent tool results, is in `transcripts/usage-phase3.tsv`. It is summarized below.

## Headline

| Tier | Arm | Pass | Wall mean (s) | Iterations | Edit rounds | Failed test runs | Tool calls |
|---|---|---|---|---|---|---|---|
| 1 | Sygnal baseline | 40/40 | 74.8 | 4.8 | 2.1 | 1.7 | 17.1 |
| 1 | **Sygnal phase3** | **40/40** | **50.3** | **3.2** | **1.2** | **0.1** | **11.7** |
| 1 | React | 30/30 | 39.2 | 2.8 | 1.0 | 0 | 9.3 |
| 2 | Sygnal baseline | 20/20 | 92.2 | 4.6 | 2.1 | 1.7 | 17.0 |
| 2 | **Sygnal phase3** | **20/20** | **107.7** | 4.7 | 2.3 | 1.0 | 17.7 |
| 2 | React | 20/20 | 63.2 | 2.5 | 1.4 | 0 | — |

Gap to React on the shared tasks:

| Tier | Sygnal − React, baseline | Sygnal − React, phase3 | Change |
|---|---|---|---|
| 1 | 46.1 s | 15.8 s | 66% smaller |
| 2 | 29.0 s | 44.5 s | 53% larger |

The pass rate is still saturated (100% in both arms and both tiers), so efficiency is the signal.

Mean usage per phase3 Sygnal trial:

| Tier | Tokens | Tool calls | Duration |
|---|---|---|---|
| 1 | ~73.7k | 11.7 | 50 s |
| 2 | ~83.6k | 17.7 | 108 s |

## Tier 1: the plan worked

| Task | Sygnal wall (baseline → phase3) | Iterations (baseline → phase3) | React wall |
|---|---|---|---|
| 01 clear completed | 53.4 → **41.3** | 5.0 → 2.6 | 38.6 |
| 02 pin via Collection | 81.6 → **48.6** | 7.0 → 3.4 | 36.2 |
| 03 status bar via EVENTS | 98.6 → **50.7** | 6.2 → 3.0 | 39.2 |
| 04 derived total | 68.2 → **50.7** | 3.8 → 2.6 | 44.6 |
| 05 async driver | 100.4 → **58.3** | 5.4 → 2.2 | 37.2 |
| 06 fix selector typo | 20.0 → 37.9 | 1.0 → 2.6 | — |
| 07 fix isolation bug | 66.6 → **35.1** | 4.6 → 2.2 | — |
| 08 extract sub-component | 107.6 → **80.1** | 5.4 → 6.8 | 38.8 |

Where the 24.5 s per trial went (`compare-t1.md`):

- **Tooling friction fell from 24.6 to 9.6 s.** What's left is the harness guard (9.6 s, the same as the baseline, and React also pays it). B-007, B-006, G-016, G-018 and G-015 no longer appear.
- **Learning time fell from 8.8 to 2.2 s.** Reads of library source almost disappeared (2.0 → 0.3 s of the delta), and the parent-child-props lookups are gone. Agents work from the self-sufficient `SKILL.md`.
- **Failed test runs fell from 1.7 to 0.1 per trial.** Agents write strict-mode `renderComponent` tests from the recipe, and those tests pass the first time.
- **The canonical forms took hold.**
  - Shorthand keys: 14 trials → 0.
  - Raw `{type, data}` EVENTS objects: 5 → 0.
  - `ABORT` returns: 0 → 16.
  - `event()`: 0 → 5.
- **Task 06 got slower (20 → 38 s).** Agents now write a regression test even for a one-line fix. That is a deliberate effect of the skill's workflow, not friction.

## Tier 2: slower, for two specific reasons

The harder tasks lost time in **verify (+12.3 s), debug (+7.6 s) and test-authoring (+6.5 s)**. Tooling friction still fell (28.7 → 15.5 s) and learning still fell (11.9 → 9.2 s). Tasks 09 and 12 account for most of the loss: 106 s and 132 s, against baseline means of 79 s and 95 s.

The failure signatures (`phase3-t2.md`, "Failures") point to two issues found during this run:

1. **G-070: `simulateEvent` silently ignores selectors it can't match.**
   - What happens:
     - `:nth-child(...)`, `>` and other structural selectors match nothing in the mock DOM.
     - No error is raised and no event is sent.
     - The test then waits on `t.next(...)` until the 2 s timeout.
   - Size: 13 failed runs in 9 of 20 tier-2 trials show `next timed out`, and 4 tier-1 trials hit the same thing.
   - Workaround: every affected agent eventually added `data-id` attributes and attribute selectors.
   - This is the largest single cause of the tier-2 regression. The baseline agents mostly didn't write this kind of test (B-007 stopped them), so they never ran into it.
2. **B-029: `ABORT` from a non-STATE sink reports SYG218/SYG216.**
   - The cause is in `component.ts`: the sink-reducer return check rejects the `ABORT` symbol before `isAbort` filters it out.
   - This contradicts the skill and `llms.txt`.
   - Impact:
     - It shows up as `Expected no diagnostics, got 1` in 3 trials.
     - At least 3 agents on task 10 restructured their code to work around it.

Also seen:
- **G-071:** `npx --no-install sygnal-check` still queries the npm registry and prints E404 (sygnal-check isn't published; D36 resolves this). Every agent skipped the static check. Most said so, and the runtime strict diagnostics covered it.
- **More code and more tests:** Sygnal agents now write more tests and more code than before. Tier-2 lines added went from 129 to 157, against 104–138 for React. Part of the extra verify time is these tests running, not friction.

## Recommendations

**Before release (4B), small:**
1. **Fix B-029.** In the non-STATE sink path, let `ABORT` through before the type check, and add a regression test.
2. **Fix G-070.**
   - Make the mock DOM's selector matching support the selectors agents actually use (`:nth-child`, `:first-child`, `:last-child`, `>`).
   - Make `simulateEvent` throw a clear error when the selector matches no element: name the selector and suggest `data-*` attribute selectors. A silent no-op is the worst outcome.
   - Document the supported selectors in `llms.txt` and `SKILL.md`.
3. **Publish `sygnal-check` and add it to the templates (D36).** This resolves G-071 and lets agents run the static check.

**After those, a targeted tier-2 re-run** (`phase3b-t2`, tasks 09–12 × 5 trials) to confirm the regression is gone before tagging the release. The tier-1 result doesn't need re-running.

**PLAN-2 candidates:**
- **Remaining tier-1 gap (about 16 s per trial):** orient and skill-load (+1.6 s) and the extra test-authoring and verify cost of always writing tests. The harness guard is a third of the remaining raw cost but affects both arms.
- **Task 08 (extract sub-component):** still the slowest tier-1 task, at 80 s and 6.8 iterations. Agents capture the "before" HTML to prove nothing changed. A documented `t.html()` snapshot pattern or a parent-child extraction recipe in the skill would shorten this.

## Limits

- **Small samples:** 5 trials per task. Treat per-task means as directional; the per-tier aggregates (40 and 20 trials) are more reliable.
- **React arm reused:** the React data comes from the baseline run, not a fresh run. If model or harness drift since then matters, a fresh React run would remove that confound.
- **Same harness guard in both runs:** the coordinator was worktree-pinned for both runs, so the harness-guard friction (about 10 s per tier-1 trial, about 15 s per tier-2 trial) is present in both and is not subtracted above. It is shown separately in the analyses.
