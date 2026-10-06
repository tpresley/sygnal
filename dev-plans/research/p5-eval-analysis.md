# PLAN-5 eval analysis (D228 package)

Analysis of the PLAN-5 Phase 4 eval runs (2026-10-05/06). No eval was run for this note; every number comes from the stored results and transcripts.

- Results: `evals/agent-ergonomics/results/<run>.json`. Analyses: `results/analysis/<run>.{md,json}` (from `analysis/analyze.mjs`). Transcripts and final code: `/tmp/sygnal-evals/trials/<run>/`.
- Runs: `p5-final-{opus,sonnet,haiku}` (tasks 30–34, Sygnal + React, 5 trials each), `p5-f1-behavior-{m}` / `p5-f1-helpers-{m}` (task 30, Sygnal, 5 each), `p5-4s-toc-{m}` (30–34, Sygnal, toc skill), `p5-s14-opus` (tiers 1–2 + `ergo`, 80). That is 335 trials. All of them ran and were scored, none timed out and none ended in a CLI error.
- Build: the `plan5-integration` tip `3c9819b` (tarball sha256 `7197a8f6…`), Claude Code 2.1.287. SKILL.md is 41,366 B (PLAN-4: 38,889 B) and `llms.txt` is 311 lines (PLAN-4: 290). The toc skill (`skills/sygnal-dev-toc`) has a 13,386 B SKILL.md plus 12 references (33.6 KB).
- Comparisons are task-matched (`analysis/compare.mjs`): each task's mean first, then the mean over shared tasks. The pass-count p-values are Fisher's exact test. The wall p-values are exact two-sample permutation tests. With n = 5 per cell, a difference of one or two trials is noise.
- **Re-analysed 2026-10-06 (PLAN-5 4-E2)** with the 4-D `analyze.mjs`, which counts only Sygnal skill calls as skill reads (the CLI's own `run`/`dataviz` calls were counted before). Only the numbers that include those calls changed: React learn time and skill bytes (Opus, Haiku), and Haiku's Sygnal learn time and skill bytes (`p5-final`, toc, both forms arms). Opus and Sonnet Sygnal numbers, S-14, wall, pass, cost and peak context are unchanged. No conclusion changes; see "Re-analysis (4-E2)" at the end.
- Spend: **$128.68** across the 13 runs. D228 approved about $114, so the runs went about $15 (13%) over. The overrun is mostly Haiku: $24.16 on `p5-final-haiku` and $11.42 on the toc Haiku run.

## TL;DR

| Question | Answer |
|---|---|
| 1. Tier 30–34, Sygnal vs React | Opus **92% vs 100%** (23/25 vs 25/25; p = 0.49). Sonnet **96% vs 92%**. Haiku **20% vs 36%** (5/25 vs 9/25; p = 0.35). Sygnal takes 1.23–1.43× the wall time and 1.3–2.6× the cost. Sonnet does as well as Opus and is about 2× faster |
| 2. Haiku failures | Mostly general capability on spec details: on task 30 both arms scored 0/5 with the same failing assertions. Haiku also reports "complete" with its own tests green in 48/50 failing trials. The Sygnal-specific part is that Haiku with the full SKILL.md **doesn't use the PLAN-5 APIs**: the intended API appears in 1/15 trials on tasks 32–34, and Haiku opened 1 guide in 25 trials. It also misuses the test harness (14/25). Two failures are docs-fixable outright: the `sortable` cancel wording and VirtualCollection wrapped in its own scroller |
| 3. Forms A/B (D228 rule) | **By the letter of the rule, helpers win on every model.** Opus is 5/5 = 5/5 with helpers −13% on mean wall (one 294 s behavior outlier; the median favours the behavior; p = 1.0). Sonnet: helpers pass 5/5 vs 4/5 but are 27% slower (p = 0.024 for the behavior being faster). Haiku: 0/5 = 0/5, helpers −13% (p = 0.54). Every trigger is within noise. **This is the user's decision**, see below |
| 4. Skill format (D226) | The toc format cuts **peak context by 12–17% and cost by 11–17%** on all three models. Pass rates move by noise only (Opus +1, Sonnet −2, Haiku ±0 trials). Learn time rises for Opus and Sonnet (+4 s and +2 s; reading references counts as learning) and falls for Haiku (−30%). With toc, Haiku actually reads the guides and uses the intended APIs (12/15 on tasks 32–34, against 1/15). **Recommend adopting it** after a toc S-14 check |
| 5. S-14 | Tiers 1–2 pass: peak context +3% and learn +0.4 s (noise). **`ergo` learn is over the bar**: 9.8 → 11.9 s (+21%; the bar is 10.8 s). `ergo` peak context sits right at the bar: 43.1k → 47.3k (+9.6%; the bar is 47.4k). Both come from task 29, where agents now read `forms.md` (31.8 KB), `ui/dialog.md` and the bundle. 01–23 was not run, so it can't be judged. Pass rate is 80/80 |
| 6. Regressions vs PLAN-4 (tiers 1–2, `ergo`) | None in pass rate: 80/80, against 78/80 in PLAN-4's runs. Wall rose by more than 10% only on task 11 (+36%; −9% against `p46-ev-opus`), task 10 (+13%) and task 28 (+8%). Task 29's peak context rose by 27% |

## 1. Tier 30–34: Sygnal vs React (`p5-final-*`)

Task-matched means over the 5 tasks; 25 trials per arm and model.

| Metric | Opus Sygnal | Opus React | Sonnet Sygnal | Sonnet React | Haiku Sygnal | Haiku React |
|---|---|---|---|---|---|---|
| Pass | **23/25 (92%)** | 25/25 | **24/25 (96%)** | 23/25 (92%) | **5/25 (20%)** | 9/25 (36%) |
| Hidden tests passed | 153/155 (98.7%) | 155/155 | 154/155 (99.4%) | 146/155 (94.2%) | 100/155 (64.5%) | 108/155 (69.7%) |
| Wall (s) | 82.1 | 64.1 (×1.28) | 37.9 | 26.5 (×1.43) | 315.2 | 256.7 (×1.23) |
| Cost per trial | $0.582 | $0.280 (×2.08) | $0.217 | $0.085 (×2.56) | $0.548 | $0.418 (×1.31) |
| Billed tokens (k) | 439.5 | 118.0 (×3.73) | 193.2 | 61.7 (×3.13) | 2,597.6 | 1,929.7 (×1.35) |
| Output tokens (k) | 7.3 | 7.0 | 4.5 | 3.5 | 31.6 | 26.1 |
| Learn (s) | 13.8 | 0 | 4.9 | 0 | 26.6 | 0.4* |
| Peak context (k) | 50.2 | 21.4 (×2.34) | 40.8 | 16.6 (×2.46) | 78.3 | 61.1 (×1.28) |

\*Re-analysed in 4-E2: the first analysis counted every `Skill` call as a skill read, and React Haiku invoked Claude Code's built-in `run` skill in 19/25 trials (React Opus: `dataviz` 5 times on task 32), so it reported React learn 0.7 s (Opus) and 3.9 s (Haiku), Haiku Sygnal 27.9 s. Those calls are now listed as other skills; see "Harness notes".

Pass rate per task (Sygnal | React) and Sygnal wall (s):

| Task | Opus | Sonnet | Haiku | Sygnal wall O / S / H (React) |
|---|---|---|---|---|
| 30 checkout form | 5 \| 5 | 4 \| 5 | 0 \| 0 | 121.9 (73.0) / 62.0 (32.1) / 352.9 (240.4) |
| 31 command menu | 5 \| 5 | 5 \| 5 | 3 \| 3 | 60.2 (36.2) / 34.9 (14.8) / 130.7 (218.5) |
| 32 Chart.js widget | 5 \| 5 | 5 \| 5 | 1 \| 3 | 45.7 (56.6) / 40.9 (18.9) / 430.1 (210.8) |
| 33 virtual list | **3** \| 5 | 5 \| 5 | 1 \| 0 | 71.3 (52.1) / 30.8 (26.2) / 270.1 (235.3) |
| 34 sortable list | 5 \| 5 | 5 \| **3** | **0 \| 3** | 111.1 (102.8) / 20.9 (40.4) / 392.4 (378.4) |

**Capability hierarchy (D227).**
- Opus and Sonnet are equivalent on Sygnal: 92% vs 96%. Sonnet is 2.2× faster and 2.7× cheaper per trial ($0.22 vs $0.58).
- Haiku falls about 75 points, to 20%. On React it falls to 36%.
- The Sygnal–React pass gap is −8 points on Opus (p = 0.49), +4 on Sonnet (p = 1.0) and −16 on Haiku (p = 0.35). None of the three is significant. The gap is real in time and cost: 1.2–1.4× wall and 1.3–2.6× cost.
- Both of Opus's misses, and the toc Opus miss, are task 33 rejecting "0" as a row number: `"0": expected '' to be 'Enter a row from 1 to 10,000.'`. Four React Haiku trials miss the same check, so it is a logic slip, not an API problem.
- Peak context is where Sygnal costs most: +24–29k on Opus and Sonnet. That is SKILL.md (about 11k tokens) plus the guides the agents open.

## 2. Haiku failures

**Scope.**
- All 50 failing Haiku Sygnal trials were profiled by script: tools used, guide reads, APIs in the final code, test-harness errors, the final claim, and the hidden failures.
- The transcripts read in full were all task-30 trials of `p5-final-haiku` and `p5-f1-behavior-haiku`, plus samples from 32, 33 and 34 in `p5-final` and the toc run.
- React Haiku's 16 failures were profiled the same way for contrast.

**What separates Haiku from Opus and Sonnet.**
Haiku loads the full SKILL.md every time (393 lines, sometimes twice). After that it reads almost nothing: 1 guide in 25 `p5-final` trials, against all 25 for Opus. It writes the feature by hand.

| Intended API in the final code (Sygnal, `p5-final`) | Opus | Sonnet | Haiku |
|---|---|---|---|
| 30 `form` behavior | 4/5 | 0/5 (hand-rolled; 4/5 pass) | 0/5 |
| 32 `defineWidget` | 5/5 | 5/5 | **0/5** |
| 33 `<VirtualCollection>` | 5/5 | 5/5 | **0/5** (scrollTop maths in state) |
| 34 `sortable` | 5/5 | 5/5 | **1/5** |
| Guide files opened (any task) | 25/25 trials | 18/25 | **1/25** |

**Root causes** for the 20 failing `p5-final` Haiku Sygnal trials, counting the primary cause per trial:

| Cause | Trials | Sygnal-specific? | Evidence |
|---|---|---|---|
| Spec details missed in a hand-rolled form or feature (validation on leave, the double-submit guard, an alert not cleared on retry, aria wiring), with self-tests that never check them | 7 (30 ×5, 31 ×2) | **No**: React Haiku fails 30 5/5 with the same assertions (`Quantity is invalid`, `expected 2 to be 1`) and 31 2/5 | 48/50 failing trials end by claiming success; 43/50 with their own suite green |
| PLAN-5 API not used, and the hand-rolled replacement is wrong (imperative Chart.js from sinks via `document.querySelector` + `setTimeout`; manual virtualisation; manual keyboard reorder) | 11 (32 ×3, 33 ×4, 34 ×4) | **Yes**: SKILL.md lines 168/170/171 route exactly these tasks, but Haiku doesn't act on routing lines buried in a 41 KB file | React Haiku: 32 3/5, 34 3/5 |
| Test-harness misuse leading Haiku to abandon a correct API | 1 (34-t2) | Yes | "The `sortable` behavior might not exist or work as expected. Let me implement this manually." This came after `simulateEvent(element)` ("not a valid CSS selector") and a `t.next()` timeout in its own test |
| Stopped after a plan, no code | 1 (32-t2) | Partly | It ended the turn with a proposal: "Store the chart instance via a custom driver" (not `defineWidget`) |

**Contributing patterns** (counted in all 25 Sygnal Haiku trials of `p5-final`):
- Test-harness errors from `renderComponent` appear in **14/25** trials (Sonnet 1/25, Opus 0/25): `simulateEvent` given an element, `t.next()` where `t.waitForState()` was needed, `t.respond`/`t.fail` with no pending request.
- Haiku then weakens its tests. One example: "Let me simplify the tests to remove the ones that require complex HTTP response handling" (30-t1). It shows up in 11 of the 50 failing trials across the four Haiku runs.
- It dismisses a diagnostic. In `p5-f1-behavior-haiku` 30-t1, it said SYG104 "is a false positive since ItemRow is just a regular function, not a Sygnal component. Let me suppress it." The hidden suite then failed every field-array test.
- It misreads the action semantics. "The HTTP sink sees the old state before the STATE reducer runs" (30-t1) led to validation being moved into the HTTP sink, in 3 trials.
- Environment detours (the `run` skill, `npm run dev`, port hunting, blocked `kill`) happened in 6/25 Sygnal and **22/25 React** Haiku trials. They are general.

**With the toc skill** (`p5-4s-toc-haiku`), Haiku does follow routing. It reads `references/widgets-and-ui.md` in 19/25 trials, opens the guides, and uses the intended API on tasks 32–34 in 12/15 trials. The pass rate stays 5/25, but the causes move to two concrete docs gaps:
- **Task 34 (4/5 trials at 5/6 tests):** `sortable`'s default cancel text is "Reorder cancelled. X is back at position…" (`src/extra/sortable.ts:97`). The spec asks for "Cancelled. X is back at position…". Opus and Sonnet override it with `messages`. Haiku never knew the option existed: it is only in the guide's option table.
- **Task 33 (4/5 trials at 1/6):** `<VirtualCollection>` was put inside the starter's `<ul className="customers">` instead of taking `className="customers"` itself. It is its own scroll container, so nothing scrolled. SYG430 was reported and ignored. The one trial that passed `className` to it got 5/6.

**Forms (task 30, Haiku, every arm 0/5).**
- The behavior arm scored 8/35 hidden tests, against 17/35 for the helpers arm and 15/35 with no guidance.
- With the behavior, Haiku puts each item in a Collection child component with the Remove button inside it. That triggers SYG104 and SYG410 (`state` prop with no `get()`). It never opens `forms.md`, so it doesn't find the field-array pattern (`form.ADD`/`form.REMOVE`).

**Fixable gaps** (ranked by expected effect on Haiku; all small):
1. **Make routing a step, not a list.** Haiku follows the toc SKILL.md's "Reference files: read the ones your task needs before writing code", and it ignores the same pointers inline in the full file. Either adopt toc (§4), or put a short "task → API → guide to read first" table near the top of the full SKILL.md, worded as a workflow step.
2. **`sortable` wording.** On the SKILL.md / `llms.txt` sortable line, add: "the announcements are English defaults; match a spec's exact wording with `messages: { drop, cancel, … }`".
3. **`VirtualCollection` is the scroller.** On the SKILL.md line and at the top of `virtual-collections.md`, add: "put `className` (bounded height), `role` and `aria-label` on `<VirtualCollection>` itself; never wrap it in your own scrolling element". Consider making SYG430's message name the wrapping case.
4. **Forms field arrays.** On the SKILL.md forms line, add the field-array form in one clause: the items rendered inline from `state.form.fields.items`, with `form.ADD`/`form.REMOVE`; no Collection child for the rows.
5. **Test harness one-liners** for the testing section: `simulateEvent` takes a selector, never an element; `t.waitForState(pred)` when the state may already match; answer `t.respond('HTTP', …)` only after `t.requests('HTTP')` shows the request. The runtime messages already say this; Haiku reads them and still blames the API, so these mostly help at the margin.

General-capability failures (spec detail, false completion claims) are not docs problems. React Haiku shows them at the same rate.

## 3. Forms A/B (D228 rule)

The rule was fixed before the runs: the behavior stays canonical unless the helpers pass more trials, or the helpers are at least 10% faster with no lower pass rate.

| Model | Behavior pass | Helpers pass | Behavior wall (mean / median) | Helpers wall (mean / median) | Δ mean | Cost B → H | Learn B → H | Wall p | Rule |
|---|---|---|---|---|---|---|---|---|---|
| Opus | 5/5 (35/35) | 5/5 (35/35) | 136.1 / 105 | 117.9 / 116 | **−13%** | $0.802 → $0.788 | 24.8 → 36.5 s | 1.0 | helpers (≥ 10% faster, equal pass) |
| Sonnet | 4/5 (34/35) | **5/5** (35/35) | 47.0 / 48 | 59.5 / 62 | **+27%** | $0.280 → $0.306 | 4.8 → 6.1 s | 0.024 | helpers (one more pass) |
| Haiku | 0/5 (8/35) | 0/5 (17/35) | 401.6 / 431 | 350.6 / 281 | −13% | $0.719 → $0.705 | 8.3 → 35.0 s | 0.54 | helpers (≥ 10% faster, equal pass) |
| Pooled | 9/15 | 10/15 | | | | | | Fisher 1.0 | helpers (one more pass) |

No-guidance reference (the `p5-final` task-30 trials, skill only):
- Opus used the behavior in 4/5 trials and passed 5/5 at 121.9 s.
- Sonnet hand-rolled in 5/5 and passed 4/5.
- Haiku hand-rolled in 5/5 and passed 0/5.
- Both guided arms did use their shape. Helpers were used in 5/5 trials on Opus, 5/5 on Sonnet and 3/5 on Haiku; the behavior was used in 5/5 on every model.

**Verdict.** Applied literally, the rule says helpers on all three models and pooled. Every trigger is within noise, though:
- **Opus:** the −13% mean comes from one behavior trial (t1: 294 s, of which 199 s was one debug stretch). The other four behavior trials (91–105 s) were each faster than every helpers trial (109–140 s). The medians are 105 vs 116 s, in the behavior's favour.
- **Sonnet:** the helpers' extra pass is one trial. The behavior is significantly *faster* (−21%, p = 0.024).
- **Haiku:** nothing passes in either arm.

Nothing here shows the helpers are better. Nothing shows the behavior is better on pass rate either. Since the rule was agreed in advance and is met by the letter, the decision goes back to the user (D193/D228). Options:
- (a) Apply the rule: make the helpers canonical.
- (b) Keep the behavior canonical, recording that the trigger was noise-level, with the medians and the Sonnet wall result in its favour.
- (c) Re-run task 30 with 10 trials per arm on Sonnet (about $3).

My recommendation is (b) or (c). The rule as written can't tell one outlier from an effect at n = 5.

Doc gap either way: in all 10 Opus A/B trials, about 20–29 s of learn time went to `forms.md` (31.8 KB) plus grepping `dist/index.esm.js` for `replyErrors`, `ERRORS` and `submitting`, to confirm how a 422 reply maps to fields. A short "server errors and pending state" section in `forms.md` would remove that source dive.

## 4. Skill format (D226): toc vs the current SKILL.md

Toc arm `p5-4s-toc-{m}` vs the `p5-final-{m}` Sygnal arm, tasks 30–34, task-matched.

| Metric | Opus full → toc | Sonnet full → toc | Haiku full → toc |
|---|---|---|---|
| Pass | 23 → **24**/25 | 24 → **22**/25 | 5 → 5/25 |
| Hidden tests | 153 → 154/155 | 154 → 152/155 | 100 → 95/155 |
| Wall (s) | 82.1 → 75.0 (−9%) | 37.9 → 39.5 (+4%) | 315.2 → 270.9 (−14%) |
| Cost | $0.582 → $0.491 (−16%) | $0.217 → $0.193 (−11%) | $0.548 → $0.457 (−17%) |
| Billed tokens (k) | 439.5 → 358.9 (−18%) | 193.2 → 208.0 (+8%) | 2,598 → 2,197 (−15%) |
| **Peak context (k)** | 50.2 → **41.5 (−17%)** | 40.8 → **34.3 (−16%)** | 78.3 → **68.5 (−12%)** |
| Learn (s) | 13.8 → 17.7 (+4.0) | 4.9 → 6.8 (+2.0) | 26.6 → 18.7 (−7.9) |
| Skill bytes read per trial | 41,366 → 19,586 | 41,366 → 15,179 | 43,021 → 25,480 |
| Tool calls | 10.6 → 12.6 | 5.8 → 8.1 | 40.8 → 41.3 |

References read (trials out of 25), Opus / Sonnet / Haiku:

| Reference | Opus | Sonnet | Haiku |
|---|---|---|---|
| `testing.md` | 17 | 1 | 17 |
| `widgets-and-ui.md` | 17 | 7 | 19 |
| `intent-and-streams.md` | 7 | 3 | 11 |
| `model-and-sinks.md` | 4 | 2 | 17 |
| `behaviors-and-forms.md` | 0 | 0 | 10 |
| `components.md` | 0 | 0 | 6 |
| `http.md` | 0 | 0 | 5 |

The other five references were never read. Opus and Sonnet read the `dist/guide/*.md` files about as often as with the full skill.

**Reading the numbers.**
- Peak context and cost drop on every model, and these are the D226/S-14 measures that matter most.
- The pass-rate differences are noise: Sonnet's −2 is 30 at 3/5 and 31 at 4/5, both one-trial misses on spec details.
- Learn time rises for Opus and Sonnet because opening a reference is a learn step: Opus spent 4.9 s on skill references against 2.1 s loading SKILL.md. It still doesn't add wall time on Opus (−9%).
- The largest qualitative effect is on Haiku. The toc's explicit "read the references your task needs" step got Haiku to open guides and use `defineWidget`, `VirtualCollection` and `sortable` (12/15 on tasks 32–34, against 1/15). The pass rate didn't move, because of the two docs gaps in §2: fix those and toc-Haiku task 34 would have been about 4/5.

**Recommendation.**
- Adopt the toc format for 6.0's skill, conditional on a toc S-14 run: tiers 1–2 + `ergo` on Opus, 80 trials, about $28.
- That run should confirm the peak-context saving holds on the older tasks and that learn time on `ergo` doesn't rise further.
- The toc also creates headroom for S-14's `ergo` peak context (§5).
- `scripts/check-skill-toc.mjs` already checks that toc and full carry the same facts. Keep it if both formats ship.

## 5. S-14: learn time and peak context against PLAN-4

`p5-s14-opus` (Sygnal, Opus, tiers 1–2 + `ergo`, 80 trials, 80/80 pass), task-matched.

| Set | Reference | Learn (s) | Peak context (k) | Pass | Wall (s) | Cost |
|---|---|---|---|---|---|---|
| Tiers 1–2 (12 tasks) | `p4-final6-opus` | 2.0 → 2.4 (+18%, +0.4 s: noise per run.md) | 33.6 → 34.6 (**+3.0%**) | 60/60 → 60/60 | 31.2 → 30.1 | $0.307 → $0.313 |
| `ergo` (4 tasks) | `p4-final7-opus-ergo` (the S-14 reference) | 9.8 → **11.9 (+21%)**; bar ≈ 10.8 | 43.1 → **47.3 (+9.6%)**; bar ≈ 47.4 | 20/20 → 20/20 | 59.1 → 60.7 | $0.475 → $0.507 |
| `ergo` | `p4-final6-opus` (4-E, before 4-G) | 19.2 → 11.9 (−38%) | 45.1 → 47.3 (+5%) | 18/20 → 20/20 | 72.5 → 60.7 | $0.533 → $0.507 |
| All 16 | `p46-ev-opus` (4.6 core) | 4.8 → 4.8 (−1%) | 35.9 → 37.8 (+5%) | 80/80 → 80/80 | 38.9 → 37.7 | $0.345 → $0.361 |
| 01–23 | `p4-final6-opus` (3.93 s, 35.9k) | **not measured**: S-14 ran only the minimum (tiers 1–2 + `ergo`); tasks 13–23 weren't re-run | | | | |

**Verdict.** Against the reference the plan names (`p4-final7-opus-ergo`), `ergo` **learn time is over the bar (+21%)** and peak context is at the bar (+9.6%, 0.1k under). Tiers 1–2 pass.

The `ergo` rise is concentrated:

| Task | Learn | Peak context | Cause |
|---|---|---|---|
| 29 accessible signup | 11.2 → 16.0 s | 45.5 → **57.9k (+27%)** | PLAN-5's routing lines send Opus to `forms.md` (31.8 KB), `ui/dialog.md` and `element-commands.md`, all read whole with `cat`. Two trials (65.3k, 67.5k) then grepped `dist/index.esm.js` for the form behavior's `submitting`/`submit` semantics. Both used `sygnal/ui` |
| 28 stopwatch | 2.5 → 8.6 s | | One trial (t3) spent 30.7 s in the library source. The other four look like PLAN-4 |
| 26, 27 | flat or down | | |

Learn time on the same 16 tasks equals `p46-ev-opus`'s. Against the original 4-E `ergo` run it fell by 38%. So the bar is crossed against the best reference only, and by one task.

Per the S-14 rule this goes to the user with these numbers. The targeted fix is not a general `llms.txt` trim:
- **(a)** Split `forms.md`, or give it an agent-sized summary at the top (submit lifecycle, `submitting`, the server-error reply shape), so agents don't `cat` 31.8 KB and then grep the bundle.
- **(b)** Adopt the toc skill (§4: −16 to −17% peak on Opus and Sonnet).

Re-check with the toc S-14 run proposed in §4.

## 6. Regressions vs PLAN-4 (tiers 1–2 + `ergo`, Opus)

Every task passes 5/5. The two PLAN-4 `ergo` misses (27-t3, 28-t2 in `p4-final6-opus`) don't recur.

Per task, against `p4-final6-opus` (tiers 1–2) and `p4-final7-opus-ergo` (`ergo`). Only moves above about 10% are listed:

| Task | Wall (s) | Learn (s) | Peak (k) | Note |
|---|---|---|---|---|
| 01, 02, 08, 12 | −28%, −24%, −19%, −12% | ≈ | ≈ | faster (01/02 were G-205 starters) |
| 10 signup wizard | 49.8 → 56.2 (+13%) | 6.4 → 9.1 | 36.6 → 39.1 | against `p46-ev-opus` −6% |
| 11 search debounce | 35.5 → 48.2 (+36%) | ≈ | 34.0 → 38.1 (+12%) | against `p46-ev-opus` 52.8 → 48.2 (−9%): the PLAN-4 run was the fast one |
| 28 stopwatch | 53.8 → 58.2 (+8%) | 2.5 → 8.6 | 39.3 → 41.2 | one trial's source dive |
| 29 accessible signup | 71.4 → 75.9 (+6%) | 11.2 → 16.0 | **45.5 → 57.9 (+27%)** | see §5; cost $0.525 → $0.643 |

No tier's matched wall got worse: tiers 1–2 −4%, `ergo` +3%. The only real regression is task 29's context and cost, which comes from the PLAN-5 forms and `ui` docs.

## Harness notes

- **Built-in Claude Code skills leak into trials.** The isolation posture blocks user skills, but the CLI's bundled skills (`run`, `dataviz`, `design`…) are listed in every trial's `init`.
  - Haiku invoked `run` in 19/25 React trials, and in Sygnal trials 4/25 (`p5-final`), 11/25 (toc) and 4/5 in each forms arm. That led to dev servers, port hunting and blocked `kill` attempts, which are the analysis's "machine-wide process kill" data gaps.
  - Opus React invoked `dataviz` 5×.
  - `analyze.mjs` (before 4-D) counted any `Skill` call as reading the variant's skill: it attributed SKILL.md bytes and `skill-load` time. That inflated the React arms' learn time and skill bytes (React Haiku: 19 "invocations", 33 KB).
  - Fixes: disable the built-in skills in the trial posture (or disallow `Skill(run)` and the like), and make `analyze.mjs` match the skill by name.
  - **Done**: `analyze.mjs` counts only Sygnal skill calls (4-D); these runs were re-analysed with it (4-E2, below). From 4-E2 on, trials run with the built-in skills blocked (D234: `disableBundledSkills`, `skillOverrides` off and `Skill()` deny rules in each trial's settings; `skillGuard: 1` in the run meta and manifest). The D228 runs are `skillGuard` 0, so compare their React Haiku numbers with later runs with care.
- Failed trials are not classified (`failureCategory: null` in all 335 records; run.md step 5). The root causes above come from this note's own profiling, not `score.mjs --classify`.
- The PLAN-4 baselines were present: `results/analysis/p4-final6-opus`, `p4-final7-opus-ergo` and `p46-ev-opus`.

## Recommendations

1. **Forms (D228):** the user decides. The rule says helpers by the letter; the evidence is noise-level and favours the behavior on median and Sonnet wall. Recommended: keep the behavior canonical and record the outcome, or re-run task 30 on Sonnet with 10 trials (about $3).
2. **Skill format (D226):** adopt toc, after a toc S-14 run (about $28) confirms peak and learn time on tiers 1–2 + `ergo`.
3. **S-14:** `ergo` learn time is over the bar (+21%) and peak context is at it (+9.6%), both from task 29. Ask the user before release. Fix it with an agent-sized `forms.md` (summary first, or a split) rather than an `llms.txt` trim.
4. **Docs fixes from Haiku** (small, low-risk):
   - the `sortable` `messages` hint;
   - "`VirtualCollection` is the scroll container";
   - the forms field-array clause;
   - the testing one-liners;
   - in the full SKILL.md, routing as a "read the guide first" step.
5. **Harness:** disable built-in skills in trials, fix the skill attribution in `analyze.mjs`, and classify failed trials before REPORT-v5.
6. **Not measurable here:**
   - S-14 on 01–23, since tasks 13–25 weren't re-run;
   - Haiku on the old tiers, since no PLAN-5 Haiku run covered them;
   - any significance for one-trial pass differences at n = 5.

## Re-analysis (4-E2, 2026-10-06)

All 13 runs re-analysed locally with the 4-D `analyze.mjs` (no model calls; same trial dirs, each run's variant skill and its packed `llms.txt`). Task-matched means; only the rows that moved:

| Run, arm | Learn (s) | Skill bytes per trial | Skill invoked (trials) | Other skills (trials) |
|---|---|---|---|---|
| `p5-final-opus` React | 0.7 → **0** | 8,273 → **0** | 5 → 0 | `dataviz` 5 |
| `p5-final-haiku` React | 3.9 → **0.4** | 33,119 → **≈ 0** | 19 → 0 | `run` 19 |
| `p5-final-haiku` Sygnal | 27.9 → **26.6** | 49,639 → **43,021** | 25 → 25 | `run` 4 |
| `p5-4s-toc-haiku` | 21.1 → **18.7** | 31,369 → **25,480** | 25 → 25 | `run` 11 |
| `p5-f1-behavior-haiku` | 12.9 → **8.3** | 74,459 → **41,366** | 5 → 5 | `run` 4 |
| `p5-f1-helpers-haiku` | 37.7 → **35.0** | 74,459 → **41,366** | 5 → 5 | `run` 4 |

Unchanged: every Opus and Sonnet Sygnal run (`p5-final`, toc, forms arms), `p5-final-sonnet` React, and `p5-s14-opus` (learn 4.8 s, 41,366 B, peak 37.8k: the S-14 verdict stands). Wall, pass, cost, billed tokens and peak context don't depend on the attribution and are identical in every run.

**Conclusions.** None changes:
- §1: the Sygnal–React learn gap is slightly larger (React learn ≈ 0 on every model), which was already the reading; pass, wall and cost ratios are unchanged.
- §3 (forms A/B): the rule is decided on pass and wall, which didn't move. Haiku's learn time is lower in both arms (behavior 8.3 s, helpers 35.0 s), so the behavior's lower learn time on Haiku is a bit clearer.
- §4 (toc): Haiku's learn saving grows from −6.9 to −7.9 s (−30%), and its skill bytes per trial go 43.0 → 25.5 KB (−41%). Opus and Sonnet unchanged. The recommendation (adopt toc after a toc S-14) stands.
- §5 (S-14): unchanged (no built-in skill calls in `p5-s14-opus`).
- Each report now also lists failed trials by auto category (4-D) and the built-in skill condition (`skillGuard` 0 for all D228 runs).
