# Sygnal

Reactive component framework built on Cycle.js patterns. All source is TypeScript.

## Build & Test

```bash
npm run build          # Rollup → dist/ (16 inputs: core UMD/CJS/ESM, JSX runtimes, sygnal/diagnostics,
                       #   sygnal/devtools, sygnal/element, sygnal/vite, Astro, Vike) + bundled .d.ts
npm run build:all      # same as build (kept for prepublishOnly)
npm test               # the full gate, in order:
                       #   vitest run          library tests in test/ (1,771)
                       #   test:next           PLAN-4.6 R1-R4: the suites the next core (src/core/) covers,
                       #                       with SYGNAL_CORE=next (scripts/test-next.mjs; deleted at R5)
                       #   test:examples       each example's own suite (9 examples, 105 tests)
                       #   test:types          tsc on type-tests/
                       #   test:browser        browser-tests/ (154)
                       #   test:perf-gate      count gate (PLAN-4.5): DOM patches, streams, timers, retained
                       #                       objects and heap vs benchmarks/audit/gate.json (~15 s; needs
                       #                       benchmarks/ installed; limits only go down)
npm run test:examples  # only the example suites (TEST_EXAMPLES_INSTALL=1 or --install runs npm install first)
node scripts/perf-gate.mjs --runs=3  # the count gate alone, 3 runs with min … max per metric
node scripts/perf-report.mjs         # timing ratios to React vs PLAN-4.5 targets (warn-only, ~1.5 min, not in npm test);
                                     #   harness: benchmarks/audit (see benchmarks/README.md)
npm --prefix sygnal-check test       # static checker package (245 tests, *.vtest.js)
npm --prefix docs run build          # docs site + internal link check
node scripts/gen-error-docs.mjs      # regenerate docs reference/errors.md from sygnal-check/explanations.json
node scripts/check-doc-samples.mjs   # sygnal-check --strict on every docs code sample (444 checked, 5 skipped by marker)
node scripts/size-gate.mjs           # size gate: kanban gzip with nativeGlobalThis: false ≤ 42,300 B gated (D48;
                                     #   needs build + examples/kanban install); also prints the default
                                     #   (globalthis-aliased) size. `--budget <bytes>` overrides
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

**Rendering pipeline:** `view()` → `processPortals` → `processTransitions` → `instantiateSubComponents` → `renderVdom` (inject + `processSuspensePost`)

**Special JSX components** use `preventInstantiation` pattern: Portal, Transition, Suspense, Collection, Switchable. They create marker VNodes with custom `sel` names that are processed at specific points in the pipeline.

**Source layout:**
- `src/component.ts` — Core component class (~2,300 lines): rendering pipeline, error boundaries, disposal, READY sink, Suspense post-processing, per-action state snapshots for non-STATE sinks
- `src/collection.ts`, `src/switchable.ts` — Collection and dynamic component rendering
- `src/portal.ts` — Portal component (`preventInstantiation` pattern, separate snabbdom patch instance)
- `src/transition.ts` — Transition component (CSS enter/leave via snabbdom hooks)
- `src/suspense.ts` — Suspense component (`preventInstantiation` pattern, processed in `renderVdom`)
- `src/lazy.ts` — Lazy loading wrapper with `__sygnalLazy` metadata for Suspense detection
- `src/extra/ref.ts` — `createRef()` and `createRef$()` for DOM element access
- `src/extra/` — Helpers (processForm, processDrag, eventDriver, driverFactories, `fetchDriver.ts` (`makeFetchDriver`: opt-in HTTP driver, `HTTP.select(category)`/`HTTP.errors(category)`, `latest: true` aborts superseded requests), reducers `set`/`toggle`/`event`/`emit`, etc.)
- `src/extra/testing.ts` — `renderComponent()`: mock DOM by default or `dom: 'real'` (real DOM driver in `document.body`; `t.container`/`t.query`/`t.queryAll`), `simulateEvent`/`simulateAction`, `ready`/`next`/`waitForState`/`settle`, `t.state`, `html`, `sinkValues`/`emitted`, fakes for driverless sinks (`t.respond`/`t.fail`/`t.requests`, e.g. for `makeFetchDriver`), works under fake timers (`vi.useFakeTimers()`: the waits drive the clock), `expectNoDiagnostics`, `inspect`
- `src/extra/diagnostics/` — Diagnostics core: `codes.ts` (SYG code registry: severity, title; `docsUrlFor()` → `https://sygnal.js.org/reference/errors#sygnnn`), `index.ts` (modes, `report()`, hooks, `getDiagnostics`/`onDiagnostic`), `legacy.ts` (coded console messages that print even when off)
- `src/extra/diagnostics/checks/` — The `sygnal/diagnostics` dev entry (separate bundle, never in apps): wiring, dom (SYG103/104), events, props, state, collections, rxjsHints (SYG301), strict (SYG501/502/504, `configureStrict`), inspect (`inspect()` app graph); types in `public.d.ts`. Reaches the core through `globalThis.__SYGNAL_DIAGNOSTICS__`
- `src/vite/plugin.ts` — `sygnal/vite`: JSX (oxc + esbuild below Vite 8), HMR wiring, dev-only diagnostics injection, `sygnal-check` in dev, Vitest setupFiles, Vike/Astro dev wrappers
- `src/pragma/` — JSX createElement implementation (passes `onError` through)
- `src/vike/ClientOnly.ts` — ClientOnly component (`preventInstantiation` pattern, renders fallback during SSR)
- `src/astro/` — Astro framework integration (client hydration + SSR)
- `src/cycle/` — Absorbed Cycle.js internals (run, isolate, state, dom)
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
- `dev-plans/` — Plans and status trackers (PLAN-1: agent ergonomics; PLAN-2: follow-up ergonomics, the next major)

