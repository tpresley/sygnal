# Agent-ergonomics eval harness

This harness measures how well a fresh coding agent writes Sygnal code, with a React comparison arm. It is run twice with the same task set and trial budget: once as the **baseline** before the PLAN-1 framework changes, and once as the **re-run** after them (`dev-plans/PLAN-1.md`, workstreams 0A and 4A).

- `run.md`: the exact per-trial procedure for the coordinator.
- `verify.mjs`: self-check that every hidden suite fails on its starter and passes with its reference solution.

## Layout

```
evals/agent-ergonomics/
  README.md  run.md
  orchestrate.mjs       one command per run: pack, prepare, run headless N at a time, score, analyze (resumable, --dry-run)
  prepare.mjs           copy a starter into a scratch trial dir and npm install it
  run-trial.mjs         run one prepared trial headless with `claude -p` (transcript, wall time, cost, tokens, timeout)
  score.mjs             run hidden tests in a finished trial dir, then append to results/<run>.json
  transcript-stats.mjs  iterations / edit rounds / wall time / peeking audit from a transcript
  verify.mjs            fail-before / pass-after check for every task in both arms
  lib/common.mjs        shared plumbing
  lib/transcript.mjs    command classifiers and transcriptStats() (transcript-stats.mjs, orchestrate.mjs)
  lib/headless.mjs      headless trial posture (claude args, environment), stream-json helpers
  lib/runner.mjs        runTrial(): spawn, stamp, timeout, <dest>.run.json
  lib/plan.mjs          task selection (tiers, ranges), resume plan, cost/time estimate
  lib/variant.mjs       run variants: load/validate a spec, resolve + hash it, materialize it, starter overlays,
                        the per-trial skill isolation flags (orchestrate.mjs --variant)
  lib/limits.mjs        usage/rate-limit detection and the backoff schedule
  lib/pool.mjs          the orchestrator's worker pool, with usage-limit pauses and a clean stop
  variants/<name>.json  one spec per experiment arm (baseline-5.4.0, branch, e1-*, e5-*, e7-*, e8-*, e9-*)
  analysis/compare.mjs  task-matched comparison of two runs, also across arms (analysis/lib/matched.mjs)
  tests/                node:test unit tests for the harness (node --test evals/agent-ergonomics/tests/*.unit.mjs),
                        and fake-claude.mjs, a stand-in CLI for testing the pipeline without API calls
  tasks/NN-slug/        Sygnal arm: PROMPT.md + starter/ (what the agent gets)
  hidden/_support/      Sygnal arm: vitest config + DOM helpers for hidden tests
  hidden/NN-slug/       Sygnal arm: *.hidden.jsx acceptance tests + solution/ overlay
                        (+ mutants/<name>/ overlays on the solution that must fail; tier 3)
  react/package.json    canonical React-arm dependency set
  react/tasks/NN-slug/  React arm: PROMPT.md + starter/
  react/hidden/...      React arm: same layout as hidden/
  results/<run>.json    one record per scored trial
```

## Tasks

