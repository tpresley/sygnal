# Running a trial (coordinator procedure)

One **trial** = one fresh agent attempting one task in one arm. Paths below are relative to the repo root (`$REPO`). `$EVAL` is `$REPO/evals/agent-ergonomics`.

## The one-command way (harness v2, PLAN-2 0-B)

`orchestrate.mjs` does steps 0–4 and the analysis for a whole run: it packs Sygnal once, prepares each trial dir, runs the agent **headless** (`claude -p` from inside the trial dir, `run-trial.mjs`), computes the transcript stats, scores with usage, and runs `analysis/analyze.mjs`. It runs N trials at a time and is resumable.

```bash
# See the plan and the estimate first (nothing runs):
node $EVAL/orchestrate.mjs --run v2-baseline --tasks all --trials 5 --concurrency 4 --model claude-opus-5-5 --dry-run --preflight
# Run it (re-run the same command to resume after an interruption):
node $EVAL/orchestrate.mjs --run v2-baseline --tasks all --trials 5 --concurrency 4 --model claude-opus-5-5
# A subset: one arm, tier 2, three trials each
node $EVAL/orchestrate.mjs --run e7-sonnet --arms sygnal --tasks tier2 --trials 3 --model sonnet
```

- `--tasks`: `all`, `tier1` (01–08), `tier2` (09–12), `tier3` (13+), `03`, `01-05`, or a comma list. Tasks come from the task dirs, so new tasks need no code change; a task missing from one arm is skipped for that arm.
- `--model` (default `claude-opus-5-5`) and `--effort` are passed to every trial. **Use full model ids:** the installed CLI resolves aliases itself, and an old CLI maps them to old models (CLI 2.1.90: `opus` → `claude-opus-4-6`). The model each trial actually ran on (from its init/assistant events) is recorded per record (`model`); a trial on a different model than the one meant (an alias's current model, e.g. `opus` → `claude-opus-5-5`) is not scored and stops the run unless `--allow-mixed`. The dry run shows what the alias must resolve to; `--dry-run --preflight` also asks the CLI.
- Before the first trial, a **preflight** makes one tiny `claude -p` call with the trial environment and model (60 s limit). If it fails (auth, no answer, wrong model), nothing starts. `--no-preflight` skips it.
- The manifest (`<trials-root>/<run>/manifest.json`) records the model, the CLI version (`claude --version`), the tarball and the git sha. A run refuses to resume with a different model, effort or tarball unless `--allow-mixed`, and warns when the CLI version changed.
- `--timeout-min` (default 30) kills a trial and its child processes; a timed-out trial is scored as is, with category `other`.
- Resume: trials that already have a record in `results/<run>.json` are skipped; an agent that finished but wasn't scored is only scored; a partial trial (crash, auth failure, Ctrl-C) is moved to `<dest>.stale-<time>` and redone.
- **Not run is not a failure.** A trial whose agent never reached the model (an `is_error` result, an auth failure in the api_retry events or the result text, `duration_api_ms` 0, or no model turn) gets no score record and no analysis entry. If it took no turn, its sidecars are renamed `*.notrun-<time>` and the dir stays prepared, so re-running the command retries it; otherwise it is redone. An auth failure, or two not-run trials in a row, stops the run. `score.mjs` also refuses a trial whose `<dest>.run.json` says the agent never ran (`--force` overrides).
- The orchestrator warns when the installed `sygnal-dev` skill differs from the checkout's (PLAN-1 D35). `--verify` runs `verify.mjs` against the run's tarball first.
- Trial dirs: `--trials-root` (default `/tmp/sygnal-evals/trials`, resolved, so on macOS the prompt says `/private/tmp/...`, which is the agent's real cwd) `/<run>/<arm>-<NN>-t<k>`, with `<dest>.prompt.txt`, `<dest>.transcript.jsonl`, `<dest>.run.json` and `<dest>.stderr.log` next to each. The run log is `<trials-root>/<run>/orchestrate.log.jsonl`.
- Still manual: step 3's audit review (records with audit hits get an `AUDIT:` note) and step 5's failure classification.
- To test the pipeline without API calls: `--claude-bin $EVAL/tests/fake-claude.mjs` (with `FAKE_CLAUDE_SOLUTION=$EVAL/hidden/<task>/solution` it applies the reference solution, so the trial passes).

**Headless posture** (`lib/headless.mjs`): the same prompt file a PLAN-1 subagent got, `--permission-mode acceptEdits`, the general-purpose tool set (`Bash Read Edit Write Glob Grep Skill TodoWrite WebFetch WebSearch`) all pre-approved, no MCP servers (`--strict-mcp-config`), no session persistence. Variables that tie a process to a host Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_EFFORT`, …) are removed from the trial's environment. The worktree guard of a coordinator session doesn't apply (G-030). This is a method change: compare headless runs only with headless runs (PLAN-2 §8).

The manual procedure below is still valid, and is what the orchestrator automates.

## 0. Once per run

1. Pick a run name: `baseline` for the Phase 0 run, `phase3` for the re-run (PLAN-1 §7). Results go to `$EVAL/results/<run>.json`.
2. Build and pack Sygnal **once**, so every Sygnal-arm trial in the run uses the same build:
   ```bash
   cd $REPO && npm run build
   mkdir -p /tmp/sygnal-evals && npm pack --pack-destination /tmp/sygnal-evals
   # -> /tmp/sygnal-evals/sygnal-<version>.tgz   (call this $TGZ)
   ```
   For the re-run, do this from the `plan1-phase3` checkout.
3. Check the harness is healthy: `node $EVAL/verify.mjs --tarball $TGZ`. It must end with `ALL OK`.
4. Decide the trial budget (PLAN-1 §7: 3 trials or 1 trial per task and arm). Use the same budget for the re-run.

Trial ids are `1..N` per (task, arm). Run the trials of a run in any order, but never two trials of the same (task, arm) in the same scratch dir.

**Tier-2 tasks (09–12).** A harder tier exists in both arms (README "Tasks"; decision D16). The procedure is exactly the same: prepare, spawn, collect, score, classify. Tier-2 hidden suites take longer (task 11 waits on a real 300 ms debounce; about 10 s per suite). For the baseline of the tier-2 tasks, use the same pre-change tarball as the tier-1 baseline (D16), and report tier 1 and tier 2 separately: tier-1 pass rates are saturated, tier 2 is where pass rate can move.

**Tier-3 tasks (13–17).** Added in PLAN-2 (0-C) after tier 2 saturated as well; same procedure, reported as a third tier. Suites take 3–15 s (task 15 reloads the app after waiting out its save window; task 17 answers each fetch by hand). Before baselining, pilot 2 trials per arm and tune difficulty (target first-attempt pass rate about 60–80%); after the baseline, the tier-3 tests are frozen like the others. Failure categories for tier 3: a reply lost because it was handled in an unmounted page, or a click handled two levels above its button, is `isolation`; an activity type or callback prop that doesn't match, or a Collection `from` a calculated field, is `wiring`; a timer or handler that saves stale data is `reducer-shape` only if a reducer returns the stale state, otherwise `other`; markup drift in task 16 is `other`.

**Iterations from older transcripts.** `transcript-stats.mjs` undercounted iterations before G-017 was fixed (it missed `npm --prefix X test`, the most common form). Rerun it on the stored transcripts to get comparable numbers before comparing runs.

## 1. Prepare the trial directory

Use a scratch dir **outside the repo**. Never reuse a dir.

```bash
node $EVAL/prepare.mjs --arm sygnal --task 03 --tarball $TGZ \
  --dest /tmp/sygnal-evals/trials/<run>/sygnal-03-t1
# React arm (tasks 01-05 and 08-17 only):
node $EVAL/prepare.mjs --arm react --task 03 \
  --dest /tmp/sygnal-evals/trials/<run>/react-03-t1
```

`prepare.mjs` copies the starter, vendors the Sygnal tarball as `vendor/sygnal.tgz`, runs `npm install`, and runs a leak check (no hidden tests, no symlinks, no mention of the repo path). It also writes the agent prompt to `<dest>.prompt.txt`, next to the trial dir.

## 2. Spawn the agent

**Headless (harness v2, preferred):**

```bash
node $EVAL/run-trial.mjs --dest <dest> [--model claude-opus-5-5] [--timeout-min 30]
```

It runs `claude -p "$(cat <dest>.prompt.txt)" --output-format stream-json --verbose` from inside `<dest>` (posture above), stamps every line with a `timestamp`, and writes `<dest>.transcript.jsonl` and `<dest>.run.json` (wall time, exit status, model, cost, billed tokens, turns). Don't mix headless and subagent trials within one run.

**Subagent (PLAN-1 method):** spawn a **fresh** general-purpose subagent (no `SendMessage` reuse, no worktree isolation). Its prompt is **exactly** the contents of `<dest>.prompt.txt`, with nothing added. That file contains:

- the task's `PROMPT.md` text, verbatim;
- Sygnal arm only: `This app uses the Sygnal framework. Use the sygnal-dev skill.`;
- the trial dir path, with "work only inside that directory" and the note that `npm run build` and `npm test` work there.

Do not add hints, the task category, or any mention of acceptance tests, hidden tests, or this harness. The `sygnal-dev` skill must be available to the agent in its installed form. For the re-run, install the Phase 3 version of the skill first.

Rules for the agent (enforced by audit, not by telling it):
- It may run the app's own `npm run build`, `npm test`, `npm run dev`, and write its own tests.
- It must never see `evals/agent-ergonomics/` (in particular `hidden/`).

> **Isolation caveat.** A subagent spawned with the Agent tool inherits the coordinator's cwd, which is inside the repo, so a curious agent could find `evals/`. The prompt points it at the trial dir, and step 3's audit catches any access. The headless runner avoids this: its cwd is the trial dir.

Record the wall time, `total_tokens` and `duration_ms` if the Agent tool result reports them. Otherwise step 3 derives the wall time from transcript timestamps.

## 3. Collect metrics from the transcript

Find the trial agent's transcript:
- Subagent: `~/.claude/projects/<project-dir>/<coordinator-session-id>/subagents/agent-<agentId>.jsonl` (the `agentId` comes from the Agent tool result; `<project-dir>` is the coordinator's cwd with `/` and `.` replaced by `-`).
- Headless: `<dest>.transcript.jsonl` (from `run-trial.mjs`, stamped).

```bash
node $EVAL/transcript-stats.mjs <transcript.jsonl> --dir <dest>
```

It prints `iterations`, `editRounds`, `edits`, `wallSeconds`, `audit`, and for headless transcripts `headless` (model, cost, billed tokens, output tokens, duration from the run's `result` event). **If `audit` is non-empty, read the flagged calls.** If the agent read anything under `evals/agent-ergonomics/`, a `hidden/` dir or `__hidden__`, the trial is **invalid**: delete its record (if any), note it in the status ledger, and rerun it with a new trial id. Other out-of-dir reads (for example `node_modules/sygnal/src` inside the trial, or skill files) are fine.

You can also count by hand from the transcript; the definitions are in README.md "Metrics".

## 4. Score

Only after the agent has finished:

```bash
node $EVAL/score.mjs --dir <dest> --task 03 --arm sygnal --trial 1 --run <run> \
  --iterations <n> --edit-rounds <n> --wall-seconds <n> \
  --duration-ms <n> --tokens <n> --output-tokens <n> --cost-usd <x> --model <id> --method headless
```

Usage flags: take them from `<dest>.run.json` (headless: `durationMs`, `tokens`, `outputTokens`, `costUsd`, `model`) or, for a subagent trial, from the Agent tool result (`total_tokens` as `--tokens`, `duration_ms`; note that the Agent tool's `total_tokens` is the final context size, not billed tokens, so don't compare it with headless `tokens`). The orchestrator passes all of them. `--wall-seconds` defaults to `--duration-ms` / 1000. Concurrent scorers are safe (the results file is updated under a lock).

This copies the hidden tests into `<dest>/__hidden__/`, runs them with the arm's own vitest config (it ignores the agent's `vite.config.js`), and appends or replaces the record in `results/<run>.json`. It prints the record.

## 5. Classify failures

If `pass` is `false`, read the failing test messages (in the record), the agent's diff (`diff -ru $EVAL/tasks/<task>/starter/src <dest>/src`), and its final message. Then set the category:

```bash
node $EVAL/score.mjs --classify --run <run> --task 03 --arm sygnal --trial 1 --category wiring
```

| Category | Use when the root cause is... |
|---|---|
| `wiring` | a string link that doesn't match: view class ↔ intent selector, intent key ↔ model key, EVENTS type emit ↔ select, CHILD/PARENT message shape, Collection `from`, a driver name between `run()` and intent/model, or a driver never registered in `run()` |
| `isolation` | a parent listening (DOM.select) to elements rendered inside a child or Collection item, or otherwise relying on DOM events crossing a component boundary |
| `reducer-shape` | a reducer that drops state keys (no spread), mutates state, returns the wrong type, or returns `undefined` by accident (which removes a Collection item) |
| `stream-operator` | misuse of xstream: RxJS-only operators (`pipe`, `switchMap`, `tap`...), wrong operator semantics, unhandled stream errors, memory/startWith confusion |
| `other` | anything else: misread spec, formatting/text mismatch, build error unrelated to the above, ran out of time, gave up |
| `none` | the trial passed (set automatically) |

Pick the **first** root cause in the causal chain. If two independent bugs exist, pick the one that fails more hidden tests, and mention the other in `--notes` when re-scoring. React-arm failures will mostly be `other` or `reducer-shape`; that's expected.

## 6. After the run

- Analyze: `node $EVAL/analysis/analyze.mjs --run <run> --trials-root <trials-root>` (the orchestrator does this). For headless runs the trial map `results/transcripts/<run>.tsv` lists `<trial>\theadless`; without a map the analyzer finds `<trials-root>/<run>/*.transcript.jsonl` itself. The report adds cost, billed tokens, output tokens and agent-reported duration per arm and task, and its recommendations are checked against the installed skill, `llms.txt` and the trackers (already-done ones are suppressed or rewritten).
- Commit `results/<run>.json`, `results/transcripts/<run>.tsv` and `results/analysis/<run>.{json,md}` (the trial dirs stay in /tmp).
- Summarize: first-attempt pass rate per arm, mean `iterations`, mean `editRounds`, failure-category distribution, per task. For the re-run, produce `REPORT.md` comparing `baseline` against `phase3` and the React arm (PLAN-1 §7).
