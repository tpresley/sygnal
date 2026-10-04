# Core rewrite study 2: what the core supports vs. the documented 6.0 API

Each row lists a feature the component core implements, with:
- its documentation status, with sources: llms.txt (normative), the skill, `docs/`, `CHANGELOG.md`, the PLAN-1/4/4.5/5 trackers;
- where it is actually used: `src/`, `test/`, `browser-tests/`, `examples/`, `docs/`;
- the recommendation for a 6.0 rewrite.

Status: **C** = canonical, **A** = documented only as an alternative or advanced form, **U** = undocumented.

**Policy note.** PLAN-1 says "non-canonical forms keep working; nothing is removed" (`PLAN-1-canonical-forms.md:12`, `alternative-forms.md:7`). D157 (PLAN-4.5) already lists several removals for PLAN-5 to weigh. The recommendations below assume the user decision this study asks for: a 6.0 major can drop forms that cost core complexity, with a migration note and the strict codes (SYG50x) that already flag them.

## Drop: undocumented, or internal plumbing exposed by accident

| Feature | Status | Real usage | Core cost today |
|---|---|---|---|
| `component({ sources })`: instantiate immediately | U | 2 tests (`p3-1a-replies:303`, `p45-s-trim:17`) | branch in `component()` |
| `component({ isolateOpts })` | U | 1 test | `isolate()` wrapper, scope normalization |
| Intent returning one stream of `{type, data}` | U | 2 tests (`testing-simulate:323`, `diagnostics/wiring:120`) | two branches; the action-name checks (SYG605, inspect) are skipped for it |
| `sygnalFactory` / `sygnalOptions` / `<sygnal-factory>` vnode props | U (SYG413 text only) | internal: pragma, vike, ssr, astro | per-vnode options object built **every render**; name-based instantiation; `component()` per instance |
| `.label` as a component name | U (still in `index.d.ts:1022`) | Collection/Switchable markers only | `nameOf` fallbacks everywhere |
| Collection `idfield` | U | none | `fieldLense` parameter |
| `.context` entry as a state-key string or `true` | Only in SYG403 fix text | **zero** (tests, examples, docs) | 2 branches per context computation |
| `CHILD.select()` with no argument | prose only | none | filter branch |
| `__SYGNAL_HMR_STATE` / `__SYGNAL_HMR_UPDATING` | dead (replaced by the `__hmr` source) | type declarations + tests asserting they are gone | none in the core; delete the declarations |
| `sinks.__index` | dead (written, never read) | none | 1 line |

## Drop, or move to a compat helper: documented as alternative or advanced, little real use

| Feature | Status | Real usage | Core cost today | Proposal |
|---|---|---|---|---|
| `component({...})` options factory as public API | A ("lower-level… most users won't need this", `reference/api.md:109`) | 35 test lines; no examples | the whole options plumbing; `optionsOf`/`OPTION_KEYS` copied in pragma, vike, astro, lazy, testing | Keep only as `defineComponent(opts)`, which returns a normal function component (statics assigned). It never needs a separate instantiation path |
| `DOMSourceName` / `stateSourceName` | A (`guide/components.md:53`) | one test (`'DOM2'`); `run()` hard-codes STATE/DOM at the root, so a non-default name can't work under `run()` anyway | string-threaded through every function and ~20 consumer files (`|| 'DOM'` fallbacks) | Drop: fixed `DOM` and `STATE` |
| `.components` registry + string tags + `of="Item"` | A (one table row; SYG414 fix text) | 3 tests; **disables the pragma's `$p` fast path for the whole subtree** (`walkView` `byName`) | name set per component, name lookup | Drop: components are referenced by function (JSX already does this) |
| `CHILD.select('Name')` | A, SYG506 | **no runtime test**; type test + docs only | name filter, `componentName` escape hatch | Drop: `CHILD.select(Fn)` only |
| `.peers` | A (own guide page; never in llms.txt or the skill) | tests only (4 files); zero examples | `initPeers$`; peers in render params, sinks and view args; G-281 root detection depends on peers getting the parent's sources | Drop. A peer is a sibling component rendered by the parent; migration note |
| `hmrActions` | A/near-U (API option table + SYG604 only; not on the HMR page) | 4 tests | `initHmrActions`, the startup `go()` branch | Drop, or fold into the `sygnal/vite` HMR dev entry (D157 already suggests moving HMR swap code out of `run()`) |
| `'ACTION \| SINK'` model keys | A, SYG504 | tests + 8 incidental uses in `browser-tests/commands.jsx` | parsed in **12 places** (core, testing, undo, behaviors, devtools, actionLog, strict, viewTransitions check) | Drop (already a D157 candidate). Normalizing once at definition time would make even keeping it nearly free |
| Positional view args `view(props, state, context, peers)` | A, SYG501 | tests only; SSR already calls views with one argument | 3 extra arguments per render | Drop (SSR already disagrees with the client) |
| `storeCalculatedInState: false` | A (one mention) | **no test sets `false`**; docs only | `cleanupCalculated` branch | Drop the option; calculated fields are always stored (current default) |
| `isolatedState` (child-local state) | Contradictory: guide pages present it as normal; llms.txt and the skill say a child's `initialState` is an error | tests | `local$` side fold, the `__localState` source, the B-016 empty-model hack | **Keep, but make it explicit and simple.** In a cell-based core it is just "this instance owns a root cell". Resolve the doc contradiction |
| Calculated boolean entries | Types allow `boolean` (`index.d.ts:975`), runtime throws SYG206 | none | none | Fix the types |