| # | Task | What it exercises | Arms |
|---|---|---|---|
| 01 | `clear-completed` | add a button + action + reducer | Sygnal, React |
| 02 | `collection-pin` | child → parent communication through a Collection (pin a task; header shows it) | Sygnal, React |
| 03 | `events-status` | cross-component communication between siblings with separate state (editor → status bar), via EVENTS | Sygnal, React |
| 04 | `derived-total` | derived values: cart total plus each line's share, kept current as child items change (context / calculated) | Sygnal, React |
| 05 | `driver-quote` | async side effect with loading and error states (custom driver around `fetch`) | Sygnal, React |
| 06 | `fix-add-button` | fix a seeded wiring bug: intent selector `.add-todo-button` vs view class `add-todo-btn` | Sygnal |
| 07 | `fix-remove-button` | fix a seeded isolation bug: the parent does `DOM.select('.remove')` for a button rendered inside a Collection item | Sygnal |
| 08 | `extract-rating` | refactor: extract a reusable `StarRating` that takes a value and reports picks to its parent (PARENT/CHILD) | Sygnal, React |
| **Tier 2** | | | |
| 09 | `board-moves` | nested collections (a board of lists, each a Collection of cards): "Previous list" / "Next list" moves, per-list counts and a board total. Card → List → Board communication, cross-list moves that must keep card state, bounds at the first/last list, emptying and refilling a list | Sygnal, React |
| 10 | `signup-wizard` | two-step signup with separate step components: blur/submit-gated validation messages that then track the value live, Back/Next keeping values and the chosen plan across unmount/remount, a final summary | Sygnal, React |
| 11 | `search-debounce` | search-as-you-type against `GET /api/search`: 300 ms debounce, "Searching…" / results / "No results" / "Search failed.", stale responses (success or failure) never overwrite newer ones, clearing cancels everything without a request | Sygnal, React |
| 12 | `selection-panel` | cross-cutting feature in a mid-size app (5 components, rows 3 levels deep in nested collections): a selected task highlighted in its row and shown in a sibling details panel that stays in sync with toggles, cleared by a document-level Escape and by deleting the selected task | Sygnal, React |
| **Tier 3** | | | |
| 13 | `course-portal` | multi-file feature: a third routed page (tabs + Switchable) whose course list loads through a driver on first visit only, a Collection of courses with Enroll/Leave/Full and seat counts, a header count on every page and the enrolled titles on the Profile page; a response that arrives after the user left the page must still be used, Retry after a failure | Sygnal, React |
| 14 | `fix-support-inbox` | debugging, two planted wiring bugs reported as symptoms: an activity-log type mismatch across files (the emitter imports a legacy constant from `events.js`), and an "Assign to me" click handled two component levels above the button that renders it (Sygnal: a parent `DOM.select` for a Collection item's button inside a child; React: a callback prop renamed between the levels) | Sygnal, React |
| 15 | `fix-reading-list` | debugging, two planted state bugs: rows whose edits don't reach the real list since it was sorted (Sygnal: Collection `from` a calculated field; React: index-based handlers on the sorted copy), and a stale closure in the save throttle that drops the last changes of a burst from `localStorage` (checked by reloading the app) | Sygnal, React |
| 16 | `split-checkout` | large refactor: split a ~250-line checkout into `CartTable`, `ShippingForm` and `OrderSummary` that talk only through the parent, with byte-identical normalized markup at six checkpoints (initial, edited, errors, live errors, empty cart, confirmation) and unchanged behavior | Sygnal, React |
| 17 | `address-lookup` | form + async: ZIP lookup on every complete 5-digit ZIP, latest response only (a stale success or failure must not fill the city, touch the checkbox, show a message or move focus), and real DOM form state: the City input's `value`, the Express checkbox's `checked`/`disabled`, and focus moved to City on a current failure | Sygnal, React |

**Tier 2 (tasks 09–12)** exists because the baseline saturated: all 70 tier-1 trials passed, so pass rate could not discriminate (`results/BASELINE.md`, decision D16). Tier-2 tasks are built so that a capable agent can genuinely get them wrong through realistic multi-component wiring and state reasoning: each suite has 7–8 tests, covering the main behavior and the edge cases where wiring mistakes show (the bounds of a move, a stale response arriving after a newer one, Escape with nothing selected, deleting a non-selected item, values surviving a step change). The difficulty is not meant to come from trick wording or from known framework bugs: where a tier-2 behavior ran into a framework bug while the tasks were built, the task or the assertion was shaped to not depend on it (see "Known framework issues" 5–7). Tier-2 prompts are more precise about markup (the class names, input names and texts the tests use), and their starters are larger (three to five components with existing features to keep working).

**Tier 3 (tasks 13–17)** exists because tiers 1 and 2 also saturated (100% pass in both arms at the end of PLAN-1; PLAN-2 workstream 0-C). It aims at a first-attempt pass rate of roughly 60–80% for a strong model. Each task combines several places where a plausible solution goes wrong without any visible error: state that must outlive a routed page, a reply that arrives after its page unmounted, a link two components apart, a calculated or derived list that silently drops edits, a timer that closes over old data, markup that must survive a split exactly, and stale async replies that must also not move focus. The debugging tasks (14, 15) describe only symptoms, as a user would; each plants two independent bugs, and the React arm plants framework-idiomatic bugs with the same symptoms, so the prompts and hidden tests stay identical. Every tier-3 task also ships **mutants** (`hidden/<task>/mutants/<name>/`, an overlay on top of the reference solution): plausible but wrong solutions that `verify.mjs` requires the hidden suite to fail. Tier-3 suites assert real DOM properties (`value`, `checked`, `disabled`, `document.activeElement`), and task 16 compares a normalized serialization of the whole page (tags, sorted attributes, live input/button properties, merged text) against snapshots taken from the original single-component app; the two arms' starters render identical normalized markup.

Prompts are written the way a user would ask. They describe behavior and visible text, never Sygnal mechanics or pitfalls. Where both arms have a task, the `PROMPT.md` files are identical and the hidden test files are byte-identical (`verify.mjs` checks this). Only the harness in `_support/dom.js` differs.

Tier-1 starters are deliberately small (one to three components), so agents spend their effort on the task, not on reading.

## Methodology

**Unit of measurement.** A trial is one fresh agent, one task, and one arm. The agent gets only the task prompt, the path to a scratch copy of the starter, and (Sygnal arm) an instruction to use the `sygnal-dev` skill. It may build, run, and write its own tests. When it stops, the hidden acceptance tests are copied in and run. A trial passes only if every hidden test passes.

**Hidden tests drive real behavior.** The Sygnal hidden tests mount the app the way the browser does: they create `<div id="root">` in jsdom and import `src/main.js`, so `run(App, drivers)` executes with whatever drivers the agent registered. Tests then dispatch real DOM events (click, input, change) and assert on rendered text. So every layer is exercised: view → DOM driver → **intent** (selectors, isolation scopes) → model → state → view. That matters because wiring and isolation bugs live in the intent layer, which `simulateAction` would bypass. The tests use only public behavior (DOM and text) and no Sygnal internals or test utilities, so the same suite stays valid across the framework refactor between baseline and re-run. Elements are found by visible text and roles (button labels, row text), not by class names the agent might rename. The exceptions are the `filled` class in task 08 and the `StarRating.jsx` file name, both of which the prompt requires, and the markup that the tier-2 prompts spell out (for example `section.list` / `.card` / `.title` in 09, `input[name="email"]` in 10, `ul.results` in 11, `.task-row` / `.task-title` / `aside.details` and the `selected` class in 12). Interaction helpers (`click`, `typeInto`, `setChecked`, `blur`, `pressKey`) pause 50 ms after each action, like a human would. (Without that pause, two latent Sygnal issues show up when events fire in the same tick; see "Known framework issues" below.) `blur(el)` focuses the field and then calls `el.blur()`, so jsdom fires real `blur` and `focusout` events; `typeInto` also focuses its field first, so moving on to the next field blurs the previous one, as in a browser. `pressKey(key, target)` dispatches bubbling `keydown`/`keyup` on the target (default: the focused element, else `<body>`). Task 11 uses real timers with the real 300 ms debounce (assertions leave at least 100 ms of margin) rather than fake timers, because fake timers would also freeze the frameworks' own scheduling and the helpers' pauses.

The React hidden tests are the same files. Their `_support/dom.js` renders `src/App.jsx` with `@testing-library/react` and fires events through RTL, so controlled inputs behave.

**Fail-before / pass-after.** Every hidden suite fails on its unmodified starter and passes with its reference solution (`hidden/<task>/solution/`, an overlay of changed files). `verify.mjs` checks both for all 32 task/arm pairs (17 Sygnal, 15 React; it picks up every `NN-slug` task dir automatically), and that the hidden suite fails on every mutant a task ships. `--reruns 5` repeats every suite to catch flakiness. Rerun it whenever a task, a test, or the framework changes. In particular, run it against the Phase 3 build before the re-run: if a reference solution stops passing because of an intended API change, update the solution, not the test.

**Pinned build.** The Sygnal arm installs Sygnal from an `npm pack` tarball of the checkout under test, vendored into the trial as `vendor/sygnal.tgz` (`"sygnal": "file:vendor/sygnal.tgz"`). This is the same build an npm user would get. It is a copy, not a symlink, so `node_modules/sygnal` does not lead back to the repo. Build and pack once per run, so all trials use the same build.

**Same budget, same tasks.** The baseline and the re-run use the same tasks, trial count, model, and spawning method. Report confidence honestly: with 1–3 trials per cell, results are directional.

## Threat model for hidden tests

Goal: the agent under test must not read the acceptance tests or the reference solutions, and must not tailor its work to them.

| Vector | Mitigation |
|---|---|
| Hidden tests inside the task dir | They live in `hidden/`, outside `tasks/`. `prepare.mjs` copies only `starter/`. |
| Trial dir inside the repo (agent wanders up to `evals/`) | `prepare.mjs` refuses a `--dest` inside the repo. Use `/tmp/...`. |
| `node_modules/sygnal` symlinked to the repo (a `file:..` dependency) | Sygnal is installed from a vendored tarball copy. The leak check rejects symlinks and any mention of the repo path. |
| The agent's cwd is the repo (the Agent tool inherits the coordinator's cwd) | The prompt points the agent at the trial dir. `transcript-stats.mjs` audits every tool call for `evals/agent-ergonomics`, `/hidden/`, `__hidden__` and `*.hidden.*` (ignoring mentions of the trial dir itself, which may live under some `.../evals/...`), and for file access outside the trial dir. A trial with a hit is invalid and rerun. For stronger isolation, run trials headless from the trial dir (run.md step 2). |
| Agent tunes to the test runner (for example, edits `vite.config.js` to break tests) | The hidden suite runs with its own `__hidden__/vitest.config.mjs` and ignores the agent's config. It is copied in only after the agent finishes. |
| Hidden tests leaking into the repo's own test run | Hidden test files are named `*.hidden.jsx`, which the root vitest default include (`**/*.{test,spec}.*`) never matches. Starters contain no test files. |
| Prompt wording that hints at the answer | Prompts describe the behavior only. The task category and the seeded bug's nature are never stated. |

