# Benchmarks

| Path | What |
|---|---|
| `audit/` | The performance harness (from the 5.4.0 audit, re-run for PLAN-4.5): Sygnal, React 19 and Vue 3.5 apps for 5 scenarios, timing bench, CPU profiler, instrumented counts, retention |
| `audit/gate.json` | Limits of the count gate (`scripts/perf-gate.mjs`, part of `npm test`) |
| `jfb-smoke.mjs` | Checks and smoke-times the js-framework-benchmark entries |
| `js-framework-benchmark/` | Sygnal's keyed and non-keyed entries for [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), kept as-is for upstream submission |
| `RESULTS.md` | Recorded results (P-3, PF-1) |
| `audit/baseline-5.4.0/`, `audit/results-plan4/`, `audit/report.html` | The audit's recorded runs and report |

One `package.json` here covers the harness and the gate: Vite 7, React 19.3, Vue 3.5, and Playwright pinned to browser-tests' version (1.63.0, Chromium 153; D191), so both use the same Chromium.

## Setup

```bash
npm run build                      # the library: every app here imports the repo's dist/
npm ci --prefix benchmarks
```

No network is needed after that.

## The count gate

```bash
npm run test:perf-gate             # = node scripts/perf-gate.mjs; also the last step of npm test
node scripts/perf-gate.mjs --runs=3   # three measurements, prints min … max per metric
```

It builds `audit/apps/sygnal/{table-coll,counters,deep}` unminified into `audit/dist-gate/`, with counters injected at build time (`audit/lib/instrument.mjs`: snabbdom's `patch`, xstream's `Stream` constructor, and `setTimeout`/`setInterval` in the page), runs them in browser-tests' Chromium and compares the counts with `audit/gate.json`. It exits 1 when a count is above its limit, and 2 when it can't run (it prints the missing step). About 15 s.

| Metric | How it is measured |
|---|---|
| DOM patches: select row, 1k Collection | `table-coll`: 1,000 rows, click row 2's label, until it has `danger`, + 500 ms |
| DOM patches: update every 10th, 1k Collection | `table-coll`: 1,000 rows, click `#update` |
| DOM patches: leaf click, 30 deep | `deep`: click the leaf's `.inc` |
| Streams per Collection item | `counters`: xstream streams created while mounting 1,000 counters (+ 1 s), ÷ 1,000, to 0.1 |
| `setTimeout` calls, unmount 1k | `counters`: calls while unmounting 1,000 counters (+ 1.5 s) |
| Retained `ScopeChecker`s | `counters`: heap-snapshot count after 5 mount/unmount cycles of 1,000 (+ 1.5 s) minus before |
| Heap after 5×1k Collection cycles minus ready | `table-coll`: JS heap after GC, sampled every 750 ms after 5 back-to-back create/clear cycles until two samples agree within 0.1 MB, minus the heap before |

The counts repeat exactly from run to run, except the select-row patch count, which can drop to 1,000 under CPU load (two 1 ms render debounces coalesce; it can't go above 1,001); the heap varies by about 0.01 MB. **Limits only go down**: a PLAN-4.5 workstream that lowers a count lowers its `limit` and `baseline` in `gate.json` in the same merge.

## Timing (warn-only)

```bash
node scripts/perf-report.mjs       # build + Sygnal/React/Vue on the PLAN-4.5 target ops, ratios to React (~1.5 min)
node scripts/perf-report.mjs --all # every op plus memory (~15 min)
```

It prints each target's Sygnal/React latency ratio next to the PLAN-4.5 §3 target and writes `audit/results/perf-report-<date>.json` (gitignored). It never fails on a ratio.

## The harness

All scripts are run from anywhere; results go to `audit/results/` (gitignored).

```bash
npm --prefix benchmarks run build                  # production builds of every app → audit/dist/
npm --prefix benchmarks run build:profile          # unminified + source maps → audit/dist-profile/
npm --prefix benchmarks run bench                  # speed + memory, all apps (about 15 min)
npm --prefix benchmarks run bench -- --fw=sygnal,react --scenario=table --op=select --no-memory
npm --prefix benchmarks run profile -- --page=table-coll --op="select row (1k)" --inclusive
npm --prefix benchmarks run instrument             # counts per op: patches, streams, timers, retained objects
npm --prefix benchmarks run retained               # heap and DOM nodes 200 ms, 1 s, 3 s after 5 create/clear cycles
```

**Method** (`audit/lib/ops.mjs`, adopted from P-3's former `browser-tests/perf` harness). Each op: `setup` (not timed); wait until the page is quiet (100 ms, then three idle callbacks in a row with ≥ 10 ms left); `gc()` and two animation frames; then click and time:

- **latency** (`dom`): event → the DOM shows the result, with style and layout forced;
- **paint**: event → just after the next frame (quantised by the frame clock);
- **busy**: event → the first idle callback with ≥ 10 ms left (includes trailing work; floor about one frame);
- **cpu**: CDP main-thread task time from the event to 150 ms after idle.

Without the quiet wait, a Collection's trailing teardown from the setup landed in the next op and roughly doubled it, so ratios recorded before P45-0 (the audit, `dev-plans/research/p45-perf-baseline.md`) are higher for Collection ops than this harness's.

Scenarios and apps (`audit/apps/{sygnal,react,vue}`): `table` (js-framework-benchmark style; Sygnal also as `table-coll`, one Collection item per row), `counters` (1,000 components with their own state), `deep` (a leaf 30 components deep), `input` (keystroke with a 1,000-item list). The `table` ops include P-3's **clear 2k rows** (clear after an append).

## js-framework-benchmark entries

The entries resolve `sygnal` (this checkout) and `vite` from `benchmarks/node_modules`; see [js-framework-benchmark/README.md](js-framework-benchmark/README.md).

```bash
npm --prefix benchmarks run jfb -- --runs 5        # builds both, checks every op, smoke timings
```
