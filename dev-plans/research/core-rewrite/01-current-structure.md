# Core rewrite study 1: the current component core (`plan45-integration` @ b67c208)

Working notes for the rewrite experiment. They describe `src/component.ts` (2,026 lines) and the modules it leans on, as of PLAN-4.5. Line numbers refer to that commit.

## 1. Entry points: how a component gets made

| Path | Where | What it does |
|---|---|---|
| `component(opts)` | `component.ts:139` | Options-object factory. Returns `make(sources)`, optionally wrapped in `isolate(make, isolateOpts)`, and tagged `isSygnalComponent`/`componentName`. `make` does `new Component({...opts, sources})` and adds `sinks.__dispose`. If `opts.sources` is given, it instantiates at once (legacy). |
| `optionsOf(fn, name, extra)` | `:111` | Reads the `OPTION_KEYS` statics off a function component and returns `{name, view: fn, ...statics}`. |
| `run(App)` | `extra/run.ts` | `component(optionsOf(App))`, then `withState(app, 'STATE')`, then cycle `setup(main, drivers)`. |
| JSX pragma | `pragma/index.ts` | A function tag that isn't `isSygnalComponent` becomes `sel = name` with `data.sygnalOptions = {view, model, intent, ...}`, a **new object per vnode per render**. A factory tag becomes `data.sygnalFactory`. |
| Collection item | `instantiateCollection` `:1371` | `component(optionsOf(of))`, once per Collection mount, then cycle `makeCollection` → `isolate(item, scopes)` per item. |
| Switchable page | `:1510` | `component(optionsOf(...))`. It **mutates `props.of` in place**. |
| Tag child | `instantiateCustomComponent` `:1540` | `component(props.sygnalOptions)` per new instance (new factory per instance), then `isolate(factory, {STATE: lens})`. |
| Lazy | `walkView` `:1652` | Rewrites the marker vnode into a `sygnalOptions` vnode once the import resolves. A re-render is forced by pushing a copied state with `__sygnalLazyTick` into the state stream. |

## 2. Constructor (`:227`–`432`), in order

1. **Calculated:**
   - normalize `fn | [deps, fn]`;
   - Kahn topological sort;
   - cycle path reported as SYG209;
   - per-field memo `{v, r}` (`_calculatedOrder`).
2. `isSubComponent = 'props$' in sources`. (`props$` presence is the root/child discriminator.)
3. **Source wrapping:**
   - STATE → `new StateSource(state$.map(tap currentState + devtools))`;
   - `props$` → `map` (tap `currentProps`, strip `sygnalFactory`/`sygnalOptions`);
   - `children$` → `extractSlots` (taps `currentChildren`/`currentSlots`);
   - DOM → `Proxy` (`DOM.click(sel)` shorthand).
