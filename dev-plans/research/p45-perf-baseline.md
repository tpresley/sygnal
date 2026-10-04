# PLAN-4.5 performance baseline (re-run of the 5.4.0 audit on PLAN-4)

Branch `exp/p45-perf-baseline` from `plan4-integration` @ `a7efb5d`. Measurement and analysis only; no product changes.
Harness: `perf/` (the 5.4.0 audit's, copied unchanged plus `perf/instrument.mjs`); the 5.4.0 numbers are kept in `perf/baseline-5.4.0/`, the audit report in `perf/report.html`.

```bash
npm --prefix perf install && npm run build
node perf/build.mjs && node perf/build.mjs --profile
node perf/bench.mjs --out=results/plan4.json         # speed + memory, median of 10 after 3 warmups
node perf/instrument.mjs                             # patches, streams, timers, retained ScopeCheckers
node perf/profile.mjs --page=table-coll --op="select row (1k)" --inclusive
```

> **DRAFT** — measurements are on hold until the user's timed eval trials finish. Cells marked `TBD` are filled by the re-run.

## 1. Before → after (5.4.0 → plan4-integration)

Same machine (Apple M3 Max), headless Chromium, production builds, median of 10 after 3 warmups (10k/clear-after-select: fresh page, 4–5 runs). Latency = dispatch → DOM shows the result + layout; CPU = main-thread task time to 150 ms after the result. React 19.2 / Vue 3.5 re-run in the same session (ratios comparable).

| Op | Sygnal 5.4.0 lat / cpu | Sygnal PLAN-4 lat / cpu | Coll. 5.4.0 lat / cpu | Coll. PLAN-4 lat / cpu | React lat | Vue lat |
|---|---:|---:|---:|---:|---:|---:|
| create 1k rows | 20.3 / 23.0 | TBD | 128.5 / 167.2 | TBD | TBD | TBD |
| replace 1k rows | 21.9 / 22.7 | TBD | 153.3 / 266.0 | TBD | TBD | TBD |
| update every 10th (1k) | 8.5 / 7.8 | TBD | 31.1 / 114.8 | TBD | TBD | TBD |
| select row (1k) | 7.3 / 6.3 | TBD | 32.0 / 179.0 | TBD | TBD | TBD |
| swap rows (1k) | 7.2 / 6.5 | TBD | 19.3 / 56.6 | TBD | TBD | TBD |
| remove row (1k) | 7.4 / 8.1 | TBD | 25.9 / 67.2 | TBD | TBD | TBD |
| create 10k rows | 179.8 / 198.5 | TBD | 1458 / 1536 | TBD | TBD | TBD |
| append 1k to 1k | 23.9 / 24.7 | TBD | 170.9 / 246.1 | TBD | TBD | TBD |
| clear 1k rows | 4.9 / 3.1 | TBD | 9.5 / 124.2 | TBD | TBD | TBD |
| clear 1k after a select | 5.1 / 3.6 | TBD | 422.5 / 539.8 | TBD | TBD | TBD |
| select row (10k) | 44.1 / 46.3 | TBD | 137.2 / 283.2 | TBD | TBD | TBD |
| mount 1k components | — | — | 97.2 / 141.6 | TBD | TBD | TBD |
| update 1 of 1k | — | — | 13.3 / 13.6 | TBD | TBD | TBD |
| unmount 1k components | — | — | 9.0 / 125.8 | TBD | TBD | TBD |
| leaf update, 30 deep | 5.8 / 19.0 | TBD | — | — | TBD | TBD |
| keystroke (1k list) | 4.4 / 2.7 | TBD | — | — | TBD | TBD |

(Counters rows are Collection items, listed under "Coll.". 5.4.0 React/Vue latencies: see `perf/baseline-5.4.0/baseline.txt`.)

Memory (JS heap after forced GC, MB): 

| App | 5.4.0 ready / populated / 10k / after cycles | PLAN-4 |
|---|---|---|
| Sygnal table | 1.55 / 2.40 / 9.12 / 1.89 | TBD |
| Sygnal Collection table | 1.62 / 32.73 / 329.76 / 27.63 | TBD |
| Sygnal counters (1k, 6 cycles) | 1.54 / 30.29 / — / 6.33 | TBD |
| React counters | 1.45 / 2.66 / — / 2.21 | TBD |
| Vue counters | 1.29 / 3.69 / — / 1.91 | TBD |

## 2. Findings 1–6 on the current code

| # | Finding | Status | Evidence (current source) |
|---|---|---|---|
| 1 | No render batching; each child render repatches from the root; `processSuspensePost` copies every vnode with children | **OPEN** (expected; numbers TBD) | 3 per-component `debounce(1)`: `src/component.ts:1177` (collectRenderParameters), `:1382` (instantiateCollection), `:1640` (renderVdom). `injectComponents` copies every ancestor of a component (`:1794–1836`); `processSuspensePost` copies every vnode with children (`:1865–1878`, line 1877). DOM driver patches per root vnode (`src/cycle/dom/makeDOMDriver.ts:121`, `.fold(patch, …)`). Patches: select 1k Coll. 1,001 → TBD; update every 10th 102 → TBD; leaf 30 deep 51 → TBD |
| 2 | ~141 streams / 31 KB per component; teardown one setTimeout per stream | **OPEN** | Full wiring in every instance: `src/component.ts:412–423` (12 init* stages incl. context, HMR, peers, child sources, READY); dispose defers to `setTimeout` (`:474`); xstream `Stream._remove` schedules `_stopNow` per stream (`node_modules/xstream/index.js:889`). Streams/component 141 → TBD; setTimeouts on 1k unmount 74,011 → TBD |
| 3 | Quadratic Collection plumbing | **PARTLY FIXED** (PF-1, 3-R) | Fixed: `instanceLens.get` starts at the last index (`src/cycle/state/Collection.ts:67–80`, O(1) while order is stable; a reorder still scans); `fieldLense.set` uses one Map (`src/component.ts:1440`); `fieldLense.get` keeps identity for items with an id (`:1421`). Open: `fieldLense.get` still maps the whole array per emission (`:1428`, O(N) per state change, fine); `instanceLens.set` maps the whole array per item write (`Collection.ts:83–95`); `PickCombine.up()` rebuilds the N-array on every item emission (`src/cycle/state/pickCombine.ts:93–101`) → O(N²) on create/append/update-every-10th |
| 4 | EventDelegator listener leak on unmount | **OPEN** | `insertListener` adds to the priority queues (`src/cycle/dom/EventDelegator.ts:255–282`); the bubbling path returns the bare `subject` with no stop hook (`:163–169`); `PriorityQueue.delete` exists (`PriorityQueue.ts:23`) but nothing calls it. Retained ScopeCheckers after 5×1k counters: 5,000 → TBD; Coll. table: 10,000 → TBD |
| 5 | Pragma hot path + whole-tree walks per render | **OPEN** | `mapObject` reduces with deep `extend(true)` per key (`src/pragma/fn.ts:24–29`), run by `deepifyKeys`/`rewriteModules`/`omit` (`fn.ts:31–58`, `src/pragma/index.ts:144–147`, `:213`); walks per render: `stampFields` (`component.ts:902`, `:1927`), `preprocessVdom` (`:903`, `:1937`), `getComponents` (`:1209`, `:1743`), `processSuspensePost` (`:1865`) |
| 6 | Timer floor; per-vnode module work; deep compares; MutationObserver | **OPEN** | `DebounceOperator` re-arms a `setInterval` per emission (`src/extra/xstreamExtras.ts:60–71`); 8 modules on every vnode (`src/cycle/dom/modules.ts`): `selectModule.queueSelect` reads `tagName` of every element (`selectModule.ts:18–23`), `controlledInputModule.syncControlled` regex-tests every element with props (`controlledInputModule.ts:36`, `:53`), `classNameModule.syncClassName` (`classNameModule.ts:41`); `objIsEqual` depth 5 (identity first, `src/cycle/state/objIsEqual.ts:2–11`) on state/props/children/slots/context (`component.ts:1157–1169`, `:2112`); subtree MutationObserver with old values (`makeDOMDriver.ts:92`, `:124–133`). Keystroke latency 4.35 ms → TBD |

Profile shares (Collection select, 5.4.0: 74% DOM patch, `patchVnode` 36%, `processSuspensePost` 7%, `IsolateModule.update` 7%): TBD. Single-component select (5.4.0: pragma 48%, `sanitizeData` 42%): TBD.

## 3. Recommendations 1–10 against PLAN-4

Byte deltas are rough core-gzip estimates (kanban gate: 41,343 B of 42,300 B; PLAN-5 needs ≈ 880 B). **S** = likely saves bytes.

| # | Change | Applicable | Touch points (current) | Est. gzip Δ | Risks against PLAN-4 features |
|---|---|---|---|---|---|
| 1 | One render scheduler (dirty set, parent-first, one patch per flush, microtask after the reducer queue) replacing the 3 debounce(1) | Yes, unchanged | `component.ts:1177`, `:1382`, `:1640`; `makeDOMDriver.ts:114–143`; `instantiateSubComponents` `:1204` | +250–400 scheduler, −~200 when `DebounceOperator` drops out of apps that don't import `debounce` (kanban doesn't) → **≈ +50…+200** | **G-213 hold** (`pickCombine.ts:4–26`) assumes one action reaches each Collection in its own debounce task — must be re-derived (a single flush makes a move one patch, so the hold may become unnecessary: possible −150 B). **View Transitions** quiet window (`viewTransition.ts:29–30`, 20 ms/200 ms cap) assumes multi-patch moves; with one patch per action it still works but adds 20 ms; can be simplified. **Element commands** run in a microtask after the next patch (`elementCommands.ts:47–49`): a microtask flush must patch before them. **G-146**: `_inputSeq` is captured before the debounce (`:1176`) and stamped at `:902`; capture at flush. **B-003/B-013**: comments at `:686`, `:987`, `:1003` rely on the Collection debounce lag. **testing.ts**: `t.settle()` quiet window 20 ms and E11 fake timers (`testing.ts:117–119`, `:1037–1130`); a microtask/MessageChannel flush isn't faked by vitest by default, so waits get faster, not stuck. **2-R HMR / G-231 lesson**: the scheduler must be per app (on the app's IsolateModule), never module-global |
| 2 | Keep unchanged vnodes identical (`processSuspensePost`, `injectComponents` copy only changed paths) | Yes | `component.ts:1794–1836`, `:1865–1878`, `:1646`, `:1694` | +20–50 | Low. Suspense `data-sygnal-ready` marking (`:1806`) must still copy; snabbdom mutates `vnode.elm` on reused vnodes (fine: that's the point) |
| 3 | Remove delegator listeners on stop | Yes | `EventDelegator.ts:147–169`, `:255–282`; `PriorityQueue.ts:23`; `SymbolTree.ts` pruning; `MainDOMSource.ts:131–138` | +60–120 | Low. Element commands' `select().elements()` and controls (CT-1, kind-blind `[data-control]`) go through the same delegator: a stopped intent stream must not stop a sibling's shared destination |
| 4 | Linear Collection (key→index map per array; coalesce `PickCombine.up()` per tick) | Partly (PF-1 did lookups and set) | `Collection.ts:67–95`; `pickCombine.ts:50–56`, `:93–101` | +40–90 | **G-213/3-R**: `up()` coalescing interacts with the hold/`later` set and the B-010 reorder re-emit (`:128–138`); do it together with #1. B-010, G-102 tests guard sort/filter |
| 5 | Lazy per-component wiring; isolate only DOM+STATE per item; synchronous subtree teardown | Yes | `component.ts:187–432` (init* at `:412–423`), `:441–479` (dispose), `src/cycle/isolate/`, `Collection.ts` item isolation | ±150 (lazy getters cost, removed stages save) | Medium-high. DISPOSE actions/`onDispose` need the deferred tick (`:472`); GS-1 behaviors (`uses`), GS-5 persist setup (`:386–387`), GS-9 uid, replies (G-144), devtools hooks all touch init. Synchronous teardown vs xstream's async `_stopNow` needs a guard for streams re-subscribed in the same tick |
| 6 | Pragma rewrite (one pass, no `extend`), fuse the per-render walks | Yes | `src/pragma/fn.ts:1–58`, `src/pragma/index.ts:20–46`, `:84`, `:144–147`, `:213`; `component.ts:902–903`, `:1209`, `:1927–2010` | **S: −300…−500** (`extend` is only used by the pragma, so the dependency leaves the bundle) | `extend(true)` deep-copies nested prop objects (style, dataset, attrs objects); a shallow pass hands the app's objects to snabbdom by reference — check apps that mutate a style object between renders. G-152 dataset key casing, B-011 text/children, focus props, SVG `ns` must be kept |
| 7 | Tag checks first in selectModule / controlledInputModule / classNameModule | Yes | `selectModule.ts:18–23`, `controlledInputModule.ts:36–58`, `classNameModule.ts:41–70` | +10–30 | Low. classNameModule is needed on any element with `className` (B-012), not only fields: gate on `props` having `className`, not on tag |
| 8 | Cheaper change detection (identity, then shallow) | Partly (identity first already in `objIsEqual`; GS-4 makes "same object = no change" the semantics) | `component.ts:590–626`, `:1157–1169`, `:2112`; `objIsEqual.ts` | ±20 | GS-4 + the dev entry's in-place-mutation check make identity-first safe for state; props built inline in JSX still need a structural compare; `STATE.watch` (GS-6) uses `objIsEqual` too |
| 9 | Drop the subtree MutationObserver; emit the root from a post-patch hook | Yes | `makeDOMDriver.ts:89–97`, `:120–143` | **S: −60…−120** | **Element commands** depend on the DOM source emitting after every patch (`elementCommands.ts:22–26`, `:49`): a post hook emits exactly then (good), but external DOM mutations no longer re-emit. Router scroll restoration has its own observer (`router.ts:145`), unaffected. `testing.ts:1176` real-DOM mode passes the observer through |
| 10 | Benchmark in CI as a regression gate | Yes | `scripts/` next to `size-gate.mjs` | 0 | Timing is machine-dependent: gate on counts (below) and on ratios to the React arm |

## 4. Suggested PLAN-4.5 workstreams (order)

TBD after the re-run confirms the numbers; draft:

1. **P45-0 Gate first** (#10): count-based gate script + the merged harness; ratchet at the current values so every later stream proves its gain.
2. **P45-A Identity and leaks** (#2, #3, #7) — small, independent, low risk; #2 also shrinks patch cost before batching lands.
3. **P45-B Pragma** (#6) — saves bytes that pay for #1 and #3; independent of the rest.
4. **P45-C Render scheduler** (#1 + rest of #4 + revisit G-213 hold + VT quiet window + #9) — one workstream: they all change "when does the DOM patch". Largest gain, largest risk; full browser suite + G-146/B-003/E11 tests.
5. **P45-D Lazy wiring and teardown** (#5) — last: biggest refactor of `component.ts`, benefits from #1's simpler render path.
6. #8 folds into C or D when a profile shows it.

## 5. Proposed perf CI gate (rec 10)

Deterministic counts (machine-independent, hard gate) from `perf/instrument.mjs`; thresholds start at today's values (TBD) and tighten as each workstream lands:

| Metric | Today | Gate now | Target after PLAN-4.5 |
|---|---:|---:|---:|
| DOM patches, select row in a 1k Collection | TBD | TBD | ≤ 2 |
| DOM patches, leaf click 30 deep | TBD | TBD | ≤ 2 |
| Streams per Collection item (1k counters) | TBD | TBD | ≤ 40 |
| setTimeout calls, unmount 1k counters | TBD | TBD | ≤ 1,100 |
| Retained ScopeCheckers after 5×1k mount/unmount | TBD | TBD | 0 |

Timing (soft gate, warn): median ratio to the React arm in the same run, for select row (1k, single and Collection), mount 1k, update 1 of 1k; fail only beyond +25% of the recorded ratio. Retained heap after 6 counter cycles ≤ ready + 1 MB.

## 6. Harness recommendation

TBD (see the final section once filled): keep `perf/` as the primary PLAN-4.5 harness, move it under `benchmarks/` beside the jfb entries, adopt P-3's quiet-wait (idle-callback) step and its paint/busy metrics, keep `browser-tests/perf/` until its create/edit/swap/append/clear-2k scenario is ported.
