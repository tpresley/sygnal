# PLAN-2: Agent Ergonomics, Round 2

**Goal:** close the rest of the Sygnal↔React efficiency gap for AI agents, clear the correctness backlog PLAN-1 left behind, and run the experiments that tell us what to build next. As in PLAN-1, the MVI architecture, pure reducers, drivers and the rule against event binding in the view stay as they are (PLAN-1 D1, and the element-bound-triggers rejection in PLAN-1 §0).

**Starting point (end of PLAN-1, 5.4.0 release prep, PR tpresley/sygnal#11):**

| | Sygnal | React | Gap |
|---|---|---|---|
| Tier 1 (8 tasks) | 50.3 s, 3.2 iterations | 39.2 s, 2.8 iterations | 15.8 s |
| Tier 2 (4 tasks) | 78.5 s, 2.4 iterations | 63.2 s, 2.5 iterations | 15.4 s |

Pass rate is 100% in both arms and both tiers, so it is saturated and can't show improvement.

The largest per-task gaps left are task **11** search-debounce (84 vs 49 s), task **08** extract-component (80 vs 39 s) and task **10** signup-wizard (86 vs 69 s). Sources: `evals/agent-ergonomics/results/REPORT.md` and `analysis/compare-t1.md` / `compare-t2b.md`.

**Inputs:**
- `dev-plans/PLAN-1-status.md`: open B-/G- items and "PLAN-2 candidate" entries.
- `evals/agent-ergonomics/results/`: analyses of the `phase3`, `phase3-t2` and `phase3b-t2` runs.
- Coordinator review of the 80 Phase 4 trial transcripts and final code (findings F1–F8 below).

**Non-goals:** new rendering engine features unrelated to agent use; replacing xstream; changing the eval's acceptance tests mid-plan (a new tier is allowed, but existing tiers stay fixed so results compare).

---

## 0. New findings (not in the PLAN-1 tracker)

Each finding is backed by trial evidence and feeds an experiment (E-) or a workstream below. Counts come from the final code in the `phase3`, `phase3-t2` and `phase3b-t2` trial dirs.

| ID | Finding | Evidence | Goes to |
|---|---|---|---|
| F1 | **Agents avoid drivers for async work.** They put `fetch` in an EFFECT or in intent so that `run(App)` and `renderComponent(App)` need no driver wiring. | Task 11: **8 of 10** solutions called `fetch` inside the component. Task 05: 4 of 5 used a driver. Agents said explicitly they did it "so main.js needs no extra driver". "drivers" is the largest Sygnal learn topic (1.2 s/trial on tier 2). | E2 |
| F2 | **Stale-response handling is hand-rolled every time.** Request-id counters plus `ABORT` on mismatch. | **9 of 15** task-05/11 solutions implement it, and the spec requires it on task 11. It's the main extra code on task 11, the largest remaining gap. | E3 |
| F3 | **The mock DOM can't verify real DOM properties,** so agents add a second, jsdom-based suite. | 6 tier-2 trials (task 10 ×5, task 12 ×1) wrote `App.dom.test.js` with `run()` + jsdom, to check radio `checked`, real focus/blur, or "the real form fields". | E4 |
| F4 | **Debounce tests run on real time.** | No task-11 test used fake timers. Every suite waits out the real 300 ms debounce (several times per test). Verify time on task 11 is far above React's. | E11 |
| F5 | **In a multi-sink entry, PARENT and EVENTS see the pre-update state** (the B-003 snapshot semantics). This is correct by design but surprised the 4C implementer, and agents may hit it. | 4C report. | 2-D1 |
| F6 | **The friction analyzer's recommendations are templated.** It still recommends adding a testing section and API facts that SKILL.md already has. | `analysis/phase3*.md` "Recommendations". | 0-B |
| F7 | **The reference file is never read.** `references/component-patterns.md` was opened in **0 of 20** tier-2 trials, and SKILL.md (326 lines) is read whole every time. Sygnal agents carry ~10k more peak context than React agents. | Skill heatmap; peak context 78.3k vs 67.7k. | E5 |
| F8 | **The newer tools are unused.** No trial used `inspect()`, `--graph`, `explain` or the MCP server. All 80 skipped `sygnal-check` because it wasn't installed (G-071; fixed once it's published). | Transcripts and final reports. | E1, E8 |

