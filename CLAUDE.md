# Sygnal

Reactive component framework built on Cycle.js patterns. All source is TypeScript.

## Build & Test

```bash
npm run build          # Rollup → dist/ (16 inputs: core UMD/CJS/ESM, JSX runtimes, sygnal/diagnostics,
                       #   sygnal/devtools, sygnal/element, sygnal/vite, Astro, Vike) + bundled .d.ts
npm run build:all      # same as build (kept for prepublishOnly)
npm test               # the full gate, in order:
                       #   vitest run          library tests in test/ (2,583; test/parity/: the core's behaviour contract)
                       #   test:examples       each example's own suite (9 examples, 105 tests)
                       #   test:types          tsc on type-tests/
                       #   test:browser        browser-tests/ (184)
                       #   test:perf-gate      count gate (PLAN-4.5/4.6): DOM patches, streams, timers, retained
                       #                       objects and heap vs benchmarks/audit/gate.json (~10 s; needs
                       #                       benchmarks/ installed; limits only go down)
npm run test:examples  # only the example suites (TEST_EXAMPLES_INSTALL=1 or --install runs npm install first)
node scripts/perf-gate.mjs --runs=3  # the count gate alone, 3 runs with min … max per metric
node scripts/perf-report.mjs         # timing ratios to React vs the timing targets (warn-only, ~1.5 min, not in npm test);
                                     #   harness: benchmarks/audit (see benchmarks/README.md)
npm --prefix sygnal-check test       # static checker package (492 tests, *.vtest.js)
npm --prefix docs run build          # docs site + internal link check
node scripts/gen-error-docs.mjs      # regenerate docs reference/errors.md from sygnal-check/explanations.json
node scripts/check-doc-samples.mjs   # sygnal-check --strict on every docs code sample (552 checked, 13 skipped by marker)
node scripts/size-gate.mjs           # size gate: kanban gzip with nativeGlobalThis: false <= 42,300 B gated (D48, D185;
                                     #   needs build + examples/kanban install); also prints the default (globalthis-aliased)
                                     #   size and src/core/** alone. `--budget <bytes>` overrides
```

This is a **library package** — no dev server. Verify changes via `npm run build` + `npm test`. Build before testing: tests and examples import `dist/`.

**Fresh checkout / worktree setup** (G-002): the gate needs more than the root install, or the kanban-based library tests fail with "Cannot find package 'sygnal'":

```bash
npm ci
npm ci --prefix browser-tests
npm ci --prefix sygnal-check             # @babel/parser for vite-plugin-dev and inspect-kanban tests
npm install --prefix examples/kanban     # its file:../.. link; other examples: TEST_EXAMPLES_INSTALL=1 npm test
npm install --prefix examples/todomvc    # test/copied and the devtools Copy-as-test tests import it
npm ci --prefix benchmarks               # Vite + sygnal/vite for test:perf-gate (also: TEST_EXAMPLES_INSTALL=1 npm test)
npm ci --prefix docs                     # Astro/Starlight, for npm --prefix docs run build
npm run build
```

Use `npm --prefix <dir>` / `git -C <dir>` rather than `cd` in scripts; the shell can stay in a previous directory.

## Architecture

**Component pattern (MVI):**
```ts
function MyComponent({ state, context }) { return <div>...</div> }
MyComponent.intent = ({ DOM, EVENTS, CHILD, dispose$ }) => ({ ACTION: stream$ })
MyComponent.model = { ACTION: (state, data) => newState }
MyComponent.initialState = { ... }
MyComponent.context = { field: state => computed }
MyComponent.onError = (error, { componentName }) => fallbackVNode  // Error boundary
```

