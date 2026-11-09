# Core size and speed sweep (after 7.4.0)

Maintainer's brief (2026-11-09): sweep Sygnal core for size and speed.

- Size reduction is the primary goal, speed the secondary one.
- No speed gain is required for a significant size reduction. A speed decrease is not acceptable.
- Think outside the box, but the developer-facing API doesn't change.
- The one exception: a significant size or speed gain that needs an API change that is itself an
  improvement. Those are written up for the maintainer's assessment for 8.0, not implemented.

Integration branch: `claude/core-size-sweep` (from `main` at 7.4.0). Each workstream below runs on
its own branch and worktree cut from it. The coordinator session merges them.

## Baseline (7.4.0, Vite 8.3.6 in examples/kanban)

| Measure | Value |
|---|---|
| Size gate (a) `nativeGlobalThis: false`, gzip (the gated number) | 43,630 B |
| Size gate (b) default, gzip (what apps ship) | 39,630 B |
| Size gate (c) `src/core/**` alone | 53,951 B min / 20,166 B gzip |
| Perf count gate | all at their limits; heap 0.97 MB (limit 1.00) |

Where the minified bytes of the kanban bundle go (esbuild from `src/`, approximate; it undercounts
`src/core` because it dropped the Collection host): xstream 15,958; `src/core` 36,849 (instance
13,006, runtime 10,215, define 4,586, actions 3,335, cell 2,085, statics 1,685); `src/cycle` 25,914
(EventDelegator 6,043, makeDOMDriver 2,907, utils 2,033, IsolateModule 1,771, MainDOMSource 1,609,
styleModule 1,236, VNodeWrapper 1,227); snabbdom 8,611 (init 5,001, htmldomapi 1,569); `src/extra`
9,509 (dragDriver 1,996, diagnostics index 1,789, run 1,556, codes 996, elementCommands 821, legacy
530); `src/pragma` 5,707; the `globalthis` chain about 14,000 (only in (a), which is why (b) is
4,000 B smaller).

gzip absorbs duplicate code, so dedupe savings are far smaller than raw savings suggest (D188).
Judge every change by the gzip numbers, not by raw bytes.

## Rules for every workstream

1. **No API change.** Everything public keeps working: `npm test` passes. A test may change only
   if it pins an internal detail that the change removes, and the report lists each such edit and
   why it isn't observable to app authors.
2. **No speed decrease.** See "Measuring speed".
3. **Behaviour-preserving.** Never drop or water down a behaviour to save bytes. If a saving needs
   a behaviour change, however small, don't make it: put it in the report with its number.
4. **Count-gate limits only go down.** Don't edit `benchmarks/audit/gate.json` or the `BUDGET` in
   `scripts/size-gate.mjs`. Report your numbers, and the coordinator sets the limits after merging.
5. **D209 stands** (see CLAUDE.md): no bundling of actively maintained third-party code.
6. **Stay inside your files** (the table below). Other workstreams are editing the rest at the same
   time. If you need a change outside them, describe it in your report rather than making it.
7. **Earn the complexity.** Keep a change only if it saves at least 10 B gzip or measurably speeds
   up an op. The code must still read like the code around it: no cleverness for a few bytes.
8. Commit in small steps on your branch, each message giving its gzip delta. Don't push, open a
   PR, or touch `main` or the integration branch.
9. Spikes are allowed and encouraged. A spike that doesn't pay off is a good result: report it as
   no-go with the numbers, and leave it off the branch.
10. **API ideas for 8.0**: if you find a significant gain that needs an API change that would be an
    improvement in itself, measure or estimate it and write it up. Don't implement it.

## Setup of a worktree