Not defended against: an agent that deliberately searches the whole filesystem (for example `find / -name '*.hidden.*'`). The audit would flag it.

## How to run

See `run.md` for the full procedure. With harness v2, a whole run is one command:

```bash
node evals/agent-ergonomics/orchestrate.mjs --run v2-baseline --tasks all --trials 5 --concurrency 4 --model claude-opus-5-5 --dry-run --preflight   # plan + estimate
node evals/agent-ergonomics/orchestrate.mjs --run v2-baseline --tasks all --trials 5 --concurrency 4 --model claude-opus-5-5             # run / resume
```

**Experiments run as variants** (PLAN-2 Phase 3; run.md "Variants"): `--variant <name>` takes `variants/<name>.json`, which sets the Sygnal build (`branch`, a tarball, or `npm` `sygnal@5.4.0`), the `sygnal-dev` skill (a repo dir or a git ref, copied into the run and loaded per trial with `--setting-sources project,local --add-dir`, so `~/.claude` is never touched), a starter overlay (files, `package.json` merge, vendored packages such as `sygnal-check`), a prompt prefix/suffix, MCP servers, and model/effort. Each record carries the variant name and the hash of its resolved spec; a run won't resume under a different one.

```bash
node evals/agent-ergonomics/orchestrate.mjs --run e1-control --variant branch   --arms sygnal --tasks tier1,14,15 --trials 5
node evals/agent-ergonomics/orchestrate.mjs --run e1-check   --variant e1-check --arms sygnal --tasks tier1,14,15 --trials 5
node evals/agent-ergonomics/analysis/compare.mjs --base e1-control --next e1-check              # task-matched
node evals/agent-ergonomics/analysis/compare.mjs --base v2-baseline:react --next e1-check:sygnal  # the gap, across runs
```

