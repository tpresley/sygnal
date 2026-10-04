# PLAN-4.5 performance baseline (re-run of the 5.4.0 audit on PLAN-4)

> Paths updated after P45-0 moved the harness from `perf/` to `benchmarks/audit/` (G-251).

Branch `exp/p45-perf-baseline` from `plan4-integration` @ `a7efb5d`. Measurement and analysis only; no product changes.
The harness is `benchmarks/audit/`: the 5.4.0 audit's harness unchanged, plus `benchmarks/audit/instrument.mjs` (counts) and `benchmarks/audit/retained.mjs` (settled retention). The 5.4.0 results are in `benchmarks/audit/baseline-5.4.0/`, the audit report is `benchmarks/audit/report.html`, and this run's raw output is in `benchmarks/audit/results-plan4/`.

```bash
npm --prefix perf install && npm run build
node benchmarks/audit/build.mjs && node benchmarks/audit/build.mjs --profile
node benchmarks/audit/bench.mjs --out=results/plan4.json         # speed + memory, median of 10 after 3 warmups
node benchmarks/audit/instrument.mjs                             # patches, streams, timers, retained ScopeCheckers (heap snapshots)
node benchmarks/audit/retained.mjs [--dist=<other build>]        # heap/DOM nodes 200 ms, 1 s, 3 s after create/clear cycles
node benchmarks/audit/profile.mjs --page=table-coll --op="select row (1k)" --inclusive
```

## 1. Before → after (5.4.0 → plan4-integration)

Both runs: same machine (Apple M3 Max), headless Chromium 153, production builds, median of 10 after 3 warmups (10k create, 10k select and clear-after-select use a fresh page and 4–5 runs). Latency runs from dispatch until the DOM shows the result, with layout. CPU is main-thread task time until 150 ms after the result. React 19.2 and Vue 3.5 were re-run in the same session; they came out 0–12% slower than in the 5.4.0 session, so read a Sygnal change under about 10% as noise.

Latency / CPU in ms. "Coll." means one Collection item component per row; counters and their ops are Collection items too.

| Op | Sygnal 5.4.0 | Sygnal PLAN-4 | Coll. 5.4.0 | Coll. PLAN-4 | React PLAN-4 run | Vue PLAN-4 run |
|---|---:|---:|---:|---:|---:|---:|
| create 1k rows | 20.3 / 23.0 | 20.5 / 22.8 | 128.5 / 167.2 | 137.4 / 180.6 | 13.6 / 18.8 | 12.8 / 17.5 |
| replace 1k rows | 21.9 / 22.7 | 23.3 / 24.6 | 153.3 / 266.0 | 187.7 / 297.4 | 17.8 / 21.2 | 15.5 / 18.9 |
| update every 10th (1k) | 8.5 / 7.8 | 8.2 / 7.4 | 31.1 / 114.8 | 27.0 / 107.4 | 1.9 / 3.2 | 1.9 / 3.4 |
| select row (1k) | 7.3 / 6.3 | 7.1 / 6.1 | 32.0 / 179.0 | 38.5 / 184.8 | 0.55 / 1.6 | 0.5 / 1.6 |
| swap rows (1k) | 7.2 / 6.5 | 7.8 / 7.2 | 19.3 / 56.6 | 23.3 / 68.7 | 13.2 / 16.5 | 1.3 / 2.7 |
| remove row (1k) | 7.4 / 8.1 | 7.9 / 8.8 | 25.9 / 67.2 | 26.2 / 69.4 | 1.4 / 4.2 | 1.0 / 4.0 |
| create 10k rows | 179.8 / 198.5 | 195.7 / 217.3 | 1458 / 1536 | 1494 / 1527 | 273.1 / 294.8 | 141.7 / 163.8 |
| append 1k to 1k | 23.9 / 24.7 | 24.4 / 25.1 | 170.9 / 246.1 | 187.9 / 277.5 | 14.0 / 16.9 | 14.6 / 17.7 |
| clear 1k rows | 4.9 / 3.1 | 5.2 / 3.5 | 9.5 / 124.2 | 10.6 / 131.0 | 2.7 / 3.1 | 2.1 / 2.6 |
| clear 1k after a select | 5.1 / 3.6 | 5.5 / 3.9 | 422.5 / 539.8 | 461.0 / 585.5 | 3.4 / 4.2 | 2.2 / 2.9 |
| select row (10k) | 44.1 / 46.3 | 46.2 / 47.9 | 137.2 / 283.2 | 144.3 / 291.0 | 4.3 / 8.0 | 8.1 / 12.7 |
| mount 1k components | — | — | 97.2 / 141.6 | **110.0 / 157.4** | 9.7 / 16.1 | 9.8 / 16.5 |
| update 1 of 1k | — | — | 13.3 / 13.6 | **8.0 / 7.3** | 0.8 / 2.9 | 0.55 / 2.5 |
| unmount 1k components | — | — | 9.0 / 125.8 | 9.9 / 128.0 | 2.0 / 2.7 | 2.2 / 2.8 |
| leaf update, 30 deep | 5.8 / 19.0 | 5.9 / 18.3 | — | — | 0.4 / 0.75 | 0.4 / 0.8 |
| keystroke (1k list) | 4.4 / 2.7 | 4.4 / 2.9 | — | — | 0.5 / 1.3 | 0.4 / 1.2 |

