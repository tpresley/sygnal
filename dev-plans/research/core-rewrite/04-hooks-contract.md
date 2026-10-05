# Core rewrite 4: the hooks contract (PLAN-4.6 R0)

**Types:** [`src/core/hooks.ts`](../../../src/core/hooks.ts) (types only, imported by nothing yet, 0 bytes in any bundle).
**Inputs:** [03-proposal.md](03-proposal.md) §6, spike 0-S (`proto/registry.ts`, `proto/runtime.ts`, `proto/uses.ts`), PLAN-4.6 §2 and D165–D170.
**Line numbers** below are for `plan46-integration` @ `666a3c5` (all paths under `src/`).

## 1. Why

Today every extension reaches into the component instance:
- it replaces instance methods (`makeOnAction`, `makeEffectHandler`, `instantiateCollection`, `collectRenderParameters`, `log`);
- it mutates fields during the constructor (`model`, `intent`, `initialState`, `sources`, `sourceNames`, `model$[sink]`);
- or it writes into stream internals (`action$._n`, `_replies[i]._n`, `sinks.STATE.shamefullySendNext`, `STATE.stream._v`).

Three ordering facts of `component.ts` make that work, and the new core won't have them:
1. `diag.onIntent` (497/512) runs before `initAction$`/`initModel$` (412/415).
2. `diag.onModel` (684/795) runs before `initVdom$` (417; `collectRenderParameters` at 835) and `initSinks` (418; `model$` read at 933–966).
3. The core calls `this.instantiateCollection`, `this.makeOnAction`, `this.makeEffectHandler` and `this.log` through the instance, so an own property overrides them.

The new core replaces all of it with three layers:
1. **module registries** for features (definition hooks, hosts, markers, resolvers, statics);
2. **per-app hooks** for observers and wrappers (diagnostics, devtools, testing, the action log);
3. a **runtime API** (`InstanceView`, `setState`, `dispatch`, `getState`) instead of raw instances and stream internals.

## 2. The contract

### 2.1 Registries (module level, filled on import; an app that never imports the module pays nothing)

| Registry | Signature | Users |
|---|---|---|
| `defHooks` | `(src: DefSource, view) => DefSource \| void`, once per component function | behaviors (`uses`), undo, selection, pager, persist (model rewrite + RESTORE entry), resources (RESOURCE entry + `idle`) |
| `hosts` | `sel → (owner, props, children) => Host` | Collection, Switchable |
| `pres` | `sel → (vnode, owner) => vnode` (template rewrite in the reconcile walk) | Portal, Transition, ClientOnly, Slot |
| `posts` | `sel → (vnode, owner) => vnode` (after injection) | Suspense |
| `resolvers` | `(view, owner) => view \| undefined` | lazy |
| statics | `__sygnalStatic` / `__sygnalReplies` / `replies(id)` / optional `isolateValue` on a driver source | timers, fetch `resources`, socket `connections`, router `route`, head, testing fakes, PLAN-5 browser sources |

**Owners (R2):** registry entries are core modules, so hosts, `pres`, `posts` and `resolvers` get the owner's raw instance (a resolver calls `owner.refresh()` to render it again); hooks get `InstanceView`s. Each registration is guarded by D175's build constant (`src/core/build.ts`), so a production build that strips the next core drops them too.

**`transformDef` / `defHooks`** (spike finding 5): a definition hook runs a behavior's existing `merge(component, key)` on a **definition shim** (`model`, `intent`, `initialState`, `_idle`, `stateSourceName: 'STATE'`, `isSubComponent: true`, `view`). So `behaviors.ts`, `undo.ts` and `selection.ts` work unchanged. They run once per function instead of once per instance. The slice goes to `idle` (the defaults a sub-component reads until it writes them) and, for a root, into `initialState`. That matches today's root merge (`behaviors.ts:57`) vs sub-component `_idle` (`behaviors.ts:56`).

### 2.2 Hooks (per app; all optional; called as `hooks.x?.(…)`)

