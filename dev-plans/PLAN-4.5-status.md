# PLAN-4.5 Status Tracker

Tracks progress for [PLAN-4.5.md](PLAN-4.5.md) (performance). The coordinator maintains it.

**Numbering:** decisions from **D150**, gaps from **G-250** (PLAN-4 ended at D148 / G-235).

**Integration branch:** `plan45-integration`, cut from `plan4-integration` at `eb9f9fe` (tag `plan4-phase4`) on 2026-10-04, in worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** P45-0, A, B, C, D, R and S merged (net core −153 B). P45-EV running in the user's terminal; P45-R2 running (merge after the eval).

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
| P45-R | Phase review fixes (G-257…G-272) | ✅ merged | `p45-r-fixes` (`69bd051`) | 2026-10-04 | +222 B (41,495 B; PLAN-4.5 net **+152 B**, over the ≤ 0 rule → P45-Q10). Counts unchanged. G-257 hold: a pending first-render gate holds the patch (≤ 50 ms) |
| P45-S | Core size trim, no behaviour change (D157) | ✅ merged | `p45-s-trim` (`7981cde`) | 2026-10-04 | −305 B (41,190 B; PLAN-4.5 net **−153 B**, 1,110 B headroom). Calculated-field setup, EventDelegator, Portal/Suspense/Transition, Collection sort; new `test/p45-s-trim.test.js` pins the rewritten paths |
| P45-R2 | Review fixes for R+S (G-273…G-281) | 🟠 committed, gates not run | `p45-r2-fixes` (`e528c7e`) | | The agent's install/build was refused by the auto-mode classifier; partial checks only (src vitest: no regressions; tsc). Merge + full gates after P45-EV finishes. Est. +110 B |
| P45-E | Change detection (only if profiles show it) | ⬜ | | | |
| P45-EV | Agent regression eval (~$30, user's terminal) | ⬜ | | | after P45-D |

## Decisions

| ID | Date | Decision | By |
|---|---|---|---|
| D158 | 2026-10-04 | P45-R2: keep the 41 B G-281 fix (root recorded on the scheduler) over the 15 B option that would stop peers writing into the root's sources (behaviour change). Vike's live shell state slices are marked caller-owned, so the dev freeze skips them. G-278 documented, not fixed (detection would rely on fake-timer internals) | Coordinator |
| D157 | 2026-10-04 | P45-Q10: one no-behaviour-change trim pass, then accept what's left. Result: −305 B, PLAN-4.5 net −153 B (the ≤ 0 rule holds). Further savings needing behaviour changes, for PLAN-5 to weigh: drop snabbdom's Fragment tag side effect (~150 B), move `run()` HMR swap code to a dev entry, drop the old `'ACTION | SINK'` forms, register marker handlers (Portal/Transition/ClientOnly/Lazy/Suspense) on import, strip the debug log in production | User |
| D156 | 2026-10-04 | P45-R: while a component created in this flush waits for its first-render gate, the app's patch is held (≈ 1 ms, ≤ 50 ms) so a cross-Collection move is one patch — the mechanism of D153. G-272 lands as a guard without a failing-first test (no public path reproduces it). G-265: devtools/diagnostics plain-object checks deliberately keep treating vnodes as non-plain | Coordinator |
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
| G-253 | P45-A | Low | delegator | A non-bubbling stream that restarts after its shared record was removed, while a newer stream made a fresh record, can lose events | Fixed (P45-R, G-263) |
| G-254 | P45-B | Low | tests | `p4-p1b-view-transitions` "200 ms cap" used a fixed 5 ms wait and failed once under full-suite load; now polls | Fixed |
| G-255 | P45-B | Low | component.ts | Pre-existing: a view returning the same root vnode object twice loses its child components on the second render (root `componentsProcessed` flag) | Fixed (P45-D) |
| G-256 | P45-B | Low | component.ts | Pre-existing: markers inside a fragment (e.g. Transition in `<>…</>`) are never processed | Fixed (P45-D) |
| G-257 | review A–C | High | scheduler | First-render gate waits on a 1 ms timer the flush doesn't wait for: a cross-Collection move of items that have intent+model is two patches ~2 ms apart (item missing in between). Confirmed by script; kanban lanes hit it | Fixed (P45-R) |
| G-258 | review A–C | Med | view transitions | With the quiet window gone, G-257's second patch lands mid-animation (item pops in) | Fixed (P45-R) |
| G-259 | review A–C | Med | component.ts | G-146 bypass reads a global input counter: any keystroke re-renders every component that gets an equal state (3 keystrokes → 3 renders of each Collection row) | Fixed (P45-R) |
| G-260 | review A–C | Med | scheduler/DOM driver | A non-idempotent element-measuring loop (patch → element → action → patch) is now microtask-only and can freeze the tab; before it was timer-paced | Fixed (P45-R) |
| G-261 | review A–C | Low | DOM driver | Transition leave `rm()` and Portal `tryMount` change the DOM outside a patch; the root isn't re-emitted | Fixed (P45-R) |
| G-262 | review A–C | Low | scheduler | Public `collection()`/`switchable()` with root sources: `__d` undefined → NaN keys; items treated as app roots | Fixed (P45-R) |
| G-263 | review A–C | Low | delegator | Never-started non-bubbling records are kept forever; a restarted stream re-adds a stale record (supersedes G-253) | Fixed (P45-R) |
| G-264 | review A–C | Low | component.ts | `addComponent` writes `props.key` into a user's lent `props` object | Fixed (P45-R) |
| G-265 | review A–C | Low | pragma | Pragma vnodes have a non-Object prototype: Copy as test throws for an action carrying JSX; devtools/diagnostics `isPlain` checks miss them | Fixed (P45-R) |
| G-266 | review D | High | scheduler | Shared start timers are per delay app-wide: a child created after the 0 ms timer fired joins the pending 1/10 ms timer, so its intent/BOOTSTRAP runs before its own INITIALIZE (isolated child shows 1 instead of 2). Confirmed | Fixed (P45-R) |
| G-267 | review D | Med | scheduler | `tearDown` loop aborts when one stream's stop throws; the rest of that level are never stopped. Confirmed | Fixed (P45-R) |
| G-268 | review D | Low/Med | diagnostics | D152 freeze also freezes caller-owned initial state (`renderComponent({ initialState: fixture })`, element host props, Vike data). Confirmed | Fixed (P45-R) |
| G-269 | review D | Low | component.ts | Internal render input `c` collides with a peer named `c` | Fixed (P45-R) |
| G-270 | review D | Low | scheduler | A shared start timer that never fires (`vi.clearAllTimers()`) blocks every later component with that delay | Fixed (P45-R) |
| G-271 | review D | Low | component.ts | `hub.set` is O(children² × sinks) per render | Fixed (P45-R) |
| G-272 | review D | Low | component.ts | INITIALIZE timer not cancelled on stop/restart → sent twice | Fixed (P45-R) |
| G-273 | review R+S | Med | scheduler | A first-render gate timer that never fires (`vi.clearAllTimers()`, timer switch) pins the hold: later patches wait for an unrelated flush. Confirmed | → P45-R2 |
| G-274 | review R+S | Med | scheduler | The flush-cap counter resets only via one timer; if lost, every later flush is timer-paced; with never-advanced fake timers raw `run()` stops after 99 flushes. Confirmed | → P45-R2 |
| G-275 | review R+S | Med | diagnostics | D152 freeze still freezes caller-owned objects that sygnal/element and Vike merge into a wrapper's `initialState` (host `arr.push` throws in dev). Confirmed for element | → P45-R2 |
| G-276 | review R+S | Low/Med | DOM driver | The G-261 poke listener sits on the first root, which the first patch can replace (`#app` mount + `<div id="app">` view) | → P45-R2 |
| G-277 | review R+S | Low | DOM driver | The `sygnal-dom` poke bubbles past the innermost app root (outer apps re-emit; reaches document) | → P45-R2 |
| G-278 | review R+S | Low | scheduler/testing | With `vi.useFakeTimers()` and raw `run()`, creating a gated component holds the app's patch until the clock advances | → P45-R2 |
| G-279 | review R+S | Low | transition | Transition-leave poke can fire before a `style.remove` delayed removal | → P45-R2 |
| G-280 | review R+S | Low | diagnostics | D152 no longer freezes `component({ … })` option statics | → P45-R2 |
| G-281 | review R+S | Low | component.ts | Root detection `_r = !sources.__k` depends on the caller's sources object being mutated (`A(sources); B(sources)`) | → P45-R2 |
| G-251 | P45-0 | Low | docs | `research/p45-perf-baseline.md` still names the old `perf/` paths | Fixed (close-out) |

## Merge measurements

| Merge | Gated size | Collection select (ratio / CPU ratio) | Mount 1k | Leaf 30 | Keystroke | Single select |
|---|---|---|---|---|---|---|
| P45-0 baseline | 41,343 | 28.4× / 90× | 6.9–7.5× | 12.9–15.7× | 9.0–9.2× | 16.3–16.7× |
| + P45-A | 41,555 | 24.5× / 15.2× | 6.5× | 11.8× | 10.2× | 17.2× |
| + P45-B | 41,309 | 12.0× / 7.7× (9.6 ms) | 4.7× (64.3 ms) | 11.2× (7.25 ms) | 5.7× (4.6 ms) | 9.3× (7.4 ms) |
| + P45-C | 41,141 | 11.3× / 2.8× (10.15 ms) | 3.9× (58.4 ms) | 4.0× (2.4 ms) | **1.9× (1.5 ms) met** | 4.4× (4.0 ms) |
| + P45-D | 41,273 | 16.4× / 2.6× (8.2 ms) | **2.6× (36.8 ms) met** | **1.8× (1.0 ms) met** | **1.8× (1.55 ms) met** | 7.4× (3.7 ms) |
| + P45-R | 41,495 | 10.5× (7.35 ms) | 2.4× (37.4 ms) | 2.8× (1.7 ms) | 1.8× (1.45 ms) | 4.4× (3.1 ms) |
| + P45-S | 41,190 | (no runtime change) | | | | |

React's times were 0.65–0.8 ms in the P45-B run (0.5 before), so the P45-B ratios flatter; the absolute Sygnal times in parentheses are the fairer comparison.

Latency is now held up mostly by the per-component 1 ms debounce floor (P45-C); P45-A's gain is in CPU (profile: Collection select busy 338 → 135 ms/run, `patchVnode` 125 → 14 ms).

## Log

- 2026-10-04 — P45-R2 committed (`e528c7e`), gates pending (install refused in the agent's session; the coordinator runs them after the eval to avoid loading the machine). D158.
- 2026-10-04 — Review of R+S: 9 findings (G-273…G-281), 3 confirmed; P45-R2 started on its own branch. P45-S: no behaviour change found.
- 2026-10-04 — P45-S merged (`7981cde`); all gates green; 41,190 B (net −153 B). D157. G-251 fixed. P45-EV commands handed over; a review of R+S runs on a side branch (not merged while the eval runs).
- 2026-10-04 — P45-R merged (`69bd051`); all gates green; counts unchanged. Net +152 B → P45-Q10 asked. D156.
- 2026-10-04 — Review of D: 7 findings (G-266…G-272), sent to P45-R.
- 2026-10-04 — P45-D merged (`a2c2158`); gates green first time; limits lowered (streams 22, timeouts 100, heap 1.2). A–C review: 9 findings (G-257…G-265). D154/D155. P45-R and a review of D started.
- 2026-10-04 — P45-C merged (`6b59d7e`); all gates green first time; limits lowered (patches 1/1/1, streams 122, timeouts 71,000). D151–D153. P45-D and an A–C phase review started. P45-Q9 (G-146 render-after-input) asked.
- 2026-10-04 — P45-B merged (`408b9db`); gates green after a flake fix (G-254); limits lowered (streams 149, timeouts 79,000, ScopeCheckers 0). P45-C started. P45-Q7/Q8 asked.
- 2026-10-04 — P45-A merged (`08e208c`); gates green after a test-race fix (G-252 note); limits lowered (ScopeCheckers 1, heap 1.5 MB). P45-B started.
- 2026-10-04 — P45-0 merged (`fb1f4eb`); gates re-run on integration.
- 2026-10-04 — `plan45-integration` cut from `plan4-phase4`. Tracker created. P45-0 and P45-A started.