Read-out:
- **The only clear gain is update 1 of 1k** (−40%, from PF-1). Its ratio to the best of React and Vue went from 24× to 14×.
- **Collection mount and create are 7–12% slower.** Streams per item went from 141 to 151, and the extra ones come from PLAN-4's per-component wiring.
- Replace, append and swap on the Collection are 10–20% slower. That is at or a little above the noise level; the likely cause is the same extra wiring plus pickCombine's G-213 bookkeeping (`fresh` set, a `batch()` timer per new listener).
- **Single-component Sygnal is unchanged** (select 14× the best of React and Vue, leaf 30 deep 15×, keystroke 11×).

Memory (JS heap after forced GC, MB, sampled 200 ms after the last step, as in the audit):

| App | 5.4.0: ready / populated / 10k / after cycles | PLAN-4 |
|---|---|---|
| Sygnal table | 1.55 / 2.40 / 9.12 / 1.89 | 1.56 / 2.40 / 9.12 / 1.90 |
| Sygnal Collection table | 1.62 / 32.73 / 329.8 / 27.63 | 1.63 / 34.40 / 347.8 / 49.42 (7,041 nodes)* |
| Sygnal counters (6 cycles) | 1.54 / 30.29 / — / 6.33 | 1.54 / 31.94 / — / 6.33 |
| React table / counters | 1.54 / 2.90 / 12.52 / 2.32; counters 2.66 → 2.21 | same |
| Vue table / counters | 1.32 / 2.64 / 12.40 / 1.64; counters 3.69 → 1.91 | same |

\* **Not a regression.** The bench samples 200 ms after back-to-back cycles, while the teardown backlog is still draining. `retained.mjs` (5 cycles of 1k create/clear, no gap) gives the same result on both builds:

| Build | +200 ms | +1 s | +3 s |
|---|---|---|---|
| 5.4.0 | 52.65 MB / 14,041 nodes | 10.39 MB / 41 nodes | 10.39 MB / 41 nodes |
| PLAN-4 | 55.03 MB / 14,041 nodes | 10.42 MB / 41 nodes | 10.42 MB / 41 nodes |

The settled leak is about 1.75 MB per 1k-item cycle in both builds (one cycle: 4.04 MB). The 200 ms figure is a race, so the gate below uses the settled value.

## 2. Findings 1–6 on the current code

Counts come from `benchmarks/audit/instrument.mjs`, run on an unminified build with the patch and Stream-constructor counters injected at build time.

