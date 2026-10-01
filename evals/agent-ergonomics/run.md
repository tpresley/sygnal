# Running a trial (coordinator procedure)

One **trial** = one fresh agent attempting one task in one arm. Follow these steps exactly, in order, for every trial. Paths below are relative to the repo root (`$REPO`). `$EVAL` is `$REPO/evals/agent-ergonomics`.

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

Spawn a **fresh** general-purpose subagent (no `SendMessage` reuse, no worktree isolation). Its prompt is **exactly** the contents of `<dest>.prompt.txt`, with nothing added. That file contains:

- the task's `PROMPT.md` text, verbatim;
- Sygnal arm only: `This app uses the Sygnal framework. Use the sygnal-dev skill.`;
- the trial dir path, with "work only inside that directory" and the note that `npm run build` and `npm test` work there.

Do not add hints, the task category, or any mention of acceptance tests, hidden tests, or this harness. The `sygnal-dev` skill must be available to the agent in its installed form. For the re-run, install the Phase 3 version of the skill first.

Rules for the agent (enforced by audit, not by telling it):
- It may run the app's own `npm run build`, `npm test`, `npm run dev`, and write its own tests.
- It must never see `evals/agent-ergonomics/` (in particular `hidden/`).

> **Isolation caveat.** A subagent spawned with the Agent tool inherits the coordinator's cwd, which is inside the repo, so a curious agent could find `evals/`. The prompt points it at the trial dir, and step 3's audit catches any access. For stronger isolation, run the trial headless from the trial dir instead:
> ```bash
> cd <dest> && claude -p "$(cat <dest>.prompt.txt)" --output-format stream-json --verbose \
>   > <dest>.transcript.jsonl
> ```
> (Use the same model and permission mode as the subagent runs. Don't mix the two methods within one run.)

Record the wall time if the Agent tool result reports it. Otherwise step 3 derives it from transcript timestamps.

## 3. Collect metrics from the transcript

Find the trial agent's transcript:
- Subagent: `~/.claude/projects/<project-dir>/<coordinator-session-id>/subagents/agent-<agentId>.jsonl` (the `agentId` comes from the Agent tool result; `<project-dir>` is the coordinator's cwd with `/` and `.` replaced by `-`).
- Headless: `<dest>.transcript.jsonl`.

```bash
node $EVAL/transcript-stats.mjs <transcript.jsonl> --dir <dest>
```

It prints `iterations`, `editRounds`, `edits`, `wallSeconds`, and `audit`. **If `audit` is non-empty, read the flagged calls.** If the agent read anything under `evals/agent-ergonomics/`, a `hidden/` dir or `__hidden__`, the trial is **invalid**: delete its record (if any), note it in the status ledger, and rerun it with a new trial id. Other out-of-dir reads (for example `node_modules/sygnal/src` inside the trial, or skill files) are fine.

You can also count by hand from the transcript; the definitions are in README.md "Metrics".

## 4. Score

Only after the agent has finished:

```bash
node $EVAL/score.mjs --dir <dest> --task 03 --arm sygnal --trial 1 --run <run> \
  --iterations <n> --edit-rounds <n> --wall-seconds <n>
```

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

- Commit `results/<run>.json` (the trial dirs stay in /tmp).
- Summarize: first-attempt pass rate per arm, mean `iterations`, mean `editRounds`, failure-category distribution, per task. For the re-run, produce `REPORT.md` comparing `baseline` against `phase3` and the React arm (PLAN-1 §7).
