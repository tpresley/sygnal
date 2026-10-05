# Core rewrite 6: tests coupled to what the rewrite deletes (PLAN-4.6 R0)

This lists every existing test that pokes a core internal the rewrite deletes, or uses a form that D162–D164 remove. The source is a grep sweep of `test/**`, `browser-tests/**`, `type-tests/**` and `examples/*/src/*.test.*` at `666a3c5`; line numbers come from that sweep.

**Dispositions** (PLAN-4.6 §4: a test may be current-core-only only when it tests an internal R5 deletes, never to skip a behaviour):
- **PORT:** the behaviour stays. Rewrite the test against the public API (or the parity harness) before or during the phase that implements it. The current-core version can stay until then.
- **DELETE-R5:** the test is about a removed form or a deleted internal. It is marked current-core-only during R1–R4 and deleted with the feature in R5. Where the form gets a migration check, the test becomes a check test.
- **CURRENT-ONLY:** the test pins the old core's mechanism (scheduler, `withState`, pickCombine). Its behaviour is covered by a parity test, named here. It runs only on the current core until R5 deletes it.

**Unaffected:**
- **Examples:** none of the 10 example test files hits anything; they use only `renderComponent`, `xs`, `ABORT` and `renderToString` from `'sygnal'`.
- **sygnal-check:** its tests don't import the runtime.
- **Import paths:** every `test/` file imports from `../src/...`. Files that import a public export through an internal path (`Collection` from `src/collection.js` in about 32 files, `Switchable` from `src/switchable.js` in about 12, `ABORT` from `src/component.js` in about 15) only need the path changed if those modules move in R5. They aren't counted below.

## 1. Totals

| Disposition | Files (by majority disposition) |
|---|---|
| PORT | 41 (11 in §2, 6 in §3, 24 in §4) |
| DELETE-R5 | 17 (3 in §2, 9 in §4, 5 type-test files) + 1 fixture |
| CURRENT-ONLY | 9 (all in §2) |
| **Total** | **67** files (62 runtime test files + 5 type-test files) + 1 fixture; **≈ 230** test cases affected |

- Whole-file rewrites or deletions: 24 files. The rest have a few affected cases each.
- Biggest single items:
  - `component.test.js` (34 cases)
  - `effect-and-shorthand.test.js` (15)
  - `suspense.test.js` (12)
  - `devtools-timetravel.test.js` (11)
  - `slot.test.js` (10)
- Each of those five is built on a `component()` + `setup` + `withState` harness.

## 2. Scheduler, state-stream and Collection internals