| # | Finding | Status | Numbers 5.4.0 → PLAN-4 | Current source |
|---|---|---|---|---|
| 1 | No render batching; every child render repatches from the root; `processSuspensePost` copies every vnode that has children | **OPEN** | DOM patches: select row in a 1k Collection 1,001 → **1,001**; update every 10th 102 → **102**; leaf 30 deep 51 → **51**; single-component select 1 → 1. Update 1 of 1k counters: 3 patches (the clicked item, then the parent). Collection select profile: snabbdom 54.6% self (`patchVnode` 38.0%, `updateChildren` 11.1%); driver sink inclusive 75%; `processSuspensePost` 6.5% (5.4.0: 7%); `IsolateModule.update` 7.6% (5.4.0: 7%) | 3× `debounce(1)`: `src/component.ts:1177`, `:1382`, `:1640`. `injectComponents` copies every ancestor (`:1794–1836`). `processSuspensePost` (`:1865–1878`, copy at `:1877`). The driver patches each root vnode (`src/cycle/dom/makeDOMDriver.ts:121`) |
| 2 | Many streams per component; teardown costs one setTimeout per stream | **OPEN, slightly worse** | Streams per item: 141 → **151** (counter), **156** (table row with 2 intent streams). Mounting 1k counters: 151,008 streams, 4,005 setIntervals, 1,015 setTimeouts. Unmount: 74,011 → **79,013** setTimeouts; clearing a 1k table: **89,014**. Heap for 1k counters: 30.3 → 31.9 MB | init* stages `component.ts:412–423`; deferred dispose `:474`; xstream `Stream._remove` → `setTimeout(_stopNow)` (`node_modules/xstream/index.js:889`) |
| 3 | Quadratic Collection plumbing | **PARTLY FIXED** (PF-1, 3-R) | Update 1 of 1k: 13.3 → 8.0 ms. `PickCombine.up` still costs 8.9% inclusive in the select profile (up to 1,000 `up()` calls per action) | Fixed: `instanceLens.get` starts its scan at the item's last index (`src/cycle/state/Collection.ts:67–80`); `fieldLense.set` uses a Map (`component.ts:1440`); items with an id keep their identity (`:1421`). Open: `PickCombine.up()` rebuilds the N-element array on every item emission (`src/cycle/state/pickCombine.ts:50–56`, `:93–101`); `instanceLens.set` maps the whole array on every item write (`Collection.ts:83–95`); a reorder falls back to a scan; `fieldLense.get` maps all items on each emission (`:1428`, O(N), acceptable) |
| 4 | EventDelegator listener leak on unmount | **OPEN** | Heap-snapshot delta after 5×1k mount/unmount, settled 1.5 s: **5,000 ScopeCheckers** (counters), **10,000** (Collection table, 2 intent streams per row); Component delta 1. Settled retained heap: about 10.4 MB per 5×1k table cycles, the same as 5.4.0 | The bubbling path returns a bare `subject` with no stop hook (`src/cycle/dom/EventDelegator.ts:163–169`); `insertListener` (`:255–282`); `PriorityQueue.delete` exists (`PriorityQueue.ts:23`) but nothing calls it |
| 5 | Pragma hot path and whole-tree walks on every render | **OPEN** | Single-component select: pragma 45% of busy time (`pragma/index.ts` 18%, `fn.ts` 15.9%, `extend` 7.3%, `jsx-runtime` 3.9%; 5.4.0: 48%); `getComponents` 3.7%, `stampFields` 1.5%, `processSuspensePost` 1.2%; snabbdom 11% | `mapObject` with deep `extend(true)` (`src/pragma/fn.ts:24–58`); `rewriteModules` (`src/pragma/index.ts:46`); `sanitizeData` (`:144–147`), called at `:213`. Walks: `stampFields` (`component.ts:902`, `:1927`), `preprocessVdom` (`:903`, `:1937`), `getComponents` (`:1209`, `:1743`), `processSuspensePost` (`:1865`) |
| 6 | Timer latency floor, per-vnode module work, deep compares, MutationObserver | **OPEN** | Keystroke 4.35 ms latency on 2.85 ms of CPU (unchanged). Leaf 30 deep: 945 setIntervals, 387 setTimeouts for one click. Select row in a 1k Collection: 3,005 setIntervals. Collection select: `syncClassName` 4.7%, `syncControlled` 3.8%, `queueSelect` 3.0% (11.5%; 5.4.0: 12%). `objIsEqual` 0.2% | `DebounceOperator` re-arms `setInterval` (`src/extra/xstreamExtras.ts:60–71`); modules `src/cycle/dom/modules.ts`, `selectModule.ts:18–23`, `controlledInputModule.ts:36`/`:53`, `classNameModule.ts:41`; `objIsEqual` checks identity first (`src/cycle/state/objIsEqual.ts:8–11`), depth 5, used at `component.ts:590–626`, `:1157–1169`, `:2112`; subtree MutationObserver with old values (`makeDOMDriver.ts:92`, `:124–133`) |

## 3. Recommendations 1–10 against PLAN-4

Byte deltas are rough estimates of the core gzip change (kanban gate: 41,343 B against a 42,300 B budget; PLAN-5 needs about 880 B). **S** marks a recommendation that likely saves bytes.