## Keep: canonical or documented, with real use (the rewrite must preserve these)

- **View:** destructured `{state, context, children, slots, uid, ...props}`.
- **Intent and sources:** object-of-streams intent; sources DOM (with the shorthand Proxy), STATE (`.stream`, `.watch`), CHILD, `props$`, `children$`, `commands$`, `dispose$`.
- **Model:**
  - function = STATE; object of sinks STATE/EVENTS/PARENT/EFFECT/ELEMENT/LOG/driver;
  - `<SINK>: true` and constant sink values;
  - `ABORT`, and returning the same state = no change (GS-4);
  - `next(type, data, ms)`;
  - the 4th `props` argument (incl. `signal` for EFFECT);
  - **"every sink sees the state from before this action"** (llms.txt);
  - built-ins BOOTSTRAP ("once, just after mount"; no 10 ms promise), INITIALIZE, DISPOSE, RESTORE, RESOURCE.
- **Component data:**
  - `initialState`;
  - `.calculated` (fn and `[deps, fn]`);
  - `.context` (function entries);
  - `.onError` (+ app `onError` phases, `'widget'` reserved for PLAN-5).
- **Statics:**
  - `connections`, `resources`, `route`, `head`, `timers`, `uses`, `persist`, `viewTransitions`, through the generic `__sygnalStatic` path, which PLAN-5 B-3 reuses for browser sources;
  - hidden-Switchable `background` filtering.
- **Children and markers:**
  - sub-components with a `state` prop (string or lens);
  - Collection (`of` fn, `from` string or lens, `filter`, `sort` forms, `className`);
  - Switchable (`of`, `current`, `state`, `instance`, hidden pages kept alive);
  - Suspense/READY, Lazy, Portal, Transition, ClientOnly, Slot.
- **Other:**
  - commands, element commands, controls (alternative form, but in the pragma, not the core);
  - reply actions (`__sygnalReplies`, `__emitterId` stamping);
  - fetch/socket isolation (scope tags on values);
  - `uid()`.
- **PLAN-4.5 behaviour:** one patch per flush, synchronous teardown, DOM source emits after patches, statics frozen in dev, count gate.

## Internal contracts the core exposes today (they are not public API, but other modules depend on them)

The rewrite should **replace** these with an explicit hooks API rather than reproduce them:
- **behaviors / undo / selection / persist** mutate `inst.model`, `intent` and `initialState` from inside the constructor (`uses[k].merge(this, k)`, `persist.setup(this)`).
- **the dev action log** replaces `makeOnAction`/`makeEffectHandler` on the instance and patches `action$._n`, `action$.shamefullySendNext` and `_replies[i]._n`.
- **testing** replaces `collectRenderParameters` and `log`, and **parses the debug log text of `next()`** (`NEXT_LOG` regex, `testing.ts:1031`). It also mutates `sources` and `sourceNames` from inside `diag.onIntent`.
- **devtools** keeps the raw instance and reads about 15 fields. It time-travels by pushing into `instance.sinks.STATE.shamefullySendNext`.
- **diagnostics checks** replace `instantiateCollection` and read `currentState`, `addCalculated`, `_calculatedFieldNames`, `_disposed` and `_o`.
- **`model$`** is a mutable object that checks and fakes rewrite after `onModel` (ELEMENT, replies, EVENTS).
- **Collection** writes `_key` onto sinks objects; `pickCombine` reads it.