---

## 1. Coordinator operating model

Same as PLAN-1 §1 (responsibilities, isolation-worktree subagents fast-forwarded to the integration branch, file ownership, gates, subagent brief template, escalation), with these lessons from PLAN-1 written in:

- **Integration branch:** `plan2-integration`, cut from `main` after the 5.4.0 PR merges. Tags `plan2-phaseN`. Tracker: `dev-plans/PLAN-2-status.md`, in the same format as PLAN-1's, created when Phase 0 starts.
- **Worktree guard:** briefs must say to use plain `git -C <abs>` and `npm --prefix <abs>`, with no `cd &&` chains and no shell variables in git or sed commands. Subagents can't merge the integration branch themselves, so the coordinator merges.
- **Fresh-worktree setup:**
  - `npm ci` at the root;
  - `npm ci --prefix browser-tests`;
  - `npm install --prefix sygnal-check`;
  - `npm ci --prefix docs`;
  - `npm ci --prefix create-sygnal-app`;
  - `npm install` in each `examples/*`.
- **Gates for every merge:**
  - `npm run build:all`;
  - `npm test` (library, `test:examples`, types, browser);
  - `npm --prefix sygnal-check test`;
  - `node scripts/check-doc-samples.mjs`;
  - `node scripts/gen-error-docs.mjs --check`;
  - `npm --prefix docs run build`;
  - kanban gzip at or under budget, measured from inside `examples/kanban`.
  - **Size budget:** 41,805 B. Any growth is recorded with its reason. A workstream may propose a re-baseline, but only the user decides one.
- **Agent-facing sync rule:** any API or behaviour change updates `llms.txt` (≤ 250 lines; byte-identical copy in `docs/public`), `skills/sygnal-dev/SKILL.md`, the template `AGENTS.md` files and the docs in the same workstream. After a skill change, the installed skill is re-synced before any eval run (PLAN-1 D35).
- **Experiments:** each E- task has a hypothesis, a prototype on an `exp/*` branch, a measurement and a written **decision record** (adopt / adapt / drop) in the tracker. **Nothing from an experiment merges without the user deciding.** Prototypes may break the size budget; only adopted work has to meet it.

---

## 2. Phase 0: Release follow-through and eval infrastructure

Prerequisite: 5.4.0 is published (user action: RELEASING.md order sygnal-check → sygnal → create-sygnal-app) and PR #11 is merged.

### 0-A: Post-release verification (coordinator)
- Run the RELEASING.md smoke loop against the **published** packages: every template × js/ts, then `npm test`, `npx --no-install sygnal-check [pages] --strict` and `npm run build`.
- Confirm G-068/G-071 are gone: `sygnal-check` resolves locally and there's no E404.
- Housekeeping:
  - add `CHANGELOG.md` to the root `files`;
  - add a `create-sygnal-app/README.md`;
  - remove the stale PLAN-1 worktrees (G-006, user action).

### 0-B: Eval harness v2 (one subagent; owns `evals/agent-ergonomics/**`)
1. **Headless trial runner** (G-030). A script that runs each trial with `claude -p` from inside the trial dir, using the same model and permission mode, and writes `<dest>.transcript.jsonl`. This removes harness-guard noise: 8–17 s per trial in both arms, about 24% of React's wall time. `transcript-stats` and `analyze` must read headless transcripts.
2. **Fresh React arm.** Re-run the React baseline with the new runner, so both arms share a method and date (this removes the D37 confound).
3. **Fresh Sygnal reference run**, all 12 tasks × 5 on 5.4.0 with the new runner. This becomes the new `v2-baseline`. The PLAN-1 numbers are not compared directly against it, because the method changed.
4. **Record usage in results.** `score.mjs` takes `--tokens` and `--duration-ms`, the analyzer reports them, and `run.md` step 4 is updated.
5. **Data-driven recommendations (F6).** The analyzer checks each recommendation's precondition against the installed skill/llms.txt and the catalog's tracker status, and suppresses or rewrites recommendations that are already done. Add tests.
6. **Model parameter.** Trials can run with a chosen model, for E7.
7. **Parallel trial orchestration.** One command prepares, runs N at a time, scores and analyzes, which replaces the coordinator's manual waves.

