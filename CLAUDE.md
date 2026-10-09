# Sygnal

Reactive component framework built on Cycle.js patterns. All source is TypeScript.

## Build & Test

```bash
npm run build          # Rollup → dist/ (24 configs: core UMD + CJS/ESM, sygnal/jsx, jsx-runtime,
                       #   jsx-dev-runtime, sygnal/diagnostics, sygnal/devtools, sygnal/element, sygnal/ui,
                       #   sygnal/zag, sygnal/ui/menu, sygnal/ui/select, sygnal/ui/combobox, sygnal/react, sygnal/ai,
                       #   the globalthis shim, sygnal/vite, Astro (3), Vike (4)) + bundled .d.ts
npm run build:all      # same as build (kept for prepublishOnly)
npm test               # the full gate, in order:
                       #   vitest run          library tests in test/ (2,583; test/parity/: the core's behaviour contract)
                       #   test:examples       each example's own suite (9 examples, 105 tests)
                       #   test:types          tsc on type-tests/
                       #   test:browser        browser-tests/ (184; Chromium. Opt-in other engines:
                       #                       BROWSER=firefox|webkit npm --prefix browser-tests test)
                       #   test:perf-gate      count gate (PLAN-4.5/4.6): DOM patches, streams, timers, retained
                       #                       objects and heap vs benchmarks/audit/gate.json (~10 s; needs
                       #                       benchmarks/ installed; limits only go down)
npm run test:examples  # only the example suites (TEST_EXAMPLES_INSTALL=1 or --install runs npm install first)
npm run test:recipes   # the docs recipes' code (dev-plans/research/p5-recipes, G-441): recipe tests + docs-sync;
                       #   --browser[=chromium,firefox,webkit] adds the real-browser run; not in npm test (own
                       #   ~150 MB devDependencies: TEST_RECIPES_INSTALL=1 or --install runs npm ci there first)
node scripts/perf-gate.mjs --runs=3  # the count gate alone, 3 runs with min … max per metric
node scripts/perf-report.mjs         # timing ratios to React vs the timing targets (warn-only, ~1.5 min, not in npm test);
                                     #   harness: benchmarks/audit (see benchmarks/README.md)
npm --prefix sygnal-check test       # static checker package (492 tests, *.vtest.js)
npm --prefix docs run build          # docs site + internal link check
npm --prefix docs run check-live     # every live example of the built docs/dist in Playwright; must pass on BROWSER=chromium, firefox and webkit
node scripts/gen-error-docs.mjs      # regenerate docs reference/errors.md from sygnal-check/explanations.json
node scripts/check-doc-samples.mjs   # sygnal-check --strict on every docs code sample (680 checked, 15 skipped by marker)
node scripts/size-gate.mjs           # size gate: kanban gzip with nativeGlobalThis: false <= 42,700 B gated (D48, D185, D222, D230;
                                     #   needs build + examples/kanban install); also prints the default (globalthis-aliased)
                                     #   size and src/core/** alone. `--budget <bytes>` overrides
```

This is a **library package** — no dev server. Verify changes via `npm run build` + `npm test`. Build before testing: tests and examples import `dist/`.

**Fresh checkout / worktree setup** (G-002): the gate needs more than the root install, or the kanban-based library tests fail with "Cannot find package 'sygnal'":