**Absorbed dependencies:**
All `@cycle/*` packages have been absorbed into `src/cycle/`. The only external runtime dependencies are `snabbdom` and `xstream`.

- `src/cycle/dom/snabbdom.ts` — Local barrel that imports from snabbdom subpaths (e.g., `snabbdom/build/h`) to avoid snabbdom's broken barrel export which triggers a `styleModule` `window` ReferenceError in Node.js
- `src/cycle/dom/styleModule.ts` — Local copy of snabbdom's styleModule with a fixed `typeof window !== "undefined"` guard (snabbdom 3.6.3 regression)

**Rollup externals:** Use the `isExternal` function in `rollup.config.mjs` which matches any import starting with `snabbdom/` or `xstream/`.

## Canonical Forms and Diagnostics

Docs, examples, `llms.txt` and the skill use only the canonical forms in `dev-plans/PLAN-1-canonical-forms.md`: destructured views `function C({ state, context, ...props })`, `ABORT` for "no change", `EFFECT` for side effects, the object form for every non-STATE sink (no `'ACTION | SINK'` keys), `EVENTS: event('TYPE', fn)` (not `emit()` or raw `{ type, data }`), `CHILD.select(ChildFn)`, `.context` for deep data. Strict mode (SYG501–507: `sygnal-check --strict`, `configureStrict`, `renderComponent({ strict })`) flags the alternatives; the docs list them only on `advanced/alternative-forms`. All examples and templates are strict-clean.

To add a diagnostic code: add it to both tables in `src/extra/diagnostics/codes.ts` (inside the workstream range), add its explanation to `sygnal-check/src/explanations.js`, regenerate `sygnal-check/explanations.json` (`node sygnal-check/bin/sygnal-check.js explain --all --json > sygnal-check/explanations.json`), then `node scripts/gen-error-docs.mjs`. Drift tests cover each step.

## Key Conventions

- All source files are `.ts` (converted from `.js` as part of the absorption project)
- `src/index.d.ts` contains standalone type declarations for the component public API — these are separate from the `.ts` source types
- Tests are in `test/` (root vitest) and `examples/*/src/*.test.*` (run per example by `test:examples`)
- Build must produce every entry successfully before tests are meaningful