A usage or rate limit during a run pauses all trials and retries (`--limit-backoff`, `--limit-retries`, `--limit-max-wait`); if it persists, the run stops cleanly and prints the command that resumes it.

The steps it automates, by hand:

```bash
npm run build && npm pack --pack-destination /tmp/sygnal-evals          # once per run
node evals/agent-ergonomics/verify.mjs --tarball /tmp/sygnal-evals/sygnal-*.tgz
node evals/agent-ergonomics/prepare.mjs --arm sygnal --task 03 --tarball <tgz> --dest /tmp/sygnal-evals/trials/baseline/sygnal-03-t1
node evals/agent-ergonomics/run-trial.mjs --dest /tmp/sygnal-evals/trials/baseline/sygnal-03-t1 --model claude-opus-5-5   # headless; or a fresh subagent with <dest>.prompt.txt
node evals/agent-ergonomics/transcript-stats.mjs <transcript.jsonl> --dir <dest>
node evals/agent-ergonomics/score.mjs --dir <dest> --task 03 --arm sygnal --trial 1 --run baseline \
  --iterations 4 --edit-rounds 2 --wall-seconds 210
node evals/agent-ergonomics/score.mjs --classify --run baseline --task 03 --arm sygnal --trial 1 --category wiring   # failures only
```