| Hook | When | Replaces |
|---|---|---|
| `transformDef(src, view)` | definition time (per app consumers) | `state.ts` SYG222 model wrapping in onIntent, strict's model checks |
| `onCreate(inst)` | after the state cell + INITIALIZE, before the intent subscribes | `onComponentCreated`, `onSubComponentRegistered`, testing's root detection |
| `onDispose(inst)` | start of dispose | `diag.onDispose`, `onComponentDisposed` |
| `onRender(inst, vnode)` | after a view ran (not for a cached vnode) | `diag.onRender` |
| `onPatch(vnode)` | after the one root patch of a flush | the perf gate's and parity suite's DOM wrapper (test-only today) |
| `wrapSources(inst, sources)` | once, before the intent | `diag.sourcesFor`, testing's `inject` (mutating `sources`/`sourceNames`), shorthand/controls/replies Proxies |
| `onIntent(inst, names)` | after the intent returned | `diag.onIntent` action-name checks (SYG605, inspect) |
| `onAction(inst, action)` | an action is dequeued, with `cause` | `action$._n`, `action$.shamefullySendNext` and `_replies[i]._n` patches (action log, devtools `patchReplies`), `onActionDispatched` |
| `wrapHandler(inst, type, sink, fn)` | per handler, when the action runs | `makeOnAction` / `makeEffectHandler` replacement, SYG222 reducer wrapping |
| `onReducer(inst, type, prev, next)` | after STATE was applied | `diag.onReducer` |
| `onSink(inst, type, sink, value)` | a non-STATE sink produced a value | `model$[sink]` replacements (replies, fetch, ELEMENT, EVENTS taps), `recordChildSinks` |
| `onNext(inst, type, data, ms)` | a model `next()` was scheduled | testing's `NEXT_LOG` regex over `log` text (testing.ts:1031) |
| `onElementCommand(inst, cmd)` | before an ELEMENT command runs after the patch | `model$.ELEMENT` replacement (testing `recordCommands`, checks/elementCommands) |
| `onStateChanged` / `onPropsChanged` / `onContextChanged` / `onReady` | in the flush, when they changed | the `window.__SYGNAL_DEVTOOLS__?.connected` checks |
| `onContextMiss(inst, read, changed)` | dev only: a skipped view re-run gave a different vnode (D168) | new |
| `onStateSeed(inst, slice, initialState)` | an `isolatedState` child bound to an existing slice keeps it (D174; R2) | R4's dev warning (keys `initialState` defines that the slice lacks) |
| `onDuplicateKey(owner, key)` | a Collection item key appears more than once; its first element renders (D169; R2) | R4's dev warning |
| `onError(error, info)` | errors with a phase | `sources.__e` / run()'s `onError` |

**Rules:**
- Hooks run synchronously inside the queue/flush. A hook may dispatch (it is queued FIFO), but must not render, patch or dispose.
- A hook gets an `InstanceView`, never the raw instance.
- Hooks are per app, so two apps on a page never see each other's (today `pendingReducers` and the diagnostics bridge are page-wide). `globalThis.__SYGNAL_DIAGNOSTICS__` stays the dev entry's bridge, but what it installs becomes hooks: the runtime reads the registered check set once per app.

### 2.3 Runtime API

- **`InstanceView`:** `id`, `parentId`, `name`, `def`, `state`, `props`, `context`, `kind`, `shown`, `disposed`, `uid`, `children()`, `sources`. Devtools' "about 15 fields" all come from here.
- **`getState()`:** replaces `STATE.stream._v`.
- **`setState(target, state | fn)`:** a queued action with cause `'setState'`, applied run-to-completion, one patch. It replaces every `shamefullySendNext` of a reducer: devtools time travel, element prop sync, HMR state restore, Vike page swaps, the lazy re-render tick.
- **`dispatch(target, type, data, cause)`:** replaces testing's `simulateAction` push and persist's RESTORE push.
- **`addHooks(hooks)`:** a dev entry or devtools connecting after `run()`.
- **`flushed()`:** testing's settle without polling.

### 2.4 The flush contract (spike finding 3; PLAN-4.6 §2 change 4)

1. **Actions drain run-to-completion, FIFO.**
   - An action dispatched while one is processed is appended, never nested. That covers a driver emitting synchronously during sink delivery, an EFFECT dispatching, a PARENT, or a hook.
   - Each action: `pre = cell.get()`; its handlers run in model order with `(pre, data, next, props)`.
   - STATE is applied immediately (D165). Every other sink gets `pre`. EFFECT runs synchronously.
2. **A commit schedules one flush** (a microtask). The flush loops until nothing changed:
   - run the STATE watchers;
   - render top-down (dirty-checked; a hidden Switchable page is skipped);
   - recompute the statics of instances whose state changed;
   - drain the queue.
3. **Then:**
   - **one** root vnode goes to the DOM driver (one patch);
   - the streams of disposed instances are stopped (the `_remove` swap scoped to `dispose()`, D165/Q18: no timer);
   - ELEMENT commands run;
   - BOOTSTRAP is dispatched for the instances created in this flush, a microtask later.