**Gate:**
- The harness self-test (`verify.mjs`) passes.
- The headless runner reproduces a PLAN-1 trial's pass/fail.
- The React re-run's pass rate is 100%.

### 0-C: Tier 3, discriminating tasks (one subagent; owns `evals/agent-ergonomics/tasks/13-*`…, `hidden/13-*`…, `react/…`)
Tiers 1 and 2 can't show pass-rate change. Add 4–6 tasks in both arms, sized so a strong model's first-attempt pass rate is about 60–80%:
- a **multi-file feature** in a medium app (routing with `Switchable` plus a Collection inside a routed page plus a driver);
- **debugging** tasks with non-obvious wiring bugs: an EVENTS type mismatch across files, a wrong Collection `from` after a state-shape change, an isolation trap two levels deep, a stale-closure bug in an EFFECT;
- a **large refactor**: split a 300-line component into three that communicate via PARENT/EVENTS while keeping exact markup;
- a **form + async** task that combines F2 and F3 patterns.

Each task needs a reference solution, hidden tests and a leak check. `verify.mjs` must cover the new tasks. Pilot with 2 trials per arm; adjust difficulty before baselining.

**Phase 0 close:**
- Record `v2-baseline` (all tiers, both arms) in `results/V2-BASELINE.md`.
- Tag `plan2-phase0`.

---

## 3. Phase 1: Correctness backlog (parallel; each item needs a failing-first test)

These are the open items from PLAN-1, re-verified against 5.4.0 before work starts. If an item doesn't reproduce, it's closed as "not reproduced".

### 1-A: Rendering and props (owns `src/pragma/**`, `src/cycle/dom/*Module.ts`)
- **B-014** (verify first): a JSX string `class="a b"` may be iterated character by character by snabbdom's classModule. Normalize the string `class` to the class map.
- **B-015:** snabbdom's propsModule never unsets removed props (`title`, …). Clear removed props, generalizing the B-012 className fix.
- **B-017:** a `<select>` whose options change in the same patch may not take its new controlled value. Run the controlled-value hook after children update.
- **G-033:** SYG111 (sygnal-check) misses `<select value="literal">`.

### 1-B: State and components (owns `src/component.ts`; coordinate with 2-A)
- **B-016:** an isolatedState sub-component that has initialState but no model never applies its initialState.
- **G-027 / G-044:** align codes and severities with actual behaviour. Make SYG218 surface under its own code (not only attached to SYG216), collect SYG420, and decide on "error" codes that only log. Needs a short decision record and then a regenerated `explanations.json` and error page.
- **G-036:** `run(App, drivers, { diagnostics: { strict: true } })`.

### 1-C: Drivers (owns `src/extra/driverFactories.ts`)
- **G-069:** `driverFromAsync` logs "sendFn is not a function" when a reply arrives before any `select()` listener has subscribed. Buffer or drop it cleanly.

### 1-D: Integrations (owns `src/vike/**`, `src/astro/**`, `src/vite/**`)
- **B-020:** linked-dev Vike pre-bundles a second core.
- **G-046:** the `sygnal/config` setting `urlPathname` in `passToClient` logs a Vike warning on every page.
- **G-037 (Vike part):** diagnostics name components "Page__nav0".

### 1-E: Types and build hygiene (owns `src/index.d.ts`, `src/cycle/dom/DocumentDOMSource.ts`, `test/types.test.ts`, `type-tests/**`)
- **B-002 / G-012:** remove the TS2322 build warnings in the DOM source, so new warnings are visible.
- **G-019:** `test/types.test.ts` assertions are never type-checked. Move them into `type-tests/` or enable vitest typecheck.
- **G-007 [USER DECISION]:** (1) whether `event()` should be renamed or aliased, given it collides by convention with the `event` callback parameter. Recommendation: keep `event`, because it's already in 5.4.0 docs and agents use it correctly (5 of 40 tier-1 trials). (2) Reserved view-prop names (`state`, `children`, `slots`, `context`, `peers`): SYG106 warns today. Decide whether strict mode should make it an error.

