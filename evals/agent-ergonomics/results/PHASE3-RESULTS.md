# PLAN-2 Phase 3: experiment results

Decision records for the Phase 3 experiments (PLAN-2 §5), measured with the 3-H variant harness on 2026-10-01/02. Every experiment is compared, task-matched, with its control run `p3-control` (Sygnal, `branch` variant: the plan2-integration build + its skill), and the remaining Sygnal − React gap with `p3-control-react`. Model `claude-opus-5-5` unless noted; 5 trials per (arm, task).

Numbers are matched means over the shared tasks (each task weighs the same). Spread is the per-task min–max of trial wall time. With n = 5 per cell, differences under ~5 s or ~10% are called **within noise** unless they repeat across tasks.

## Executive summary

| Experiment | Key number (vs `p3-control`, task-matched) | Verdict |
|---|---|---|
| **E1** sygnal-check in the loop | Installed: 50/50 trials ran it unprompted; it flagged the planted bug in 15/15 debug trials (06/07/14) within 2–4 s. Wall 25.0 → 25.0 s, iterations 1.32 → 1.28. Pretest hook: wall +0.6 s, iterations +0.26, failed runs 0.12 → 0.28 | **Adapt**: install sygnal-check in the eval starters (as the 5.4.0 templates do; the skill already tells agents to run it); **drop** the pretest hook |
| **E2** `makeFetchDriver()` + test fakes | Side effect in a driver: 20/20 trials (control: 7/20 driver, 13/20 `fetch` in an EFFECT); request-id bookkeeping 15/15 → 0/20. Wall on 05/11/17 44.5 → 42.7 s (05: −27%), source LOC −30%. Task 13: 71.8 → 233 s, confounded by Switchable stale pages in 4/5 trials | **Adopt (b)+(a)** (user decision), after the Switchable bug is reproduced and task 13 re-run |
| **E4** `renderComponent({ dom: 'real' })` | Adopted in 14/15 trials; run()+jsdom suites 7/15 → 0/15, second test files 1 → 0. Test-authoring 12.9 → 12.6 s (−2%, rule needs −20%); task 17 wall 55.7 → 66.0 s (ranges don't overlap) | **Adapt**: fix the real-mode waits (state resolves before the DOM patch), then re-measure task 17 |
| **E5** lean / lean-routed skill | Peak context −4.0k / −3.7k (−13%), cost −8%; but wall +5.2 s / +3.6 s, failed runs 0.29 → 0.75 / 0.67, slower on 10/11 tasks | **Drop** both variants; **adapt**: port the 4 new facts into the current skill, delete `references/component-patterns.md` |
| **E7** Sonnet 5.5 | Pass: Sygnal 83/85, React 74/75 (Opus: 83/85, 75/75). Gap +9.6 s (1.69×) vs Opus +8.4 s (1.25×). Both Sygnal failures are a framework defect (Switchable drops `PARENT`), not agent wiring | **Inconclusive** on the hypothesis (pass rate doesn't separate the arms on Sonnet either); fix the Switchable bug; Haiku not run |
| **E8** sygnal-check MCP server | MCP used in 9/15 trials, `check` only (never `graph`/`explain`); debug time unchanged on 14/15. Wall 47.1 → 95.2 s is one 774 s outlier (Switchable bug); without it 48.8 s | **Drop** from agent docs (keep the server) |
| **E9** testing-norm parity | Tier-1 gap with the same instruction in both arms: "add a test" +6.6 s (1.30×), "no tests" +6.9 s (1.45×); control +3.7 s | **Drop the hypothesis**: the testing norm is not the gap. No skill change |
| **E11** fake timers | 5/5 task-11 trials used `vi.useFakeTimers()`; suite 2.9–4.8 s → 0.37–0.40 s; verify 5.5 → 2.0 s; 0 hangs. Task-11 wall 49.2 → 45.9 s (−3.2 s, within noise) | **Adopt** (0 app bytes, removes a hang trap), noting the wall gain isn't measurable at n = 5 |

Surprises that matter more than most experiment deltas:

1. **Switchable drops a child's `PARENT` sink** (likely bug). `src/switchable.ts` builds the switched sinks from `Object.keys(sources)`, so a sink that is not also a source (`PARENT`) is never forwarded. Task 13's canonical Retry (`PARENT` + `CHILD.select(CoursesPage)`) is lost: both Sonnet failures, 2 Opus trials that switched to EVENTS, and the 774 s E8 trial. **Switchable can also stick on the previous page** after a switch (in `renderComponent` and in jsdom with `run()`): seen in 4/5 e2 task-13 trials and e8-mcp 13-t2 (0/5 in the control). e2 13-t3 and e8 13-t2 each spent 8–12 minutes on it before replacing Switchable with conditional rendering (e2 13-t3: 1,200 switches clean after the swap; Home↔Profile alone stable over 160 switches, so the page with a driver source seems to trigger it). Unverified by me; needs a repro. `src/switchable.ts` and `initContext()` are unchanged since v5.4.0.
2. **`.context` that reads a `calculated` field lags one update in Collection items** (likely bug). `initContext()` reads `this.currentState` when the state stream fires, before calculated fields are recomputed (agent diagnosis, consistent with the code). This causes the e9-no-test 04-t3 failure ("(68%)" vs "(56%)"), and 5 more task-04 trials spent time on it.
3. **The eval starters lack sygnal-check, but the skill tells agents to run it.** 68/85 control trials ran `npx sygnal-check` and got "npx canceled due to missing packages" (≈2 s each), and many final reports say "couldn't run sygnal-check". Every Sygnal run except e1-*/e8 has this.
4. **Recurring test-authoring mistakes:** guessing `t.state` (doesn't exist; 2 trials in the control, 12–13 per lean-skill run), `next()` after the state already happened (the error message names the fix), and `t.html()` checked before the first render (`expected '' to contain`).

---

## E1: sygnal-check in the loop

**Hypothesis.** With sygnal-check installed, agents catch wiring bugs before running tests, which cuts iterations on build and debug tasks.

**What ran.** `e1-check` (sygnal-check vendored as a devDependency + an AGENTS.md naming it) and `e1-pretest` (the same + `"pretest": "sygnal-check --strict"`), Sygnal tier 1 (01–08) + 14, 15; 50 trials each, all passed.

| Metric (10 tasks) | p3-control | e1-check | e1-pretest |
|---|---|---|---|
| Wall (s) | 25.0 | 25.0 | 25.6 |
| Iterations | 1.32 | 1.28 | 1.58 |
| Failed runs | 0.12 | 0.14 | 0.28 |
| Cost ($) | 0.222 | 0.228 | 0.232 |
| Peak context (k) | 26.0 | 26.5 | 26.7 |
| Debug phase (s) | 0.7 | 0.8 | 1.4 |

Debug tasks (wall, min–max): 06 15.8 (15.1–16.6) → 18.1 (16.4–21.6) / 18.1; 07 21.5 (16.9–25.1) → 19.7 (18.6–21.6) / 22.1; 14 29.0 (24.2–35.9) → 31.4 (24.2–36.9) / 28.9.

**Evidence.**
- **Use.** e1-check: 50/50 trials ran `npx sygnal-check` unprompted (the AGENTS.md table and the skill both name it). e1-pretest: 49/50 ran it (39 through `npm test`, 21 also by hand). In the control, 68/85 trials *tried* (the skill tells them to) and got "not installed".
- **Findings.** On the debug tasks it pointed at the planted bug first, in every trial: 06 SYG110 (selector not in view) + SYG502, 07 SYG104, 14 SYG104, all on the first command at 2–4 s, and clean after the fix. One feature trial (04-t4) got 4 warnings mid-edit, one pretest run (01-t2) a SYG101. No false alarms on the final code.
- **Time.** 2.45 s/trial of explicit check runs (e1-check), 0.33 s (pretest, which folds it into `npm test`). The control already loses ≈2.1 s/trial to the failed `npx` attempt, so installing it is time-neutral.
- Opus finds these bugs from the code anyway, so the early pointer doesn't shorten the debug tasks; pass rates are 100% everywhere.

**Verdict: adapt.** Agents run it without prompting (the decision rule's trigger for a stronger instruction is not met). Install sygnal-check in the eval starters so they match the 5.4.0 templates and the skill (otherwise every Sygnal trial pays for a failed `npx`). Drop the pretest hook: it adds iterations and failed runs (the check counts as a failed `npm test`) for no gain. Re-test E1 on a smaller model, where the planted-bug pointer could matter. Cost: 0 B, no API.

## E2: async side effects (`makeFetchDriver()`, test fakes)

**Hypothesis.** Agents put `fetch` in components because drivers cost wiring; a built-in fetch driver with test fakes brings side effects back to drivers without slowing agents down (E3: `latest: true` removes the hand-rolled request-id pattern).

**What ran.** `e2` (exp/e2-fetch-driver build + skill: `makeFetchDriver()` with `latest`, `t.respond`/`t.fail`/`t.requests`, SYG609), tasks 05, 11, 13, 17; 20 trials, all passed, $8.10.

| Task | Wall p3-control → e2 (s) | Iterations | Failed runs | Test-authoring (s) | Debug (s) | Source LOC added | Cost ($) |
|---|---|---|---|---|---|---|---|
| 05 | 28.7 (25.5–34.1) → **20.9 (19.0–22.3)** | 1.2 → 1.0 | 0.2 → 0.0 | 8.7 → 5.1 | 0.6 → 0.0 | 39 → 17 | 0.236 → 0.205 |
| 11 | 49.2 (41.5–55.9) → 45.5 (34.2–61.1) | 1.0 → 1.4 | 0.0 → 0.2 | 12.0 → 11.1 | 0.0 → 2.3 | 43 → 28 | 0.307 → 0.317 |
| 13 | 71.8 (58.9–83.7) → 233.0 (52.2–587.7) | 2.4 → 7.8 | 0.6 → 3.4 | 12.8 → 53.4 | 3.0 → 100.9 | 115 → 107 | 0.413 → 0.704 |
| 17 | 55.7 (54.0–58.1) → 61.8 (54.4–65.2) | 1.2 → 1.4 | 0.0 → 0.0 | 13.9 → 17.2 | 0.0 → 0.0 | 51 → 47 | 0.335 → 0.394 |
| **Matched, 4 tasks** | 51.3 → 90.3 | 1.45 → 2.90 | 0.2 → 0.9 | 11.8 → 21.7 | 0.9 → 25.8 | 62 → 50 | 0.323 → 0.405 |
| **Matched, 05/11/17** | **44.5 → 42.7** | 1.13 → 1.27 | 0.07 → 0.07 | 11.5 → 11.1 | 0.2 → 0.8 | 44 → 31 | 0.293 → 0.305 |

Pass 19/20 → 20/20 (the control's failure is 17-t5's spec misread). Source LOC = lines added to non-test files.

**Evidence.**
- **Where the side effect lands (final code).** Control: 7/20 in a `driverFromAsync` driver (05 ×5, 11 ×2), 13/20 `fetch` inside an EFFECT (11 ×3, 13 ×5, 17 ×5), 0 in intent. E2: **20/20 `makeFetchDriver()`**, no `fetch` left in any component.
- **Latest-only.** `latest: true` in 19/20 (13-t4 didn't need it). Hand-rolled request ids (`reqId`/`lookupId` + ABORT on mismatch): control 15/15 trials on 05/11/17 → e2 0/20.
- **Tests.** `t.respond`/`t.fail`/`t.requests` in 18/20 suites; 9/20 also stub global `fetch` for a full-app test. Friction seen: `t.respond` matched requests by object identity when an agent reused one constant request object (13-t4); a component test that forgot the HTTP fake (13-t4).
- **Task 13 is confounded.** 4/5 e2 trials (t1, t3, t4, t5) hit intermittent stale pages after switching tabs (the `Switchable` problem in Surprises), against 0/5 in the control; 13-t3 spent 6 of its 10 minutes on it and replaced Switchable with conditional rendering, 13-t4 reordered its test's tab clicks to avoid it. It may be triggered by a Switchable page that owns a driver source (the Courses page reads `HTTP`); e8-mcp 13-t2 hit it after moving Retry to EVENTS. Until that is reproduced and fixed, task 13 can't measure E2.
- **Without 13:** 05 is faster with non-overlapping ranges (−7.8 s, −27%; source LOC −56%), 11 is within noise (−3.7 s), 17 is +6.1 s (test-authoring +3.3 s, more and longer tests). Learn time didn't grow (11.1 → 10.3 s on all 4).

**Verdict: adopt (b) + (a), user decision.** It meets the decision rule's goal: side effects move out of components (13/20 → 0/20 in components) at no agent-time cost on 05/11/17 (44.5 → 42.7 s) and with less code. Before Phase 4, reproduce the Switchable stale-page bug and re-run task 13 (± E2) to rule out an E2 interaction. Small follow-ups: `t.respond` should match by request content, not identity; a clearer error when a test omits the driver. Cost (tracker): kanban gated +52 B; driver 1.66 KB gz standalone, +1.27 KB in an app that uses it, 0 B otherwise; new API `makeFetchDriver`, `HTTP.select/errors`, `t.respond`/`t.fail`/`t.requests`, SYG609.

## E4: real-DOM test mode

**Hypothesis.** A real-DOM `renderComponent` mode removes the second jsdom suite and cuts test-authoring time.

**What ran.** `e4` (exp/e4-real-dom build + skill), tasks 10, 12, 17; 15 trials, all passed.

| Task | Wall p3-control → e4 (s) | Iterations | Failed runs | Test-authoring (s) | Verify (s) | Debug (s) | Cost ($) |
|---|---|---|---|---|---|---|---|
| 10 | 53.7 (50.1–55.9) → 53.0 (48.0–58.7) | 1.8 → 1.6 | 0.8 → 0.2 | 10.7 → 11.0 | 2.3 → 3.5 | 3.2 → 0.6 | 0.348 → 0.347 |
| 12 | 45.6 (37.0–59.5) → 47.4 (42.5–53.7) | 2.2 → 2.2 | 0.6 → 0.6 | 14.2 → 9.4 | 2.4 → 3.1 | 2.1 → 2.9 | 0.316 → 0.312 |
| 17 | 55.7 (54.0–58.1) → 66.0 (61.3–70.1) | 1.2 → 1.8 | 0.0 → 0.6 | 13.9 → 17.2 | 3.6 → 3.0 | 0.0 → 3.9 | 0.335 → 0.400 |
| **Matched** | **51.7 → 55.5** | 1.73 → 1.87 | 0.47 → 0.47 | **12.9 → 12.6** | 2.8 → 3.2 | 1.8 → 2.5 | 0.333 → 0.353 |

Pass: 14/15 → 15/15 (the control's 17-t5 failure is a spec misread, not test tooling). Peak context 30.1k → 31.2k.

**Evidence.**
- **Test files.** One file per trial in both runs. Control: 7/15 suites used `run()` + jsdom (10: 2/5, 17: 5/5) and one trial (12-t2) kept a second `App.dom.test.js`. E4: 0 `run()` suites, 0 second files; `dom: 'real'` in 14/15 (12-t5 stayed on the mock). Suite length is similar (task 17: 82–119 → 109–148 lines).
- **Suite duration** 0.6–1.4 s in both; no flaky reruns seen within the trials (the planned 10× rerun of each agent's suite was not part of this run).
- **New friction in real mode** (the task-17 slowdown): after `await t.next(s => s.zipStatus === 'Looking up…')` the real DOM still shows the old text (17-t2, 17-t3); `t.query(...)` returns null before the first render (17-t2, 17-t4); `t.queryAll()` on the mock DOM throws (12-t2). 3/5 task-17 trials had a failed own-test run (control 0/5).

**Verdict: adapt.** It does what it was built for (one suite, no run()+jsdom), but the decision rule (test-authoring −20%) is not met (−2%), and task 17 got slower. Make the waits real-DOM aware (`next`/`waitForState`/`settle` resolve after the patch in `dom: 'real'`; `t.query` waits for the first render like `simulateEvent` does), then re-run 10/12/17. Cost (tracker): 0 app bytes; testing.ts +1.7 KB gz in dist; API `dom: 'real'`, `t.container`, `t.query`, `t.queryAll`; llms.txt −16 lines.

## E5: skill size and shape

**Hypothesis.** A ~150-line SKILL.md cuts peak context and skill-load time without raising learn or debug time.

**What ran.** `e5-lean` (172 lines, 11.9 KB) and `e5-routed` (189 lines, 13.8 KB, + a task → `llms.txt` section/`sed` index), Sygnal, tasks 01, 04, 05, 07, 08, 10, 11, 13, 15, 16, 17; 55 trials each. Control skill: 357 lines, 25.8 KB.

| Metric (11 tasks) | p3-control | e5-lean | e5-routed |
|---|---|---|---|
| Pass | 53/55 | 54/55 | 55/55 |
| Wall (s) | 44.7 | 49.9 (+5.2) | 48.4 (+3.6) |
| Peak context (k) | 29.7 | 25.6 (−4.0) | 25.9 (−3.7) |
| Cost ($) | 0.307 | 0.282 | 0.283 |
| Iterations | 1.78 | 2.40 | 2.25 |
| Failed runs | 0.29 | 0.75 | 0.67 |
| Learn phase (s) | 6.1 | 6.6 | 6.5 |
| …of which skill-load | 1.31 | 1.17 | 1.24 |
| …framework-source (`node_modules`) | 3.66 | 4.40 | 4.58 |
| Debug phase (s) | 1.5 | 4.2 | 3.9 |
| `llms.txt` reads (trials) | 32 (25) | 62 (41) | 66 (40) |
| `dist` reads (trials) | 18 (10) | 2 (1) | 0 (0) |
| `sed -n` range reads of `llms.txt` (trials) | 1 | 44 (32) | 60 (39) |
| `references/` reads | 2 | 0 | 0 |

Lean was slower on 10/11 tasks (largest: 16 +14.5 s, 13 +10.3 s, 10 +6.7 s); routed on 10/11 (16 +6.0 s, 04 +6.0 s, 08 +6.3 s).

**Evidence.**
- The 4 facts added to both variants worked: `dist` reads fell from 18 (task 15 in 5/5 trials, 13, 11) to 2 and 0.
- Shrinking cost more than it saved. The lean skills dropped the `t.*` helper reference (it moved to llms.txt §7), so agents guessed: `t.state.tasks` → "Cannot read properties of undefined" in 13/55 (lean) and 12/55 (routed) trials vs 2/85 in the control (every task-01 trial in both variants); `t.html()` before the first render (`expected '' to contain`) in 5 and 3. Debug time rose from 1.5 to ~4 s per trial.
- Agents followed the routing index (`sed -n` ranges in 39/55 trials), but read `llms.txt` twice as often; learn time did not fall.
- Skill-load is only ~1.2 s in all three; the 4k context saving buys ~8% cost, not wall time.

**Verdict: drop** both variants. **Adapt**: keep the current skill, add the 4 facts that ended the `dist` reads, and delete `references/component-patterns.md` (2 reads in 55 control trials, 0 in the variants). Consider a `t.state` getter (latest state): it is the agents' natural guess and costs no app bytes. Cost: none to adopt the adaptation (≈ +10 lines).

## E7: model sensitivity (Sonnet 5.5)

**Hypothesis.** Diagnostics, strict mode and the skill help a smaller model more; a weaker model makes more of the silent wiring errors Sygnal catches.

**What ran.** `e7-sonnet` (`claude-sonnet-5-5`, branch build + skill), both arms, all tiers; 160 trials. Haiku (`e7-haiku`) was not run.

| | Opus Sygnal | Opus React | Sonnet Sygnal | Sonnet React |
|---|---|---|---|---|
| Pass tier 1 | 40/40 | 30/30 | 40/40 | 30/30 |
| Pass tier 2 | 20/20 | 20/20 | 20/20 | 20/20 |
| Pass tier 3 | 23/25 | 25/25 | 23/25 | 24/25 |
| Wall, 15 shared tasks (s) | 41.6 | 33.2 | 23.4 | 13.8 |
| Gap (Sygnal − React) | +8.4 s (1.25×) | | +9.6 s (1.69×) | |
| Wall by tier 1 / 2 / 3 (s) | 23.8 / 46.3 / 59.2 | 20.2 / 35.6 / 46.8 | 15.2 / 25.1 / 31.9 | 9.7 / 14.7 / 18.1 |
| Cost ratio (Sygnal/React) | 1.78× | | 2.32× | |
| Iterations | 1.61 | 1.57 | 1.69 | 1.05 |
| Failed runs | 0.23 | 0.28 | 0.33 | 0.01 |
| Peak context (k) | 29.0 | 16.6 | 27.3 | 14.3 |
| Kept a test | 85/85 | 51/75 | 70/85 | **0/75** |

**Failures (classified).** Sonnet Sygnal 13-t2 and 13-t5 (7/8): Retry wired canonically (`RETRY: { PARENT: … }` in CoursesPage, `CHILD.select(CoursesPage)` in App) inside a `Switchable`, which drops `PARENT` → *wiring*, root cause **framework** (Switchable bug, see Surprises). Sonnet React 15-t3 (3/7): rewrote the save as a debounce but left the finish/remove toggle broken; ran no tests (none exist, it wrote none) → *other*.

**Evidence.** Sonnet's Sygnal debug episodes are test-tooling mistakes, not app wiring: `next()` after the state already happened (05 ×3, 12), `t.html()` before the first render (10 ×3), JSX in a `.test.js` file (16 ×2), a stale snapshot (16). No SYG-detectable wiring error reached the hidden tests. Sonnet React wrote no tests at all, which explains most of its speed (and the wider ratio): Sonnet Sygnal still kept a test in 70/85 trials because the skill asks.

**Verdict: inconclusive.** The pass rate doesn't separate the arms on Sonnet either (97.6% vs 98.7%), and the only Sygnal failures are one framework bug. The gap ratio is larger on Sonnet mostly because React agents skip tests. Priorities this suggests: fix Switchable (`PARENT`), and make the testing helpers harder to misuse; not more docs. Haiku is the remaining lever for a pass-rate signal. Cost: none.

## E8: introspection tools in the loop (MCP)

**Hypothesis.** On debugging tasks, the sygnal-check MCP server (`check` / `graph` / `explain`) shortens diagnosis.

**What ran.** `e8-mcp` (sygnal-check installed + its MCP server configured; no AGENTS.md), tasks 13, 14, 15; 15 trials, all passed.

| Task | Wall p3-control → e8 (s) | Iterations | Failed runs | Debug (s) | Cost ($) |
|---|---|---|---|---|---|
| 13 | 71.8 (58.9–83.7) → 217.4 (58.1–**774.0**) | 2.4 → 5.6 | 0.6 → 2.2 | 3.0 → 136.1 | 0.413 → 0.665 |
| 13 without t2 | → 78.3 | | | | |
| 14 | 29.0 (24.2–35.9) → 27.8 (25.6–30.3) | 1.0 → 1.4 | 0.0 → 0.2 | 0.0 → 0.8 | 0.238 → 0.252 |
| 15 | 40.5 (36.1–44.8) → 40.4 (39.3–43.0) | 1.2 → 1.6 | 0.2 → 0.4 | 1.2 → 1.7 | 0.294 → 0.310 |
| **Matched** | **47.1 → 95.2** (48.8 without 13-t2) | 1.53 → 2.87 | 0.27 → 0.93 | 1.4 → 46.2 | 0.315 → 0.409 |

**Evidence.**
- MCP calls: 10 in 9/15 trials, all `mcp__sygnal-check__check`; `graph` and `explain` never used. Task 14: `check` at 2 s in 5/5 trials, found SYG104 (the planted bug); debug time didn't change (0 → 0.8 s). Agents also ran the CLI (13/15 trials), since it was installed.
- The 774 s trial (13-t2) is not MCP time: the agent hit the Switchable `PARENT` drop, then spent ~10 minutes on intermittent stale pages after rapid tab switches in `renderComponent` and in jsdom (it reports the original two-tab app shows it too; unverified, worth a look), and finally replaced Switchable with conditional rendering.

**Verdict: drop** the MCP server from agent docs (keep it shipped): unprompted use is shallow (`check` only, which the CLI already gives), and there is no debug-time gain. `t.inspect()` was not exercised. Cost: none.

## E9: testing-norm parity

**Hypothesis.** Part of the gap is the skill's "always write a test" norm, which React agents don't follow.

**What ran.** `e9-add-test` ("Add a test for your change.") and `e9-no-test` ("Don't write new tests…") appended to both arms' prompts, tier 1 (Sygnal 01–08, React 01–05, 08); 70 trials each. Gap = 6 shared tasks.

| Tier-1 gap (6 shared tasks) | React (s) | Sygnal (s) | Gap | Ratio | Kept a test (S / R) |
|---|---|---|---|---|---|
| Control (no instruction) | 20.2 | 23.8 | +3.7 s | 1.18× | 30/30 / 21/30 |
| "Add a test" | 22.2 | 28.8 | +6.6 s | 1.30× | 30/30 / 30/30 |
| "No tests" | 15.4 | 22.3 | +6.9 s | 1.45× | 0/30 / 0/30 |

Per task, wall (min–max), React → Sygnal:

| Task | add-test | no-test |
|---|---|---|
| 01 | 21.5 → 24.8 (19.1–31.3) | 15.0 → 16.0 (15.0–18.8) |
| 02 | 18.1 → 20.9 (19.3–24.4) | 13.9 → 18.2 (17.1–19.8) |
| 03 | 21.4 → 24.8 (20.8–36.6) | 17.2 → 17.9 (17.1–20.0) |
| 04 | 23.1 → 22.8 (21.7–24.8) | 16.0 → 33.8 (20.4–62.6) |
| 05 | 24.9 → 31.0 (26.2–35.0) | 13.8 → 21.3 (18.2–25.6) |
| 08 | 24.3 → **48.5** (42.3–55.1) | 16.6 → 26.8 (17.7–41.5) |

**Evidence.**
- Equalizing the instruction doesn't close the gap; removing tests from both arms widens the ratio (React's fixed cost shrinks more). The tier-1 framework cost is ~3–7 s per task, driven by incidents more than by tests: "add a test" on 08 made Sygnal agents test the extracted child directly (4.6 iterations, empty `t.html()`, JSX in `.test.js`, null targets); "no tests" on 04 hit the stale-context bug (one 62.6 s trial, one failure). Without 08, the add-test gap is +3.1 s; without 04, the no-test gap is +5.8 s.
- Peak context stays +11.5k for Sygnal in both (the skill), and cost ≈2×.
- Sygnal agents honour "no tests" (4/40 wrote a scratch test, 0 kept), so the skill's norm yields to an explicit instruction.

**Verdict: drop the hypothesis.** The testing norm is not a material part of the gap on Opus; no skill change ("make tests conditional on task size" is not supported). What is worth doing: a recipe for testing an extracted child (task 08) and the stale-context fix. Cost: none.

## E11: deterministic test timing (fake timers)

**Hypothesis.** `renderComponent` working under `vi.useFakeTimers()` makes debounce tests fast and deterministic and cuts task 11's verify time.

**What ran.** `e11` (exp/e11-fake-timers: harness waits drive `@sinonjs/fake-timers`; docs + 14 skill lines), tasks 05, 11, 17; 15 trials, all passed.

| Task | Wall p3-control → e11 (s) | Iterations | Failed runs | Verify (s) | Test-authoring (s) | Debug (s) |
|---|---|---|---|---|---|---|
| 05 | 28.7 (25.5–34.1) → 32.9 (27.5–34.7) | 1.2 → 1.8 | 0.2 → 0.8 | 2.2 → 3.1 | 8.7 → 8.4 | 0.6 → 3.3 |
| 11 | 49.2 (41.5–55.9) → 45.9 (41.8–53.3) | 1.0 → 1.4 | 0.0 → 0.4 | **5.5 → 2.0** | 12.0 → 12.9 | 0.0 → 2.4 |
| 17 | 55.7 (54.0–58.1) → 58.3 (50.5–63.0) | 1.2 → 1.2 | 0.0 → 0.0 | 3.6 → 4.0 | 13.9 → 13.2 | 0.0 → 0.0 |
| **Matched** | 44.5 → 45.7 | 1.13 → 1.47 | 0.07 → 0.40 | 3.8 → 3.0 | 11.5 → 11.5 | 0.2 → 1.9 |

**Evidence.**
- Adoption: `vi.useFakeTimers()` + `advanceTimersByTimeAsync` in 5/5 task-11 suites, 0/10 on 05/17 (no timers there; correct). Control: 0/15.
- Task-11 suite duration (vitest "Duration"): control 2.89–4.80 s → e11 0.37–0.40 s.
- No fake-timer hangs. The two "timed out" runs (05-t1, 11-t2) are `next()` called after the state had already happened; the harness error named the fix and both passed on the next run. Under fake timers these fail in milliseconds rather than after 2 s.
- The extra iterations on 05/11 are those test-authoring mistakes, not timer problems.

**Verdict: adopt.** The decision rule asks for a measurable task-11 wall drop: −3.2 s (−6.5%) is within noise, but verify time fell 64% and suites 8–12×, adoption was unprompted and correct, and there were no hangs. It also removes a trap: on the current build, `vi.useFakeTimers()` hangs every harness wait. Cost (tracker): kanban +0 B (UMD +118 B gz), no new API, 1 llms.txt line, SKILL.md +14 lines. The 20-rerun flakiness check is from the prototype (0 flakes), not this run.

---

## Failed trials (all runs)

| Run | Trial | Tests | Category | Cause |
|---|---|---|---|---|
| p3-control | sygnal-16-t4 | 6/7 | other (harness strictness) | Refactor correct; the hidden test greps `Checkout.jsx` for "Place order", which survives in a **code comment** |
| p3-control | sygnal-17-t5 | 7/8 | other (spec) | Network errors show `error.message` ("Failed to fetch") instead of "Lookup failed." |
| e5-lean | sygnal-16-t4 | 6/7 | other (harness strictness) | Same as p3-control 16-t4: "Place order" in a comment in `Checkout.jsx` |
| e9-no-test | sygnal-04-t3 | 2/4 | other (**framework**) | `.context` reading the `calculated` total lags one update in Collection items: "(68%)" instead of "(56%)" after +; no test written (as instructed) to catch it |
| e7-sonnet | sygnal-13-t2 | 7/8 | wiring (**framework**) | Retry via `PARENT` + `CHILD.select(CoursesPage)` inside `Switchable`; Switchable doesn't forward `PARENT` |
| e7-sonnet | sygnal-13-t5 | 7/8 | wiring (**framework**) | Same as 13-t2 |
| e7-sonnet | react-15-t3 | 3/7 | other | Fixed the save debounce but not the finish/remove toggle; no tests run |
| e2, e1-check, e1-pretest, e4, e5-routed, e8-mcp, e9-add-test, e11, p3-control-react | — | — | — | no failures |

**Regression check vs the 5.4.0 baseline (85/85).** Neither p3-control failure is a branch regression: 16-t4 is a test that matches a comment (it recurs with a different skill in e5-lean 16-t4), and 17-t5 is a spec misread. Both bugs behind the framework failures (Switchable `PARENT`, stale context from `calculated`) are in code PLAN-2 didn't change, so they exist in 5.4.0 too; the 5.4.0 runs just didn't hit them in a scored test. Suggest: make the 16 hidden test ignore comments, and log both framework bugs (G-items).

## Method notes

- **Posture differs from v2-baseline.** Phase 3 runs use the 3-H isolated posture (`--setting-sources project,local`, skill via `--add-dir`); v2-baseline used the installed-skill posture (user settings loaded). Isolation removes ~8k tokens of context in both arms: React peak context 25.1k → 16.6k with wall 34.1 → 33.2 s (−0.9 s); Sygnal 36.3k → 28.5k with wall 44.9 → 38.9 s (17 tasks). Compare Phase 3 runs only with `p3-control` / `p3-control-react`, never with v2-baseline. The Sygnal − React gap is +8.4 s (1.25×) in the Phase 3 controls vs +14.3 s (1.42×) in v2-baseline; part of that is the Phase 1–2 work and part the posture, and they can't be separated without a `baseline-5.4.0` run in the isolated posture.
- **sygnal-check is missing from the eval starters** (see E1), so every Sygnal run except e1-*/e8 includes ≈2 s/trial of a failed `npx sygnal-check`.
- Comparisons: `analysis/compare.mjs` (task-matched); spread, phases and per-trial evidence from `results/analysis/<run>.json` and the transcripts in `/private/tmp/sygnal-evals/trials/<run>/`. Phase times are the analyzer's attribution (`phases`), "failed runs" are failed build/test commands not caused by the harness.
- Each experiment ran once against one control run: run-to-run drift is visible (control vs e9 React differ by 2 s on tier 1), so treat single-run differences under ~5 s as noise.
- Not measured here: E4's 10× rerun flakiness of the agents' suites, E11's 20× reruns (prototype data only), Haiku (E7), E6/E10.
