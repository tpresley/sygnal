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
| `test/bugfixes-1h.test.js` (1 of its cases) | 1H-1 / B-003 "a sink is deferred behind a same-tick STATE reducer and then sees its result" (L80): pins the microtask reducer | 1 | CURRENT-ONLY (R2, D165: reducers are synchronous; every sink sees the pre-action state) | `parity/timing` synchronous reducers |
| `test/p45-r3-scheduler.test.js` (G-284 case) | "more than 100 renders wait for the clock; advancing it now and then keeps them going" (L69): pins the timer-based loop guard | 1 | CURRENT-ONLY (R2, D165: the loop guard hops a MessageChannel / setImmediate, no timer) | `parity/reentrancy` G-283 / G-284 |
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

## 6. R3 status (statics, replies, behaviors, persist, commands, ELEMENT, controls, View Transitions)

**Added to `test:next`** (green on the next core): `p46-r3-review`, `p46-r3-g315-strip`, `command`, `copied/signup-form.copied`, `driverFactories`, `head`, `p3-2a-socket`, `p3-5-1-fake`, `p3-5-4a-switchable`, `p3-5-4c-router-fake`, `p3-6b-test-traps`, `p3-g160-connections-fake`, `p3-g167-statics-no-model`, `p3-g189-reply-after-delayed-send`, `p3-head-pause`, `p3-resource-empty-string`, `p4-2a2-ssr-behaviors`, `p4-3a-element-commands`, `p4-3a-recipes`, `p4-3b-doc-samples`, `p4-3b2-persist-astro`, `p4-3b2-persist-hydrate`, `p4-3c-timers`, `p4-3d-recipes`, `p4-3r-persist`, `p4-4g1-doc-samples`, `p4-4g1-undo-coalesce`, `p4-4p-controls-doc-samples`, `p4-p1b-doc-samples`, `p45-r-g257`, `plan2-4r-fetch`, `plan2-e2-fetch-driver`, `router`, `router-docs`, `router-ssr`. Parity: the statics, fetch, behaviors and reentrancy-with-statics areas run on next (`NEXT_DONE` has R3), plus `parity/commands` (both cores).

**R3-area suites with cases still failing on next**, by blocker (each case's R3 behaviour passes; what fails is another phase's):

| File (failing / total on next) | Blocker |
|---|---|
| `p3-1a-replies` (1/25) | R5: `component({ ...isolateOpts })` (§4, already PORT) |
| `p3-1c-fakes` (3/25), `p3-2c-socket-fakes` (2/24), `p3-3a-resources` (1/18), `plan2-4r-isolation` (2/6), `p3-5-4c-router-fake-docs` (1/8) | R4: renderComponent's child fakes (`inject` → `wrapSources`): a child-only HTTP / socket / router sink has no fake on next. The root's fakes (model sinks, `connections`, `resources`) work |
| `p4-3b-persist` (3/31), `p4-4g1-persist-plain` (1/9), `p4-3d-behaviors` (1/28), `p4-3c-recipe` (2/3), `p4-4a1/4b1/4b2-doc-samples` (behaviors, STATE.watch samples) | R4: `t.actions` (the action log via hooks); state and DOM assertions before it pass |
| `p4-3b-persist` SYG223/SYG224, `p4-3b2-persist-vike` (2/3), `p4-2b-gs1-behaviors` SYG127 (3/16), `p4-3c-timers-run` SYG643 (2/6), `p4-3r-view-transitions` / `p4-p1b-view-transitions` SYG645 (3/8, 1/12), `p3-1d-reply-checks` (7/12), `p3-2b-connections` SYG112 (1/23), `p3-5-3-cache` SYG630–633 + inspect (5/46), `p3-5-5-cache-ssr` / `p3-6a-cache-path` SYG635 (1/16, 1/18), `router-features` SYG132/133/112 (3/28), `plan2-e2-run` SYG609 (2/4), `diagnostics/controls` (11/19) | R4: the `sygnal/diagnostics` checks run through the current core's instance hooks (`onModel`, `model$` taps) |
| `p3-5-5-vike-seed` (2/3) | R4: Vike integration |
| `p4-ct1-controls` HMR (1/25), `p4-2r-fixes` (6/19), `p45-d-lazy-wiring` (19/35) | R4 (HMR, devtools) and R5 (`.peers`, `hmrActions`, internal sinks shape) |
| `bugfixes-1h` B-003 case | CURRENT-ONLY (D165, §2) |
| `bugfixes-1f` (5/29) | R4 (SYG104) and R5 (`.components`, `hmrActions`) |
| `devtools-actions`, `devtools-copy-as-test`, `p4-2c-actions` | R4 (devtools, action log) |

