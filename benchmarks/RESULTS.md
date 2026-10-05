# Performance baseline (PLAN-4 GS-16, prototype P-3)

> **Historical (PLAN-4.6):** the `src/component.ts` paths below are the 5.x core, deleted at PLAN-4.6 R5; the component core is `src/core/` now. The analysis is kept as recorded.

Measure only, not gating. Recorded 2026-10-03 on branch `p4-p3-perf` (from `plan4-integration` at 284a648, Sygnal 5.4.0 + the PLAN-4 work merged so far).

> **Since PLAN-4.5 P45-0** the P-3 runner (`browser-tests/perf/`) is retired. Its method (quiet-page wait, paint and busy) and its clear-2k op are part of the audit harness in `benchmarks/audit/`, and the js-framework-benchmark smoke run is `npm --prefix benchmarks run jfb`. How to run everything, including the count gate in `npm test`: [README.md](README.md). The commands below are kept as the record of how these results were produced.

## Summary

- **A Sygnal Collection of 1,000 item components is 4–12× slower than React 19 and Vue 3.5** on every op of the scenario, and editing one row costs 16 ms against under 2 ms.
- **The same rows mapped in one component** (the js-framework-benchmark shape) are within about 2× of React and Vue on create, append and swap. An edit still costs about 9.5 ms, because the whole 1,000-row view is rebuilt and diffed.
- **The Collection's edit and swap time is mostly two O(n²) lookups**, not rendering. Only the edited row's view re-runs. Making both lookups O(1) costs about 28 B gzip and halves edit and swap. A bundle-level prototype measured 16.7 → 8.2 ms for edit and 11.6 → 5.7 ms for swap.
- **Decision: one scoped follow-up**, "Collection O(1) item lookups" (below). No `lazy` view for now.

## Environment