**The core (`src/core/`, PLAN-4.6; design: `dev-plans/research/core-rewrite/03-proposal.md`, hooks: `04-hooks-contract.md`):** one runtime per `run()` with a FIFO run-to-completion action queue; a STATE write is applied synchronously and schedules one flush (a microtask) that renders top-down (dirty-checked), recomputes statics, drains what was queued, repeats until stable, then emits **one vnode** (one DOM patch). No startup timers: `INITIALIZE` at construction, intent subscribed at creation, `BOOTSTRAP` a microtask after the first render. Teardown swaps `Stream.prototype._remove` only inside `dispose()` (0 timers).
- `runtime.ts` (App: queue, flush, loop guard via a `MessageChannel`/`setImmediate` hop, drivers, `start()`), `instance.ts` (Inst: render with cached vnode, tag children keyed in a Map, context read-tracking D168), `cell.ts` (state cells: root/key/lens/Collection item/local `isolatedState`, calculated fields), `define.ts` (`WeakMap<fn, Def>`: model table, calculated order, context entries; behaviors via a definition shim), `actions.ts` (one action: handlers get the pre-action state; sinks, PARENT, EFFECT, ELEMENT), `statics.ts` (declaration statics, replies), `teardown.ts`, `view.ts` (read-only InstanceView for hooks)
- `hooks.ts` — the extension contract (types only): registries (hosts, pre/post processors, resolvers, definition hooks) and per-app hook layers (`transformDef`, `onCreate`/`onDispose`/`onRender`, `onAction`/`wrapHandler`/`onReducer`/`onSink`, `wrapSources`, ...) used by `renderComponent`, `sygnal/diagnostics` (`checks/next.ts`), `sygnal/devtools` (`extra/devtoolsNext.ts`). Dev entries publish layer factories on `__SYGNAL_DIAGNOSTICS__.layers`; the runtime API (`app.__runtime`: `setState`, `getState`, `dispatch`, `flushed`) serves devtools, HMR, Vike and `sygnal/element`
- `hosts/collection.ts`, `hosts/switchable.ts`, `markers/{portal,transition,suspense,lazy,clientonly}.ts` — registered on import by the public marker modules (D157: an app that never imports one pays nothing)

**Special JSX components** (Portal, Transition, Suspense, Slot, Collection, Switchable, ClientOnly) are marker functions with `preventInstantiation` and a `componentName` (`'collection'`, ...): the pragma emits a marker vnode with that `sel`, and the core's registered host / processor handles it. A component vnode carries the component function in `data.c` (no options object).