### 1-F: Examples (owns `examples/todomvc/**`)
- **G-052:** todomvc ids from `Date.now()` can collide, there's a type error in `app.tsx`, and the build doesn't run tsc.
- **G-063:** drop todomvc's custom `waitForHtml`.

**Phase 1 close:**
- Run a review subagent over the phase diff (as in PLAN-1).
- Run a fix workstream if needed.
- Tag `plan2-phase1`.

---

## 4. Phase 2: Known ergonomics improvements (parallel with Phase 3 experiments where file ownership allows)

### 2-A: Testing completeness (owns `src/extra/testing.ts`, testing docs)
- **G-064:** `renderComponent` gives every custom sink in the tree a no-op recording driver, not only the root's, so `sinkValues('API')` works for a child's sink without passing a driver.
- **G-065:** `t.next()` started after `await t.ready()` can miss buffered calls. Make `ready()` return a history cursor that `next()` uses, or document a single pattern and add a diagnostic.
- **G-053:** expose the timing constants (`settleMs`, `eventWaitMs`) as `renderComponent` options. Detect `next()` delays longer than the quiet window.

### 2-B: Agent docs, small and evidence-backed (owns `llms.txt`, `SKILL.md`, docs)
- **2-D1 (F5):** one line plus an example on snapshot semantics. Sinks in one entry all see the state as it was **before** this action; to send derived data, compute it from `(state, data)` inside the sink.
- **2-D2 (task 08):** an "extract a component without changing markup" recipe:
  - props in;
  - `PARENT` out;
  - `CHILD.select(Child)`;
  - a `t.html()` before/after snapshot assertion.

  Task 08 is the slowest tier-1 task (6.8 iterations), because agents invent their own markup-diff approach.
- **2-D3:** document the canonical stale-response pattern, as an interim measure until E3 decides on a helper.

**Phase 2 close:**
- Run a targeted eval (tier 1 tasks 08, plus tier 2 tasks 10–11) with the v2 runner against `v2-baseline`.
- Tag `plan2-phase2`.

---

## 5. Phase 3: Exploration and experiments

Each experiment:
- **Hypothesis**
- **Prototype:** an `exp/*` branch, kept out of the integration branch.
- **Measure:** v2 runner. The default is 5 trials on the named tasks, both arms where relevant.
- **Decision rule**
- **Decision record:** adopt / adapt / drop, plus the cost in bytes and API surface.

Experiments marked **[USER DECISION]** touch API philosophy and need the user's approval before a prototype is merged anywhere.

### E1: `sygnal-check` in the loop
- **Hypothesis:** with sygnal-check installed (templates, from 5.4.0) and the Vite plugin overlay, agents catch wiring bugs before running tests. That cuts iterations on build and debug tasks (06, 07, tier-3 debugging).
- **Method:** two variants of the Sygnal arm, the starter with sygnal-check vs without, on tasks 01–08 plus the tier-3 debug tasks.
- **Measure:** iterations, failed runs, time-to-first-green, and how often agents actually run it.
- **Decide:** if agents don't run it unprompted, test a stronger AGENTS.md instruction, or a `pretest` hook in the templates that runs `sygnal-check --strict`.

### E2: Async side-effect ergonomics (F1) **[USER DECISION]**
- **Hypothesis:** agents put `fetch` in components because drivers cost wiring in `main.js`, `run()` and tests. Lowering that cost brings side effects back to drivers without slowing agents down.
- **Variants to prototype:**
  - (a) `renderComponent`/`run` auto-provide recording no-op drivers for undeclared sinks in tests (extends G-064);
  - (b) a built-in `HTTP`/`fetch` driver factory (`makeFetchDriver()`), with per-request `category` and `errors()`;
  - (c) a component-level `drivers` static, so a component declares the drivers it needs and `run(App)` wires them;
  - (d) accept `fetch` in an EFFECT + `next()` as a sanctioned form: document it, and maybe add a SYG note when used inside `intent`.
