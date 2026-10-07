# PLAN-5 final eval: report

This is the report for PLAN-5 Phase 4. It follows `REPORT-v4.md` and covers:
- what PLAN-5 shipped, and the size budgets it used;
- the new tier, tasks 30–34, Sygnal against React on Opus, Sonnet and Haiku (D227);
- the Haiku failure analysis and the docs fixes it led to (4-D);
- the forms A/B (D228 rule, decided as D231);
- the skill-format experiment (toc, D226/D232/D235);
- the S-14 learn-time and peak-context check against PLAN-4, before and after the fixes;
- regressions against PLAN-4, per task.

No eval was run for this report. Every number comes from a run named next to it: results in `results/<run>.json`, analyses in `results/analysis/<run>.{md,json}`, transcripts and final code in `/tmp/sygnal-evals/trials/<run>/`. The first-pass analysis of the D228 runs, with the per-trial profiling, is `dev-plans/research/p5-eval-analysis.md` (re-analysed in 4-E2). Comparisons are task-matched (`analysis/compare.mjs`: each task's mean first, then the mean over the shared tasks). The comparison tables for this report are saved as `results/analysis/compare-p5-*.md`. The tests are the same as in REPORT-v3/v4: exact two-sample permutation per task on wall time, Fisher's exact test for pass counts.

## TL;DR

| Question | Answer |
|---|---|
| Tier 30–34, Sygnal vs React | Pass: Opus **23/25 vs 25/25** (p = 0.49), Sonnet **24/25 vs 23/25**, Haiku **5/25 vs 9/25** (p = 0.35). None significant. Sygnal takes **1.23–1.43×** the wall time, **1.3–2.6×** the cost and **1.3–2.5×** the peak context |
| Capability hierarchy | Opus ≈ Sonnet (92% vs 96%); Sonnet is 2.2× faster and 2.7× cheaper per trial. Haiku drops to 20% (React Haiku 36%) |
| Haiku | Mostly general capability (spec details, "done" claims with green self-tests: 48/50 failing trials). The Sygnal-specific part: with the full SKILL.md Haiku used the intended PLAN-5 API in **1/15** trials on 32–34; with the toc skill in **12/15**. 4-D shipped the fixes; **Haiku was not re-run after them** |
| Forms A/B (D231) | The D228 rule's triggers for the helpers were noise on every model. **The `form` behavior stays canonical**; `forms.md` was cut to an agent-sized page (31.8 → 15.8 KB) |
| Skill format (D235) | Toc cut peak context 12–17% and cost 11–17% on 30–34 (all models) and 24–28% / 21% on tiers 1–2 (S-14), but raised learn time and tier 1–2 wall (+25%). **6.0 ships the full SKILL.md**; toc stays an experiment |
| S-14 (bar: ≤ ~10% worse than PLAN-4) | **Passes after 4-D** (`p5-s14b-opus`, 80/80). `ergo` against `p4-final7-opus-ergo`: learn **9.8 → 9.7 s**, peak **43.1k → 42.8k**, wall −6%, cost −5%. Before 4-D it failed on learn (+21%, task 29) |
| Regressions vs PLAN-4 | **Task 10 (signup wizard): 49.8 → 121.5 s (2.44×, p = 0.008)**, learn 6.4 → 20.4 s, peak 36.6k → 55.0k. A new finding, caused by 4-D's "read the guide, use its API" step meeting a gap in the `form` behavior (see "Regressions"). Task 29: learn +6.1 s, peak +13% (not significant on wall). Every other task is flat or faster |
| Spend | **$180.13** for 495 trials: the D228 package $128.68 (approved ≈ $114), toc S-14 $23.69, S-14 re-check $27.76 |

## What PLAN-5 shipped

**Features** (all opt-in, 0 B in an app that doesn't import them; tree-shaking gate on kanban):

| Item | What | Used size (gzip) |
|---|---|---|
| W-1 / W-3 | `defineWidget()`: a third-party widget as a JSX tag (canonical) or a control (D189); `.detail()`; web components Using + Publishing guide | ≈ 1.3 KB |
| W-2 | `sygnal/zag` `fromZag`; `sygnal/ui/menu`, `/select`, `/combobox` (D211); `sygnal/react` `fromReact` (React 19, preact/compat) | one Zag part ≈ 33 KB |
| F-1 | `form` behavior via `uses` (D193, canonical) + exported helpers (escape hatch); field arrays inline (D233) | ≈ 2.4 KB + `defineBehavior` 0.9 KB |
| U-1 / T-1 | `sygnal/ui`: native `dialog`, `popover`, `tooltip`, `tabs`, `accordion`, `disclosure`, `<Toaster>` (top layer inside modals, D198) | 1.1–2.1 KB per part |
| V-1 | `<VirtualCollection>` on `@tanstack/virtual-core` (a regular dependency, D209) | ≈ 8.8 KB |
| B-1 | `sortable` behavior (pointer + keyboard, undo/persist aware, D218/D219/D221) | ≈ 2.4 KB |
| B-3 / B-4 | browser sources (`makeBrowserDriver`); `lazy(load, { when })` | ≈ 2.0 KB; every `lazy()` user +0.55 KB (D207) |
| A-1 | `<Collection viewTransitionName>` (D210) | in core, +120 B |
| Docs | 20 guide pages + 9 recipes offline in `dist/guide/` (+86.5 KB packed); `forms.md` split into `forms.md` / `forms-reference.md` / `inputs.md` (4-D) | — |

**Core changes** (the PLAN-4.6 core, `src/core/` and the DOM driver):
- **Hydration adopts server DOM** (3-J/3-M, D217/D220): the hydration vnode is built from the DOM with the client vnode as template; ≈ 289 B.
- **Fragments flattened before patch** (3-Q): snabbdom's `fragments` option is no longer used; +74 B. Fixed stale fragment bounds after hydration (G-518…G-523).
- **Collection without its wrapper `div`** (4-H, D229): items render into the parent as a keyed fragment. Breaking: wrapper props (`className`, `style`, …) are SYG612. Follow-up fixes for Collection roots (4-I: READY, Suspense, per-item Transition) and shared vnodes when an ancestor is recreated (4-J, G-564).
- **Patch errors** (3-Q/3-V/3-W, D223/D224): a DOM patch error goes to `run({ onError })` with phase `'patch'`; the app stops updating its DOM (state and events continue) and marks its root `data-sygnal-error="patch"`.
- Router delivery to nested declarers in one flush, with a hop guard (4-J/4-K).

**Sizes:**

| Budget | PLAN-5 start | Final | Cap |
|---|---|---|---|
| Core (kanban gzip, `nativeGlobalThis: false`) | 41,396 B | **42,698 B** (+1,302 B) | 42,300 → **42,500 (D222)** → **42,700 B (D230)**; 2 B left |
| SKILL.md | 38,873 B | **41,492 B** | 38,912 → **41,500 B (D225)**; 8 B left |
| `llms.txt` | 291 lines | **311 lines** (55.9 KB) | 315 lines |

- **D222** (+200 B): fragment flattening (+74 B), hydration follow-ups (+44 B), the patch-error guard (+33 B) left 8 B under 42,300.
- **D230** (+200 B): 4-I's Collection-root fixes (READY +12 B, per-item Transition around a Collection +58 B, `flat()` copy perf +19 B) put the core at 42,584 B. 4-J (+80 B, G-564 +52 B) and 4-K took it to 42,698 B.
- **D225**: the SKILL.md cap rose to keep every guide link and the rank-1/2 lines; 4-D's hints came to a net +126 B after trims (41,366 → 41,492 B).

## Method

| | |
|---|---|
| Runner | `orchestrate.mjs`, headless, 5 trials per (arm, task). Claude Code 2.1.287 in every run. Starter v2, process guard on |
| Models (D227) | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001` |
| Tasks | New tier `p5`: 30 checkout form (schema validation, a field array, server errors), 31 command menu, 32 Chart.js widget, 33 10,000-row virtual list with jump, 34 sortable list with keyboard moves. React arm: react-hook-form + zod, `cmdk`, Chart.js, TanStack Virtual, dnd-kit. Old tiers for S-14: tier 1 (01–08), tier 2 (09–12), `ergo` (26–29) |
| D228 package (2026-10-05/06) | Build `3c9819b` (tarball `7197a8f6…`), SKILL.md 41,366 B, `llms.txt` 311 lines. `p5-final-{opus,sonnet,haiku}` (30–34, both arms, 50 each); `p5-f1-behavior-{m}` / `p5-f1-helpers-{m}` (task 30, Sygnal, 5 each); `p5-4s-toc-{m}` (30–34, toc skill, 25 each); `p5-s14-opus` (tiers 1–2 + `ergo`, 80). 335 trials |
| After 4-D + 4-E2 (2026-10-06) | Tarball `0918bdf4…`. `p5-s14-toc-opus` (build `c1b297c`, toc skill 13,675 B + 12 references 33.6 KB, 80 trials) and `p5-s14b-opus` (build `94af305`, full SKILL.md 41,492 B, 80 trials) |
| References | `p4-final6-opus` (PLAN-4 4-E, tiers 1–2), `p4-final7-opus-ergo` (PLAN-4 4-E2, `ergo`: the S-14 reference), `p46-ev-opus` (4.6 core) |
| Forms A/B (D228 rule, fixed before the runs) | The behavior stays canonical unless the helpers pass more trials, or are ≥ 10% faster with no lower pass rate |

**Conditions that changed between runs:**
- **D234: built-in skills blocked** from the toc S-14 run on (`skillGuard: 1`: `disableBundledSkills`, `skillOverrides` off, `Skill(…)` deny rules). In the D228 runs (`skillGuard: 0`) Haiku invoked Claude Code's `run` skill in 19/25 React and 4/25 Sygnal trials (11/25 toc, 4/5 in each forms arm), which led to dev servers, port hunting and blocked `kill`s. Opus React invoked `dataviz` 5 times. The 4-D `analyze.mjs` counts only Sygnal skill calls as learning; all D228 runs were re-analysed with it (no conclusion changed). Wall and cost in the D228 Haiku runs still include those detours, more so on the React side.
- **4-D docs** between the two S-14 runs: `forms.md` 31.8 → 15.8 KB (+ `forms-reference.md`, `inputs.md`); a workflow step at the top of SKILL.md ("read the shipped guide before coding these, and use its API" for forms, widgets, long lists, sortable, `sygnal/ui`); hints for `sortable` `messages`, the VirtualCollection scroller, 422 reply shapes, field-array rows inline (D233), and the testing errors.
- **Field arrays** became inline rows (D233) after the D228 runs; task 30's hidden suite accepts both.

## Tier 30–34: Sygnal vs React

Task-matched means over the 5 tasks; 25 trials per arm and model (`p5-final-*`, `compare-p5-30-34-*-gap.md`).

| Metric | Opus Sygnal | Opus React | Sonnet Sygnal | Sonnet React | Haiku Sygnal | Haiku React |
|---|---|---|---|---|---|---|
| Pass | **23/25** | 25/25 | **24/25** | 23/25 | **5/25** | 9/25 |
| Hidden tests | 153/155 | 155/155 | 154/155 | 146/155 | 100/155 | 108/155 |
| Wall (s) | 82.1 | 64.1 (**1.28×**) | 37.9 | 26.5 (**1.43×**) | 315.2 | 256.7 (**1.23×**) |
| Cost per trial | $0.582 | $0.280 (2.08×) | $0.217 | $0.085 (2.56×) | $0.548 | $0.418 (1.31×) |
| Billed tokens (k) | 439.5 | 118.0 (3.73×) | 193.2 | 61.7 (3.13×) | 2,597.6 | 1,929.7 (1.35×) |
| Learn (s) | 13.8 | 0 | 4.9 | 0 | 26.6 | 0.4 |
| Peak context (k) | 50.2 | 21.4 (2.34×) | 40.8 | 16.6 (2.46×) | 78.3 | 61.1 (1.28×) |

Ratios are Sygnal / React.

| Task | Pass Sygnal \| React: Opus / Sonnet / Haiku | Sygnal wall O / S / H (React) |
|---|---|---|
| 30 checkout form | 5\|5 / 4\|5 / 0\|0 | 121.9 (73.0) / 62.0 (32.1) / 352.9 (240.4) |
| 31 command menu | 5\|5 / 5\|5 / 3\|3 | 60.2 (36.2) / 34.9 (14.8) / 130.7 (218.5) |
| 32 Chart.js widget | 5\|5 / 5\|5 / 1\|3 | 45.7 (56.6) / 40.9 (18.9) / 430.1 (210.8) |
| 33 virtual list | **3**\|5 / 5\|5 / 1\|0 | 71.3 (52.1) / 30.8 (26.2) / 270.1 (235.3) |
| 34 sortable list | 5\|5 / 5\|**3** / **0\|3** | 111.1 (102.8) / 20.9 (40.4) / 392.4 (378.4) |

**Reading.**
- **No pass gap is significant** (−8, +4 and −16 points). The gap is in time and cost: 1.2–1.4× wall, 1.3–2.6× cost. On Opus the wall ratio, 1.28×, is lower than PLAN-4's `ergo` gap after 4-E2 (1.45×) and close to PLAN-3's tier-2 gap (1.29×).
- **Peak context is the largest cost**: +24–29k tokens on Opus and Sonnet, i.e. SKILL.md (≈ 11k tokens) plus the guides agents open. React agents needed no lookup.
- **Opus's two misses** (and the toc arm's one) are task 33 rejecting "0" as a row number; four React Haiku trials miss the same check. A logic slip, not an API problem.
- Opus used the intended API in 15/15 trials on 32–34 and the `form` behavior in 4/5 on 30. Sonnet used `defineWidget`, `<VirtualCollection>` and `sortable` 5/5 each, but hand-rolled task 30's form in 5/5 (4/5 pass).

**Capability hierarchy (D227).** Opus and Sonnet are equivalent on Sygnal (92% vs 96%); Sonnet is 2.2× faster and 2.7× cheaper per trial ($0.22 vs $0.58). Haiku falls about 75 points to 20%; on React it falls to 36%. With the full skill, Sygnal on Haiku is a reach; on Sonnet it is as good as on Opus.

## Haiku: failure analysis and the docs fixes

Profiled by script for all 50 failing Haiku Sygnal trials across the four D228 Haiku runs, with every task-30 transcript and samples from 32–34 read in full (`p5-eval-analysis.md` §2). Failures were not classified by `score.mjs --classify`; 4-D's auto-category puts all 20 `p5-final-haiku` Sygnal and 16 React failures in `other`.

| Primary cause (20 failing `p5-final-haiku` Sygnal trials) | Trials | Sygnal-specific? |
|---|---|---|
| Spec details missed in a hand-rolled form or feature, with self-tests that don't check them | 7 (30 ×5, 31 ×2) | **No**: React Haiku fails 30 5/5 on the same assertions |
| PLAN-5 API not used; the hand-rolled replacement is wrong (Chart.js via `document.querySelector` + `setTimeout`, manual virtualisation, manual keyboard reorder) | 11 (32 ×3, 33 ×4, 34 ×4) | **Yes**: the routing lines were in SKILL.md, Haiku didn't act on them |
| Test-harness misuse, then abandoning a correct API ("The `sortable` behavior might not exist…") | 1 | Yes |
| Stopped after a plan | 1 | Partly |

- **Haiku reads almost nothing past SKILL.md** with the full skill: 1 guide opened in 25 trials (Opus 25/25, Sonnet 18/25). The intended API appears in 1/15 trials on 32–34.
- **Test-harness errors** in 14/25 Sygnal Haiku trials (Opus 0, Sonnet 1): `simulateEvent` given an element, `t.next()` where `t.waitForState()` was needed, `t.respond` with no pending request. Haiku then weakens its tests (11/50 failing trials).
- **False completion**: 48/50 failing trials end by claiming success, 43/50 with their own suite green. React Haiku does the same.
- **With the toc skill**, Haiku follows the "read the references your task needs" step: it opened `widgets-and-ui.md` in 19/25 trials and used the intended API in **12/15** on 32–34. Pass stayed 5/25 because two docs gaps then decided the outcome:
  - task 34 (4/5 trials at 5/6): `sortable`'s default cancel text differs from the spec's; the `messages` option was only in the guide's option table;
  - task 33 (4/5 at 1/6): `<VirtualCollection>` placed inside the starter's scrolling `<ul>`, so nothing scrolled; SYG430 was reported and ignored.

**Fixes shipped in 4-D** (from this analysis): the "read the shipped guide first" workflow step in the full SKILL.md; `sortable` `messages` hint; "VirtualCollection is the scroll container"; field-array rows inline (D233); the testing one-liners (`simulateEvent` takes a selector; `dom: 'real'`; assert on `t.state` after an awaited `t.respond`). **None of these was measured on Haiku**: no Haiku run followed 4-D.

## Forms A/B (D228 rule → D231)

Task 30, Sygnal, 5 trials per arm (`p5-f1-behavior-{m}`, `p5-f1-helpers-{m}`).

| Model | Behavior pass | Helpers pass | Wall mean / median B → H | Δ mean | Wall p | Rule says |
|---|---|---|---|---|---|---|
| Opus | 5/5 | 5/5 | 136.1 / 105 → 117.9 / 116 | −13% | 1.0 | helpers (≥ 10% faster) |
| Sonnet | 4/5 | **5/5** | 47.0 / 48 → 59.5 / 62 | **+27%** | **0.024** (behavior faster) | helpers (one more pass) |
| Haiku | 0/5 (8/35 tests) | 0/5 (17/35) | 401.6 / 431 → 350.6 / 281 | −13% | 0.54 | helpers (≥ 10% faster) |

- The rule says helpers on every model, but each trigger is noise: Opus's −13% is one 294 s behavior trial (the other four, 91–105 s, beat every helpers trial; medians favour the behavior); Sonnet's extra pass is one trial, and the behavior was significantly faster; Haiku passed nothing in either arm.
- **D231: the behavior stays canonical** (D193). Opus spent 20–29 s per trial reading `forms.md` (31.8 KB) and grepping the bundle for `replyErrors`/`submitting`, so 4-D rewrote it agent-sized: the recipe answers (behavior, inline rows, submit to HTTP, pending, 422) sit in the first ≈ 9.5 KB of a 15.8 KB page.
- Haiku with the behavior put each row in a Collection child (SYG104, SYG410) and never opened `forms.md`. D233 made inline rows canonical.

## Skill format: toc vs full SKILL.md (D226 → D232 → D235)

The toc skill (`skills/sygnal-dev-toc`): a 13.4 KB SKILL.md table of contents plus 12 reference files (33.6 KB), same facts (`scripts/check-skill-toc.mjs`).

**On 30–34** (`p5-4s-toc-{m}` vs `p5-final-{m}` Sygnal, D228 conditions):

| Metric | Opus full → toc | Sonnet full → toc | Haiku full → toc |
|---|---|---|---|
| Pass | 23 → 24/25 | 24 → 22/25 | 5 → 5/25 |
| Wall (s) | 82.1 → 75.0 (−9%) | 37.9 → 39.5 (+4%) | 315.2 → 270.9 (−14%) |
| Cost | −16% | −11% | −17% |
| **Peak context (k)** | 50.2 → **41.5 (−17%)** | 40.8 → **34.3 (−16%)** | 78.3 → **68.5 (−12%)** |
| Learn (s) | 13.8 → 17.7 | 4.9 → 6.8 | 26.6 → 18.7 |
| Skill bytes read per trial | 41,366 → 19,586 | 41,366 → 15,179 | 43,021 → 25,480 |

**On S-14's tasks** (`p5-s14-opus` → `p5-s14-toc-opus`; the toc run was under D234 and after 4-D, so the two arms differ in more than the format; `compare-p5-s14-toc.md`):

| Set | Peak (k) | Cost | Wall (s) | Learn (s) | Pass |
|---|---|---|---|---|---|
| Tiers 1–2 | 34.6 → **25.0 (−28%)** | −21% | 30.1 → 37.5 (**+25%**) | 2.4 → 5.5 | 60/60 → 60/60 |
| `ergo` | 47.3 → **39.4 (−17%)** | −13% | 60.7 → 59.8 (flat) | 11.9 → **14.0** (bar ≈ 10.8) | 20/20 → 20/20 |

Against the full skill under the same tarball and conditions (`p5-s14b-opus` → toc): tiers 1–2 peak −26%, cost −21%, wall +9%, learn 3.0 → 5.5 s; `ergo` peak −8%, cost −2%, wall +8%, learn 9.7 → 14.0 s.

- Toc saves context and money on every model and task set. It costs learn time on Opus and Sonnet: each reference opened is a learn step, and agents open 1–3 on simple tasks the full skill answers inline (e.g. 08: wall 29.7 → 48.2 s).
- Its largest effect is qualitative and on Haiku: routing written as a step gets followed.
- **D235: 6.0 ships the full SKILL.md** (with 4-D's guide step); toc stays an experiment, to be retried with a fuller SKILL.md core so simple tasks need no reference.

## S-14: learn time and peak context against PLAN-4

Bar (PLAN-5 §2): learn time and peak context no more than about 10% worse than PLAN-4; reference `p4-final7-opus-ergo` for `ergo`, `p4-final6-opus` for tiers 1–2.

| Set | Reference | `p5-s14-opus` (before 4-D) | **`p5-s14b-opus` (after 4-D, D234)** |
|---|---|---|---|
| `ergo` learn (s) | 9.8 | 11.9 (**+21%** ❌) | **9.7 (−1%)** ✅ |
| `ergo` peak (k) | 43.1 | 47.3 (+9.6%, at the bar) | **42.8 (−1%)** ✅ |
| `ergo` wall / cost | 59.1 s / $0.475 | 60.7 / $0.507 | **55.5 / $0.453** |
| Tiers 1–2 learn (s) | 2.0 | 2.4 | 3.0 (+1.0 s; all of it task 10) |
| Tiers 1–2 peak (k) | 33.6 | 34.6 (+3%) | 33.8 (+1%) ✅ |
| Tiers 1–2 wall / cost | 31.2 s / $0.307 | 30.1 / $0.313 | 34.5 (+10%) / $0.312 |
| Pass | 80/80 (78/80 with 4-E's `ergo`) | 80/80 | 80/80 |

**Verdict: S-14 passes; no `llms.txt` trim.** The forms fix worked where it was aimed: task 29's peak went 57.9k → 51.3k, and 27/28 dropped back (27: learn 8.8 → 4.2 s; 28: 8.6 → 2.7 s). Against the original 4-E `ergo` run (`p4-final6-opus`), PLAN-5's `ergo` is 72.5 → 55.5 s (−23%), learn 19.2 → 9.7 s, pass 18/20 → 20/20.

Tiers 1–2 *without task 10* (11 tasks, `p4-final6-opus` → `p5-s14b-opus`): wall 29.6 → 26.6 s (−10%), learn 1.6 → 1.4 s, peak 33.4k → 31.9k (−4%), cost −8%. The tracker read the tiers 1–2 learn rise as noise; it is one task, and a real one (next section).

## Regressions against PLAN-4, per task

Opus, `p5-s14b-opus` against `p4-final6-opus` (tiers 1–2) and `p4-final7-opus-ergo` (`ergo`); every task passes 5/5 in both. Moves above about 10% (`compare-p5-s14b-*.md`):

| Task | Wall (s) | Learn (s) | Peak (k) | Cost | Note |
|---|---|---|---|---|---|
| **10 signup wizard** | **49.8 → 121.5 (2.44×, p = 0.008)** | 6.4 → 20.4 | 36.6 → **55.0 (+50%)** | $0.392 → $0.717 | new in 4-D; see below |
| 29 accessible signup | 71.4 → 79.1 (+11%, p = 0.15) | 11.2 → 17.3 | 45.5 → 51.3 (+13%) | +14% | reads `forms.md` + `ui/dialog.md`; was +27% peak before 4-D |
| 01 clear completed | 24.0 → 15.4 (−36%, p = 0.008) | ≈ | −7% | −26% | G-205 starter now a11y-clean |
| 02, 08, 09 | −26%, −25%, −15% | ≈ | −5 to −9% | | |
| 27 undo editor | 59.1 → 45.2 (−24%) | 11.3 → 4.2 | 44.4 → 38.8 | −21% | |
| 28 stopwatch | 53.8 → 45.3 (−16%) | ≈ | ≈ | | |

**Task 10: the guide step routes a wizard to the `form` behavior, which then gets stuck.**
- Task 10 turns a signup form into a two-step wizard (Back keeps the values). Before 4-D, 0/5 trials used `form` in both `p4-final6-opus` and `p5-s14-opus` (`forms.md` was opened 1–3 times and set aside). After 4-D's "a form with validation → `form` behavior, read `forms.md`" step, **5/5 used it** in `p5-s14b-opus`, and 5/5 in the toc S-14 (110 s; the toc's routing step is the same).
- **4/5 `p5-s14b` trials then debugged the same failure**: the account step sends no request, so the trial ended the submit with `EFFECT: next('form.DONE')`; the step unmounts before the deferred action arrives, `state.form.submitting` stays `true`, and after Back the second Next is dropped as a double submit. In t1's words: "`form.DONE` never runs: the step unmounts before the delayed `next()` fires". t3 switched to `Switchable` to keep the step alive; t1, t2 and t5 cleared `submitting` by hand. The fifth trial (t4) lost its time to the mock DOM not turning a button click into a form submit, then to its own `form.SUBMIT` intent replacing the behavior's submit trigger.
- Mean 6.8 iterations and 3.4 failed test runs per trial (tiers 1–2 average ≈ 1.5 and 0.2). All 5 still passed the hidden suite.
- Cause: a docs and API gap, not the routing itself. `forms.md` documents only the HTTP case (`ok: 'form.DONE'`); it doesn't say how to finish a submit that sends nothing, and a pending submit survives its host's unmount in parent-held state.

## Cost

| Phase | Run | Trials | Pass | Cost |
|---|---|---|---|---|
| D228 | `p5-final-opus` (both arms) | 50 | 48 | $21.54 |
| D228 | `p5-final-sonnet` (both arms) | 50 | 47 | $7.54 |
| D228 | `p5-final-haiku` (both arms) | 50 | 14 | $24.16 |
| D228 | `p5-f1-behavior-{opus,sonnet,haiku}` | 15 | 9 | $9.01 |
| D228 | `p5-f1-helpers-{opus,sonnet,haiku}` | 15 | 10 | $9.00 |
| D228 | `p5-4s-toc-{opus,sonnet,haiku}` | 75 | 51 | $28.55 |
| D228 | `p5-s14-opus` | 80 | 80 | $28.89 |
| D232 | `p5-s14-toc-opus` | 80 | 80 | $23.69 |
| D235 | `p5-s14b-opus` | 80 | 80 | $27.76 |
| | **D228 $128.68 · toc S-14 $23.69 · S-14 re-check $27.76** | **495** | | **$180.13** |

D228 approved ≈ $114 and ran $15 (13%) over, mostly Haiku ($24.16 on `p5-final-haiku`, $11.42 on toc Haiku). The toc S-14 came in under its ≈ $26.59–28 estimate. Per trial: Sonnet Sygnal $0.22, Opus Sygnal $0.58, Haiku Sygnal $0.55 (Haiku is not cheaper here: 2.6M billed tokens per trial).

## Caveats

- **n = 5 per cell.** Significant at p < 0.05: the task-10 regression (p = 0.008 against both PLAN-4 and `p5-s14-opus`), task 01's gain, the Sonnet forms wall difference (p = 0.024, in the behavior's favour). No pass-rate difference in this report is significant; one or two trials per task is noise.
- **Conditions changed between runs.** The D228 runs had built-in skills available (`skillGuard: 0`); the toc S-14 and S-14 re-check had them blocked (D234). The two later runs also had 4-D's docs. So `p5-s14-opus` → `p5-s14-toc-opus` mixes the format change with D234 and 4-D; the cleaner format comparison is `p5-s14b-opus` → `p5-s14-toc-opus` (same tarball and conditions). React Haiku's D228 wall includes 19/25 trials of `run`-skill detours.
- **Phase attribution is heuristic** (a long model turn is charged to the next tool call); it inflates Haiku's learn time in particular.
- **Not measured:**
  - S-14 on tasks 13–25 (tier 3, TS, `net`): only the minimum (tiers 1–2 + `ergo`) was run, so REPORT-v4's 01–23 D76 row has no PLAN-5 counterpart.
  - Haiku on the old tiers (01–29), and Sonnet on anything but 30–34.
  - Any model on 30–34 after 4-D: the Haiku docs fixes, the agent-sized `forms.md`, D233's inline rows and D234 are unmeasured on the new tier.
  - The forms A/B at n = 10 (D231 option (c), not run).
  - Failure classification: `failureCategory` is `null` in all 495 records; root causes come from scripted profiling and transcript reads.

## Recommendations

1. **Fix the task-10 regression before release** (S-14 passed on the matched bar, but one tier-2 task is 2.4× slower):
   - (a) `forms.md`: a short "submit without a request" paragraph (how to finish the submit when nothing is sent) and a wizard note (a step that unmounts keeps its `form` slice in parent state). About +0.3 KB of guide, 0 B SKILL.md.
   - (b) Consider making the behavior end a submit whose host is disposed, or a `submit` option for local forms that completes at once (helper-side, 0 B core). User decision.
   - (c) Then a targeted re-run of tasks 10 and 29 on Opus, 5 trials each, ≈ $7.
2. **Toc skill with a fuller core** (D235): keep the toc's step-style routing and its context savings, but move the facts simple tasks need (views, intent, model, Collection, tests) into the toc SKILL.md so they need no reference read. Re-measure on tiers 1–2 + `ergo` + 30–34 (Opus, 105 trials, ≈ $36) under D234 conditions.
3. **Haiku-oriented docs, measured**: re-run `p5-final-haiku` Sygnal on 30–34 after 4-D (25 trials, ≈ $14) to see whether the guide step, the `sortable`/VirtualCollection hints and the testing one-liners move Haiku's pass rate (from the toc run: task 34 to ≈ 4/5, task 33 up). Re-run React Haiku in the same hour under D234 (≈ $10), since its D228 numbers include the `run`-skill detours.
4. **Context remains the main Sygnal cost** (2.3–2.5× React's peak on Opus/Sonnet). SKILL.md is at its cap (8 B left); further gains come from the toc direction (2), not from trimming lines.
5. **Open backlog gaps** (all Low or watched; none affects the eval tasks):
   - **G-551** dom/tests: a throwing user `reportSnabbdomError` errors the root element stream; an old failed app's dispose can clear a newer app's patch-error mark in the same container; add a test for a throw during the first (adopt) patch.
   - **G-568** Collection/SSR: an item view returning `null` renders an empty `<div>` on the client but nothing from `renderToString`.
   - **G-569** core: a view returning an array still renders `undefined`; G-564 residual (a vnode moved directly between two kept parents passes the new element to its own `hook.destroy`).
   - **G-574** router/docs: the hop guard counts all synchronous navigations (a burst of > 32 skips 33…49; final state correct); the docs should say "navigations".
   - **G-562** (Medium, watched): a Firefox full-run hang at one focus test, not reproduced on integration since 4-R.
   - G-563 (router, first ROUTE a task late) was fixed in 4-J.
   - New, from this report: the task-10 `form` submit gap (recommendation 1); not yet a G- item.
6. **Harness:** classify failed trials (`score.mjs --classify`) as part of every run, and record `skillGuard` in REPORT tables from now on.