| # | Change | Applicable | Touch points (current) | Est. gzip Δ | Risks against PLAN-4 features |
|---|---|---|---|---|---|
| 1 | One render scheduler: dirty set, parents first, one patch per flush on a microtask after the reducer queue. Replaces the 3 `debounce(1)` | Yes, unchanged | `component.ts:1177`, `:1382`, `:1640`, `:1204`; `makeDOMDriver.ts:114–143` | +250–400 for the scheduler, minus ≈200 when `DebounceOperator` leaves the core (kanban doesn't import `debounce`): **≈ +50…+200** | **G-213 hold** (`pickCombine.ts:4–26`, D138) assumes each Collection receives an action's state in its own debounce task; with one flush a move is a single patch, so the hold (and `live`, `batch`, `fresh`) may be removable (≈ −150 B). **View Transitions** quiet window (`viewTransition.ts:29–30`, 20 ms, 200 ms cap) exists for multi-patch moves; it still works but becomes 20 ms of dead time, so shrink it. **Element commands** run in a microtask after the next patch (`elementCommands.ts:47–49`), so the flush must patch before that microtask. **G-146**: `_inputSeq` is taken before the debounce (`:1176`) and stamped at `:902`; take it at flush time. **B-003/B-013** assume the Collection's debounce lag (`:686`, `:987`, `:1003`). **testing.ts**: the `t.settle()` 20 ms quiet window and E11 fake timers (`testing.ts:117–119`, `:1037–1130`); a microtask flush isn't faked, so waits get shorter but never stuck. **2-R HMR / G-231**: the scheduler must be per app (on the app's IsolateModule), never module-global |
| 2 | Keep unchanged vnodes identical: `processSuspensePost`/`injectComponents` copy only the changed path, and return the input when nothing needs injecting | Yes | `component.ts:1646`, `:1694`, `:1794–1836`, `:1865–1878` | +20–50 | Low. The Suspense `data-sygnal-ready` marking (`:1806`) must still copy |
| 3 | Remove delegator listeners on stop | Yes | `EventDelegator.ts:147–169`, `:255–282`; `PriorityQueue.ts:23`; `SymbolTree.ts` pruning; `MainDOMSource.ts:131–138` | +60–120 | Low. Controls (CT-1, kind-blind `[data-control]`) and element-command `select().elements()` share the delegator: stopping one stream must not remove a sibling's destination |
| 4 | Linear-time Collection: key→index map per array; coalesce `PickCombine.up()` once per tick | Partly (PF-1 did lookups and set) | `Collection.ts:67–95`; `pickCombine.ts:50–56`, `:93–101`, `:128–138` | +40–90 | **G-213/3-R**: coalescing `up()` interacts with the `later` hold and B-010's reorder re-emit; do it inside #1. B-010 and G-102 tests guard sort and filter |
| 5 | Lazy per-component wiring; isolate only DOM and STATE per item; tear down a subtree synchronously | Yes; more pressing now (151 streams) | `component.ts:187–432` (init* `:412–423`), `:441–479` (dispose), `src/cycle/isolate/`, item isolation in `Collection.ts` | ±150 | Medium–high. DISPOSE actions and `onDispose` rely on the deferred tick (`:472`). GS-1 `uses` (`:384–385`), GS-5 persist setup (`:387`), GS-9 uid, G-144 replies and devtools hooks all live in init. Synchronous teardown needs a guard for a stream re-subscribed in the same tick |
| 6 | Pragma rewrite: one pass, no `extend`; fuse the per-render walks | Yes | `src/pragma/fn.ts:1–58`; `src/pragma/index.ts:20–46`, `:84`, `:144–147`, `:213`; `component.ts:902–903`, `:1209`, `:1927–2010` | **S: −300…−500** (`extend` is used only here, so the dependency leaves the bundle) | `extend(true)` deep-copies nested prop objects (style, attrs, dataset); a shallow pass passes the app's objects by reference, so test an app that mutates a style object. Keep G-152 (dataset key casing), B-011 (text/children), focus props and SVG `ns` |
| 7 | Tag checks first in selectModule, controlledInputModule and classNameModule | Yes (11.5% of Collection select) | `selectModule.ts:18–23`, `controlledInputModule.ts:36–58`, `classNameModule.ts:41–70` | +10–30 | Low. classNameModule applies to any element with `className` (B-012), so gate it on the prop, not on the tag |
| 8 | Cheaper change detection (identity, then shallow) | Partly; identity-first already exists, and GS-4 made "same object = no change" the semantics | `component.ts:590–626`, `:1157–1169`, `:2112`; `objIsEqual.ts` | ±20 | Low priority (0.2% of the profile). Props built inline in JSX still need a structural compare; GS-6 `STATE.watch` uses `objIsEqual` |
| 9 | Drop the subtree MutationObserver; emit the root from a snabbdom post hook | Yes | `makeDOMDriver.ts:89–97`, `:120–143` | **S: −60…−120** | **Element commands** need the DOM source to emit after each patch (`elementCommands.ts:22–26`); a post hook does exactly that, but DOM mutations made outside a patch no longer re-emit. The router has its own observer (`router.ts:145`) and is unaffected; `testing.ts:1176` passes the observer through |
| 10 | Perf regression gate in CI | Yes | new `scripts/perf-gate.mjs` next to `size-gate.mjs`, built on `benchmarks/audit/instrument.mjs` | 0 | Timings depend on the machine, so gate on counts (below) |

Net bytes if all are done: about −100 to +300 B. #6 and #9 pay for #1, #3 and #4, and #1 can also remove the G-213 hold.

## 4. Suggested PLAN-4.5 workstreams (in order)

1. **P45-0 Gate and harness** (#10): `scripts/perf-gate.mjs` on top of `instrument.mjs` and `retained.mjs`, ratcheted at today's counts, so each later stream proves its gain. Move `benchmarks/audit/` to `benchmarks/audit/` (see §6).
2. **P45-A Identity and leaks** (#2, #3, #7): small, independent, low risk. #2 cuts patch cost before batching lands; #3 removes the 10.4 MB per 5k-item leak.
3. **P45-B Pragma** (#6, plus fusing the walks): saves 300–500 B, which buys room for #1; independent of the rest.
4. **P45-C Render scheduler** (#1, the rest of #4, #9; revisit the G-213 hold and the View Transitions quiet window): one workstream, because all of these change when the DOM patches. Largest gain and largest risk. Needs the full browser suite and the G-146, B-003/B-013, E11 and G-213 tests; an A/B re-run of this bench at merge.
5. **P45-D Lazy wiring and synchronous teardown** (#5): last, because it is the largest refactor of `component.ts` and builds on C's simpler render path. Target: ≤ 40 streams per item, sub-30 ms mount of 1k.
6. #8 only if a profile still shows it after C and D.

## 5. Proposed perf CI gate (rec 10)

**Hard gate: deterministic counts** from `instrument.mjs` and `retained.mjs`, independent of the machine. The gate starts at today's value (it fails only if a change makes the count worse) and each workstream lowers it when it lands:

| Metric | Today | Gate now | After A/B | Target after PLAN-4.5 |
|---|---:|---:|---:|---:|
| DOM patches, select row in a 1k Collection | 1,001 | ≤ 1,001 | ≤ 1,001 | ≤ 2 (C) |
| DOM patches, update every 10th in a 1k Collection | 102 | ≤ 102 | ≤ 102 | ≤ 2 (C) |
| DOM patches, leaf click 30 deep | 51 | ≤ 51 | ≤ 51 | ≤ 2 (C) |
| Streams per Collection item (1k counters) | 151 | ≤ 155 | ≤ 155 | ≤ 40 (D) |
| setTimeout calls, unmount 1k counters | 79,013 | ≤ 81,000 | ≤ 81,000 | ≤ 1,100 (D) |
| Retained ScopeCheckers after 5×1k mount/unmount | 5,000 | ≤ 5,000 | 0 (A) | 0 |
| Settled heap after 5×1k Collection create/clear, minus ready | 8.8 MB | ≤ 9.5 MB | ≤ 1.5 MB (A) | ≤ 1 MB |

**Soft gate (warn only): timing ratios** to the React arm in the same run (median of 10), for select row 1k (single component: 14×; Collection: 77×), mount 1k (11×), update 1 of 1k (14×), leaf 30 deep (15×). Warn when a ratio is more than 25% above the recorded value. Runs nightly or on demand, not on every PR: the full bench takes about 15 minutes.

## 6. Harness recommendation

Keep both; delete neither. **For PLAN-4.5, use `benchmarks/audit/` (this branch) as the primary harness** and move it to `benchmarks/audit/` when P45-0 lands. Why:
- It has 16 ops across 5 scenarios (P-3 has 5 ops in 1 scenario), including the ops that expose findings 1, 2 and 6 (select, deep, keystroke, mount/unmount).
- It records CPU as well as latency, measures memory, has a source-mapped profiler down to `src/*.ts`, and now has the count instrumentation the gate needs.

From P-3 (`browser-tests/perf/` and `benchmarks/`), adopt:
1. the quiet-page step before each op (100 ms plus three idle callbacks), instead of `benchmarks/audit/`'s fixed `settle()`; it matters for the Collection ops with trailing teardown;
2. the paint and busy metrics;
3. the js-framework-benchmark entries (`benchmarks/js-framework-benchmark/`), which stay as-is for upstream submission.

Then align dependencies: `benchmarks/audit/` uses Vite 7 and React 19.2, while `benchmarks/` uses Vite 6 and React 19.3. P-3's clear-2k scenario can become one more op in `benchmarks/audit/lib/ops.mjs`, after which `browser-tests/perf/` can be retired.