| | |
|---|---|
| Machine | Apple M3 Max (16 cores), 128 GB, macOS (Darwin 24.6.0, arm64) |
| Browser | Chromium 145.0.7632.6, Playwright 1.58, headless, `--js-flags=--expose-gc`, 1280×900 viewport |
| Node | v24.14.0 |
| Frameworks | Sygnal 5.4.0 (this repo's `dist/`), React 19.3.0 + react-dom 19.3.0, Vue 3.5.43 (+ @vitejs/plugin-vue 5.2.4) |
| Build | Vite 6.4.3, production mode, minified (`npm --prefix benchmarks run build:perf`) |

## The scenario (`browser-tests/perf/`)

Each app renders the same markup: four buttons (`#run`, `#add`, `#swaprows`, `#clear`) and a `div.rows` with one `div.row[data-id]` per row (`span.id`, `button.lbl`). Each app gets the same deterministic labels from `apps/data.js`.

| App | Shape |
|---|---|
| `sygnal-collection` | idiomatic Sygnal: `<Collection of={Row} from="rows" />`. Each row is a component, and an edit is the row's own action, written back by id. |
| `sygnal-map` | one Sygnal component that maps `state.rows` to keyed elements, with `EDIT: DOM.click('.lbl').data('id', Number)` (the js-framework-benchmark entry's shape) |
| `react` | React 19: `useReducer`, keyed `memo` rows, stable `dispatch` |
| `vue` | Vue 3.5: one SFC (compiled template), a `ref([])` with deep reactivity, keyed `v-for`, `row.label += ' !!!'` |

Each run performs: clear → **create** 1,000 rows → **edit** one row (click the 501st row's label: it gains `' !!!'`) → **swap** rows 2 and 999 → **append** 1,000 rows. There are 3 warm-up runs and then 10 measured runs, and each app runs in its own browser context.

**Method** (`browser-tests/perf/apps/harness.js`), for each op:

1. Wait until the page is quiet: 100 ms, then three idle callbacks in a row with at least 10 ms of idle time left. Without this wait, the Collection's trailing work from the previous op lands inside the next op's measurement and doubles it.
2. Call `gc()`, then wait for two animation frames.
3. Take t0, then call `element.click()` (a real DOM click).
4. A MutationObserver on `#app` re-checks the op's expected DOM after each batch of mutations. Once the DOM matches, the harness forces style and layout (`document.body.offsetHeight`). This gives **dom** = click → DOM settled + layout.
5. **paint** = click → the next frame (rAF, then a MessageChannel message). It is quantised by the frame clock.
6. **busy** = click → the first idle callback with at least 10 ms left. It includes work done after the DOM is already right. Its floor is about 25 ms, because an idle callback only runs after the frame.

## Results

Median **dom** ms over 10 runs, with the [p25–p75] range and min–max. Lower is better.

| Op | Sygnal Collection | Sygnal mapped rows | React 19 | Vue 3.5 |
|---|---:|---:|---:|---:|
| create 1,000 | **68.3** [65.8–72.1] 62.3–73.9 | **22.3** [21.8–25.1] 20.8–28.3 | **12.3** [11.8–15.7] 11.5–17.0 | **10.7** [10.6–12.7] 10.0–15.2 |
| edit one row | **16.4** [15.9–16.5] 14.7–16.9 | **9.5** [8.9–11.4] 8.6–13.5 | **0.7** [0.7–0.8] 0.6–1.8 | **1.3** [1.2–1.5] 1.2–3.1 |
| swap two rows | **11.0** [10.9–11.5] 10.6–13.0 | **9.5** [9.2–9.9] 8.9–13.7 | **10.5** [9.6–14.0] 8.7–17.2 | **1.4** [1.3–2.3] 1.2–3.2 |
| append 1,000 | **94.4** [89.3–97.2] 87.2–101.8 | **25.1** [24.1–26.3] 23.5–30.2 | **14.2** [12.3–16.9] 11.6–18.6 | **12.7** [12.7–13.1] 12.2–19.3 |
| clear 2,000 | **15.0** [14.9–15.8] 13.9–16.6 | **7.0** [6.8–7.5] 6.4–9.0 | **4.0** [3.7–4.2] 3.1–4.7 | **3.4** [3.1–3.6] 3.1–4.0 |

Median **paint** (click → next frame) and **busy** (click → main thread idle), in ms:

| Op | Collection paint / busy | Mapped paint / busy | React paint / busy | Vue paint / busy |
|---|---:|---:|---:|---:|
| create | 70.9 / 86.1 | 24.2 / 40.8 | 14.3 / 27.7 | 12.8 / 26.0 |
| edit | 17.0 / 30.7 | 10.5 / 25.9 | 9.2 / 25.5 | 8.6 / 25.2 |
| swap | 12.4 / 25.4 | 10.5 / 25.5 | 12.7 / 26.4 | 8.0 / 25.3 |
| append | 97.6 / 119.1 | 26.9 / 42.7 | 16.2 / 26.0 | 14.9 / 26.0 |
| clear | 81.4 / **287.5** | 9.4 / 25.9 | 8.2 / 25.9 | 7.7 / 26.3 |

Notes:

- React's swap (10.5 ms) is its known weak spot: its keyed reconciliation moves 997 DOM rows (1,994 mutation records) where Sygnal (snabbdom) and Vue move 2.
- After an edit, only the edited row's view re-runs in the Collection (1 `Row` view call, measured). The edit cost is therefore not rendering (see the profile below).
- Clearing 2,000 Collection items updates the DOM in 15 ms but keeps the main thread busy for about 290 ms afterwards, mostly disposal (see the profile below).

### js-framework-benchmark entries (smoke timings)

`npm --prefix browser-tests run perf -- --jfb --runs 5` checks every op of both entries in a real browser, then times them. The check reads every row after each mutation batch, so these timings overstate the real cost. Use them only to compare keyed with non-keyed.

| Op | keyed (median ms) | non-keyed (median ms) |
|---|---:|---:|
| create 1,000 (`run`) | 37.3 | 36.8 |
| replace 1,000 | 40.0 | 26.8 |
| update every 10th | 20.0 | 18.3 |
| select row | 14.6 | 13.0 |
| swap rows | 16.5 | 15.0 |
| remove row | 16.1 | 23.4 |
| create 10,000 (`runlots`) | 353.2 | 324.5 |
| clear 10,000 | 46.8 | 47.2 |
| append 1,000 | 51.7 | 50.7 |
| clear 1,000 | 11.3 | 11.5 |

## Profile: where Sygnal spends the time

`npm --prefix browser-tests run perf -- --profile <app>:<op>` builds unminified (`build:perf:profile`) and records a V8 CPU profile from the click to idle (`console.profile` around the op). It then lists self time per function. Line numbers below refer to the bundled `dist/index.esm.js`; the sources are named.

**Collection edit** (the op with the worst ratio to React and Vue: 16 ms against 0.7 ms; about 15 ms of CPU per run):

| ms/run | Function | Source |
|---:|---|---|
| 2.5 | `instanceLens().get` | `src/cycle/state/Collection.ts`: each of the 1,000 item lenses scans the array linearly for its key, building a template string per comparison: **O(n²)** on every state change |
| 2.6 | `fieldLense.set` (+ its `find` callback) | `src/component.ts` `instantiateCollection`: writes the item back with `newState.find(...)` for every old item: **O(n²)**, plus a `{ ...item }` copy of all 1,000 items |
| 2.0 + 1.0 | xstream `MapOp._n`, `_n` | the state fan-out to 1,000 item state streams (`StateSource.select` → `dropRepeats`) |
| 0.6 + 0.5 | `MemoryStream._n`, snabbdom `patchVnode` | the item's re-render and the parent's patch |
| 0.3 + 0.3 | `objIsEqual`, `props$` map | `src/component.ts`: the per-item props and state checks that keep 999 rows from re-rendering |

**Collection create** (the slowest op in absolute time, 68 ms): 18.5 ms is GC, and the rest is spread thinly over building 1,000 component instances. The visible items are `initSinks`, `Component`, xstream `_add` / `_start` (stream graph wiring), `debounce` timers (`setInterval` / `clearInterval` from `src/extra/xstreamExtras.ts`, used per component), and `PickCombine.up` (6.1 ms: `src/cycle/state/pickCombine.ts` rebuilds the whole n-item vnode array each time one item emits its first vnode: **O(n²)** during creation). No single hot spot; the cost is one full component (streams, isolation scopes, timers) per row.

**Collection clear** (about 265 ms of trailing CPU): xstream `Stream._remove` (34.5 ms) and `_hasNoSinks` (31 ms), about 160 ms of `setTimeout` plus timer dispatch (`(program)`), then `_stopNow`. Each disposed item removes its listeners from shared parent streams (`_ils.indexOf` + splice: **O(n²)**), and xstream schedules an asynchronous stop (`setTimeout`) per stream. The source is xstream's teardown, triggered from `dispose()` in `src/component.ts` through `makeCollection`'s `__dispose` in `src/cycle/state/Collection.ts`.

**Mapped rows edit** (9.5 ms; about 8 ms of CPU): the view rebuilds 1,000 row vnodes, which costs about 2.5 ms in the JSX pragma (`src/pragma/index.ts`: `jsx`, `sanitizeData`, `extend`, `mapObject`). Snabbdom's `patchVnode` and `updateChildren` diff them in about 1.6 ms. Sygnal's per-render tree walks over the full tree add about 1.5 ms (`src/component.ts`: `getComponents`, `stampFields`, `applyFocusProps`, `processSuspensePost`, `syncClassName`). React avoids all of this with `memo`; that difference is what an Elm-style `lazy` would close.

### Prototype check of the Collection fix (not committed)

These patches were applied to a copy of the unminified bundle only; `src/` is untouched. The Collection scenario ran 8 times per variant on the same machine:

1. `fieldLense.get` returns the item itself when it already has an id, instead of a `{ ...item }` copy.
2. `instanceLens().get` tries the item's last index first, which makes the lookup O(1) while the order doesn't change.
3. `fieldLense.set` builds one `Map` by id instead of calling `find()` once per item.

| Variant | create | edit | swap | append | clear |
|---|---:|---:|---:|---:|---:|
| baseline (unminified) | 70.1 | 16.7 | 11.6 | 97.3 | 16.2 |
| 1 only | 71.3 | 14.1 | 9.7 | 97.3 | 16.3 |
| 1 + 2 + 3 | 69.9 | **8.2** | **5.7** | 89.6 | 15.9 |
| 1 + 2 + 3 + `PickCombine.up` coalesced to one per microtask | 71.5 | 8.1 | 5.7 | 91.1 | 16.5 |

Patches 1–3 cost **+28 B** gzip. This was measured by applying them to `dist/index.esm.js` and comparing the minified + gzip (level 9) size: 68,315 → 68,343 B. Coalescing `up()` changed nothing measurable, so it is not proposed.

## Decision record

**Status:** proposed follow-up, scoped. It is not part of PLAN-4's gates and needs the coordinator's assignment (it touches `src/component.ts` and `src/cycle/state/**`).

**Decision: "Collection O(1) item lookups"**, a slice-equality-skipping fix inside the existing model. It adds no API.

- **Changes:**
  - `instanceLens().get` in `src/cycle/state/Collection.ts`: remember the item's last index and check it first.
  - `fieldLense.set` in `src/component.ts` `instantiateCollection`: one `Map` by id per write, not a `find()` per item.
  - `fieldLense.get`: keep the item's identity when it already has an id, so the item StateSource's reference `dropRepeats` skips unchanged items before the deeper equality checks run.
- **Expected cost:** about +30 B gzip on the core (measured +28 B). The size gate's 42,300 B budget for kanban needs re-checking, since kanban uses Collection.
- **Expected gain**, from the bundle prototype: Collection edit 16.7 → 8.2 ms (−51%), swap 11.6 → 5.7 ms (−51%), append −8%. Create is unchanged. The gain grows with list length, because both lookups are O(n²).
- **Risk:**
  - Items without an `id` still get index ids, so their behaviour doesn't change.
  - Keeping the item's identity means a Collection item now receives the same object that is in the parent's array. That is safe under the "never mutate" rule, but the tests in `test/` covering Collection write-back (B-013 calculated fields, G-102 filter/sort) must stay green.

**Not proposed now:**

- **Elm-style `lazy(view, ...args)`**, a snabbdom `thunk`. It would bring the mapped-rows edit from about 9.5 ms toward React's 1 ms by skipping the vnode rebuild and the diff of unchanged rows. But every whole-tree pass in `src/component.ts` would also have to skip thunk subtrees: `processPortals`, `processTransitions`, `getComponents` / `injectComponents`, `stampFields`, `applyFocusProps`, `processSuspensePost`. It adds API surface (a new export, docs, strict rules). Estimate: +250–400 B gzip; not measured. Revisit if users report large single-component lists. The js-framework-benchmark entry would be the first beneficiary.
- **Collection create, append and clear cost** (5–7× React and Vue, and about 290 ms of teardown busy time for 2,000 items) comes from one full component per row: streams, isolation scopes, debounce timers, and xstream's per-listener O(n) removal and asynchronous stop. Memoization can't fix that. It needs cheaper item instances or batched disposal, which is a larger design question. Until then, the guidance for big read-mostly lists is "map rows in one component; use Collection when rows have their own behaviour". The docs workstream (4-A/4-B) could add that sentence.
- **Signals or a compiler** (gap study N-1 and N-2): nothing here calls for them. The gaps above are local O(n²) paths and per-item overhead, not the state model.

## Reproduce

As recorded (P-3's runner, retired in P45-0; today use [README.md](README.md)):

```bash
npm run build                                  # the library
npm ci --prefix browser-tests && npm ci --prefix benchmarks
npm --prefix browser-tests run perf            # builds the apps, 3 warm-up + 10 runs per app (about 1 min)
npm --prefix browser-tests run perf -- --runs 20 --apps sygnal-collection,react --json out.json
npm --prefix browser-tests run perf -- --profile sygnal-collection:edit
npm --prefix browser-tests run perf -- --jfb   # js-framework-benchmark entries: check + smoke timings
```

None of this runs in `npm test`. Absolute numbers depend on the machine; compare apps within one run.

## After PF-1 (Collection O(1) item lookups, D128)

Implemented on branch `p4-pf1-collection` (from `plan4-integration` at 5bebf3f), 2026-10-03. No API change.

- `instanceLens().get` (`src/cycle/state/Collection.ts`): the scan starts at the item's last index and wraps around, so it is one check while the order doesn't change, and only moved items scan.
- `fieldLense.set` (`src/component.ts` `instantiateCollection`): one `Map` by id per write instead of a `find()` per item. The map is filled from the end, so with duplicate ids the first match still wins.
- `fieldLense.get` / `set`: an object item that has a (truthy) id is passed as is instead of a `{ ...item }` copy. Items without an id still get a copy with their index as the id, and primitives are still wrapped as `{ value, id }`. Unchanged items, including filtered-out ones, keep their identity in the parent's array after an item writes back.

Same machine and method as above, `npm --prefix browser-tests run perf -- --runs 10 --apps sygnal-collection`, median **dom** ms [p25–p75] (paint):

| Op | before (5bebf3f) | after PF-1 | change |
|---|---:|---:|---:|
| create 1,000 | 71.0 [66.8–72.4] (73.9) | 70.5 [68.7–72.2] (73.2) | ≈ 0 |
| edit one row | 16.2 [15.8–16.5] (17.1) | **8.3** [8.1–8.4] (10.5) | −49% |
| swap two rows | 10.7 [10.4–11.3] (12.0) | **5.5** [5.1–5.7] (9.3) | −49% |
| append 1,000 | 97.4 [91.1–98.4] (100.6) | 92.7 [89.5–94.2] (96.0) | −5% |
| clear 2,000 | 16.0 [15.4–16.9] (86.3) | 16.0 [15.9–16.2] (85.3) | 0 |

Busy (click → idle): edit 31.8 → 25.3 ms, swap 25.9 → 24.0 ms; create, append and clear unchanged (clear still ≈ 300 ms of teardown).

Size: kanban gated bundle 41,129 → 41,171 B (**+42 B**; the bundle prototype's +28 B was measured on `dist/index.esm.js` at gzip -9 and without the duplicate-id ordering). Tests: `test/p4-pf1-collection-lookups.test.js` (17; 7 failed first: 5 identity checks and the two O(n) work counters).

## PLAN-5 V-1: `<VirtualCollection>` (2-V, 2026-10-05)

The `virtual` scenario of `audit/` (`lib/ops.mjs`): a 640 px scroll container of 32 px rows (id + label), 10,000 and 100,000 rows. Pages: `sygnal/virtual` (`<VirtualCollection>`, jump with `ELEMENT: { scrollToIndex }`), `sygnal/virtual-coll` (a plain Collection, jump with `ELEMENT: { scrollTo }`), `react/virtual` (React 19 + `@tanstack/virtual-core` 3.17.11 through a `useVirtualizer` hook equivalent to `@tanstack/react-virtual`'s), `react/virtual-plain` (every row). "Scroll by a page" and the jump wait until the target row is rendered and at the container's top; a plain list has every row, so only the scroll and its paint remain (its CPU is the cost of scrolling a big DOM).

```bash
npm --prefix benchmarks run build
npm --prefix benchmarks run bench -- --fw=sygnal,react --scenario=virtual --no-memory
```

Chromium 153, medians (create: 6 fresh pages for 10k, 4 for 100k; the others 8 after 3 warm-ups). Each cell: **paint** (event → next frame) / latency (event → DOM done) / main-thread CPU, ms:

| Op | VirtualCollection | Collection | React + TanStack Virtual | React (plain) |
|---|---:|---:|---:|---:|
| create 10k | 17.8 / 6.9 / 10.0 | 158.7 / 145.1 / 161.2 | 16.6 / 4.2 / 7.4 | 233.7 / 222.2 / 236.3 |
| scroll by a page (10k) | 18.1 / 17.7 / 4.1 | 17.1 / 0.1 / 32.1 | 18.2 / 17.9 / 3.3 | 17.0 / 0.1 / 24.1 |
| jump to row 9,000 (10k) | 18.6 / 18.2 / 4.1 | 21.5 / 18.4 / 36.7 | 17.8 / 17.6 / 3.9 | 17.2 / 0.5 / 27.1 |
| create 100k | 40.8 / 40.1 / 48.3 | 1,600 / 1,451 / 1,603 | 16.2 / 15.4 / 22.5 | 11,900 / 11,767 / 11,903 |
| scroll by a page (100k) | 22.0 / 21.6 / 12.0 | 17.0 / 0.1 / 370.1 | 18.3 / 17.9 / 7.9 | 17.4 / 0.1 / 165.5 |
| jump to row 9,000 (100k) | 22.2 / 21.8 / 12.7 | 54.7 / 18.0 / 380.8 | 18.9 / 18.5 / 8.3 | 33.1 / 0.5 / 177.4 |

- A virtual list renders a scroll in the next frame (the scroll event comes with the frame), like TanStack's own React adapter. Scroll and jump are at React + TanStack's latency at 10k (≤ 0.6 ms apart) and 1.2× at 100k.
- Create: 6.9 ms for 10k (React + TanStack 4.2), 40 ms for 100k (15.4). At 100k, about a quarter is the Collection core's key index (`core/cell.ts` `indexer`: a key string per item, one `Map` of 100k) that every Collection builds; `VirtualCollection` reuses its keys when there is no `filter`, `sort` or duplicate id (no second pass); that and making the SYG431 id scan dev-only took 100k from 54 to 40 ms.
- A plain Collection creates 1,000 rows in about 14.5 ms (a frame), 10,000 in 145 ms; scrolling it costs the main thread 32 ms at 10k and 370 ms at 100k (layout and paint of the whole list).

**Default threshold (S-7):** use `VirtualCollection` from about **1,000 rows** (where a plain Collection's create passes a frame), or earlier for expensive rows; a plain Collection below a few hundred. The guide (`guide/virtual-collections`) states it.

Size: 0 B in kanban when unused (41,500 → 41,475 B gated: gzip noise from the reordered bundle; `test/p5-v1-treeshake.test.js`); used, +8.8 KB gzipped (virtual-core 6.0 KB, the host 2.8 KB).
