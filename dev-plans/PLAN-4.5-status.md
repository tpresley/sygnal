# PLAN-4.5 Status Tracker

Tracks progress for [PLAN-4.5.md](PLAN-4.5.md) (performance). The coordinator maintains it.

**Numbering:** decisions from **D150**, gaps from **G-250** (PLAN-4 ended at D148 / G-235).

**Integration branch:** `plan45-integration`, cut from `plan4-integration` at `eb9f9fe` (tag `plan4-phase4`) on 2026-10-04, in worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** P45-0 and P45-A merged. P45-B running.

## Baseline

From `research/p45-perf-baseline.md` (PLAN-4 build `a7efb5d`; `plan4-phase4` has no core change since except +0 B docs/helpers). Gated core 41,343 B.

| Count (hard gate) | Baseline |
|---|---|
| DOM patches: select row, 1k Collection | 1,001 |
| DOM patches: update every 10th | 102 |
| DOM patches: leaf click 30 deep | 51 |
| Streams per Collection item | 151 |
| `setTimeout` calls, unmount 1k | 79,013 |
| Retained `ScopeChecker`s after 5×1k cycles | 5,000 |
| Heap after 5×1k Collection cycles minus ready (after teardown) | 8.8 MB |

**Gate limits** (`benchmarks/audit/gate.json`, set by P45-0 from 3 quiet + 3 loaded runs): patches 1,001 / 102 / 51; streams/item 151 (exact, to 0.1); unmount `setTimeout`s 81,000; ScopeCheckers 5,000; heap 9.5 MB. Only select-row varies (1,000–1,001, two 1 ms debounces sometimes coalesce). Lowered after each workstream.

**Timing baseline** (`scripts/perf-report.mjs`, warn-only, ratio of latency to React, D150): Collection select 28.4× (CPU 90×; Sygnal 14.2 ms, main thread busy ~480 ms after the click), mount 1k 6.9–7.5×, leaf 30 deep 12.9–15.7×, keystroke 9.0–9.2×, single select 16.3–16.7×.

## Workstreams

| ID | Workstream | Status | Branch | Merge | Notes |
|---|---|---|---|---|---|
| P45-0 | Harness to `benchmarks/audit/`, count gate in `npm test`, nightly timing report | ✅ merged | `p45-0-gate` (`fb1f4eb`) | 2026-10-04 | `npm ci --prefix benchmarks` is a new setup step; patch counter hooks snabbdom `patch` (survives P45-C); `browser-tests/perf/` retired |
| P45-A | Listener leak, identity-preserving vnodes, DOM module fast paths | ✅ merged | `p45-a-leak-identity` (`08e208c`) | 2026-10-04 | +212 B (41,555 B, 745 B headroom). ScopeCheckers 5,000 → 1, heap 8.76 → 1.17 MB; Collection select CPU ratio 90× → 15×. Limits lowered |
| P45-B | Pragma hot path (drop `extend`) + G-252 | 🟡 running | `p45-b-pragma` | | must recover ≥ 212 B (net ≤ 0) |
| P45-C | One render scheduler per app (+ rest of Collection, post-patch DOM emission) | ⬜ | | | after P45-B |
| P45-D | Lazy wiring, synchronous teardown | ⬜ | | | after P45-C |
| P45-E | Change detection (only if profiles show it) | ⬜ | | | |
| P45-EV | Agent regression eval (~$30, user's terminal) | ⬜ | | | after P45-D |

## Decisions

| ID | Date | Decision | By |
|---|---|---|---|
| D150 | 2026-10-04 | Timing ratios are measured after an idle wait (`h.quiet()`), so a setup's trailing teardown isn't counted in the next op. The plan's "now" column takes P45-0's figures; the targets are unchanged | Coordinator |
| D146 | 2026-10-04 | (PLAN-4 tracker) PLAN-4.5 approved with P45-Q1…Q6 as recommended: own plan before PLAN-5; net ≤ 0 B core; nested JSX prop objects by reference; DOM driver emits from a post-patch hook; hard count gate in `npm test`, timings nightly; ~$30 regression eval after P45-D | User |

## Gaps

| ID | Found | Sev | Area | Description | Status |
|---|---|---|---|---|---|
| G-250 | P45-0 | Low | process | Parallel subagents shared scratchpad log names and overwrote each other's logs. Briefs now require a workstream prefix on scratch files | Fixed (briefs) |
| G-252 | P45-A | Med | component.ts | `initState` writes the first instance's INITIALIZE reducer onto the shared user `model`, so the first instance ever created is retained forever (its intent streams and 1 ScopeChecker), and every later instance runs the first instance's memoised `addCalculated` (shared cache). Blocks "retained ScopeCheckers = 0". Also: `devtools-copy-as-test` clicked `.toggle-all` before the render (state led DOM under load); now waits for it | Test fixed; code → P45-B |
| G-253 | P45-A | Low | delegator | A non-bubbling stream that restarts after its shared record was removed, while a newer stream made a fresh record, can lose events | Open (P45-D review) |
| G-251 | P45-0 | Low | docs | `research/p45-perf-baseline.md` still names the old `perf/` paths | Open (fix at close-out) |

## Merge measurements

| Merge | Gated size | Collection select (ratio / CPU ratio) | Mount 1k | Leaf 30 | Keystroke | Single select |
|---|---|---|---|---|---|---|
| P45-0 baseline | 41,343 | 28.4× / 90× | 6.9–7.5× | 12.9–15.7× | 9.0–9.2× | 16.3–16.7× |
| + P45-A | 41,555 | 24.5× / 15.2× | 6.5× | 11.8× | 10.2× | 17.2× |

Latency is now held up mostly by the per-component 1 ms debounce floor (P45-C); P45-A's gain is in CPU (profile: Collection select busy 338 → 135 ms/run, `patchVnode` 125 → 14 ms).

## Log

- 2026-10-04 — P45-A merged (`08e208c`); gates green after a test-race fix (G-252 note); limits lowered (ScopeCheckers 1, heap 1.5 MB). P45-B started.
- 2026-10-04 — P45-0 merged (`fb1f4eb`); gates re-run on integration.
- 2026-10-04 — `plan45-integration` cut from `plan4-phase4`. Tracker created. P45-0 and P45-A started.