**Source layout:**
- `src/core/` — the component core (above)
- `src/collection.ts`, `src/switchable.ts`, `src/portal.ts`, `src/transition.ts`, `src/suspense.ts`, `src/slot.ts` — the public marker components (each imports its core handler)
- `src/lazy.ts` — Lazy loading wrapper with `__sygnalLazy` metadata for Suspense detection
- `src/defineComponent.ts` — `defineComponent(opts)`: an ordinary function component with the options as statics
- `src/shared.ts` — `ABORT`, `isAbort`, `uidPart`, `NOT_SINK` (no core import)
- `src/extra/ref.ts` — `createRef()` and `createRef$()` for DOM element access
- `src/extra/` — Helpers (processForm, processDrag, eventDriver, driverFactories, `fetchDriver.ts` (`makeFetchDriver`: opt-in HTTP driver, `HTTP.select(category)`/`HTTP.errors(category)`, `latest: true` aborts superseded requests), reducers `set`/`toggle`/`event`/`emit`, etc.)
- `src/extra/testing.ts` — `renderComponent()`: mock DOM by default or `dom: 'real'` (real DOM driver in `document.body`; `t.container`/`t.query`/`t.queryAll`), `simulateEvent`/`simulateAction`, `ready`/`next`/`waitForState`/`settle`, `t.state`, `html`, `sinkValues`/`emitted`, fakes for driverless sinks (`t.respond`/`t.fail`/`t.requests`, e.g. for `makeFetchDriver`), works under fake timers (`vi.useFakeTimers()`: the waits drive the clock), `expectNoDiagnostics`, `inspect`
- `src/extra/diagnostics/` — Diagnostics core: `codes.ts` (SYG code registry: severity, title; `docsUrlFor()` → `https://sygnal.js.org/reference/errors#sygnnn`), `index.ts` (modes, `report()`, hooks, `getDiagnostics`/`onDiagnostic`), `legacy.ts` (coded console messages that print even when off)
- `src/extra/diagnostics/checks/` — The `sygnal/diagnostics` dev entry (separate bundle, never in apps): wiring, dom (SYG103/104), events, props, state, collections, rxjsHints (SYG301), strict (`configureStrict`; SYG508 at run time), inspect (`inspect()` app graph), `next.ts` (the core's hook layer: a facade per instance for the checks, plus SYG423/424/425 and SYG612 for forms 6.0 removed); types in `public.d.ts`. Reaches the core through `globalThis.__SYGNAL_DIAGNOSTICS__`
- `src/vite/plugin.ts` — `sygnal/vite`: JSX (oxc + esbuild below Vite 8), HMR wiring, dev-only diagnostics injection, `sygnal-check` in dev, Vitest setupFiles, Vike/Astro dev wrappers
- `src/pragma/` — JSX createElement implementation (passes `onError` through)
- `src/vike/ClientOnly.ts` — ClientOnly component (`preventInstantiation` pattern, renders fallback during SSR)
- `src/astro/` — Astro framework integration (client hydration + SSR)
- `src/cycle/` — Absorbed Cycle.js internals: `dom/` (the DOM driver, isolation by scope), `state/StateSource.ts` (`STATE.stream`/`select`/`watch`), `run/adapt.ts`. The old `withState`/Collection/pickCombine chains, `setup()`/scheduler and `isolate()` went with the old core (R5)
- `src/cycle/dom/DocumentDOMSource.ts` — Enhanced with `.select()` chaining for CSS-filtered document events

**Outside `src/`:**
- `sygnal-check/` — Separate package: static checker (`@babel/parser`), rules in `src/rules/` (strict ones in `src/rules/strict/`), `--fix`, `--graph`, `explain` (`src/explanations.js` → `explanations.json`, the source of the docs error reference), MCP server (`src/mcp.js`). Tests are `*.vtest.js` (not collected by the root vitest)
- `test/` — Library vitest suites; `test/docs-errors.test.js` fails when `docs/.../reference/errors.md` is out of date
- `type-tests/` — `tsc`-checked type tests (`test:types`); `type-tests/registry/` compiles the SygnalEvents augmentation separately
- `browser-tests/` — Real-browser suite (`test:browser`, free port)
- `examples/` — Example apps, each with its own Vite/Vitest config and `npm test`; excluded from the root vitest
- `docs/` — Starlight docs site (sygnal.js.org); `docs/scripts/check-links.mjs` runs after `astro build`
- `scripts/` — `test-examples.mjs` (test:examples), `gen-error-docs.mjs` (`--check` for drift), `check-doc-samples.mjs`, `size-gate.mjs`
- `evals/agent-ergonomics/` — Agent eval harness (Sygnal vs React tasks, hidden tests, results)
- `skills/sygnal-dev/`, `llms.txt` — Agent context (canonical forms only)
- `dev-plans/` — Plans and status trackers (PLAN-1: agent ergonomics; PLAN-2: follow-up ergonomics; PLAN-4.6: the component core rewrite; PLAN-5: ecosystem)

**Absorbed dependencies:**
All `@cycle/*` packages have been absorbed into `src/cycle/`. The only external runtime dependencies are `snabbdom` and `xstream`.

- `src/cycle/dom/snabbdom.ts` — Local barrel that imports from snabbdom subpaths (e.g., `snabbdom/build/h`) to avoid snabbdom's broken barrel export which triggers a `styleModule` `window` ReferenceError in Node.js
- `src/cycle/dom/styleModule.ts` — Local copy of snabbdom's styleModule with a fixed `typeof window !== "undefined"` guard (snabbdom 3.6.3 regression)

**Rollup externals:** Use the `isExternal` function in `rollup.config.mjs` which matches any import starting with `snabbdom/` or `xstream/`.

## Canonical Forms and Diagnostics

Docs, examples, `llms.txt` and the skill use only the canonical forms in `dev-plans/PLAN-1-canonical-forms.md`: destructured views `function C({ state, context, ...props })`, `ABORT` for "no change", `EFFECT` for side effects, the object form for every non-STATE sink (no `'ACTION | SINK'` keys), `EVENTS: event('TYPE', fn)` (not `emit()` or raw `{ type, data }`), `CHILD.select(ChildFn)`, `.context` for deep data. Strict mode (SYG503, SYG505, SYG507, SYG508: `sygnal-check --strict`, `configureStrict`, `renderComponent({ strict })`) flags the alternatives that still work (SYG501/504/506 are removed-form errors now, SYG502 is retired); the docs list them only on `advanced/alternative-forms`. The forms 6.0 removed (D162–D164: positional views, `'A | SINK'` keys, `CHILD.select('Name')`, `.components`/string tags, `.peers`, `hmrActions`, source names, `storeCalculatedInState`, `component()`) are SYG612 (dev runtime; `sygnal-check` always, statics only on components) and SYG501/504/506 (`--strict`); a single-stream intent is SYG603 (thrown), string / `true` context entries SYG403; `guide/migrating-to-6` documents each. Retired codes keep their numbers and docs entries ("Retired in 6.0", `reportedBy: ['retired']`). All examples and templates are strict-clean.

To add a diagnostic code: add it to both tables in `src/extra/diagnostics/codes.ts` (inside the workstream range), add its explanation to `sygnal-check/src/explanations.js`, regenerate `sygnal-check/explanations.json` (`node sygnal-check/bin/sygnal-check.js explain --all --json > sygnal-check/explanations.json`), then `node scripts/gen-error-docs.mjs`. Drift tests cover each step.

## Key Conventions

- All source files are `.ts` (converted from `.js` as part of the absorption project)
- `src/index.d.ts` contains standalone type declarations for the component public API — these are separate from the `.ts` source types
- Tests are in `test/` (root vitest) and `examples/*/src/*.test.*` (run per example by `test:examples`)
- Build must produce every entry successfully before tests are meaningful