| File (cases) | What it touches | Affected | Disposition | Parity coverage / note |
|---|---|---|---|---|
| `test/p45-r3-scheduler.test.js` (6) | `makeScheduler`, `B` from `cycle/run/scheduler.ts`; fake-timer flush counts | whole | CURRENT-ONLY | `parity/reentrancy` G-283 / G-284 |
| `test/p45-r2-scheduler.test.js` (5) | `makeScheduler`; lost gate / counter timers (G-273/274) | whole | CURRENT-ONLY | `parity/reentrancy` G-273, G-284 |
| `test/p45-r-start-order.test.js` (5) | `makeScheduler`; start timers; `advanceTimersByTimeAsync(10)` | whole | CURRENT-ONLY (G-266 cases already ported) | `parity/reentrancy` G-266 ×3 |
| `test/p45-r-g267.test.js` (1) | `tearDown` from the scheduler | whole | CURRENT-ONLY | `parity/reentrancy` teardown |
| `test/p45-c-scheduler.test.js` (8) | public API, but pins microtask-per-reducer and parents-before-children ordering | whole | PORT (the one-patch and order cases), rest CURRENT-ONLY | `parity/timing` one patch per batch |
| `test/p45-r-g260.test.js` (2) | scheduler yield semantics | whole | CURRENT-ONLY | `parity/reentrancy` G-260/G-283 |
| `browser-tests/src/tests/scheduler-p45c.jsx` (4) | scheduler semantics in Chromium | whole | PORT to the browser suite's public form; the microtask counts are CURRENT-ONLY | |
| `test/p4-3r-pickcombine.test.js` (5) | `pickCombine`, `sinks._key`, `inst$.shamefullySendNext` | whole | CURRENT-ONLY | `parity/collection` (G-257, PF-1) |
| `test/bugfixes-1g.test.js` (17) | `pickCombine`, `_key` (B-010 block, L41–66) | 3 | CURRENT-ONLY | B-010 behaviour → PORT one Collection case |
| `test/p4-pf1-collection-lookups.test.js` (17) | `makeCollection`, `StateSource`, `inst.pickMerge`, `idfield` | 2 | `idfield` case DELETE-R5; lookup case CURRENT-ONLY | `parity/collection` PF-1 |
| `test/plan2-3f-switchable.test.js` (16) | `StateSource`, `__switchPage`, `switchable()` factory, `stateSourceName` | 4 | PORT (hidden-page behaviour via JSX) | `parity/switchable` |
| `test/p3-5-4a-switchable.test.js` (12) | `StateSource`, `switchable()` stream form | 1 | PORT | |
| `test/p4-2b-gs6-watch.test.js` (7) | `new StateSource(state$)` + `shamefullySendNext` | 3 | PORT (`STATE.watch` via a component) | `parity/timing` stream vs watch (D170) |
| `test/p4-2r-fixes.test.js` (17) | `StateSource`, `collection()`/`switchable()` factories, `shared.ts`, `sinks.STATE.shamefullySendNext`, `STATE.stream._v`, `__SYGNAL_HMR_*`, `hmrActions` | ≈ 5 | `hmrActions` and `__SYGNAL_HMR_*` cases DELETE-R5; the rest PORT | |
| `test/p4-p2b-element.test.js` (17) | "core internals sygnal/element relies on (pinned)": `sinks.STATE.shamefullySendNext`, `STATE.stream._v`, `__SYGNAL_HMR_UPDATING` | 3 | CURRENT-ONLY; R4 replaces them with `RuntimeAPI.setState`/`getState` and ports the pins to those | 04 §3.9 |
| `test/p4-p2b-run-instances.test.js` (8) | `sinks.STATE.shamefullySendNext`, `__SYGNAL_DEVTOOLS_APP__.sinks.STATE…`, `_v`, `__SYGNAL_HMR_*` | 4 | PORT (to `setState` / devtools API) | 04 §3.5 |
| `browser-tests/src/tests/element-p2b.jsx` (11) | `app.sinks.STATE.shamefullySendNext` | 1 | PORT | |
| `test/devtools-timetravel.test.js` (12) | `withState` / initSinks merge internals, `stateSourceName`, `app.sinks.STATE`, `reducerMimic$._n` | 11 | CURRENT-ONLY; R4 writes time-travel tests on `RuntimeAPI.setState` | 04 §3.5 |
| `test/p3-5-3-cache.test.js` (43) | `app.sources.STATE.stream._v` in a helper | ≈ 4 | PORT (a listener, as `parity/harness` `state()`) | |
| `test/devtools-copy-as-test.test.js` (3) | `STATE.stream._v` in a helper | 3 | PORT (same) | |
| `test/inspect.test.js` (9) | hand-built instance objects (`_componentNumber`, `stateSourceName`, `__parentComponentNumber`) | 1 | PORT (an `InstanceView`-shaped fake) | |
| `test/p45-r2-g281.test.js` (2) | `sources.__k`, `setup`/`withState`, `component({ DOMSourceName: 'DOM2' })` | whole | DELETE-R5 (root detection by peers/sources goes with D164 `.peers`; DOMSourceName D162) | |
| `test/p45-r-g262.test.js` (2) | depth `__d`, `.peers`, `component({`, factories | whole | DELETE-R5 | |

