# PLAN-4.5 Status Tracker

Tracks progress for [PLAN-4.5.md](PLAN-4.5.md) (performance). The coordinator maintains it.

**Numbering:** decisions from **D150**, gaps from **G-250** (PLAN-4 ended at D148 / G-235).

**Integration branch:** `plan45-integration`, cut from `plan4-integration` at `eb9f9fe` (tag `plan4-phase4`) on 2026-10-04, in worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** P45-0, A, B, C and D merged. Review fixes (P45-R) running; review of D running.

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
| P45-B | Pragma hot path (drop `extend`) + G-252 | ✅ merged | `p45-b-pragma` (`408b9db`) | 2026-10-04 | −246 B (41,309 B; PLAN-4.5 net −34 B). One-pass pragma, nested prop objects by reference, `extend` dropped; one fused `walkView` skipped for plain subtrees; INITIALIZE per instance. Streams 149/item, ScopeCheckers 0. Limits lowered |
| P45-C | One render scheduler per app (+ rest of Collection, post-patch DOM emission) | ✅ merged | `p45-c-scheduler` (`6b59d7e`) | 2026-10-04 | −168 B (41,141 B; PLAN-4.5 net −202 B). `src/cycle/run/scheduler.ts`: per-app keyed microtask flush (render by depth, Collection, child views by reverse depth, one patch). MutationObserver, G-213 hold and the VT 20 ms window removed. Patches 1/1/1, streams 122/item. Limits lowered |
| P45-D | Lazy wiring, synchronous teardown + G-255/256 fixes (D151) + dev-only statics freeze (D152) | ✅ merged | `p45-d-lazy` (`a2c2158`) | 2026-10-04 | +132 B (41,273 B; PLAN-4.5 net −70 B). Streams 22/item, unmount setTimeouts 9, heap 0.95 MB. Teardown in `tearDown()` stops one level per macrotask (keeps xstream's restart guard). Freeze in `checks/statics.ts` (0 B core). Limits lowered |
| P45-R | Phase review fixes (G-257…G-265, + review of D) | 🟡 running | `p45-r-fixes` | | |
| P45-E | Change detection (only if profiles show it) | ⬜ | | | |
| P45-EV | Agent regression eval (~$30, user's terminal) | ⬜ | | | after P45-D |

## Decisions

| ID | Date | Decision | By |
|---|---|---|---|
| D155 | 2026-10-04 | P45-Q9: after an input event a controlled field is always put back to the model's value, even when the state is structurally equal (React's controlled-input behaviour); CHANGELOG entry | User |
| D154 | 2026-10-04 | P45-D: `app.sinks` and child sinks no longer carry placeholder READY/PARENT/non-driver sinks (undocumented); DevTools `onContextChanged` fires only for components with their own `.context`; teardown stops one stream level per macrotask (not one global stop) to keep xstream's restart guard; frozen-static mutations report as the existing SYG216 (no new code) | Coordinator |
| D153 | 2026-10-04 | P45-C: keep the first-render gate (a new component's first render waits for its intent to subscribe, ~1 ms on mount only), so a visible element always responds. Accept the flush's microtask-hop wait (≤ 10 hops while STATE actions keep arriving) as "after the reducer queue drains". DOM source emits after every patch (within D146) | Coordinator |
| D152 | 2026-10-04 | P45-Q8: a component's static `initialState`/`model`/`context`/`calculated` are shared by all instances (no per-instance deep copy). Dev-only: freeze them when diagnostics are on so in-place mutation throws in dev; core cost ~0 B | User |
| D151 | 2026-10-04 | P45-Q7: fix G-255 (same root vnode twice) and G-256 (markers inside fragments) in PLAN-4.5 | User |
| D150 | 2026-10-04 | Timing ratios are measured after an idle wait (`h.quiet()`), so a setup's trailing teardown isn't counted in the next op. The plan's "now" column takes P45-0's figures; the targets are unchanged | Coordinator |
| D146 | 2026-10-04 | (PLAN-4 tracker) PLAN-4.5 approved with P45-Q1…Q6 as recommended: own plan before PLAN-5; net ≤ 0 B core; nested JSX prop objects by reference; DOM driver emits from a post-patch hook; hard count gate in `npm test`, timings nightly; ~$30 regression eval after P45-D | User |

## Gaps

| ID | Found | Sev | Area | Description | Status |
|---|---|---|---|---|---|
| G-250 | P45-0 | Low | process | Parallel subagents shared scratchpad log names and overwrote each other's logs. Briefs now require a workstream prefix on scratch files | Fixed (briefs) |
| G-252 | P45-A | Med | component.ts | `initState` writes the first instance's INITIALIZE reducer onto the shared user `model`, so the first instance ever created is retained forever (its intent streams and 1 ScopeChecker), and every later instance runs the first instance's memoised `addCalculated` (shared cache). Blocks "retained ScopeCheckers = 0". Also: `devtools-copy-as-test` clicked `.toggle-all` before the render (state led DOM under load); now waits for it | Fixed (P45-B) |
| G-253 | P45-A | Low | delegator | A non-bubbling stream that restarts after its shared record was removed, while a newer stream made a fresh record, can lose events | → G-263 |
| G-254 | P45-B | Low | tests | `p4-p1b-view-transitions` "200 ms cap" used a fixed 5 ms wait and failed once under full-suite load; now polls | Fixed |
| G-255 | P45-B | Low | component.ts | Pre-existing: a view returning the same root vnode object twice loses its child components on the second render (root `componentsProcessed` flag) | Fixed (P45-D) |
| G-256 | P45-B | Low | component.ts | Pre-existing: markers inside a fragment (e.g. Transition in `<>…</>`) are never processed | Fixed (P45-D) |
| G-257 | review A–C | High | scheduler | First-render gate waits on a 1 ms timer the flush doesn't wait for: a cross-Collection move of items that have intent+model is two patches ~2 ms apart (item missing in between). Confirmed by script; kanban lanes hit it | → P45-R |
| G-258 | review A–C | Med | view transitions | With the quiet window gone, G-257's second patch lands mid-animation (item pops in) | → P45-R (fix G-257) |
| G-259 | review A–C | Med | component.ts | G-146 bypass reads a global input counter: any keystroke re-renders every component that gets an equal state (3 keystrokes → 3 renders of each Collection row) | → P45-R |
| G-260 | review A–C | Med | scheduler/DOM driver | A non-idempotent element-measuring loop (patch → element → action → patch) is now microtask-only and can freeze the tab; before it was timer-paced | → P45-R |
| G-261 | review A–C | Low | DOM driver | Transition leave `rm()` and Portal `tryMount` change the DOM outside a patch; the root isn't re-emitted | → P45-R |
| G-262 | review A–C | Low | scheduler | Public `collection()`/`switchable()` with root sources: `__d` undefined → NaN keys; items treated as app roots | → P45-R |
| G-263 | review A–C | Low | delegator | Never-started non-bubbling records are kept forever; a restarted stream re-adds a stale record (supersedes G-253) | → P45-R |
| G-264 | review A–C | Low | component.ts | `addComponent` writes `props.key` into a user's lent `props` object | → P45-R |
| G-265 | review A–C | Low | pragma | Pragma vnodes have a non-Object prototype: Copy as test throws for an action carrying JSX; devtools/diagnostics `isPlain` checks miss them | → P45-R |
| G-251 | P45-0 | Low | docs | `research/p45-perf-baseline.md` still names the old `perf/` paths | Open (fix at close-out) |

## Merge measurements

| Merge | Gated size | Collection select (ratio / CPU ratio) | Mount 1k | Leaf 30 | Keystroke | Single select |
|---|---|---|---|---|---|---|
| P45-0 baseline | 41,343 | 28.4× / 90× | 6.9–7.5× | 12.9–15.7× | 9.0–9.2× | 16.3–16.7× |
| + P45-A | 41,555 | 24.5× / 15.2× | 6.5× | 11.8× | 10.2× | 17.2× |
| + P45-B | 41,309 | 12.0× / 7.7× (9.6 ms) | 4.7× (64.3 ms) | 11.2× (7.25 ms) | 5.7× (4.6 ms) | 9.3× (7.4 ms) |
| + P45-C | 41,141 | 11.3× / 2.8× (10.15 ms) | 3.9× (58.4 ms) | 4.0× (2.4 ms) | **1.9× (1.5 ms) met** | 4.4× (4.0 ms) |
| + P45-D | 41,273 | 16.4× / 2.6× (8.2 ms) | **2.6× (36.8 ms) met** | **1.8× (1.0 ms) met** | **1.8× (1.55 ms) met** | 7.4× (3.7 ms) |

React's times were 0.65–0.8 ms in the P45-B run (0.5 before), so the P45-B ratios flatter; the absolute Sygnal times in parentheses are the fairer comparison.

Latency is now held up mostly by the per-component 1 ms debounce floor (P45-C); P45-A's gain is in CPU (profile: Collection select busy 338 → 135 ms/run, `patchVnode` 125 → 14 ms).

## Log

- 2026-10-04 — P45-D merged (`a2c2158`); gates green first time; limits lowered (streams 22, timeouts 100, heap 1.2). A–C review: 9 findings (G-257…G-265). D154/D155. P45-R and a review of D started.
- 2026-10-04 — P45-C merged (`6b59d7e`); all gates green first time; limits lowered (patches 1/1/1, streams 122, timeouts 71,000). D151–D153. P45-D and an A–C phase review started. P45-Q9 (G-146 render-after-input) asked.
- 2026-10-04 — P45-B merged (`408b9db`); gates green after a flake fix (G-254); limits lowered (streams 149, timeouts 79,000, ScopeCheckers 0). P45-C started. P45-Q7/Q8 asked.
- 2026-10-04 — P45-A merged (`08e208c`); gates green after a test-race fix (G-252 note); limits lowered (ScopeCheckers 1, heap 1.5 MB). P45-B started.
- 2026-10-04 — P45-0 merged (`fb1f4eb`); gates re-run on integration.
- 2026-10-04 — `plan45-integration` cut from `plan4-phase4`. Tracker created. P45-0 and P45-A started.
