# Core rewrite study 3: proposed structure for a rewritten component core

**Branch:** `claude/component-core-rewrite-experiment` (from `plan45-integration` @ b67c208, the actual 6.0 state; `main` has only the PLAN-4/4.5 plans).
**Companions:** [01-current-structure.md](01-current-structure.md), [02-legacy-audit.md](02-legacy-audit.md), prototype in [proto/](proto/).

## 0. Summary

PLAN-4.5 already took the "use lower-level xstream primitives" route inside the current design:
- `via`/`hub` single streams;
- a keyed microtask scheduler;
- `tearDown` patching `Stream.prototype._remove`.

That took streams per Collection item from 151 to 22 and patches per update to 1. The cost is shown by PLAN-4.5's own review findings: G-257, G-266, G-272–274, G-284 and G-287 are all races between three timing sources that the current design can't remove:
1. **reducers applied in a microtask each** (Cycle's `withState`);
2. **startup on timers** (INITIALIZE at 0 ms, intent at 1 ms, BOOTSTRAP at 10 ms, first-render gates, patch holds with a 50 ms bound);
3. **state reaching every component through its own stream chain** (StateSource + isolate + lens per child).

**Proposal: go one level lower than xstream for the core's internals.** Keep streams only at the boundaries users and drivers see: intent, driver sources and sinks, `STATE.stream`/`watch`, `dispose$`. Run the inside as plain data structures:
- a **per-app synchronous store with a run-to-completion action queue**;
- **pull-based state cells** (lens views memoized on identity);
- a **dirty-checking top-down render flush** (one microtask, one patch);
- **definitions normalized once per component function**;
- an **explicit hooks API** for behaviors, persist, devtools, diagnostics and testing, instead of patching instance methods.

The user-space API stays the same apart from the legacy removals in study 2.

**Measured, prototype vs current core** (same apps, same JSX, same DOM driver, Chromium, median of 10):

| Op | Current | Prototype | React |
|---|---|---|---|
| mount 1k components | 35.2 ms | **14.7 ms** | 10.6 |
| unmount 1k components | 6.4 | **3.15** | 2.1 |
| update 1 of 1k | 3.05 | **1.3** | 1.25 |
| Collection: create 1k rows | 43.4 | **21.2** | 15.5 |
| Collection: replace 1k rows | 60.4 | **21.7** | 16.0 |
| Collection: create 10k rows | 947 | **233** | 273 |
| Collection: select row 1k / 10k | 8.25 / 85 | **3.65 / 34** | 0.5 / 4.2 |
| Collection: remove row | 11.7 | **1.25** | 1.25 |
| Collection: clear 2k | 16.1 | **7.7** | 4.65 |
| leaf update 30 deep | 1.0 | 0.6 | 0.5 |
| single-view ops (table, keystroke) | unchanged (pragma, snabbdom and DOM driver bound) | | |

- **Core self time** to mount 1k: about 22 ms (component.ts, xstream, Collection, isolate) vs **1.8 ms** in the prototype. What's left is snabbdom, the DOM driver and the pragma.
- **Bundle:** the shared chunk of the benchmark apps is 37.5 KB gzip on the current core and 20.9 KB on the prototype.

**Caveats:**
- The prototype supports only the canonical subset the benchmark apps use (see `proto/core-next.ts` header).
- A production core adds calculated fields, statics, markers, Suspense, Switchable, replies, hooks and the error boundary. I expect it to keep most of the gain, because those costs are per declared feature, not per instance; the size gain will shrink more.

## 1. Design principles

1. **Streams at the edges only.** Users write streams (intent) and drivers speak streams, so those stay xstream. Nothing between "an action arrived" and "a vnode went to the DOM driver" needs to be a stream; there it is function calls over plain objects.
2. **One clock.**
   - Actions are processed synchronously, in order, to completion.
   - Rendering happens once, in a microtask after the queue drains.
   - Timers exist only where the user asked for time (`next(…, ms)`, `timers`, transitions).
   - No startup timers, gates, holds or hop counting.
3. **Per app, never per module.** All mutable runtime state hangs off the app runtime: queue, scheduler, ids, pending flags. (Today `pendingReducers` is module-global and crosses apps.)
4. **Normalize at definition time.** Everything that depends only on the component function is computed once in a `WeakMap<fn, Def>`:
   - model table, with `'A|S'` parsed (if kept) and fn → STATE;
   - calculated topological order;
   - context entries; statics; option checks.
5. **Explicit extension points.** Every module that today patches the instance gets a named hook.

## 2. Module layout

```
src/core/
  define.ts      Def: normalized component definition (WeakMap cache); defineComponent(opts) compat
  runtime.ts     App runtime: store, action queue, flush scheduler, sink bus, hooks registry, ids
  cell.ts        state cells: root, key, lens, Collection item (shared id index), local (isolatedState)
  instance.ts    Instance: inputs, render(), reconcile children, context (with key tracking), dispose
  actions.ts     handler execution: STATE / driver / PARENT / EFFECT / ELEMENT, ABORT, next(), props arg
  hosts/
    collection.ts   keyed items over an item cell; filter/sort in the cell's get; container vnode
    switchable.ts   pages as instances; hidden = render skipped; instance re-creation (D83)
    tag.ts          sub-component (state prop string | lens | isolatedState)
  markers.ts     registry: Portal, Transition, ClientOnly, Lazy, Suspense register handlers on import (D157)
  statics.ts     generic declaration statics (__sygnalStatic), background filtering, replies
  sources.ts     the boundary: DOM (isolated + shorthand), STATE facade, CHILD, props$/children$/dispose$ (lazy)
  hooks.ts       typed hook points (§6)
```

These modules leave the core path:
- `cycle/isolate` (kept only for the public `isolate`, if any);
- `cycle/state/{withState,StateSource chains,Collection,pickCombine,pickMerge}`;
- the `scheduler.ts` hops, gates and holds;
- the `tearDown` monkey patch.

`StateSource` remains only as the user-facing facade.

## 3. Runtime: store, actions, flush

```ts
interface App {
  state: any                       // the root state (single source of truth)
  queue: Array<[Instance, Action]>
  draining: boolean; rendering: boolean
  dispatch(inst, action): void     // push; drain now unless draining or rendering
  commit(): void                   // state changed → schedule the flush (one microtask)
  flush(): void                    // render top-down, emit one root vnode, then drain anything queued meanwhile
  bus: Record<sink, Listener>      // one stream per driver sink, created on demand
  hooks: Hooks
}
```

**Action processing** (`actions.ts`), for each queued `[inst, action]`:
1. `pre = inst.cell.get()` (plus calculated fields, memoized).
2. Run the action's handlers in model order with `(pre, data, next, props)`:
   - STATE: `inst.cell.set(result)` unless ABORT or `result === pre`;
   - every other sink gets **`pre`**, which is the documented "every sink sees the state from before this action". No `STATE_SNAPSHOT`, no microtask, no `pendingReducers`;
   - driver sinks: `bus[sink].next(stamp(value))`, with the emitter id stamped and the scope chain applied (§5);
   - PARENT: delivered straight to the parent instance's CHILD hub;
   - EFFECT: runs synchronously, so `preventDefault()` on the live event still works (1H-1);
   - ELEMENT: queued until after the next patch.
3. `hooks.onAction` / `onReducer` fire.

**Reentrancy:**
- A driver or `EFFECT` that dispatches synchronously while the queue drains appends to the queue: run-to-completion, FIFO. Today's ordering is the same in practice, because each reducer is a microtask in FIFO order.
- An action arriving during the render flush is queued and drained right after it.

**Startup** (replaces the 0/1/10 ms timers, `_w`, `_i`, `_go`, gates and holds):
1. `new Instance` → `initialState` (or HMR / persisted / hydrated state) is written to the cell **synchronously**. INITIALIZE becomes a synchronous action at construction, so model `INITIALIZE` entries still run.
2. The intent is called and its streams are subscribed **synchronously**. A stream that emits on subscribe (`startWith`, `xs.of`) only queues; the queue drains after construction.
3. The first render happens in the same flush, so the element can't be visible before its intent listens: the reason for the D153 gate is gone.
4. BOOTSTRAP is dispatched after the instance's first commit (a microtask after mount). The docs promise only "once, just after mount".

**Flush:** one microtask per batch of commits, `root.render()`, one vnode to the DOM driver, then ELEMENT commands. The PLAN-4.5 guarantees hold: one patch per action and DOM source emission after the patch. A loop guard of N flushes per macrotask stays, as G-260.

## 4. State cells

```ts
interface Cell { get(): S; set(v: S): void }
```

| Cell | get | set |
|---|---|---|
| root | `app.state` | `app.state = v; commit()` |
| key (`state="field"`) | `parent.get()[k]`, memoized on the parent value's identity | `parent.set({...p, [k]: v})` (SYG409 for a calculated field) |
| lens (`state={{get, set}}`) | `lens.get(parent.get())`, memoized | `parent.set(lens.set(p, v))` |
| identity (no prop) | parent's | parent's |
| Collection item | `arr[index.get(id)]`; **one id→index Map per array identity, shared by all items** | replace or remove by index (PF-1 semantics); `undefined` removes |
| local (`isolatedState`) | own root-like slot on the instance | own; commit |

- **Calculated fields** are a cell decorator: `get` adds them, memoized per input identity (today's `addCalculated` memo); `set` runs `cleanupCalculated`. The parent's calculated fields reach children's lenses the same way `withCalculated` does today.
- **What this removes:**
  - per child: a `StateSource`, its `map`/`filter`/`dropRepeats`/`remember`, the `isolate()` wrapper, and reducer wrapping at every ancestor;
  - `currentState` as a separately maintained tap;
  - the Collection's O(n) lookup per item;
  - the `local$` side fold.
- **`STATE.stream` / `STATE.watch` for users:** a lazily created facade stream over the cell, emitting on commit when `get()` changed. Most components never touch it, so they pay nothing.

## 5. Rendering, children and sinks

`Instance.render()` (top-down, inside the flush):
1. **Inputs:** the state cell value, props, children, and the **context keys the last view read**.
   - The context object the view gets is a Proxy that records reads.
   - A context change re-renders only the components that read a changed key.
2. **If no input changed and no child output changed,** return the cached vnode object. snabbdom skips identical vnodes, so unchanged subtrees cost an identity check.
3. **Otherwise:**
   - call the view (`onError` boundary; `appError` phase `'view'`);
   - one walk (stamps G-146 `inputSeq`, replaces markers through the registry, collects children by path or `id` prop as today);
   - reconcile children (create, update props/children, dispose removed);
   - render children;
   - inject their vnodes along copied paths only;
   - apply the DOM scope (`data.isolate`, key).
4. **Children are keyed in a `Map` per instance** (path or id), not recomputed by string in a second walk (`injectComponents` today). `getComponentIdFromElement`'s ids are kept for `uid()`.

**Hidden Switchable pages** skip `render()` and mark themselves stale (R4-1/R4-10): a flag check instead of `__switchPage` streams.

**Sinks:**
- One bus stream per driver sink per app.
- An instance's handler pushes `stamp(value)`, where `stamp` adds `__emitterId`/`__emitterName` and applies the instance's **scope chain** for drivers that isolate values (fetch and socket tag requests with every ancestor's scope today, one `isolateSink` per level).
- The proposal adds a value-level `isolateValue(v, scopes)` to the isolatable-source contract, with a stream-based fallback that wraps a per-instance stream only for sinks that instance's model actually uses.
- No hub per ancestor, so a value costs O(1) instead of O(depth).

**CHILD / PARENT:** the child calls `parent.childHub.next({component, name, value})` directly. `CHILD.select(Fn)` is a lazily created filter on that hub. `element.ts` keeps the same `{name, component, value}` shape.

**READY / Suspense:** a child's ready flag lives on the instance; a change marks the parent dirty. `processSuspensePost` is unchanged.

**Statics:** `statics.ts` keeps the generic `__sygnalStatic` mechanism:
- on each commit where the instance's (calculated) state changed, recompute the declaration;
- dropRepeats (`objIsEqual`), background-filter when the page is hidden, push to the bus.

This replaces `initStatics`'s combine/merge/double-`queueMicrotask` chain. G-158's "after the reducer" ordering falls out of the synchronous store.

## 6. Hooks (replacing instance patching)

```ts
interface Hooks {
  // definition time (behaviors, undo, selection, persist: today they mutate the instance in the ctor)
  transformDef?(def: Def, view: Function): Def
  // instance lifetime
  onCreate?(inst): void; onDispose?(inst): void; onRender?(inst, vnode): void
  // actions (dev action log, devtools, testing's t.actions / next() capture without log parsing)
  onAction?(inst, action, cause): void
  wrapHandler?(inst, action, sink, fn): fn        // action log / SYG222 wrappers
  onReducer?(inst, action, prev, next): void
  onNext?(inst, type, data, ms): void              // replaces testing's NEXT_LOG regex on debug text
  // sources (testing fakes, diagnostics wrappers)
  wrapSources?(inst, sources): sources
  // devtools time travel
  setState?: (inst | 'root', state) => void        // provided BY the runtime, not patched in
}
```

- **Diagnostics** (`sygnal/diagnostics`) and **devtools** install hooks on the runtime (or a global registry the runtime reads once).
- The `window.__SYGNAL_DEVTOOLS__?.connected` checks at about 12 sites become `hooks.x?.(…)`.
- Devtools gets a stable **inspection view** of an instance (`name`, `id`, `parentId`, `state`, `props`, `context`, `model` keys, statics), not the raw object.

## 7. API changes worth making (small for users, large for the core)

Ordered by core simplification per unit of user impact; evidence in study 2.

| # | Change | User impact | Core gain |
|---|---|---|---|
| 1 | Fixed source names `DOM`/`STATE` (drop `DOMSourceName`, `stateSourceName`) | ~none (doesn't work under `run()` today) | removes string threading in core and ~20 consumer files |
| 2 | Drop `.components` registry, string tags, string `of`, `CHILD.select('Name')` | low (A forms; JSX references functions) | identity by function only; the pragma's `$p` fast path always applies; no name sets |
| 3 | Drop the public `component({...})` factory, `sources`/`isolateOpts`, and the `sygnalFactory`/`sygnalOptions` vnode props | low (A/U). Keep `defineComponent(opts)` returning a function component | **one instantiation path.** Vnodes carry the component function (`data.c = fn`), not a per-render options object |
| 4 | Drop `'ACTION \| SINK'` (D157) | low (A, SYG504) | 12 parsers → 0 (or 1 at define time if kept) |
| 5 | Drop `.peers`, `hmrActions`, positional view args, single-stream intent, string/`true` context, `storeCalculatedInState` | low (A/U, no examples) | removes render params, startup branches and view-arg plumbing |
| 6 | BOOTSTRAP timing: "after the first commit" (microtask) instead of 10 ms | none per docs ("just after mount") | removes a timer and a gate path |
| 7 | Context dependency tracking (automatic, no API) | none | context changes re-render only the readers of the changed key |
| 8 | Resolve the `isolatedState` doc contradiction; fix the `calculated: boolean` type | doc only | — |

**Optional, bigger (not required for the rewrite):** a `select`-style context helper is not needed, because tracking is automatic. I would **not** change the model/intent shape: PLAN-1's evals tuned it for agents and it costs the core nothing.

## 8. Behaviour changes to accept (CHANGELOG material)

| Change | Who notices |
|---|---|
| A STATE reducer is applied synchronously when its action is processed (not in a microtask) | Code that read `STATE.stream._v` between an action and the next microtask; tests that awaited a microtask "for the reducer". `t.state` gets simpler |
| Intent subscribed at creation; INITIALIZE synchronous; BOOTSTRAP in a microtask, not at 10 ms | Tests with fake timers that advanced 10 ms to see BOOTSTRAP (renderComponent's waits hide this) |
| Driver/sink values pass no ancestor hubs: same values, emitted in the same order, possibly earlier in the tick | Nothing documented |
| Context changes skip non-reading components | A view relying on re-rendering for a side effect (not supported) |
| Teardown is synchronous and needs no `Stream.prototype` patch | Already the PLAN-4.5 contract |

## 9. Risks

- **Test suite coupling.** Many PLAN-3/4/4.5 tests poke internals: `instantiateCollection`, `_activeSubComponents`, scheduler counts, `k.r`, `__d`. Expect to port or rewrite a significant share of `test/p45-*`, `p4-*` and `diagnostics/*`. The behavioural suites (examples, browser-tests, docs samples, agent evals) are the parity bar.
- **Extensions:** behaviors/undo/selection/persist/actionLog/testing/devtools all have to move to hooks in the same release.
- **Reentrancy edge cases** in drivers that emit synchronously into a source inside sink delivery (event bus, `driverFromAsync` early replies, G-189/G-176): cover them with failing-first tests before switching.
- **SSR / `renderToString`** builds the same uid strings and reads `sygnalOptions.view` (ssr.ts). It moves to the vnode's `data.c` with the pragma change.
- **Size:** the prototype suggests a large net saving; the production core will be bigger than the prototype. The gate (≤ 42,300 B) should only go down.

## 10. Plan, if pursued (a PLAN-4.6 or a PLAN-5 pre-phase)

| Phase | Content | Exit |
|---|---|---|
| R0 | Decide the §7 API changes; write behaviour-parity tests for §8 and the reentrancy cases; define `Hooks` | user decisions; failing-first tests |
| R1 | `src/core/` with runtime, cells, define, instance, actions; pragma emits `data.c`; behind `run({ core: 'next' })` so both cores run the suite | canonical-subset tests and examples green on both |
| R2 | Collection, Switchable, markers registry, Suspense/READY, Lazy, Portal, Transition, ClientOnly, Slot | browser-tests green on `next` |
| R3 | Statics, replies, fetch/socket scope chains, commands, ELEMENT, controls; behaviors/undo/selection/persist via `transformDef` | PLAN-3/4 suites green |
| R4 | Diagnostics, devtools, testing (`renderComponent`) via hooks; SSR/Vike/Astro/element | full `npm test`, docs samples, perf gate (lowered) |
| R5 | Delete the old core, `cycle/state` chains and the `tearDown` patch; size gate; agent regression eval | all gates; size ≤ current |

The dual-core switch in R1–R4 keeps the old core as the parity oracle until R5.

## 11. Prototype

[proto/core-next.ts](proto/core-next.ts) has about 370 lines. To reproduce:
```
npm run build && npm ci --prefix benchmarks
node benchmarks/audit/build.mjs && node benchmarks/audit/build-next.mjs
node benchmarks/audit/bench.mjs --fw=sygnal,next,react --no-memory
```

- Apps: `benchmarks/audit/apps/next/*`, the same JSX as `apps/sygnal` with only the `run` import changed.
- `debug-next.mjs` loads a page and clicks through it.
- Raw results of this run: `results-core-rewrite.json`.