4. **Loop guard:**
   - at most 100 passes per flush and 100 flushes per macrotask;
   - past that, the next flush waits for a `MessageChannel` message;
   - no `setTimeout` anywhere (replaces G-260/G-283's timers and fixes G-284).
5. **Startup:**
   - `initialState` (or the HMR, persisted or hydrated state) is written synchronously;
   - INITIALIZE is a synchronous action at construction;
   - the intent subscribes at creation, so a synchronous emission only queues;
   - the first render is in the same flush.
   - No 0/1/10 ms timers, gates or holds (D153's reason is gone).

### 2.5 Context tracking (D168)

- The `context` object a view gets is a Proxy that records the keys it reads during that call. The instance stores the set with its cached vnode.
- A context change marks dirty only the instances whose recorded set intersects the changed keys. A view with no context read is never re-rendered by a context change.
- Context entries are computed (memoized on the providing instance's state identity) and compared by key with `===`.
- **Dev check:**
  - With diagnostics on, a sample of skipped views is re-run after the flush (say 1 in 16, capped per flush).
  - When the vnode differs structurally from the cached one, the core reports it (a new SYG code in the R4 range) and calls `onContextMiss`.
  - The residual risk is a read after the view returned. It can't happen in a synchronous view, but a read through a closure kept in an event handler would escape tracking. Views never bind events, so that is unsupported anyway.

### 2.6 Hidden Switchable pages (D172, superseding D166's `lazy` prop)

- Every page is created at mount (its INITIALIZE, intent, actions, BOOTSTRAP, PARENT and `background: true` statics run from then on). A hidden page's view is first called when it is first shown, with the current state, as today (G-121). After that its render is skipped while hidden and it renders on show if its inputs changed. No new prop.
- **READY:** the Switchable stays ready for its owner, as today.

## 3. Consumers: what they use today, and the hook that replaces it

### 3.1 Behaviors (`uses`: undo, selection, pager, defineBehavior)

| Today | Use | Replacement |
|---|---|---|
| component.ts:375–376 `view.uses[k].merge(this, k)` in the constructor | per instance | `defHooks` entry (registered by `extra/behaviors.ts` on import) running `merge` on the definition shim, once per function |
| behaviors.ts:54 `c.stateSourceName`, `c.model` replaced | rewrite the model | shim `model` (stateSourceName fixed `'STATE'`, D162) |
| behaviors.ts:55, 89, 100, 104 `c._behaviorActions` | action → behavior key | `DefSource.behaviorActions` → `Def.behaviorActions` (read by the action log and devtools) |
| behaviors.ts:56 `c.isSubComponent`, `c.isolatedState`, `c._idle` | slice defaults | shim `isSubComponent: true` → `DefSource.idle`; the core applies `idle` under a child's state (today `addCalculated`, component.ts:1096–1106) |
| behaviors.ts:57 `c.initialState` | root slice | DefSource `initialState` (root) |
| behaviors.ts:94–108 `c._uses`, `c.intent` replaced, `h.__sygnalTestActions` | combined intent | shim `intent`. Testing's marker becomes a `wrapSources` concern (testing passes its actions through `dispatch`, not an intent property) |
| undo.ts:132–135 `c.model`, `c.view.uses`, bridge `report(SYG226)` | wrap model | same shim; the report gets the def name |
| selection.ts:67–73 `c.model[k+'.SELECT_ALL'…]` | model rewrite | same shim |
| checks/state.ts:40 `_uses`; checks/actionLog.ts:91 and devtoolsActions.ts:310 `_behaviorActions` | read | `inst.def.behaviorActions`, `inst.def.view.uses` |

### 3.2 persist

| Today | Replacement |
|---|---|
| component.ts:378 `view.persist.setup(this)` (root only) | `defHooks` entry for the model (RESTORE entry; PERSIST sinks → EFFECT) + `onCreate` for the root instance (storage, hydrate, listeners) |
| persist.ts:41–46 `c.sources.__m`, `__storage`, `__hydrate`, `c.calculated` | `inst.sources` (the same internal sources), `inst.def.calculated` |
| persist.ts:78 `c.action$.shamefullySendNext({type: 'RESTORE'})` | `runtime.dispatch(inst, 'RESTORE', data, 'built-in')` |
| persist.ts:82–87 `c.model` replaced | `defHooks` |
| persist.ts:92 `c.initialState` overwritten | `runtime.setState(inst, restored)` before the first render, or a `restoreState(inst)` return from `onCreate` (R3 decides; both are synchronous in the new core) |
| persist.ts:94/117 `STATE.stream` listener | `onStateChanged` (root) |
| persist.ts:103 `c.vdom$` listener (wait for the first render after hydration) | `onPatch` once, then dispatch RESTORE |
| persist.ts:115 `c._dispose$` | `onDispose` |
| checks/persist.ts:20–26 `view.persist`, `isSubComponent`, `sources.__vike` | `inst.def.view`, `inst.isRoot`, `inst.sources` |

### 3.3 Dev action log (`checks/actionLog.ts`; installed by testing, devtoolsActions, inspect)

| Today | Replacement |
|---|---|
| actionLog.ts:182–193 replaces `c.makeOnAction` (called component.ts:763) | `wrapHandler` |
| actionLog.ts:195–200 replaces `c.makeEffectHandler` (component.ts:763/1057) | `wrapHandler` (sink `'EFFECT'`) |
| actionLog.ts:209–220 replaces `c.action$._n` (an xstream internal) | `onAction` (with `cause`) |
| actionLog.ts:212, 221–223 replaces `c.action$.shamefullySendNext` (cause 'next'; also DISPOSE, RESTORE) | `onAction` cause `'next'` / `'built-in'`; `onNext` for the scheduling |
| actionLog.ts:224–228 and devtoolsActions.ts:172–180 replace `c._replies[i]._n` (index ↔ source name by filter order) | `onAction` cause `'reply'` (the runtime knows which source) |
| actionLog.ts:108–109, 159 `c.name`, `c._componentNumber`, `c.stateSourceName` | `InstanceView` |
| actionLog.ts:165 `reducer[ORIGINAL]` | `wrapHandler` gets the model's original `fn` |
| per-instance storage `c.__sygnalActionLog` | the hook's own `WeakMap<InstanceView, …>` |

### 3.4 Testing (`renderComponent`, `extra/testing.ts`)

| Today | Replacement |
|---|---|
| 1485–1551: an `always` check with onRender/onReducer/onIntent/onModel/sources/onDispose | the same functions as app hooks (`__hooks` run option) |
| 1864–1876: `component({view: componentDef, intent: wrappedIntent, …})` | `run(componentDef, drivers, {__hooks})`; no options factory (D162) |
| 1846–1852: `__sygnalTestActions` on the intent object (read by behaviors.ts:102, wiring.ts:89, inspect.ts:141) | `simulateAction` → `runtime.dispatch(root, type, data, 'simulateAction')`; wiring/inspect read the action names from `onIntent` plus a list testing passes in the hook's options |
| 1352–1359, 1504: `c.sources[DOMSourceName]._hub`, `._path` (mock DOM internals) | `wrapSources` gets the instance's DOM source; the mock DOM source exposes the scope path it needs (a mock-DOM API, not a core internal) |
| 1376–1399 `inject`: `c.sources[n] = fake(n)`, `c.sourceNames.push(n)` | `wrapSources` returning the fakes; replies/statics detection runs after it (§2.2) |
| 1494, 1498, 1825–1830: `_componentNumber`, `name`, `sources.__parentComponentNumber` (root detection, fake scope paths) | `InstanceView.id`, `.name`, `.parentId`, `.isRoot`; `onCreate` |
| 1400–1417 `recordChildSinks`: `c.sinks[k]` listeners a microtask later | `onSink` |
| 1418–1431 `watchNext`: `c.log` replaced, `NEXT_LOG` regex on component.ts:985/1068 text | `onNext` |
| 1458–1471 `recordCommands`: `c.model$.ELEMENT` replaced | `onElementCommand` |
| 1515–1521: `c.collectRenderParameters` replaced (real DOM: tag `viewTag`) | `onRender` (the vnode is the instance's; testing tags it there) or a `pres` entry owned by testing |
| 1525–1532 `sources` Proxy (`fake(k).at(ns)`) | `wrapSources` |
| 1466/1476 `checkSentCommand(c, …)`, `reportElementCommand(c, …)` read `_disposed`, `name` | `InstanceView.disposed`, `.name` |
| 2016–2018, 2959 `t.state` from `sources.STATE.stream` | unchanged (public), or `runtime.getState()` |
| 2920 `sinks.__dispose()` | `app.dispose()` |
| fakes with `__sygnalStatic` / `__sygnalReplies` (1209, 1709–1713, 1981) | unchanged (the statics contract is kept) |

### 3.5 Devtools (`extra/devtools.ts`, `devtoolsActions.ts`, `reduxDevtools.ts`)

| Today | Replacement |
|---|---|
| component.ts:312–313 `onStateChanged`, 324–325 `onPropsChanged`, 425–432 `onComponentCreated` (raw instance) + `onSubComponentRegistered`, 445–446 `onComponentDisposed`, 559–560 `onActionDispatched`, 637–638 `onContextChanged`, 915–916 `onReadyChanged`, 1484–1491 `onCollectionMounted`, 1620–1621 `onDebugLog` (all `window.__SYGNAL_DEVTOOLS__?.connected`) | the devtools entry registers hooks: `onStateChanged`, `onPropsChanged`, `onCreate`, `onDispose`, `onAction`, `onContextChanged`, `onReady`; Collection mount = `onCreate` with `kind: 'item'`; debug log = `onAction`/`onReducer` |
| devtools.ts:151–167 reads `isSubComponent`, `model`, `intent`, `context`, `calculated`, `components`, `_debug`, keeps a `WeakRef(instance)` | `InstanceView` (`def` has model/intent/context/calculated; `.components` is gone, D163); a `WeakRef(view)` |
| devtools.ts:516–556 `_extractMviGraph`: `model` (parses `'A \| SINK'` itself), `sourceNames`, `stateSourceName`, `context` | `inst.def.handlers` (already normalized; no pipe parsing, D164), `inst.sources` |
| devtools.ts:356–361 `instance._debug = enabled` (read by the `debug` getter, component.ts:490) | a devtools-side flag; per-instance debug logging becomes the devtools' own `onAction` filter |
| devtools.ts:392–395 `_timeTravel`: `instance.sinks[stateSourceName].shamefullySendNext(() => s)`; 403–405 fallback `__SYGNAL_DEVTOOLS_APP__.sinks.STATE…`; reduxDevtools.ts:82–84 | `runtime.setState(inst \| 'root', s)` |
| devtools.ts:415–420, 440–447, 481–486 `currentState`, `currentContext`, `currentProps` | `inst.state`, `.context`, `.props` |
| devtoolsActions.ts:120–136, 145–153, 239, 273–277, 309–323: `_componentNumber`, `__parentComponentNumber`, `name`, `stateSourceName`, `cleanupCalculated(s)`, `currentState`, `sources[slot].__sygnalStatic`, `view`, `sources[k]`, `model`, `_behaviorActions`, `sourceNames`, `view.initialState` | `InstanceView` + `def`; `cleanupCalculated` → `def.calculated` names (the runtime strips them in `setState`) |
| `window.__SYGNAL_DEVTOOLS_APP__` (run.ts:108/122; element.ts:227; devtools.ts:403) | the app's `RuntimeAPI`, registered with the devtools hook on `run()` |

### 3.6 Diagnostics checks (`extra/diagnostics/checks/**`)

| Today | Replacement |
|---|---|
| collections.ts:57–65 replaces `component.instantiateCollection` (component.ts:1244), reads `currentState`, `addCalculated(state)` | a check on the Collection host: `onRender` of the owner with `inst.state` (calculated included); or a host-level hook `onHostProps(owner, sel, props)` if the check needs the props before reconcile (R4) |
| state.ts:71–86 replaces `component.model` (SYG222 wrappers, `ORIGINAL`), reads `stateSourceName`, `_uses` | `wrapHandler` (STATE) |
| state.ts:88 onReducer `isSubComponent` | `onReducer` + `inst.isRoot` |
| statics.ts:44–47 deep-freezes `view` statics and `component._o` (raw options) | `onCreate` freezing `inst.def.view`'s statics (no `_o`: no options object, D162) |
| replies.ts:119–140, fetch.ts:85/123–133 replace `model$[sink]`; read `sources[n].__sygnalReplies`, `__sygnalRouter`, `__matches` | `onSink` (check the value) + `wrapSources` (the source Proxy) |
| elementCommands.ts:88, 152–160 `model$.ELEMENT`, `_disposed` | `onElementCommand`, `inst.disposed` |
| inspect.ts:135–159 `intent$`, `__sygnalTestActions`, `model$.EVENTS` tap; 84–99 `__parentComponentNumber`, `sources.PARENT === null`, `sources.state`, `_componentNumber`, `stateSourceName`; 242–265 `currentState`, `view.resources`, `sources[k].__inspect()`; 357/368 `calculated`, `context` | `onIntent`, `onSink` (EVENTS), `InstanceView` (`kind` replaces the `PARENT === null` / `sources.state` sniffing), `runtime.root.children()` for the graph |
| wiring.ts:35, 45–117 `sources[DOMSourceName]._hub`, action names, `sourceNames`, `stateSourceName`, `intent$.__sygnalTestActions`, `hmrActions` | `onIntent`, `wrapSources`; `hmrActions` is gone (D164) |
| shorthand.ts:102–110, controls.ts:137–145 Proxy the DOM source by `DOMSourceName` | `wrapSources` (`DOM` fixed, D162) |
| controls.ts:61 vnode `data.props.sygnalOptions` / `sygnalFactory` | the vnode's `data.c` (component function, R1 pragma) |
| dom.ts:214–240 `_isolateModule`, `.namespace`, onRender/onDispose; dom.ts:75 `view.toString()` | `wrapSources` (the DOM source keeps its public isolation info), `onRender`, `onDispose`, `inst.def.view` |
| props.ts:24 `currentProps` | `inst.props` |
| router.ts:69–90, timers.ts:61–66 `sources`, `sourceNames`, `__sygnalStatic`, `view[k]`, `isSubComponent`, `initialState` | `inst.def.statics`, `inst.sources`, `inst.isRoot` |
| strict.ts:60–79 `view.length`, `view.__sygnalLazy`, `model` | `transformDef` (definition time; strict checks the source shapes) |
| viewTransitions.ts:18–36 `view.viewTransitions`, `model`, `_isolateModule.vtDriver` | `inst.def`; the driver flag stays on the DOM source |
| core call sites `diag.onDispose` 444, `onIntent` 497/512, `sourcesFor` 505, `onModel` 684/795, `onRender` 849, `onReducer` 1013; `MainDOMSource.ts:98 onSelector`; `eventDriver.ts:20/32 onBusEmit/onBusSelect` | the core's calls become hooks (`onDispose`, `onIntent`, `wrapSources`, `transformDef`, `onRender`, `onReducer`); `onSelector` and the bus hooks are DOM/driver-level and stay as they are |

### 3.7 Resources / RESOURCE

| Today | Replacement |
|---|---|
| component.ts:367–372 prepends `RESOURCE` to `this.model`, sets `this._idle[k] = {status: 'idle'}` | `defHooks` entry registered by `fetchDriver.ts` (or the core's statics module) when `view.resources` is set: model entry + `idle` |
| component.ts:648–676 `initStatics` (`sourceNames` × `__sygnalStatic`, `addCalculated` + `_s`, `__switchPage.shown$`, two microtasks) | `statics.ts` of the next core: recompute on commits that changed the instance's state; background filter from `inst.shown`; no microtask hop |
| component.ts:549/566/465 `_replies` | the runtime subscribes `replies(id)` per instance and dispatches with cause `'reply'` |
| component.ts:933–939 `__emitterId` / `__emitterName` stamping | unchanged contract (stamped by the runtime's sink bus) |

### 3.8 viewTransitions

| Today | Replacement |
|---|---|
| component.ts:1015 sets `sources[DOMSourceName]._isolateModule.vt = 1` in the STATE reducer when the action is listed | `onReducer` in a module registered by `extra/viewTransitions.ts` (it owns the flag); or the runtime marks the flush `vt` and the DOM sink reads it. R3 decides; no user-visible change |
| extra/viewTransitions.ts:21–36, cycle/dom/viewTransition.ts:20–22 | unchanged (DOM-driver side) |

### 3.9 `sygnal/element`

| Today | Replacement |
|---|---|
| element.ts:188 `app.hmr(comp, app.sources.STATE.stream._v)` | `runtime.getState()` |
| element.ts:194 `app.sinks.STATE.shamefullySendNext(reducer)` (props → state) | `runtime.setState('root', fn)` |
| element.ts:213–214 PARENT value shape `{name, component, value}` | unchanged (the CHILD hub keeps the shape) |
| element.ts:199–202 `owned({...})` initialState; :227 `__SYGNAL_DEVTOOLS_APP__`; :157 bridge `report` | unchanged / the app's RuntimeAPI |

### 3.10 SSR (`extra/ssr.ts`)

| Today | Replacement |
|---|---|
| ssr.ts:384 detects sub-components by `props.sygnalOptions \|\| sygnalFactory` | `data.c` (the component function on the vnode, R1 pragma) |
| ssr.ts:418–445 `sygnalOptions.view`; **mutates** the view with `Object.assign(view, {initialState, model, …})` | reads statics from `data.c`, no mutation (nothing to copy: there is no options object) |
| ssr.ts:797 strips `sygnalOptions`/`sygnalFactory` | strips `c` |
| ssr.ts:120–133 `def.uses[k].state`; 140–158 `def.resources`; 172–187 `onError`, `head`; 160–164 uid via `uidPart` | `Def` through the same `defOf()` (behaviors' slices via `idle`), so SSR and the client share one normalization |

### 3.11 Vike and Astro

| Today | Replacement |
|---|---|
| vike/onRenderClient.ts:84–100, 127–148 hand-build vnodes with `props.sygnalOptions` (`isolatedState: true`, `owned` initialState) | a wrapper component function per page (as astro/client.ts does), rendered through `data.c` |
| vike/onRenderClient.ts:326–328 `currentApp.sinks.STATE.shamefullySendNext(s => ({...s, page}))` | `runtime.setState('root', fn)` |
| vike/onRenderClient.ts:374, 418 `__vike`, `__hydrate` sources; astro/client.ts:104 `__hydrate` | unchanged (internal sources; persist reads them through `inst.sources`) |
| astro/client.ts:78–101 copies statics onto `Wrapped` | unchanged (definition-level) |

### 3.12 HMR (`sygnal/vite` + core)

| Today | Replacement |
|---|---|
| vite/plugin.ts:500/505 `import.meta.hot.accept(path, X.hmr)` / `dispose` | unchanged (run() result) |
| extra/hmr.ts:47, run.ts:180–185 `STATE.stream._v` (or a reducer returning ABORT) | `runtime.getState()` |
| run.ts:125–160 `swapToComponent`: `sinks.STATE.shamefullySendNext(() => state)` at 0 and 20 ms, `setDebugListener` | the new app is created with the kept state as its root cell's initial value (synchronous startup, so no 0/20 ms re-sends) |
| run.ts:96 `__hmr` source `{u, s}`; component.ts:539/542/570 (no BOOTSTRAP while swapping), 688–695 (`hmrState` replaces initialState) | an internal run option read once by the runtime |
| component.ts:515–519, 570 `hmrActions` | removed (D164) |

### 3.13 Collection, Switchable, lazy, Suspense internals

| Today | Replacement |
|---|---|
| cycle/state/Collection.ts:147 `sinks._key`; pickCombine.ts:76/97/111, pickMerge.ts:81 | the Collection host keys instances in a `Map` (no sinks objects, no pickCombine) |
| Collection.ts:141 item `__uid`; 180 `__k`, `__d` | `InstanceView.uid`; no scheduler/depth sources |
| switchable.ts:79/110 `__switchPage` (`shown`, `shown$`, `mark()`, `stale`, …); component.ts:1161/1181/1206/663 | the Switchable host's page flag (`inst.shown`), read by render and statics |
| lazy.ts:43–47 `__sygnalLazy*` on the wrapper; component.ts:1653–1667 pushes `{...currentState, __sygnalLazyTick}` into the parent's state stream | `resolvers` entry; on load the runtime marks the owner dirty (no state write) |
| component.ts:965–968 `__explicitReady`, 904–923 `trackReady`, 1740–1742, 1777–1810 `processSuspensePost` | instance READY flag → owner dirty; Suspense as a `posts` entry |
| `sinks.__index` (component.ts:420) | dead (no reader); not carried over |

## 4. Mapping gaps (consumers that can't map to a hook without a behaviour change)

None needs a user-visible change. These are the points where the mapping is not one-to-one; R3/R4 decide them:
1. **persist's `initialState` overwrite** (persist.ts:92). The new core writes the initial state before `onCreate`. Persist either sets the restored state through `setState` before the first render (one extra queued action, same flush, so not visible), or the runtime offers `onCreate` a return value. No visible difference either way.
2. **Testing's `__sygnalTestActions` marker** is read by three modules. It becomes an explicit list in the hooks' options. Behaviors stop needing it once `simulateAction` goes through `runtime.dispatch`.
3. **diagnostics' `instantiateCollection` wrapper** checks Collection props before instantiation. If `onRender` is too late for one of its codes, R4 adds a host-level hook (`onHostProps`). It is internal, so no API change.
4. **Devtools' per-instance debug log** (`_debug`, `onDebugLog`) moves into devtools. The `SYGNAL_DEBUG` console output of the core either becomes a hook consumer in the devtools/diagnostics entry, or is dropped from the core. Not documented as a contract; decide in R4.
5. **The `log` text** testing parses is replaced by `onNext`. The debug text itself may change wording.

## 5. R3: how the extensions mapped (as built)

| Consumer | Where | As built |
|---|---|---|
| Statics (timers, resources, connections, route, head, testing fakes) | `core/statics.ts` | Drivers scanned once at `start()` (`__sygnalStatic` → `[sink, static]`, `__sygnalReplies` → reply sources). A declaring instance is recomputed in the flush's statics step (`App.afterRender`, after each render pass; cheap: state identity + shown flag) and after each of its own actions, before that action's driver values (G-158, Q21: a declaring instance's driver values are buffered until its statics went out). `objIsEqual` repeats dropped, background filter while on a hidden page, SYG216 `'declaration'` on a throw (nothing sent; the next value is sent even when equal to the one before the throw, as today's dropRepeats after `undefined`). No state yet: nothing declared |
| Replies | `core/statics.ts` `attach` / `detach` | `replies(id)` of each reply-capable source the definition sends to (`def.sinks`) or declares a static to, subscribed at creation (before the intent), dispatched with cause `'reply'`. Today every instance subscribes every reply-capable source; the narrowing is invisible (a reply only reaches its sender). Completed in dispose after DISPOSE and dispose$ (G-144) |
| fetch / socket scope chains | `actions.ts` `send`, `extra/fetchDriver.ts`, `extra/socketDriver.ts` | Both sources offer `isolateValue` (the same tag as their `isolateSink`), so a Collection item's request is scoped without a stream per item (fetch rows: 2 streams per item, was 28). A source without it keeps the per-instance pipe fallback |
| `resources` (RESOURCE entry, `idle`) | `core/define.ts` `builtIns` | Definition-time built-in in the core (as today's constructor, not a driver-registered hook), before `uses` |
| Behaviors (`uses`: undo, selection, pager, defineBehavior) | `core/define.ts` `builtIns` + `rootDef` | The core loops over `uses` and runs each value's own `merge()` on the definition shim (as today, D114), once per function. The shim's `isolatedState` is the view's, so an isolated definition gets the slice in its `initialState` (today's rule); a bound sub-component gets it as `idle`; the root gets it in its `initialState` in `rootDef` (the slice wins over an `initialState` key of its name, as today's root merge) |
| persist | `core/runtime.ts` `rootShim` + `rootDef(setup)` | §4 #1 decided: **neither** `setState` nor an `onCreate` return. `start()` builds the root's Def through `rootDef`, which runs `Root.persist.setup(shim)` on a root shim before the root exists (root only, as today: a child's `persist` does nothing). The setup restores into `shim.initialState` and rewrites `shim.model` (RESTORE, PERSIST → EFFECT); both are read back into the root's Def, so the restored state is the root's first state (no extra action). `sources.STATE.stream`, `_dispose$` and `vdom$` are forwarded from the root once it exists; `action$.shamefullySendNext` dispatches RESTORE (cause `'built-in'`). A definition hook was rejected: it would apply persist's model rewrite to every use of the function, children included (a behaviour change) |
| G-172 (a root without a model renders from `initialState \|\| true`) | `core/define.ts` `pipeline` | Decided on the source before the built-ins add a model, as today (component.ts:356) |
| View Transitions | `core/actions.ts` | Inline in the STATE branch (as today, component.ts:1015): the flag is set on the instance's DOM source's IsolateModule. New: only when the calculated state changed structurally (or the item removed itself): an equal state re-renders the same view on the next core (today it renders nothing and the request expires after 100 ms) |
| ELEMENT | `core/actions.ts` | `runElementCommands` (unchanged: runs once the next patch is on the page). `onElementCommand` may return `false`: recorded, not run (renderComponent's mock DOM); `compose()` keeps a `false` from any layer |
| commands$ | `core/instance.ts` `commands()` | Unchanged from R2 (the first Command among the props, read at the first `commands$` access); `parity/commands` covers it on both cores |
| testing (R3 part only) | `extra/testing.ts` next branch | `t.commands` and its checks (SYG641 when sent; mock DOM SYG640/641) through `onElementCommand`; the root's `connections` / `resources` fakes. The rest (child fakes, `t.actions`, `onModel`-based checks) is R4's port |
| `sygnal/element` PARENT driver | `core/runtime.ts` | A `PARENT` driver gets the root's PARENT values (as Cycle's run fed `sinks.PARENT` to it); run()'s `sinks` list PARENT once |