```bash
npm ci
npm ci --prefix browser-tests            # Playwright 1.63.0 (pinned; benchmarks/ pins the same): chromium-1243,
                                         #   firefox-1543, webkit-2359 from ~/Library/Caches/ms-playwright (D191);
                                         #   no install script, so npm ci downloads no browsers
npm ci --prefix sygnal-check             # @babel/parser for vite-plugin-dev and inspect-kanban tests
npm install --prefix examples/kanban     # its file:../.. link; other examples: TEST_EXAMPLES_INSTALL=1 npm test
npm install --prefix examples/todomvc    # test/copied and the devtools Copy-as-test tests import it
npm ci --prefix benchmarks               # Vite + sygnal/vite for test:perf-gate (also: TEST_EXAMPLES_INSTALL=1 npm test)
npm ci --prefix docs                     # Astro/Starlight, for npm --prefix docs run build
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --prefix dev-plans/research/p5-recipes   # for npm run test:recipes
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
- `src/extra/widget.ts` — `defineWidget()` (PLAN-5 W-1): a third-party widget as a JSX tag (opaque host, `mount`/`update`/`unmount`, dispatched events, commands, `ownProps`, `error(e)`); the `widget` marker rewritten through `pres.widget`
- `src/extra/virtual.ts` — `<VirtualCollection>` (PLAN-5 V-1, on `@tanstack/virtual-core`)
- `src/extra/browserSources.ts` — the `browser` static's sources and `makeBrowserDriver()` / `makeBrowserDriverWith()` (PLAN-5 B-3)
- `src/extra/form.ts`, `src/extra/formHelpers.ts` — the `form` behavior and its helpers (Standard Schema, PLAN-5 F-1)
- `src/ui.ts`, `src/ui/` — `sygnal/ui`: headless parts on native HTML (dialog, popover, tooltip, tabs, accordion, disclosure, Toaster)
- `src/ui/zag/` + `src/ui-menu.ts`, `src/ui-select.ts`, `src/ui-combobox.ts` — Menu, Select, Combobox on Zag machines (`fromZag`), one subpath each (`sygnal/ui/menu|select|combobox`, D211); types `src/ui-*.d.ts` (shared: `src/ui-zag-types.d.ts`)
- `src/zag.ts` — `sygnal/zag`: `fromZag(zag, render, options)`, a Zag.js machine as a widget tag (`@zag-js/vanilla`, a private snabbdom patch)
- `src/react.ts` — `sygnal/react`: `fromReact(Component, options)`, a React (or preact/compat) component as a widget tag
- `src/extra/ai/` + `src/ai.ts` — `sygnal/ai` (PLAN-6): LLM chat driver and transports, decisions, the `agent` layer. The code is in the main bundle (exported from `src/index.ts`, tree-shaken); `src/ai.ts` re-exports it from the external `sygnal` (one copy of the internals, G-581; `test/p6-ai-entry.test.js`); types `src/ai.d.ts`
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
- `browser-tests/` — Real-browser suite (`test:browser`, free port). `BROWSER=firefox|webkit` runs another cached Playwright engine (never download browsers); `BROWSER_TESTS_ONLY=<substring>` runs only the suites whose function name contains it (`main.js` list). Chromium runs with `--enable-features=WebMCP` (PLAN-6 D267); `BROWSER_ARGS` adds launch args, `BROWSER_TESTS_TIMEOUT_MS` raises the 90 s limit on a loaded machine. Real input for tests: `window.__pwType(sel, text)`, `window.__pw(action, sel, arg)` (Playwright locator: click, hover, focus, press, fill, type, mouse-away, role, aria) and `window.__pwInput(steps)` (mouse move/down/up, keys, waits; touch via CDP, Chromium only); pointer input needs an on-screen element: `mountOnScreen()` / `clearStage()` from `harness.js`
- `examples/` — Example apps, each with its own Vite/Vitest config and `npm test`; excluded from the root vitest
- `docs/` — Starlight docs site (sygnal.js.org); `docs/scripts/check-links.mjs` runs after `astro build`
- Live examples in the docs: a fence meta word runs the block under it in a Result panel with an Edit/Reset CodeMirror editor. ` ```jsx live` (mounts the `export default`, else the last top-level capitalized function declaration), `live=Name` (that component), `live-file=./x.js` (not run: a module the page's live blocks can import; one per path), `live-height=320` (min height), `live-expect=404|throw` (the demo hits a missing demo route / a throwing handler on purpose), ` ```css live` (a stylesheet scoped to the panels at build time), ` ```js live-server` (a visible demo HTTP server: a route table for the `HTTP` fetch driver of the live blocks after it). No hidden setup: what the page shows is what runs. The build compiles every block (`docs/src/plugins/remark-live.mjs` with `docs/src/live/compile.mjs`, the compiler the browser loads only for edited code) and fails on a syntax error, a missing live-file or an import not in `docs/src/live/modules.ts` (add a library there and to `docs/package.json` at an exact version). Client: `docs/src/live/` (`runtime.ts`, `server.ts`, `editor.ts` shared with Try It), loaded by the `MarkdownContent` override only on pages with a demo. The remark-live header documents the drivers each demo gets and the rules. After a docs change, build and run `node docs/scripts/check-live.mjs` with `BROWSER=chromium`, `firefox` and `webkit`: all three must pass
- `scripts/` — `test-examples.mjs` (test:examples), `gen-error-docs.mjs` (`--check` for drift), `check-doc-samples.mjs`, `size-gate.mjs`
- `evals/agent-ergonomics/` — Agent eval harness (Sygnal vs React tasks, hidden tests, results)
- `skills/sygnal-dev/`, `llms.txt` — Agent context (canonical forms only)
- `dev-plans/` — Plans and status trackers (PLAN-1: agent ergonomics; PLAN-2: follow-up ergonomics; PLAN-4.6: the component core rewrite; PLAN-5: ecosystem)

**Absorbed dependencies:**
All `@cycle/*` packages have been absorbed into `src/cycle/`. The external runtime dependencies are `snabbdom`, `xstream` and `@tanstack/virtual-core` (for `<VirtualCollection>`).

**Dependency rule (D209):** don't bundle actively maintained third-party code into Sygnal's npm builds; users must get its patch/security releases through npm and see it in `npm audit`.
- Small, framework-neutral libraries a feature needs → regular `dependencies` with a caret range, kept external in the CJS/ESM builds (`isExternal` in `rollup.config.mjs`) and side-effect free so unused features cost nothing.
- Heavy, framework-specific or rarely needed libraries (React for `fromReact`, `@zag-js/*`) → optional `peerDependencies`, usually behind a subpath.
- Absorbing code into `src/` is only for unmaintained libraries (as with Cycle.js) or small patched copies (snabbdom's `styleModule`).
- Only the standalone UMD build (`dist/sygnal.min.js`) bundles runtime dependencies.

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