4. **Root defaults:** a root without a model gets `__NOOP_ACTION__` intent and model, so the STATE sink is subscribed.
5. **Statics hooks:**
   - `resources` adds a `RESOURCE` model entry and `_idle`;
   - `uses[k].merge(this, k)` (behaviors mutate the instance's model);
   - `persist.setup(this)` (root only);
   - `__localState` (isolatedState).
6. **Per-app plumbing via sources:**
   - `__k`: the scheduler (the root makes it);
   - `__d`: depth;
   - `_r`: is-root;
   - `__uid`;
   - `dispose$`.
7. The `init*` chain: `ChildSources$`, `Intent$`, `HmrActions`, `Action$`, `State` (INITIALIZE entry), `Context`, `Model$`, `Peers$`, `Vdom$`, `Sinks`.
8. `sinks.__index`, then the devtools `onComponentCreated` and `onSubComponentRegistered` hooks.

## 3. Action path

```
intent(sourcesFor(this)) ─┐ object of streams → merged {type,data}
replies(componentNumber) ─┤ (reply-capable driver sources, __sygnalReplies)
BOOTSTRAP / hmrActions ───┤ emitted by `go()`
                          ▼
action$ = xs.create(...)   start: subscribe replies now; schedule go() on __k.t(1 | 10 ms)
                          │ (G-266: go waits for this instance's INITIALIZE, `_i`)
                          ▼
sequenced$ = via(action$, seq, initInjector)
   initInjector: __k.t(0 ms) → seq({type: INITIALIZE, data: initialState | hmr state})
   seq(action): INITIALIZE → _go() (releases first-render gate _w)
                snapshot: if any STATE reducer is pending anywhere (module-global
                `pendingReducers`) run the non-STATE handlers in a microtask with
                STATE_SNAPSHOT = currentState, else now (EFFECT can preventDefault)
                          ▼
model$[sink] = via(sequenced$ | snapshotted$, run handler list in model order)
   STATE   → reducer closure (state) => newState   (applied LATER by withState)
   other   → value | ABORT;  PARENT wraps {name, component: view, value}
   EFFECT  → side effect, never emits;  ELEMENT → runElementCommands after patch
```

- **Model normalization runs per instance:**
  - `'A | S'` split;
  - fn → `{STATE: fn}`;
  - SYG212/213 checks;
  - `makeOnAction` closures;
  - INITIALIZE added by copying the model (G-252).
- **STATE reducer closure** (`makeOnAction` `:989`):
  - `pendingReducers++`, plus a `setTimeout` reset;
  - `__k()` counts a pending reducer for the scheduler;
  - at apply time, `fresh` vs `currentState`;
  - `addCalculated`, then the reducer, then GS-4 identity = no change;
  - `diag.onReducer`, the view-transition flag, `cleanupCalculated`;
  - `currentState = result`, then `_s.shamefullySendNext` (it feeds statics ahead of the Collection flush).
- **`next(type, data, ms)`** is a `setTimeout`, then `action$.shamefullySendNext`.

## 4. State path (inherited from Cycle)

- **Root:**
  - `withState` folds reducers with `reducerMimic$`;
  - each reducer emission is applied in **its own `queueMicrotask`**;
  - `state$` is a StateSource over the fold: `filter(defined)`, `dropRepeats`, `remember`.
- **Every child gets a new StateSource chain from its parent:**
  - `parent.stream.startWith(currentState).map(addCalculated)`;
  - then `isolate(factory, {STATE: lens})`, which calls `isolateSource` → `select(lens.get)`: another map + filter + dropRepeats + remember;
  - on the way out, `isolateSink` wraps each reducer in `outerReducer(lens.get → inner → lens.set)`;
  - **writes climb the tree as reducer wrappers, one wrapper per level**, applied in a microtask at the root.
- **Lenses:**
  - `createSubComponentLense` (string key with SYG409, or `{get,set}`);
  - `withCalculated` adds the parent's calculated fields on get and `cleanupCalculated` on set.
- **isolatedState without a `state` prop:** `local$` keeps a private fold in the parent (`:1565`), off the parent's stream.
- **Collection** (`instantiateCollection` + `collection.ts` + `cycle/state/Collection.ts`):
  - `combine(parent state, props$)` → `batch(__k, d+1)` → filter/sort operators → `StateSource`;
  - `fieldLense` adds ids;
  - `makeCollection` folds an instances dict;
  - **`instanceLens.get` is a linear scan per item, so every state change costs O(n²) across items** (profiled: the #2 function in "mount 1k");
  - `pickCombine` (DOM) and `pickMerge` (others) gather the item sinks.

## 5. Render path

```
collectRenderParameters  (one xs.create; inputs: state, context, props, children/slots, DOM peers)
   per-input equality (objIsEqual; G-146 input-seq exception); all present → __k(d, emit)
   held while _w (first render waits for INITIALIZE + intent subscribe) or hidden Switchable page
render(params)                       (scheduler key d: parents first)
   view({...props, state, children, slots, context, peers, uid}, state, context, peers)
   catch → onError fallback / error div, appError(phase 'view')
   walkView: stamp data.inputSeq; replace Lazy/Portal/Transition/ClientOnly markers;
             collect sub-components by path id ('Name::r.0.2' or id prop)
   instantiateSubComponents: update props$/children$ of existing, create new
             (try/catch → onError), dispose removed (tearDown), hubs.set(child sinks), CHILD
   watch each child's DOM sink; trackReady (READY / Suspense)
out()                                 (scheduler key B - d: children before parents)
   injectComponents(root, childViews)   (re-derives ids by re-walking the tree)
   processSuspensePost                  (path copy only)
   diag.onRender; vdom$.next
root: key 2B → DOM driver: one patch per flush
```

The scheduler (`cycle/run/scheduler.ts`):
- A per-app keyed microtask queue.
- It waits up to 10 microtask hops while `__k()` counts new reducers.
- It holds the patch while first-render gates (`s.t(..., h=1)`) are pending, for at most 50 ms.
- A loop guard waits a macrotask after 100 flushes.
- `batch()` is a keyed stage operator.
- **`tearDown()` monkey-patches `Stream.prototype._remove`**, so the streams a dispose leaves without listeners stop in one timer per level.

## 6. Sinks and children

- **Per driver sink:** `hub([model$[n], ...peers$[n], state keep-alive])`. `hub.set` swaps in the children's sinks at each render. A child's sink stream sits in its parent's hub, and so on up to the root: **every driver value travels through one hub per ancestor**.
- **EVENTS and reply-capable sinks** are stamped with non-enumerable `__emitterId` and `__emitterName`.
- **`CHILD.select(x)`** goes through a lazy hub of the children's `PARENT` sinks, filtered by `component === x` (or by name).
- **`READY`** exists only when the model declares it; `__explicitReady`.
- **`EFFECT` and `ELEMENT`** are subscribed internally and are not driver sinks.

## 7. Disposal

- `dispose()` → `tearDown(_dispose)`.
- `_dispose` runs, in order:
  1. `diag.onDispose` and devtools;
  2. the DISPOSE action, through `action$.shamefullySendNext`;
  3. `dispose$` next and complete;
  4. replies completed (G-144);
  5. AbortController aborted;
  6. the children disposed.
- After that (in a microtask if reducers are pending), it completes `action$`, `vdom$` and the child sinks, and unsubscribes `_subscriptions`.

## 8. Cross-cutting

- **Devtools:**
  - `window.__SYGNAL_DEVTOOLS__` hooks are called inline at about 12 sites;
  - `onComponentCreated` gets the raw instance, so devtools reads internals.
- **Diagnostics:**
  - `diag.onIntent/onModel/onRender/onReducer/onDispose/sourcesFor` (no-ops when off);
  - `makeOnAction`/`makeEffectHandler` are wrapped by the action log;
  - the dev statics freeze reads `_o`.
- **Module globals:** `COMPONENT_COUNT` and `pendingReducers`. `pendingReducers` is app-crossing, though PLAN-4.5's G-231 said module-global state was wrong.
- **Magic source keys** (the parent→child protocol): `props$`, `children$`, `__parentContext$`, `__parentComponentNumber`, `__localState`, `__switchPage`, `__k`, `__d`, `__uid`, `__hmr`, `commands$`, `dispose$`, `CHILD`, `PARENT: null`. On the driver side: `__sygnalStatic`, `__sygnalReplies`. `NOT_SINK` regex (`shared.ts`).

## 9. Where the complexity comes from (ranked by bugs and lines it causes)

**A. State applied asynchronously.**
- `withState` applies every reducer in a microtask, so `currentState` lags the action that changed it.
- That lag produces `STATE_SNAPSHOT`, the global `pendingReducers`, `fresh`, `_s`, the scheduler's `__k()` counting with up to 10 hops, and B-003/B-013/1H-1/1H-3.

**B. Timer-based startup.**
- INITIALIZE fires @0 ms, the intent @1 ms, BOOTSTRAP @10 ms.
- Around them: the first-render gate `_w`, plus `_i`, `_go`, gates and holds with a 50 ms bound.
- This is where most of PLAN-4.5's review findings came from: G-257, G-266, G-272, G-273, G-274, G-284, G-287.

**C. Cycle isolate/lens chains for state.**
- Each child is a new StateSource chain plus an isolate wrapper.
- Writes climb as nested reducer closures.
- Collection items look themselves up by linear scan, O(n²).

**D. Identity by re-walking vnodes.**
- Sub-component ids are recomputed by string paths, in `walkView` and again in `injectComponents`.
- The pragma rebuilds `sygnalOptions` per vnode per render.
- `component()` runs per new tag instance, so per-instance model normalization repeats.

**E. Legacy option surface** threaded through every function:
- `DOMSourceName` and `stateSourceName` strings;
- `peers`, `components` with string tags, `hmrActions`, `isolateOpts`, `sources`;
- `'A | S'`, string/boolean context, a single-stream intent;
- `storeCalculatedInState`, `sygnal-factory`.

**F. Sinks travel through every ancestor's hub**, and DOM views through every ancestor's `out()`.

## 10. Measured (this machine, Chromium headless, production build, median of 8)

| Op | Sygnal latency / CPU | React latency / CPU |
|---|---|---|
| mount 1k components | 35.7 / 48.9 ms | 9.8 / 18.7 ms |
| update 1 of 1k | 4.0 / 13.1 | 1.15 / 5.9 |
| unmount 1k | 6.7 / 21.5 | 2.8 / 7.5 |
| Collection: create 1k rows | 44.0 / 61.0 | 13.6 / 21.0 (React, no per-row component) |
| Collection: select row 1k | 8.3 / 18.0 (GC 9.4 of 21.9 busy) | 0.6 / 6.0 |
| plain-view select row 1k | 3.1 / 9.1 | 0.6 / 6.0 |
| leaf update 30 deep | 1.2 / 3.4 | 0.45 / 3.1 |
| keystroke (1k list) | 1.15 / 4.8 | 0.6 / 4.8 |

**Profile notes:**
- **Mount 1k:**
  - `component.ts` self time is 20% of busy, xstream 11%;
  - `Collection.ts:72` `instanceLens.get` is 4.6%, from the O(n²) scan;
  - the harness's own MutationObserver `check` is 13%, measurement overhead to ignore.
- **Collection select:**
  - all 1,000 rows re-render, because each reads `context.selected` and context has no per-key dependency tracking;
  - GC is 43% of busy.