- **Measure:** tasks 05 and 11, plus a tier-3 async task.
- **Metrics:** where the side effect lands (driver / EFFECT / intent), lines of code, wall time, test-authoring time.
- **Decide:** whichever variant keeps side effects out of intent at the lowest agent cost. (c) and (d) change the philosophy, so the user decides.

### E3: "Latest only" async (F2)
- **Hypothesis:** a helper removes the hand-rolled request-id pattern, which appears in 9 of 15 solutions and is task 11's main code cost, and closes most of task 11's 35 s gap.
- **Variants:**
  - (a) `driverFromAsync(fn, { latest: true })`, which cancels or ignores superseded requests per category;
  - (b) an xstream operator `latest()` / `switchMap` analogue exported from `sygnal`;
  - (c) an `ABORT`-aware `stale()` guard helper for reducers.
- **Measure:** tasks 05 and 11 (LOC, wall, correctness of the stale and clear-while-in-flight cases), plus the hidden tests.

### E4: Real-DOM test mode (F3)
- **Hypothesis:** agents write a second jsdom suite because the mock can't check `checked`/`value`/focus. A `renderComponent(App, { dom: 'jsdom' })` mode, or `t.mount()` (real snabbdom patch into jsdom, same `t.*` API), removes the duplication.
- **Measure:** tasks 10 and 12: test-authoring and verify time, number of test files, and flakiness (10 reruns of each agent's suite).
- **Decide:** adopt if test-authoring time drops by at least 20% with no flakiness increase.

### E5: Skill size and shape (F7)
- **Hypothesis:** a shorter SKILL.md (~150 lines: workflow, canonical examples, testing recipe, and a pointer to `llms.txt` for API facts) cuts peak context and skill-load time without raising learn or debug time.
- **Variants:** current (326 lines); lean (~150); lean plus a task-routed "recipes" index that names which `llms.txt` section to read.
- **Measure:** all tiers. Metrics: peak context, learn time, `node_modules` reads, iterations.
- Also decide whether `references/component-patterns.md` earns its place, given it was read in 0 of 20 trials. Options: fold its most-needed patterns into llms.txt, or keep it as is.

### E6: Discriminating tier
Covered by **0-C**. This experiment is the analysis: does tier 3 separate the arms on pass rate? Which Sygnal failure categories remain (wiring, isolation, reducer-shape, stream-operator, other)? Feeds the next round of fixes.

### E7: Model sensitivity
- **Hypothesis:** diagnostics, strict mode and the skill help smaller models more than the frontier model; a weaker model makes more of the silent wiring errors that Sygnal now catches.
- **Method:** run tiers 1–3 in both arms with a smaller model (e.g. Sonnet or Haiku class) via the 0-B model parameter.
- **Metrics:** pass rate, failure categories, iterations.
- **Decide:** the results set priorities, e.g. stronger error messages vs more docs.

### E8: Introspection tools in the loop (F8)
- **Hypothesis:** on debugging tasks, the MCP server (`check` / `graph` / `explain`) or `t.inspect()` shortens diagnosis.
- **Method:** tier-3 debugging tasks with the MCP server configured for the trial agent vs not.
- **Metrics:** debug-phase time and whether the tools are used unprompted.
- **Decide:** whether to promote the tools in AGENTS.md/SKILL.md or drop them from agent docs.

### E9: Testing-norm parity
- **Hypothesis:** part of the remaining ~15 s gap is that the skill makes Sygnal agents always write a regression test (task 06: 20 → 38 s after PLAN-1), while React agents often don't.
- **Method:** both arms get the same instruction (with "add a test for your change" vs without) on tasks 01–08.
- **Result:** the true framework cost, separated from the cost of the testing norm. This informs whether the skill should make tests conditional on task size.

### E10: TypeScript variants
- **Hypothesis:** typed links (`ActionsOf`, `SygnalEvents`, typed `CHILD.select`) catch wiring errors at type-check time in TS projects. Today they go unused, because every eval task is JS.
- **Method:** TS variants of 4 tasks (02, 03, 09, 12) and a TS starter template, in both arms.
- **Metrics:** iterations, failure categories, and how many wiring mistakes `tsc` caught first.

### E11: Deterministic test timing (F4)
- **Hypothesis:** `renderComponent` works with `vi.useFakeTimers()`, or offers `t.advance(ms)` on a virtual clock that drives xstream timers (`debounce`, `delay`, `next()` delays). That makes debounce tests deterministic and fast, and cuts task 11's verify time.
- **Prototype:** a scheduler injection point for the exported xstream extras and the `next()` delay, plus `t.advance(ms)`.
- **Measure:** task 11 verify time and suite duration; flakiness over 20 reruns.
- **Decide:** adopt if task-11 wall time drops measurably with no flakiness.

**Phase 3 close:**
- Summarize every decision record in the tracker.
- The user picks which experiments to adopt. Adopted ones become Phase 4 workstreams.
- Tag `plan2-phase3`.

---

## 6. Phase 4: Adopt, measure, release

- **4-A:** implement adopted experiments as normal workstreams: gates, agent-facing sync rule, review subagent.
- **4-B:** full eval with the v2 runner, all tiers, both arms, 5 trials, against `v2-baseline`. Write `REPORT-v2.md` with the same structure as PLAN-1's REPORT.md, plus the tier-3 pass rates and the model-sensitivity table.
- **4-C:** release prep (CHANGELOG, migration notes, RELEASING.md). **[USER DECISION]** on the version: minor if all changes are additive.

---

## 7. Dependency graph

```
Phase 0:  0-A (after publish) ─┐
          0-B harness v2 ──────┼─→ v2-baseline ─────────────────┐
          0-C tier 3 ──────────┘                                │
Phase 1:  1-A ∥ 1-B ∥ 1-C ∥ 1-D ∥ 1-E ∥ 1-F  (independent of 0-B/0-C; can start at once)
Phase 2:  2-A (after 1-B merges; shares component.ts timing) ∥ 2-B
Phase 3:  E1 (needs publish) · E2/E3 (need 2-A for test drivers) · E4/E11 (need 2-A) ·
          E5/E9 (need only 0-B) · E6/E7/E8/E10 (need 0-B + 0-C)          ← all measure against v2-baseline
Phase 4:  4-A (adopted) → 4-B full eval → 4-C release
```

Phase 1 can run alongside 0-B/0-C. Experiments that measure must wait for `v2-baseline`. Prototyping can start earlier.

## 8. Risks

| Risk | Mitigation |
|---|---|
| The method change (headless runner) breaks comparability with PLAN-1 | New `v2-baseline` for both arms; PLAN-1 numbers are cited, never diffed against v2. |
| Experiment prototypes leak into the release | Experiments stay on `exp/*` branches; only user-adopted work merges (§1). |
| E2/E3 grow the API surface or blur the MVI philosophy | **[USER DECISION]** gates; each decision record states bundle and API cost; prefer opt-in helpers. |
| Tier 3 is too hard or too easy | Pilot 2 trials per arm, tune, then freeze before the baseline. |
| Eval cost: the full run is ~200+ trials per baseline with the model variants | 0-B orchestration batches trials; E7 runs on a subset first; the user approves budgets per phase. |
| Fake timers (E11) interact badly with snabbdom/xstream scheduling | Opt-in only; flakiness gate at 20 reruns. |

## 9. Definition of done

- The open B-/G- items carried from PLAN-1 are fixed, closed as not reproduced, or deferred with a reason.
- The v2 harness (headless, both arms fresh, tokens recorded, data-driven recommendations, tier 3) is in place and documented.
- Every experiment E1–E11 has a decision record. Adopted ones are shipped with docs and skill sync.
- `REPORT-v2.md` reports the Sygnal−React gap per tier, tier-3 pass rates and model sensitivity against `v2-baseline`.
- All gates pass and the size budget is met (or the user approved a re-baseline). The release is prepared, and the PR is opened but not merged.