## 3. Harnesses built on `component()` + `setup` + `withState` + `mockDOMSource`

| File (cases) | Affected | Disposition | Note |
|---|---|---|---|
| `test/component.test.js` (34) | whole (`createTestComponent`; `storeCalculatedInState`; `STATE.stream.shamefullySendNext`; 3× `component({`) | PORT ≈ 28 cases to `renderComponent` / `run`; DELETE-R5 the `storeCalculatedInState` and factory cases (≈ 6) | the largest port |
| `test/slot.test.js` (10) | whole (harness; `Slot.label`) | PORT | Slot behaviour stays |
| `test/suspense.test.js` (12) | whole (harness; `Suspense.label`) | PORT | `parity/suspense-lazy` covers 3 |
| `test/effect-and-shorthand.test.js` (15) | whole (harness; ≈ 10 pipe keys) | PORT the EFFECT/shorthand cases to object-form models; DELETE-R5 the pipe-key parsing cases | D164 |
| `test/reducers.test.js` (24) | 2 (harness at L174–200) | PORT | |
| `test/diagnostics/wiring.test.js` (7) | 2–3 (internal imports, `hmrActions`, single-stream intent, pipe keys) | DELETE-R5 the `hmrActions`/single-stream cases; PORT the rest | |

## 4. Removed public forms (D162–D164)

