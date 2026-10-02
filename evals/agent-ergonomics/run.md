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

- `--tasks`: `all`, `tier1` (01–08), `tier2` (09–12), `tier3` (13–17), `ts` (18–21, the TypeScript variants), `net` (22–23, WebSocket and declarative reads), `03`, `01-05`, or a comma list. Tasks come from the task dirs, so new tasks need no code change; a task missing from one arm is skipped for that arm.
- `--model` (default `claude-opus-5-5`) and `--effort` are passed to every trial. **Use full model ids:** the installed CLI resolves aliases itself, and an old CLI maps them to old models (CLI 2.1.90: `opus` → `claude-opus-4-6`). The model each trial actually ran on (from its init/assistant events) is recorded per record (`model`); a trial on a different model than the one meant (an alias's current model, e.g. `opus` → `claude-opus-5-5`) is not scored and stops the run unless `--allow-mixed`. The dry run shows what the alias must resolve to; `--dry-run --preflight` also asks the CLI.
- Before the first trial, a **preflight** makes one tiny `claude -p` call with the trial environment and model (60 s limit). If it fails (auth, no answer, wrong model), nothing starts. `--no-preflight` skips it.
- The manifest (`<trials-root>/<run>/manifest.json`) records the model, the CLI version (`claude --version`), the tarball and the git sha. A run refuses to resume with a different model, effort or tarball unless `--allow-mixed`, and warns when the CLI version changed.
- `--timeout-min` (default 30) kills a trial and its child processes; a timed-out trial is scored as is, with category `other`.
- Resume: trials that already have a record in `results/<run>.json` are skipped; an agent that finished but wasn't scored is only scored; a partial trial (crash, auth failure, Ctrl-C) is moved to `<dest>.stale-<time>` and redone.
- **Not run is not a failure.** A trial whose agent never reached the model (an `is_error` result, an auth failure in the api_retry events or the result text, `duration_api_ms` 0, or no model turn) gets no score record and no analysis entry. If it took no turn, its sidecars are renamed `*.notrun-<time>` and the dir stays prepared, so re-running the command retries it; otherwise it is redone. An auth failure, or two not-run trials in a row, stops the run. `score.mjs` also refuses a trial whose `<dest>.run.json` says the agent never ran (`--force` overrides).
- Without a `--variant` (or with `"skill": "installed"`), trials use the skill installed in `~/.claude/skills`, and the orchestrator warns when it differs from the checkout's (PLAN-1 D35). Without a `--variant` the trials also keep the bare starters (starter 1, no sygnal-check), so a legacy run like v2-baseline resumes and reproduces unchanged; every variant run defaults to the current starter (see "Variants"). With a variant that names a skill, nothing needs installing (see "Variants" below). `--verify` runs `verify.mjs` against the run's tarball first.
- **Usage limits.** Trials run on a subscription, so a long run can hit its usage limit (or API rate limits / overload). A trial whose result or `api_retry` events show one (HTTP 429/529, "usage limit reached", "hit your limit", overloaded, a rejected `rate_limit_event`) is **not run**, like an auth failure, and doesn't count toward the two-in-a-row stop. Instead every worker pauses and the trial is retried: `--limit-backoff 5m,15m,30m,60m` (one step per consecutive hit; a known reset time, e.g. `…limit reached|<epoch>`, wins if later), `--limit-retries` (default: the number of steps), `--limit-max-wait 5h` (give up at once if the reset is further away). A trial that runs starts the schedule over. If the limit persists, the run stops cleanly (exit code 75), the not-run trials stay prepared, and it prints the exact command that resumes it. The preflight does the same before the first trial.
- Trial dirs: `--trials-root` (default `/tmp/sygnal-evals/trials`, resolved, so on macOS the prompt says `/private/tmp/...`, which is the agent's real cwd) `/<run>/<arm>-<NN>-t<k>`, with `<dest>.prompt.txt`, `<dest>.transcript.jsonl`, `<dest>.run.json` and `<dest>.stderr.log` next to each. The run log is `<trials-root>/<run>/orchestrate.log.jsonl`.
- Still manual: step 3's audit review (records with audit hits get an `AUDIT:` note) and step 5's failure classification.
- To test the pipeline without API calls: `--claude-bin $EVAL/tests/fake-claude.mjs` (with `FAKE_CLAUDE_SOLUTION=$EVAL/hidden/<task>/solution` it applies the reference solution, so the trial passes; `FAKE_CLAUDE_MODE=ratelimit|overloaded`, or `FAKE_CLAUDE_LIMIT_CALLS=1 FAKE_CLAUDE_STATE=<file>`, simulate usage limits; the header of `tests/fake-claude.mjs` lists the rest).

**Headless posture** (`lib/headless.mjs`): the same prompt file a PLAN-1 subagent got, `--permission-mode acceptEdits`, the general-purpose tool set (`Bash Read Edit Write Glob Grep Skill TodoWrite WebFetch WebSearch`) all pre-approved, no MCP servers (`--strict-mcp-config`; a variant can add its own), no session persistence. Variables that tie a process to a host Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_EFFORT`, …) are removed from the trial's environment. The worktree guard of a coordinator session doesn't apply (G-030). This is a method change: compare headless runs only with headless runs (PLAN-2 §8).

**Process guard** (G-127, `processGuard: 1`). Trial agents used to run `pkill -f vite`, `killall node` and `lsof -ti:5173 | xargs kill -9`, which hit every matching process on the machine: other trials' dev servers and test runs, the orchestrator (the first e7-haiku run died of it), coordinator gate runs and the user's own node processes. Every trial now gets (a) `--disallowedTools Bash(pkill:*),Bash(killall:*),Bash(kill:*)` plus the absolute `/usr/bin/pkill`, `/usr/bin/killall`, `/bin/kill` forms, and (b) a shim dir `<dest>.guard/bin` first on its `PATH`, re-applied before every Bash command through `CLAUDE_ENV_FILE` (`<dest>.guard/env.sh`), whose `pkill`, `killall` and `kill` refuse ("Not available in the eval: stop only processes you started, by PID …") and exit 1. `kill` is a shell builtin, so the deny rule is what blocks it; the `kill` shim catches only the external binary (`xargs kill`). A trial stopping its own background job from a script still works. The preflight carries the same deny rules, so a CLI that rejects them fails before the first trial. The harness's own timeout kills the trial's process group with `process.kill()`, which neither layer touches. `processGuard` is in `<dest>.run.json` and the manifest (`processGuard`, `processGuards`; absent = 0, unguarded), and not in the variant hash. To find trials that ran such commands: `node evals/agent-ergonomics/transcript-stats.mjs --kills <trials-root>/<run>`; the analyzer lists them under "Method and limits", and the orchestrator adds a `PROCESS-KILL` note to their records.

### Variants (Phase 3 experiments, PLAN-2 3-H)

`--variant <name>` runs a whole run under one experiment arm, described by `variants/<name>.json` (or `.mjs` exporting the object, or a path). The spec (full reference in `lib/variant.mjs`):

| Key | Values | Effect |
|---|---|---|
| `sygnal` | `"branch"` (default) · `{ "tarball": "x.tgz" }` · `{ "npm": "sygnal@5.4.0" }` | the Sygnal build vendored into every Sygnal trial |
| `skill` | `"installed"` (default, legacy) · `"none"` · `{ "dir": "skills/sygnal-dev" }` · `{ "gitRef": "v5.4.0", "path": "skills/sygnal-dev" }` (+ `"name"`) | the `sygnal-dev` skill the Sygnal arm sees, **isolated per trial** |
| `overlay` | `{ "all" \| "sygnal" \| "react": { "dir", "files", "append", "packageJson", "packs" } }` | applied to each starter after the copy and before `npm install`: copy a dir over it, write or append files, deep-merge `package.json` (`null` deletes a key), and `npm pack` a repo dir once per run and vendor it (`"packs": { "sygnal-check": { "dir": "sygnal-check" } }` → `vendor/sygnal-check.tgz` as a devDependency) |
| `starter` | `2` (default, current) · `1` | the starter version (`lib/starter.mjs`, 4-E): `2` puts this checkout's `sygnal-check` (packed, `vendor/sygnal-check.tgz`, devDependency) and the template-style `AGENTS.md` + `CLAUDE.md` (`starter-kits/sygnal-v2/*.tmpl`) into every Sygnal trial, as the 5.4.0 templates do; `1` is the bare starters every run up to Phase 3 used. The kit is applied first, then the variant's own `overlay` |
| `prompt` | `{ "prefix", "suffix", "arms" }` | text before / after the task's `PROMPT.md` text (before the skill line), in the listed arms (default both) |
| `mcp` | `{ "arms": ["sygnal"], "mcpServers": { ... } }` | an MCP config for those arms' trials (`--mcp-config`, still `--strict-mcp-config`); its tools are pre-approved (`mcp__<server>`) |
| `model`, `effort` | strings | defaults for the run; `--model` / `--effort` override them |

Relative paths resolve against the repo root, `./` and `../` against the spec file. A typo'd key is an error, not a silent default.

**Skill isolation.** With any `skill` other than `"installed"`, every trial (both arms) runs with `--setting-sources project,local`: the CLI doesn't load user settings, and with them `~/.claude/skills`, so the installed skill can't leak in. The Sygnal arm also gets `--add-dir <run>/_variant/skillroot`, whose `.claude/skills/<name>/` holds a copy of the variant's skill, which the CLI loads as `sygnal-dev`. Nothing under `~/.claude` is read for the skill or written; the coordinator no longer swaps the installed skill (D35/D45). The CLI's `system/init` event lists the skills it loaded: the preflight and every trial check it (the Sygnal arm must have the skill, the React arm and `"none"` must not), and a mismatch stops the run before scoring. The user's `settings.json` is not loaded in this posture (today it holds only UI preferences), and neither are user-level plugins.

**What is recorded.** The variant is resolved once per run: content hashes of the skill (or its git tree id), overlay dirs and packed dirs, a given tarball's sha256, the effective model and effort. Its name and a 12-hex hash of that resolved spec go into every result record (`variant`, `variantHash`) and the manifest (`variant` with the resolved spec, `variants`). The starter version goes into every record (`starterVersion`) and the manifest (`starterVersion`, `starterVersions`); a record or manifest without it is starter 1. The starter kit's content (its file text and the packed `sygnal-check`) is part of the hash; a variant on starter 1 hashes exactly as before starter versions existed, so a Phase 3 run's `variantHash` is reproduced by its spec plus `"starter": 1` (same file name; the name is hashed; skill and sygnal-check content as at the time). Runs without a variant (the legacy posture) use starter 1. Resuming a run with a different variant, or the same variant after its skill or overlay changed, is refused unless `--allow-mixed`. The materialized variant (skill copy, packs, `prepare.json`, `mcp.json`, an npm tarball) is in `<trials-root>/<run>/_variant/`, and `analyze.mjs` gets the skill copy as `--skill-dir`.

Shipped variants: `baseline-5.4.0` (published `sygnal@5.4.0` + the 5.4.0 skill from git, on starter 1, so it reproduces the v2-baseline conditions without sygnal-check: the D45 reference), `branch` (this checkout's build + `skills/sygnal-dev` on the current starter: the control for experiments), `e5-no-skill`, `e7-sonnet`, `e7-haiku`, `e8-mcp`, `e9-add-test`, `e9-no-test` (all on the current starter). Kept for reproducing Phase 3, not recommended: `e1-check` and `e1-pretest` (starter 1 plus their own sygnal-check overlay; E1 was adopted as starter 2, and its verdict drops the pretest hook). Run each experiment's control as a variant too (`branch`), so both sides share the isolated posture and the starter; older runs (`v2-baseline`) used the installed-skill posture, and every run up to Phase 3 the bare starters.

```bash
# The control (Sygnal arm; add react for gap measurements)
node $EVAL/orchestrate.mjs --run control    --variant branch            --arms sygnal --tasks all --trials 5 --concurrency 4
# E5: skill size and shape. Lean skill from an exp branch's worktree: a one-off spec, e.g.
#   /tmp/e5-lean.json = { "sygnal": "branch", "skill": { "dir": "/path/to/exp-worktree/skills/sygnal-dev" } }
node $EVAL/orchestrate.mjs --run e5-lean    --variant /tmp/e5-lean.json --arms sygnal --tasks all --trials 5 --concurrency 4
node $EVAL/orchestrate.mjs --run e5-noskill --variant e5-no-skill        --arms sygnal --tasks all --trials 5 --concurrency 4
node $EVAL/analysis/compare.mjs --base control --next e5-lean --arms sygnal --metrics wall,peakContext,iterations
# E7: a smaller model, both arms; then the gap on that model
node $EVAL/orchestrate.mjs --run e7-sonnet --variant e7-sonnet --tasks all --trials 5 --concurrency 4
node $EVAL/analysis/compare.mjs --base e7-sonnet:react --next e7-sonnet:sygnal
# E8: the sygnal-check MCP server for Sygnal agents on the debugging tasks
node $EVAL/orchestrate.mjs --run e8-mcp --variant e8-mcp --arms sygnal --tasks 14,15 --trials 5
node $EVAL/analysis/compare.mjs --base control --next e8-mcp --tasks 14,15
# Reproducing a Phase 3 run (bare starters): its spec plus "starter": 1, in a file with the same name (the name is
# hashed). p3-control's `branch` is /tmp/p3/branch.json =
#   { "sygnal": "branch", "skill": { "dir": "skills/sygnal-dev" }, "starter": 1 }   → hash f2bc8a548175, as recorded
node $EVAL/orchestrate.mjs --run e1-control --variant /tmp/p3/branch.json --arms sygnal --tasks tier1,14,15 --trials 5 --concurrency 4
node $EVAL/orchestrate.mjs --run e1-check   --variant e1-check            --arms sygnal --tasks tier1,14,15 --trials 5 --concurrency 4
# E9: testing-norm parity, both arms, tier 1; the gap under each instruction
node $EVAL/orchestrate.mjs --run e9-add-test --variant e9-add-test --tasks tier1 --trials 5 --concurrency 4
node $EVAL/orchestrate.mjs --run e9-no-test  --variant e9-no-test  --tasks tier1 --trials 5 --concurrency 4
node $EVAL/analysis/compare.mjs --base e9-add-test:react --next e9-add-test:sygnal
node $EVAL/analysis/compare.mjs --base e9-no-test:react  --next e9-no-test:sygnal
```

`--dry-run` prints the resolved variant (sources, hashes, overlays, prompt, MCP) with the plan, without materializing anything.

### Comparing runs (task-matched, G-119)

`analysis/compare.mjs --base <run>[:arm] --next <run>[:arm]` compares only the (arm, task) cells both sides have: per cell the mean of its trials, then the **matched mean** over the shared tasks (each task weighs the same) and the delta next − base, with the ratio; then a per-task table. Tasks only one side has are listed, not averaged in. Pinning an arm on a side (`v2-baseline:react`) compares across arms and runs: cells match on task alone, so `--base v2-baseline:react --next e1-check:sygnal` is the remaining Sygnal − React gap with E1, and `--base e7-sonnet:react --next e7-sonnet:sygnal` is the gap within one run.

- `--arms sygnal,react` and `--tasks tier1|01-05|14,15` (the `--tasks` syntax of the orchestrator) restrict the cells.
- `--metrics pass,wall,costUsd,iterations` picks the per-task columns; the matched-mean table shows every metric both sides have (pass rate, wall, cost, billed and output tokens, iterations, edit rounds; from an analysis also tool calls, peak context, failed runs, LOC added, wrote-a-test).
- `--source auto` reads `results/analysis/<run>.json` when it exists, else `results/<run>.json`; if only one side has an analysis both use the results files. `--json` prints the data; `--out f.md` writes it.
- `--full` appends the old whole-run aggregate diff (phases, catalog, canonical forms), labeled as not task-matched; it is context, not a comparison.

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

**Network tasks (22–23, `net`).** Added in PLAN-3 (0-C) so the network layer has its own tier and the existing tiers stay fixed; same procedure, reported as their own tier. Suites take about 12 s (task 22 waits out its real 1 s reconnect delay several times) and 2 s (task 23). Failure categories for `net`: a socket left open, a retry that is never cancelled or fires after the app closed a socket itself, or a stale response shown, is `other` unless the cause is a selector or a mis-wired driver (`wiring`) or a reducer returning stale state (`reducer-shape`).

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

`prepare.mjs` copies the starter, vendors the Sygnal tarball as `vendor/sygnal.tgz`, applies the starter version's kit (`--starter 2`, the default: this checkout's sygnal-check packed into `vendor/` as a devDependency, plus `AGENTS.md` and `CLAUDE.md`, Sygnal arm only; `--starter 1`: the bare starter, as in every run up to Phase 3), runs `npm install`, and runs a leak check (no hidden tests, no symlinks, no mention of the repo path). It also writes the agent prompt to `<dest>.prompt.txt`, next to the trial dir.

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
