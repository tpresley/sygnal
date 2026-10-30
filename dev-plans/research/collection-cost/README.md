# Collection per-item cost (runtime)

Goal (coordinator, round 3): cut the per-item cost of Collection items in the core (`src/core/`:
`instance.ts`, `cell.ts`, context read-tracking, `context()`, the same-output check) for select
row on a 1k Collection, create 1k / 10k, mount/unmount churn and the heap. Compiling doesn't
touch this cost (compile-wasm CV-3: Collection select 1.8 → 1.4 ms compiled, vs 1.05 ms for a
plain table).

Branch `claude/explore-compile-wasm-cce134`, on top of `claude/advanced-integration` (merged).

## Method

- **Counts first** (exact, no timing noise on a shared machine):
  - `objects.mjs`: retained JS objects and bytes per Collection item. It diffs two Chromium heap
    snapshots (the audit's `table-coll` page with 1,000 rows vs 0 rows, unminified build per dist),
    by constructor or V8 node type (`--shapes`: plain objects by their property names).
  - `scripts/perf-gate.mjs`: the count gate.
- **Where the time goes**: `benchmarks/audit/profile.mjs` CPU profiles (unminified, source
  mapped). Proportions only: the machine's load average was 20–146 during this work.
- **Timings**: `ab.mjs`, the compile-wasm interleaved A/B method. Every build is open in its own
  context and measured round-robin. For each op it reports `core` (click → the core's `onPatch`
  hook: the action, reducer and render pass, through a hook layer installed via
  `__SYGNAL_DIAGNOSTICS__.layers`, no app change) and `dom` (the audit's latency: event → DOM
  settled + layout).
- **Size**: `scripts/size-gate.mjs`. While trying variants I used a one-entry rollup build
  (index + jsx-runtime ESM, ~10 s instead of the full build) with kanban bundled against it;
  that's git-ignored scratch under `results/`.

## What a Collection item cost (before)

Per item of the 1k table (the benchmark's `Row`: reads `context.selected`, two DOM click streams):
**160 retained JS objects, 5,076 B** (DOM nodes apart, 6.2 KB). The biggest parts:

| What | Per item | Why |
|---|---|---|
| `enrichEventStream` helpers | 12 closures + 10 contexts | `.value/.checked/.data/.target/.key/.detail` made as closures for each of the 2 event streams |
| intent `sources` object | 1 object + a 272 B property array, ~1 µs to make | `Object.defineProperties` with ~10 own accessors per instance (1.1 ms of a 1k create in the profile) |
| the state cell | 4 objects | a `{get, set, raw}` wrapper (3 closures) around the item cell when the component has no calculated fields |
| `MainDOMSource` | 3 closures | `isolateSource`, `isolateSink`, `isolateValue` made in each source's constructor |
| intent listeners | 2 closures + 1 context + 1 object per action | `s.subscribe({next, error})` |
| `wrapDOM` | 1 handler + 1 closure | the DOM shorthand Proxy made its handler per instance |
| defaults | 3 objects | `kids = new Map()`, `slots = {}`, `ls = {}` per instance |
| per render (not retained) | Proxy + handler + 3 closures + context + Set; a `[a, map]` pair per item; `JSON.stringify` + 2 arrays + a scope object in `isolateValue` | context read-tracking, `indexer()`, the vnode's isolate key |

## Changes

| Change | Where | Bytes (kanban gzip) |
|---|---|---|
| Intent sources: a Proxy with one shared handler, over `{[INST]: inst}`. Its own properties are the source names, in the same order, so spread, `Object.keys`, `in` and destructuring work as before, and a property the intent adds is the target's own. `srcDesc` is now a table of getters | `instance.ts`, `runtime.ts` | +48 |
| Context read-tracking: one handler for every view; each render's Proxy targets `{c: ctx, k: keys}`, so a read after the view returned (a Collection `filter` closure) still sees its own render's context; the instance's key Set is cleared and reused | `instance.ts` | +25 |
| Intent listener: a `Listener` class (`next`/`error` methods), not two closures per action | `instance.ts` | +35 |
| The base cell itself when there are no calculated fields or `idle` defaults (`rawState()` keeps STATE.stream's raw value right) | `instance.ts` | −(saves) |
| Shared `NOKIDS` Map (an instance gets its own on its first tag child), frozen `NOSLOTS`, `UNSET` sentinel; the 8 rarely used `= null` fields are left unset | `instance.ts` | +20 |
| `wrapDOM`: one shared handler | `runtime.ts` | ~0 |
| `indexer()`: the same `[array, map]` pair until the array changes | `cell.ts` | ~+5 |
| `isolateValue(node, scope, memo)`: the core passes the instance; it keeps the scope's isolate array and its JSON key | `isolate.ts`, `runtime.ts` | +37 |
| `MainDOMSource`: `isolateSource` a method, `isolateSink` / `isolateValue` made on first read | `MainDOMSource.ts` | +5 |
| `enrichEventStream`: `Object.assign(stream$, METHODS)`, shared methods using `this` | `enrichEventStream.ts` | +11 |
| `dbg()`: one read of `window.SYGNAL_DEBUG` | `debug.ts` | +10 |

**Net: +254 B**: the size gate went from 42,149 B (851 B headroom, `advanced-integration`) to
42,403 B (597 B headroom).

### Tried and dropped (bytes vs benefit)

- **An `EventStream` subclass of xstream's `Stream`** with the helpers as class getters, plus a
  producer class (`Bubbling`) for bubbling events. Zero per-stream helpers and no producer
  closures, but +171 B. The shared-methods `Object.assign` keeps most of the heap win (3,224 vs
  2,944 B per item, measured with the ItemCell class in) for +11 B. Its one difference: a detached helper (`const {value} = stream`)
  loses its stream.
- **`ItemCell` as a class** (one object instead of 2 closures + context + object): −80 B heap per
  item for +41 B of code. Dropped.
- **`= undefined` initializers** for the fields set after construction (so they're in-object):
  +41 B and no measurable heap change (the 272 B property array was the sources object's, not
  the instance's). Dropped.
- **A Proxy target that is the instance itself** (no extra object): a write to `sources.props`
  would have overwritten the instance's own `props`. Dropped for the `{[INST]: inst}` target.
- **Object literal with getters, or `Object.create(proto)`** for sources: a literal makes 7
  getter closures per object (~1 µs); a prototype loses own enumerable properties, which
  `{...sources}` (behaviors.ts, Cycle-style code) needs.
- **`Object.setPrototypeOf`** for enriched streams: 0.4 µs each, slower than the closures.

## Results

Retained per Collection item (`objects.mjs`, 1k rows, exact):

| | JS objects | JS bytes |
|---|---:|---:|
| before | 160 | 5,076 B |
| after | 104 | 3,308 B (−35%) |

CPU profile, create 1k rows (Collection table): `sources()` self time 1.11 → 0.07 ms per create.

Timings (`ab.mjs`, Chromium, 25 interleaved rounds; create 10k: 8 rounds on fresh pages), run
2026-10-29 in the coordinator's quiet window (1-minute load ~9 → 7). Still running and outside
our control: the maintainer's Docker VM (~2 cores), Spotlight indexing after the npm installs,
possibly a booted iOS simulator. `performance.now()` is coarsened to 0.1 ms on these pages, so
the small ops move in 0.1 ms steps. Median [p25 – p75] ms; raw: `ab-results.json`.

| Op | core before | core after | DOM latency before | DOM latency after |
|---|---|---|---|---|
| select row (1k Collection) | 1.6 [1.3 – 1.8] | **1.3** [1.1 – 1.4] | 2.0 [1.7 – 2.2] | **1.7** [1.5 – 1.9] |
| create 1k rows | 6.0 [4.5 – 7.0] | **4.7** [3.3 – 6.2] | 21.4 [19.1 – 23.1] | 19.3 [17.5 – 21.7] |
| replace 1k rows | 4.5 [4.4 – 5.7] | **3.7** [3.2 – 3.8] | 22.1 [21.3 – 24.8] | 21.6 [20.5 – 23.0] |
| append 1k to 1k | 4.5 [4.2 – 5.4] | **3.4** [3.3 – 3.9] | 19.6 [18.8 – 22.2] | 18.0 [17.4 – 19.1] |
| create 10k rows | 66.6 [61.3 – 68.3] | **49.6** [48.9 – 52.6] | 214.0 [209.3 – 219.3] | **196.7** [192.3 – 200.6] |
| update every 10th (1k) | 1.1 [1.0 – 1.4] | 1.0 [0.8 – 1.3] | 3.0 [2.8 – 3.5] | 2.9 [2.6 – 4.1] |
| clear 1k rows | 0.8 [0.8 – 0.9] | 0.8 [0.7 – 0.9] | 3.5 [3.3 – 3.7] | 3.8 [3.4 – 4.3] |
| mount 1k counters | 6.2 [4.2 – 7.8] | 6.2 [4.2 – 6.6] | 17.4 [14.8 – 21.6] | 16.9 [15.6 – 19.4] |
| update 1 of 1k counters | 0.5 [0.5 – 0.6] | 0.5 [0.5 – 0.7] | 1.2 [1.1 – 1.4] | 1.2 [1.1 – 1.6] |
| unmount 1k counters | 0.7 [0.6 – 0.9] | 0.7 [0.6 – 0.7] | 3.0 [2.6 – 3.9] | 2.7 [2.6 – 3.1] |

Reading it:
- **Core time, create/append/replace on the Collection table: −18 to −26%.** Create 10k: −26%,
  with no overlap between the interquartile ranges.
- **Select: −19%** (1.6 → 1.3 ms). That's the per-render context Proxy, handler and Set, and
  smaller item objects to walk. DOM latency 2.0 → 1.7 ms (React 19: 0.9 ms in the compile-wasm
  runs, a different session).
- **Counters (mount/unmount churn): no change measured.** The quartile range of mount narrowed,
  but the median is the same. Its items are small, and the browser's own element work dominates.
- **Clear, update: unchanged** (within the 0.1 ms timer step).

Count gate: unchanged (patches 1/1/1, streams 1.0 per item, unmount setTimeouts 2,
ScopeCheckers 0, heap after 5×1k create/clear 0.92 base vs 0.95 new, within run-to-run noise).
No limit moved down, so `gate.json` is unchanged.

## What is left, and why

- **Select row (1k Collection)** re-runs all 1,000 views. Every row reads `context.selected` and
  every row's `ctx.selected` value changed, so read-tracking can't skip any. Skipping rows needs
  to know that a row's *output* doesn't depend on the new value, which a view function doesn't
  declare. The same-output check (`sameTree`) already keeps 998 rows out of the patch. Per row:
  - What's left is the view call (props object, jsx, pragma), `sameTree`, and the item render's
    bookkeeping.
  - `context()`'s self time in the profile (~0.3 ms) is memory latency on first touch of each item
    object (the entry runs once per select, checked). Fewer, smaller per-item objects is the
    lever there.
  - A real cut needs an API: a keyed context selector (`context.selected` compared per row by the
    core, e.g. a declared `Row.reads = { selected: (v, state) => v === state.id }`). That is a
    design question, not a refactor.
- **Create**: what's left of the core's part is mostly the DOM event machinery each item's intent
  sets up: per stream, `select()` (a `MainDOMSource`, a namespace array), `events()` (a
  `ScopeChecker` with a filtered namespace, the producer, the stream), `subscribe`, and the
  delegator's destination and priority-queue entry. That's ~1.6 of the core's ~4.3 ms per 1k under
  load, spread over many small steps. A cheaper delegation (one destination per instance and
  selector set, made when the first event of that type arrives) is a cycle/dom redesign. The rest
  is snabbdom element creation and the browser's layout.
- **Unmount churn**: dominated by native `removeChild`; the core's teardown is ~0.2 ms per 1k.
- **Lazy intent for items that never get events**: not done. An intent must be subscribed at
  creation (a `startWith`, `xs.periodic`, a driver stream emits on subscribe), so it can't be
  deferred without changing when actions fire.

## Files

- `ab.mjs`: interleaved A/B of core time and DOM latency per op, across dists
- `objects.mjs`: retained objects and bytes per item (heap snapshot diff)
- `node-bench.mjs`: the Collection table in Node (jsdom); `onPatch` gives the core's part. jsdom's
  heap makes its GC noisy; kept for quick checks
- `ab-results.json`: the timing run above
- `results/`: git-ignored scratch (base dist copy, built pages, the size-variant builder)
- `test/collection-cost.test.js`: what intents and views see after the change (sources as a
  plain object, context reads after the view returned, the shared index pair, the shared helpers)