From CLAUDE.md, in your worktree: `npm ci`, `npm ci --prefix browser-tests`, `npm ci --prefix
sygnal-check`, `npm ci --prefix benchmarks`, `npm run build`, `npm install --prefix examples/kanban`
(there's no lockfile, so `npm ci` fails there), `npm install --prefix examples/todomvc`. Check that
`npm ls vite --prefix examples/kanban` says 8.3.6: the size numbers move by a few bytes between
Vite versions. Use `npm --prefix <dir>` and `git -C <dir>` rather than `cd`. Keep logs in your own
scratch folder.

## Measuring size

`npm run build`, then `node scripts/size-gate.mjs`. It exits 1 while you're over the budget. It
can't be over unless you've grown the bundle. Report (a), (b) and (c). (b) is what apps ship.

## Measuring speed

`node scripts/perf-ab.mjs --base=/Users/troy/Documents/Displera/sygnal/.claude/worktrees/core-size-sweep/benchmarks/audit/results/base-7.4.0`
(after `npm run build`). It benches your build against the frozen 7.4.0 build in alternating
rounds. It takes a lock shared by all worktrees, so it may wait for another session's run, and a
full run takes about 20 minutes. Run it with a long timeout, in the background.

- While iterating: `--rounds=2` and `--op=<substring>` for the ops you touched.
- Before reporting: one full run with the defaults. Passing means no op marked `SLOWER`, or each
  marked op re-run alone with `--op=… --rounds=4` and no longer marked. See the noise note below.
- `npm run test:perf-gate` (in `npm test`) must also pass.
- `benchmarks/audit/profile.mjs` gives CPU profiles for finding hot paths.

Noise (A/A, the baseline against itself, 4 rounds on a quiet machine): the latency geometric mean
was 1.001, single ops moved by up to 6%, one op was falsely marked `SLOWER`, and per-op CPU moved
by up to 20%. So: a `SLOWER` mark needs a re-run before it counts, the latency geometric mean must
be at most 1.01, and per-op CPU ratios are not evidence on their own. Builds and tests from other
sessions add load that the lock doesn't cover, so a surprising result deserves a second run.

## Before reporting

`npm run build`, then `TEST_EXAMPLES_INSTALL=1 npm test` (the full gate), `node scripts/size-gate.mjs`,
and the full `perf-ab` run. If you touched anything `sygnal-check` reads, also run
`npm --prefix sygnal-check test`. The machine is shared with the other workstreams, so if the
browser suite times out on load, set `BROWSER_TESTS_TIMEOUT_MS=600000` before calling it a failure.

Write `dev-plans/research/core-size-sweep/<workstream>.md`, committed on your branch: the changes
with their gzip deltas, the final (a) (b) (c) numbers, the perf-ab summary line and any ops marked
`SLOWER`, the gate results, tests edited and why, what you tried and rejected with numbers, and
8.0 ideas. End your session with a short summary giving the branch name and those numbers.

## Workstreams

| Name | Owns | Question |
|---|---|---|
| `xstream` | new `src/xstream*`, the alias in `src/vite/` (`globalthis.ts`, the alias part of `plugin.ts`), its entry in `rollup.config.mjs` and `package.json` | Can a compact, behaviour-identical xstream replace the 16 KB one and the `globalthis` chain? |
| `dom-events` | `src/cycle/dom/**` except the vdom files below | Can delegation, isolation and the DOM sources shrink? |
| `vdom` | `src/cycle/dom/snabbdom.ts`, `src/cycle/dom/*Module.ts`, `src/host/` where it inlines those modules | Spike: is an own patch function smaller and faster than snabbdom? |
| `core` | `src/core/**` except `debug.ts` | Size and hot paths of the component core |
| `periphery` | `src/pragma/**`, `src/cycle/state/**`, `src/extra/{run,elementCommands,eventDriver,dragDriver,xstreamExtras,xstreamCompat}.ts`, `src/shared.ts`, `src/index.ts` | The pragma, run(), helpers, and what apps pull in but don't use |
| `prod-strip` | `src/extra/diagnostics/{index,codes,legacy}.ts`, `src/core/debug.ts`, a production transform in `src/vite/` | Can dev-only strings and code leave production bundles? |
| `mangle` | `rollup.config.mjs` (a plugin), a new script for the name list | Spike: does mangling private property names in `dist/` pay off? |