| File (cases) | Form | Affected | Disposition |
|---|---|---|---|
| `test/p45-r-g264.test.js` (1) | `component`, `.components`, string tag | whole | DELETE-R5 |
| `test/p45-r-g269.test.js` (1) | `component({`, `.peers` | whole | DELETE-R5 |
| `test/p45-r2-statics.test.js` (5) | `component({ view, model, initialState })` (G-280) | 1 | PORT to `defineComponent` (D162) |
| `test/p45-s-trim.test.js` (7) | `component({ sources, calculated })` helper | 1–2 | PORT (SYG209 message via `run`, as `parity/calculated`) |
| `test/p45-d-lazy-wiring.test.js` (11) | `component({`, `.peers`, `hmrActions` | 3 | DELETE-R5 |
| `test/p45-b2-fused-walk.test.js` (8) | `.components` + `h('Badge')`; `sygnalFactory` prop | 2 | DELETE-R5 |
| `test/bugfixes-1f.test.js` (28) | `.components` + `h('Badge')`; `hmrActions` | 3 | DELETE-R5 |
| `test/p3-1a-replies.test.js` (25) | `component({ ...make(), sources })`, `isolateOpts` | 1 | PORT (the reply-isolation behaviour via JSX; `parity/fetch` covers replies per item) |
| `test/vike-client-names.test.js` (3) | fake app with `sinks.STATE.shamefullySendNext`; asserts `sygnalOptions.name/view` | whole | PORT in R4 (Vike wrapper via `data.c` + `setState`) |
| `test/inputValidation.test.js` (18) | `collection()` factory | 5 | PORT (validation via `<Collection>`), if the factory goes in R5 |
| `test/diagnostics-legacy.test.js` (14) | `collection`/`switchable` factories | 1 | PORT |
| `test/p45-b1-pragma-characterization.test.js` (4) + `test/fixtures/p45-b1-pragma-corpus.json` | pins old pragma output (`sygnalOptions` ×10, `sygnal-factory`) | whole | DELETE-R5; R1 writes a new characterization for `data.c` |
| `test/p45-b1-pragma-by-reference.test.js` (7) | `data.props.sygnalOptions.initialState/model` | 1–2 | PORT to `data.c` in R1 |
| `test/ssr.test.js` (33) | hand-built vnodes with `props.sygnalOptions` | 3 | PORT to `data.c` in R4 |
| `test/p4-ct1-controls.test.js` (19) | asserts `sygnalOptions`/`sygnalFactory` undefined; `__SYGNAL_HMR_UPDATING` | 1–2 | PORT (assert `data.c`) |
| `test/p45-b3-initialize-per-instance.test.js` (3) | `storeCalculatedInState = true` | 1–3 | PORT (drop the option; the behaviour is the default) |
| `test/testing-simulate.test.js` (31) | pipe keys ×4, single-stream intent | 5 | PORT 4 (object-form keys); DELETE-R5 the single-stream case |
| `test/b029-abort-non-state-sinks.test.js` (6) | pipe keys | 2 | PORT (object form) |
| `test/diagnostics-core.test.js` (40) | pipe key | 1 | PORT |
| `test/p3-1d-reply-checks.test.js` (12) | pipe key | 1 | PORT |
| `test/testing-utility.test.js` (18) | pipe keys | 2 | PORT |
| `test/p3-1b-effect.test.js` (13) | pipe key | 1 | PORT |
| `test/p4-3d-behaviors.test.js` (28) | `undoable({ 'LOAD \| STATE': … })` | 1 | PORT |
| `test/p4-3b-persist.test.js` (31) | `'WIPE \| PERSIST'` | 1 | PORT |
| `test/review-2e2/g043-syg213-message.test.js` (1) | pipe key | whole | PORT (object form; same message) |
| `test/diagnostics/strict.test.js` (10) | pipe keys; positional views | ≈ 5 | KEEP as checks of the static/strict rules (they don't need the runtime to accept the form); runtime halves DELETE-R5 |
| `test/diagnostics/strict-entry.test.js` (2) | positional view + pipe key | 1 | same as above |
| `test/plan2-1b.test.js` (25) | positional view | 1 | DELETE-R5 |
| `test/clientonly.test.js` (5) | `ClientOnly.label` | 1 | PORT (name via `componentName`) |
| `browser-tests/src/tests/commands.jsx` (4) | pipe keys (incidental) | whole | PORT (object form) |
| `browser-tests/src/tests/disposal.jsx` (7) | pipe key | 1 | PORT |
| `browser-tests/src/tests/effect-shorthand.jsx` (5) | pipe key | 1 | PORT |
| `test/review-2e2/g049-timing.test.js` (11) | relies on BOOTSTRAP's 10 ms delaying an item's intent (L121) | 1 | PORT to D165 timing (rewrite the expectation) |

**Type tests** (tsc, no cases):

| File | Form | Disposition |
|---|---|---|
| `type-tests/render-component-infer.tsx` | `component({ view })` | DELETE-R5 the factory part; add `defineComponent` inference |
| `type-tests/lazy.tsx` | `Page.components = { Settings }` | DELETE-R5 that line |
| `type-tests/typed-links.tsx` | `CHILD.select('TaskCard')`, `'FLIP \| PARENT'` key | DELETE-R5 those cases |
| `type-tests/api-fixes-3d.tsx` | `idfield` section | DELETE-R5 |
| `type-tests/public-api.ts` | positional view call (L383) | DELETE-R5 that case |

## 5. Counts by disposition

| | PORT | DELETE-R5 | CURRENT-ONLY |
|---|---|---|---|
| §2 internals (23 files) | 11 | 3 | 9 |
| §3 harnesses (6 files) | 6 (≈ 10 of their cases DELETE-R5) | — | — |
| §4 forms, runtime (33 files) | 24 | 9 (+ the fixture) | — |
| §4 type tests (5 files) | — | 5 | — |

Mixed files (p45-c-scheduler, scheduler-p45c.jsx, p4-pf1, p4-2r-fixes, component.test, effect-and-shorthand, diagnostics/wiring, testing-simulate, diagnostics/strict) are counted once, under their majority disposition; their rows say how the cases split.

**R1–R4 bookkeeping:** the CURRENT-ONLY and DELETE-R5 files are the "current-core-only" list PLAN-4.6 §4 asks the tracker to keep. When `SYGNAL_CORE=next` runs the root vitest suite (R1), they are excluded by path, through a list the test matrix reads, not by `it.skip` in each file. Every PORT item must be green on both cores before its phase exits.