`verify.mjs` options: `--arm sygnal|react|both`, `--task 03`, `--reruns <n>`, `--work <dir>` (default `$TMPDIR/sygnal-evals-verify`, must be outside the repo), `--tarball <tgz>` (else it packs the repo, building first if `dist/` is missing), `--build`, `--verbose`. It needs network access for `npm install` the first time. Set `SYGNAL_EVAL_REPO_ROOT` to measure a different checkout than the one containing the harness.

## Scoring and metrics

Each record in `results/<run>.json`:

```json
{ "task": "03-events-status", "arm": "sygnal", "trial": 1,
  "pass": false, "testsPassed": 1, "testsTotal": 3,
  "iterations": 4, "editRounds": 2, "wallSeconds": 210,
  "durationMs": 209500, "tokens": 1840000, "outputTokens": 9100, "costUsd": 1.23,
  "model": "claude-opus-5-5", "method": "headless",
  "variant": "e1-check", "variantHash": "32cdb33d3dd2",
  "failureCategory": "wiring",
  "failures": [{ "test": "...", "message": "..." }],
  "notes": "...", "scoredAt": "..." }
```

| Metric | Meaning |
|---|---|
| `pass` | all hidden tests passed. **First-attempt pass rate** = the share of trials with `pass: true`. Each trial is one attempt: the agent gets no feedback from the hidden tests. |
| `testsPassed` / `testsTotal` | partial credit. Useful for spotting near-misses, but `pass` is the headline. |
| `iterations` | how many times the agent ran the app or its tests: Bash calls that run `npm test` or `npm run build/test/dev/preview` (including `npm --prefix X test` and `cd X && npm test` chains, and the pnpm/yarn equivalents), `npx vite/vitest`, `vite`, `vitest`, `node_modules/.bin/vite(st)` or `node .../vitest.mjs`. A Bash call counts once even if it runs several of these; here-document bodies are ignored. A proxy for how much trial-and-error the framework forced. The classifier is `lib/transcript.mjs`; its unit tests run with `node --test evals/agent-ergonomics/tests/transcript.unit.mjs`. (Before G-017 was fixed, `npm --prefix X test`, the most common form, was not counted, so the baseline's recorded iterations are too low; recompute them from the transcripts before comparing.) |
| `editRounds` | groups of consecutive file edits not separated by a build/test run ("edit, edit, test, edit, test" = 2). A proxy for how many fix-and-check cycles were needed. Edits include Bash calls that write project files (heredoc / redirect / tee, `sed -i`, `perl -i`, python/node scripts, patches); a Bash call that edits and runs the tests counts as an edit and an iteration, and its writing time is split between implement and test-authoring by the text written to each file. Before PLAN-2 0-B fix2 such calls counted only as iterations, so older analyses undercount edit rounds (re-analyzing `phase3`: Sygnal 1.2 → 2.3, React 1.0 → 2.0 per trial; iterations unchanged). |
| `wallSeconds` | wall-clock time of the agent run, from the Agent tool result or from transcript timestamps. Noisy, so treat it as context only. |
| `durationMs` / `tokens` / `outputTokens` / `costUsd` | usage of the agent run (`score.mjs --duration-ms --tokens --output-tokens --cost-usd`). Headless trials take them from the run's final `result` event: `tokens` is every billed token (input + output + cache read + cache creation, over all turns), so it is far larger than the context size. `null` for PLAN-1 runs. |
| `model` / `method` | the model id the trial ran on, and `headless` or `subagent`. |
| `variant` / `variantHash` | the run variant (`orchestrate.mjs --variant`) and the 12-hex hash of its resolved spec (skill and overlay content, build, prompt, MCP, model, effort); absent for runs without a variant. |
| `failureCategory` | the root cause of a failed trial (`wiring`, `isolation`, `reducer-shape`, `stream-operator`, `other`), or `none` for a pass. A human or the coordinator sets it with `--category` / `--classify`; definitions are in run.md step 5. Automatic classification is a TODO in `score.mjs`. |

`transcript-stats.mjs` computes `iterations`, `editRounds` and `wallSeconds` from the agent's JSONL transcript, so the counts are applied the same way in both runs.

The report (PLAN-1 §7) compares, per arm and per task: first-attempt pass rate, mean iterations, mean edit rounds, and failure-category distribution, for baseline vs. re-run vs. React.

## Friction analyzer (`analysis/`)

Explains *where* the time goes, from the stored transcripts and final trial code (no new trials):

```bash
node evals/agent-ergonomics/analysis/analyze.mjs --run baseline        # map: results/transcripts/baseline.tsv
node evals/agent-ergonomics/analysis/analyze.mjs --run baseline-t2
node evals/agent-ergonomics/analysis/compare.mjs --base baseline --next phase3 --out /tmp/diff.md
node --test evals/agent-ergonomics/analysis/tests/*.unit.mjs
```

`compare.mjs` is task-matched (G-119): it compares only the (arm, task) cells both runs have, reports per-task deltas and the matched mean (every shared task weighs the same), and lists the tasks only one side has. `run:arm` pins an arm per side, for cross-arm comparisons (`--base v2-baseline:react --next v2-baseline:sygnal` is the gap on shared tasks). `--arms`, `--tasks`, `--metrics`, `--source`, `--json`; `--full` adds the old whole-run aggregate diff, labeled as unmatched. Details in run.md "Comparing runs".

`analyze.mjs` writes `results/analysis/<run>.json` (one record per trial plus aggregates) and `<run>.md` (the report). Per trial: tokens (peak context and cache tokens; transcript output tokens are partial), tool calls, wall time split into phases (orient, learn, implement, test-authoring, verify, debug, tooling-friction, think, report), failure episodes from a failed build/test run to the next green one, matched against `analysis/catalog.mjs` (regex signatures mapped to tracker IDs, e.g. B-007), skill sections and library files read, line diff vs the starter, canonical-form counts, `sygnal-check` diagnostics (run `npm install` in `sygnal-check/` first, or pass `--no-check`) and the agent's own complaints. The report ranks what explains the Sygnal−React delta on the shared tasks and ends with evidence-backed recommendations. Each recommendation has a precondition (`analysis/lib/preconditions.mjs`, PLAN-2 F6) checked against the installed skill, `llms.txt` (`--llms`) and the PLAN-1/PLAN-2 trackers: one that is already done is listed as suppressed with the reason, and one whose change is in place but whose problem persists is rewritten to say what is left. Headless runs (map source `headless`, or no map: `<trials-root>/<run>/*.transcript.jsonl` are found automatically) also report cost, billed tokens, output tokens and duration per arm and task. Iterations and edit rounds use `lib/transcript.mjs`, so they match `transcript-stats.mjs`. Transcript and trial-dir locations default to this machine's eval session; override with `--transcripts`, `--trials-root`, `--skill-dir` (or `EVAL_TRANSCRIPTS` / `EVAL_SCRATCH`). Heuristics and their limits are listed at the end of each report.

## Known framework issues surfaced while building the tasks

These are recorded because they affect what agents hit, and they are candidates for PLAN-1 diagnostics:

1. **Stale state in non-STATE sinks within one tick.** With `SAVE: { STATE: s => ({...s, saved: s.draft}), EVENTS: s => ({ type, data: count(s.draft) }) }`, if an `input` event (EDIT action) and a `click` (SAVE) fire in the same tick, the STATE reducer sees the new draft but the EVENTS reducer sees the previous state (`draft: ''`). Reproduced with task 03's reference solution.
2. **Controlled input not cleared when actions arrive in the same tick.** With `<input value={state.draft}>`, typing and clicking Add in the same tick leaves the typed text in the DOM even though `state.draft` is `''`. The intermediate render is coalesced, so snabbdom diffs `'' → ''` and never writes the DOM value. Reproduced with task 06's reference solution.
3. **`driverFromAsync` swallows rejections.** A rejected promise (for example the skill's `if (!response.ok) throw ...` example) is only `console.error`ed; nothing reaches the app, so a UI stays in "loading" forever. Task 05's error cases depend on this. Also, a promise that resolves to `null` or `undefined` throws inside the driver (`innerVal.then` on null) and is likewise only logged.
4. **Docs gap: props in sub-components.** `skills/sygnal-dev` never shows how a child reads props passed by its parent (they are spread into the view's first argument, and the 4th reducer argument is `props`). The docs site covers it (`docs/.../guide/components.md`); the skill does not. Task 08's natural solution needs it.
5. **A Collection doesn't re-render when its items are only reordered.** Swapping two items of the array a `<Collection>` renders (same items, new order) updates the state but leaves the DOM in the old order until some item's own state changes. Cause: `pickCombine` (`src/cycle/state/pickCombine.ts`) only re-emits the combined vnode array when an item is added or removed or an item's sink emits; a pure reorder does neither. This is why task 09 moves cards *between* lists (add + remove) and has no Up/Down within a list.
6. **Patching an element with a single text child into one with several children keeps the old text.** `{sel ? <p>Status: {s}</p> : <p>Select a task.</p>}` renders "Select a task.Status: Open" after the switch. Cause: the JSX pragma (`src/pragma/index.ts`) gives a single-text element both `text` and a non-array `children` (one text vnode); snabbdom's `updateChildren` then runs on an `oldCh` without `length` and only appends. Going the other way (several children → one text) works. Task 12's details panel naturally hits this, so its tests check that no element holds exactly the placeholder text instead of "the panel doesn't contain the placeholder"; the reference solution uses one template-string child per line.
7. **A removed `className` stays on a reused element.** When snabbdom reuses an element whose new vnode has no `className` (for example `<p className="placeholder">` → `<p>`), the old class stays, because `className` goes through the props module, which never unsets removed props. Changing it to another class works. No tier-2 test depends on it.
8. **A Collection inside a sub-component ignores a change of its `filter` prop.** `<Collection from="tickets" filter={state.showClosed ? undefined : isOpen} />` re-filters when it is in the root component's view, but when it is in a child component's view (with or without a `state=` slice) toggling the filter changes nothing until some item's own state changes. Found while building task 14, whose "Show closed" toggle was replaced by "Release my tickets" so that no tier-3 test depends on it.
9. **A Collection `from` a calculated field is read-only.** Item edits (and an item returning `undefined` to remove itself) are discarded with runtime warning SYG409; `sygnal-check` (static, also `--strict`) does not flag it. Task 15 plants this bug on purpose; the runtime warning is the intended clue.
