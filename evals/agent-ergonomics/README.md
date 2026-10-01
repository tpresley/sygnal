# Agent-ergonomics eval harness

This harness measures how well a fresh coding agent writes Sygnal code, with a React comparison arm. It is run twice with the same task set and trial budget: once as the **baseline** before the PLAN-1 framework changes, and once as the **re-run** after them (`dev-plans/PLAN-1.md`, workstreams 0A and 4A).

- `run.md`: the exact per-trial procedure for the coordinator.
- `verify.mjs`: self-check that every hidden suite fails on its starter and passes with its reference solution.

## Layout

```
evals/agent-ergonomics/
  README.md  run.md
  prepare.mjs           copy a starter into a scratch trial dir and npm install it
  score.mjs             run hidden tests in a finished trial dir, then append to results/<run>.json
  transcript-stats.mjs  iterations / edit rounds / wall time / peeking audit from a transcript
  verify.mjs            fail-before / pass-after check for every task in both arms
  lib/common.mjs        shared plumbing
  tasks/NN-slug/        Sygnal arm: PROMPT.md + starter/ (what the agent gets)
  hidden/_support/      Sygnal arm: vitest config + DOM helpers for hidden tests
  hidden/NN-slug/       Sygnal arm: *.hidden.jsx acceptance tests + solution/ overlay
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

Prompts are written the way a user would ask. They describe behavior and visible text, never Sygnal mechanics or pitfalls. Where both arms have a task, the `PROMPT.md` files are identical and the hidden test files are byte-identical (`verify.mjs` checks this). Only the harness in `_support/dom.js` differs.

Starters are deliberately small (one to three components), so agents spend their effort on the task, not on reading.

## Methodology

**Unit of measurement.** A trial is one fresh agent, one task, and one arm. The agent gets only the task prompt, the path to a scratch copy of the starter, and (Sygnal arm) an instruction to use the `sygnal-dev` skill. It may build, run, and write its own tests. When it stops, the hidden acceptance tests are copied in and run. A trial passes only if every hidden test passes.

**Hidden tests drive real behavior.** The Sygnal hidden tests mount the app the way the browser does: they create `<div id="root">` in jsdom and import `src/main.js`, so `run(App, drivers)` executes with whatever drivers the agent registered. Tests then dispatch real DOM events (click, input, change) and assert on rendered text. So every layer is exercised: view → DOM driver → **intent** (selectors, isolation scopes) → model → state → view. That matters because wiring and isolation bugs live in the intent layer, which `simulateAction` would bypass. The tests use only public behavior (DOM and text) and no Sygnal internals or test utilities, so the same suite stays valid across the framework refactor between baseline and re-run. Elements are found by visible text and roles (button labels, row text), not by class names the agent might rename. The exceptions are the `filled` class in task 08 and the `StarRating.jsx` file name, both of which the prompt requires. Interaction helpers pause 50 ms after each action, like a human would. (Without that pause, two latent Sygnal issues show up when events fire in the same tick; see "Known framework issues" below.)

The React hidden tests are the same files. Their `_support/dom.js` renders `src/App.jsx` with `@testing-library/react` and fires events through RTL, so controlled inputs behave.

**Fail-before / pass-after.** Every hidden suite fails on its unmodified starter and passes with its reference solution (`hidden/<task>/solution/`, an overlay of changed files). `verify.mjs` checks both for all 14 task/arm pairs. Rerun it whenever a task, a test, or the framework changes. In particular, run it against the Phase 3 build before the re-run: if a reference solution stops passing because of an intended API change, update the solution, not the test.

**Pinned build.** The Sygnal arm installs Sygnal from an `npm pack` tarball of the checkout under test, vendored into the trial as `vendor/sygnal.tgz` (`"sygnal": "file:vendor/sygnal.tgz"`). This is the same build an npm user would get. It is a copy, not a symlink, so `node_modules/sygnal` does not lead back to the repo. Build and pack once per run, so all trials use the same build.

**Same budget, same tasks.** The baseline and the re-run use the same tasks, trial count, model, and spawning method. Report confidence honestly: with 1–3 trials per cell, results are directional.

## Threat model for hidden tests

Goal: the agent under test must not read the acceptance tests or the reference solutions, and must not tailor its work to them.

| Vector | Mitigation |
|---|---|
| Hidden tests inside the task dir | They live in `hidden/`, outside `tasks/`. `prepare.mjs` copies only `starter/`. |
| Trial dir inside the repo (agent wanders up to `evals/`) | `prepare.mjs` refuses a `--dest` inside the repo. Use `/tmp/...`. |
| `node_modules/sygnal` symlinked to the repo (a `file:..` dependency) | Sygnal is installed from a vendored tarball copy. The leak check rejects symlinks and any mention of the repo path. |
| The agent's cwd is the repo (the Agent tool inherits the coordinator's cwd) | The prompt points the agent at the trial dir. `transcript-stats.mjs` audits every tool call for `evals`, `hidden`, `agent-ergonomics`, `__hidden__`, and for file access outside the trial dir. A trial with a hit is invalid and rerun. For stronger isolation, run trials headless from the trial dir (run.md step 2). |
| Agent tunes to the test runner (for example, edits `vite.config.js` to break tests) | The hidden suite runs with its own `__hidden__/vitest.config.mjs` and ignores the agent's config. It is copied in only after the agent finishes. |
| Hidden tests leaking into the repo's own test run | Hidden test files are named `*.hidden.jsx`, which the root vitest default include (`**/*.{test,spec}.*`) never matches. Starters contain no test files. |
| Prompt wording that hints at the answer | Prompts describe the behavior only. The task category and the seeded bug's nature are never stated. |

Not defended against: an agent that deliberately searches the whole filesystem (for example `find / -name '*.hidden.*'`). The audit would flag it.

## How to run

See `run.md` for the full procedure. In short:

```bash
npm run build && npm pack --pack-destination /tmp/sygnal-evals          # once per run
node evals/agent-ergonomics/verify.mjs --tarball /tmp/sygnal-evals/sygnal-*.tgz
node evals/agent-ergonomics/prepare.mjs --arm sygnal --task 03 --tarball <tgz> --dest /tmp/sygnal-evals/trials/baseline/sygnal-03-t1
#   ... spawn a fresh agent with the contents of <dest>.prompt.txt ...
node evals/agent-ergonomics/transcript-stats.mjs <transcript.jsonl> --dir <dest>
node evals/agent-ergonomics/score.mjs --dir <dest> --task 03 --arm sygnal --trial 1 --run baseline \
  --iterations 4 --edit-rounds 2 --wall-seconds 210
node evals/agent-ergonomics/score.mjs --classify --run baseline --task 03 --arm sygnal --trial 1 --category wiring   # failures only
```

`verify.mjs` options: `--arm sygnal|react|both`, `--task 03`, `--work <dir>` (default `$TMPDIR/sygnal-evals-verify`, must be outside the repo), `--tarball <tgz>` (else it packs the repo, building first if `dist/` is missing), `--build`, `--verbose`. It needs network access for `npm install` the first time. Set `SYGNAL_EVAL_REPO_ROOT` to measure a different checkout than the one containing the harness.

## Scoring and metrics

Each record in `results/<run>.json`:

```json
{ "task": "03-events-status", "arm": "sygnal", "trial": 1,
  "pass": false, "testsPassed": 1, "testsTotal": 3,
  "iterations": 4, "editRounds": 2, "wallSeconds": 210,
  "failureCategory": "wiring",
  "failures": [{ "test": "...", "message": "..." }],
  "notes": "...", "scoredAt": "..." }
```

| Metric | Meaning |
|---|---|
| `pass` | all hidden tests passed. **First-attempt pass rate** = the share of trials with `pass: true`. Each trial is one attempt: the agent gets no feedback from the hidden tests. |
| `testsPassed` / `testsTotal` | partial credit. Useful for spotting near-misses, but `pass` is the headline. |
| `iterations` | how many times the agent ran the app or its tests: Bash calls to `npm run build/test/dev`, `npm test`, `npx vite/vitest`, `vite`, or `vitest`. A proxy for how much trial-and-error the framework forced. |
| `editRounds` | groups of consecutive file edits not separated by a build/test run ("edit, edit, test, edit, test" = 2). A proxy for how many fix-and-check cycles were needed. |
| `wallSeconds` | wall-clock time of the agent run, from the Agent tool result or from transcript timestamps. Noisy, so treat it as context only. |
| `failureCategory` | the root cause of a failed trial (`wiring`, `isolation`, `reducer-shape`, `stream-operator`, `other`), or `none` for a pass. A human or the coordinator sets it with `--category` / `--classify`; definitions are in run.md step 5. Automatic classification is a TODO in `score.mjs`. |

`transcript-stats.mjs` computes `iterations`, `editRounds` and `wallSeconds` from the agent's JSONL transcript, so the counts are applied the same way in both runs.

The report (PLAN-1 §7) compares, per arm and per task: first-attempt pass rate, mean iterations, mean edit rounds, and failure-category distribution, for baseline vs. re-run vs. React.

## Known framework issues surfaced while building the tasks

These are recorded because they affect what agents hit, and they are candidates for PLAN-1 diagnostics:

1. **Stale state in non-STATE sinks within one tick.** With `SAVE: { STATE: s => ({...s, saved: s.draft}), EVENTS: s => ({ type, data: count(s.draft) }) }`, if an `input` event (EDIT action) and a `click` (SAVE) fire in the same tick, the STATE reducer sees the new draft but the EVENTS reducer sees the previous state (`draft: ''`). Reproduced with task 03's reference solution.
2. **Controlled input not cleared when actions arrive in the same tick.** With `<input value={state.draft}>`, typing and clicking Add in the same tick leaves the typed text in the DOM even though `state.draft` is `''`. The intermediate render is coalesced, so snabbdom diffs `'' → ''` and never writes the DOM value. Reproduced with task 06's reference solution.
3. **`driverFromAsync` swallows rejections.** A rejected promise (for example the skill's `if (!response.ok) throw ...` example) is only `console.error`ed; nothing reaches the app, so a UI stays in "loading" forever. Task 05's error cases depend on this. Also, a promise that resolves to `null` or `undefined` throws inside the driver (`innerVal.then` on null) and is likewise only logged.
4. **Docs gap: props in sub-components.** `skills/sygnal-dev` never shows how a child reads props passed by its parent (they are spread into the view's first argument, and the 4th reducer argument is `props`). The docs site covers it (`docs/.../guide/components.md`); the skill does not. Task 08's natural solution needs it.