**Browser suite on next** (`npm --prefix browser-tests run test:next`): 175/186. Green in R3's areas: Socket driver, Router, Fetch driver, Timers frame, Persist, Element commands, Controls, View Transitions except SYG645 (R4). Commands ported to object-form models (was 0/4 on next; §4 PORT done). Failing, not R3: Effect & Shorthand 2 and Disposal 1 (they test the `'A | EFFECT'` syntax itself, D164: R5), Diagnostics 3 (R4), Custom elements 4 (R4: `sinks.STATE.shamefullySendNext`, `hmr`).

## 7. R4 status (diagnostics, devtools, testing, integrations)

`npm run test:next` (scripts/test-next.mjs) runs **every** root vitest file on the next core, minus the list in the script (`node scripts/test-next.mjs --list`): 3 whole files and 38 tests, each with its disposition (DELETE-R5: removed forms; CURRENT-ONLY: the scheduler, render-lag stamps, sinks objects, the diagnostics core's instance hooks without the dev entry; DECIDED: G-306/G-307/D177, D165 FIFO ordering in b023), then the 9 examples, the browser suite (3 'A | SINK' tests excluded, R5) and the count gate (`perf-gate --core=next`).

Ported in R4 (both cores): `p4-p2b-run-instances`, `p4-2r-fixes` (G-216), `p4-p2b-element` pins and `browser-tests element-p2b` → `runtime.setState` / `getState` when `app.__runtime` exists. New: `p46-r4-review` (G-318…G-323), `p46-r4-devtools` (time travel, debug toggle: replaces the CURRENT-ONLY time-travel internals), `p46-r4-diagnostics` (SYG423/425/612), `p46-r4-integrations` (SSR `data.c`, HMR), `p46-r4-testing-docs` (D176). Parity: the action-log and D169 areas run on next (NEXT_DONE has R4).

## 8. R5 status (cut-over)

One core: `scripts/test-next.mjs`, `test/setup-core.js` and the `SYGNAL_CORE` switch are gone; every file runs in `npm test`.
- **Deleted, whole files (10, 31 tests):** `p45-r-g262`, `p45-r-g264`, `p45-r-g269`, `p45-r2-g281` (DELETE-R5), `p45-r3-scheduler`, `p45-r2-scheduler`, `p45-r-start-order`, `p45-r-g267`, `p4-3r-pickcombine` (CURRENT-ONLY; parity/reentrancy and parity/collection cover G-257/260/266/273/274/283/284, PF-1, teardown), `p45-b1-pragma-characterization` + its fixture; also `p46-r3-g315-strip` (D175) and `review-2e2/g043-syg213-message` (SYG213 retired).
- **Deleted cases:** the `test-next.mjs --list` entries whose behaviour is removed or decided (pipe-key parsing, `.components`, `hmrActions`, `.peers`, single-stream intent, SYG605, positional-view and pipe-key runtime strict halves, render-lag stamps, the old diagnostics-core instance hooks, G-306/G-307/D177 old keying, `idfield`, `collection()`/`switchable()` factory internals); `effect-and-shorthand`'s pipe-key block (10).
- **Ported:** the `component()` + `setup` + `withState` harnesses (`component`, `slot`, `suspense`, `effect-and-shorthand`, `reducers`) to `run()`; B-010 to a Collection test; `p3-1a` isolateOpts → sibling tag children; `p4-2r` G-214 (5) to JSX markers; `p45-r2-statics` G-280 and `p46-r4-diagnostics` to `defineComponent`; `inputValidation` to `<Collection of>` (SYG411); `p45-s-trim` SYG209 via `run()`; `b023` to the D165 FIFO order; ssr / pragma / vike-client-names to `data.c`; G-334: the kept-behaviour tests with `'A | SINK'` fixtures (testing-simulate ×2, b029 ×2, testing-utility DISPOSE) to the object form.
- **Parity suite:** plain tests (no `itNext` / `needs` / expected-fail); decisions named in the titles.
- **Browser:** `'ACTION | DRIVER'` → object-form EFFECT; the whitespace-pipe and `'DISPOSE | EFFECT'` tests removed (covered by the object-form DISPOSE test).
- **New:** `p46-r5-review` and `p46-r5-review-diagnostics` (G-324…G-333, G-335), `sygnal-check/test/removed-forms.vtest.js` (static SYG612).
