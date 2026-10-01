# Changelog

All notable changes to Sygnal are listed here. Versions follow [semantic versioning](https://semver.org). Releases before 5.4.0 are described in the [GitHub releases](https://github.com/tpresley/sygnal/releases) and tags.

## 5.4.0 — 2026-10-01

Sygnal's silent failures are now loud, and coding agents get one clear way to write each concept. Every runtime warning and error has a code (`SYGnnn`) with a fix and a docs link. New dev-only checks catch wiring mistakes as they happen, a static checker (`sygnal-check`) catches them before the app runs, and the test helpers drive components the way a user would. This release also fixes a long list of rendering, state and tooling bugs that these checks and the agent evals found.

Nothing here is a breaking API change. The new checks run only in development and in tests, and the forms that strict mode doesn't recommend keep working.

**Measured impact.** In the agent eval ([`evals/agent-ergonomics/results/REPORT.md`](evals/agent-ergonomics/results/REPORT.md)), agents built the same features in Sygnal and in React. Every trial passed in both frameworks before and after this release, so speed is the measure. On the standard tasks, Sygnal trials went from 74.8 s to 50.3 s, the gap to React shrank from 46.1 s to 15.8 s (66% smaller), and failed test runs per trial fell from 1.7 to 0.1. On the harder tasks, trials went from 92.2 s to 78.5 s, the gap to React shrank from 29.0 s to 15.4 s, and iterations per trial (2.4) now match React's (2.5).

### Added

- **Coded diagnostics.** Every runtime warning and error carries a `SYGnnn` code, a fix and a link to the [error reference](https://sygnal.js.org/reference/errors). Choose a mode with `run(App, drivers, { diagnostics: 'off' | 'collect' | 'warn' | 'error' })` (or `{ mode, ignore }`). You can also read findings with `getDiagnostics()`, `clearDiagnostics()` and `onDiagnostic()`.
- **`sygnal/diagnostics`**, a dev-only entry with runtime checks:
  - intent/model wiring (actions with no reducer, reducers with no action);
  - selectors that match nothing, or that only match inside a child component's isolation boundary;
  - EVENTS that are emitted but never selected, or selected but never emitted;
  - reducer return shapes, reserved-prop collisions, and Collection `from` problems;
  - hints when an RxJS operator is used on an xstream stream.
  
  It also provides `inspect()`, a machine-readable app graph. These checks add 0 bytes to production bundles.
- **Strict mode** for the canonical forms (SYG501–507). Turn it on with `sygnal-check --strict`, at runtime with `renderComponent(C, { strict: true })`, or in dev through the Vite plugin. Other forms still run; strict mode only reports them.
- **`event()`**, the canonical way to emit a global event from a model entry: `{ STATE: …, EVENTS: event('SAVED', state => state.id) }`.
- **Test helpers on `renderComponent()`:**
  - `simulateEvent(selector, type, init?)` sends DOM events with bubbling and isolation, the enriched `.value()` / `.data()` / … API, and structural selectors (`:nth-child`, `>`, `:not()`, …);
  - `ready()`, `next(predicate)` and `settle()` wait for renders and states;
  - `html()` returns the rendered markup;
  - `sinkValues()` and `emitted()` return what each sink produced, and `simulateAction` now drives every sink;
  - `expectNoDiagnostics()` fails a test on any Sygnal warning, and the `strict` and `diagnostics` options configure the checks;
  - `inspect()` returns the app graph.
- **Vite plugin dev integration.** In `vite` dev (never in `vite build`), the plugin:
  - loads the runtime diagnostics;
  - runs `sygnal-check` on start and on every save, printing to the terminal and the browser console;
  - adds the diagnostics setup file to Vitest;
  - turns on dev mode for Vike and Astro.
  
  New options: `diagnostics`, `check` and `vitestSetup`. The plugin also configures JSX under Vite 7 as well as Vite 8.
- **`sygnal-check`**, a new separate package (`npm i -D sygnal-check`) that reads your source and never runs it:
  - the same wiring rules across the whole project, plus a controlled-input rule (SYG111);
  - `--strict`, and `--fix` for the mechanical canonical-form rewrites;
  - `--graph [--json]`, the static app graph, in the same shape as `inspect()`;
  - `explain <code>`, which explains any SYG code;
  - `mcp`, an MCP server with `check`, `graph` and `explain` tools;
  - `// sygnal-ignore SYGnnn` comments to silence one finding.
- **Agent context:**
  - `llms.txt`, a normative spec for language models, ships in the package (`node_modules/sygnal/llms.txt`) and at https://sygnal.js.org/llms.txt;
  - a rewritten `sygnal-dev` agent skill (`skills/sygnal-dev`);
  - every `create-sygnal-app` template now has an `AGENTS.md` (and a `CLAUDE.md` that imports it), a strict-mode starter test, and `sygnal-check` as a dev dependency.
- **New exports:**
  - the xstream extras `concat`, `flattenConcurrently` and `flattenSequentially`, next to the existing `debounce`, `throttle`, `delay`, `dropRepeats` and `sampleCombine`, now as tree-shakable ESM ports;
  - `errors()` on `driverFromAsync` sources;
  - `getDevTools` and `Suspense` type declarations;
  - typed links: `ActionsOf`, `IntentSources`, the `SygnalEvents` registry, typed `CHILD.select(Component)` and typed Collection `from`;
  - `isolatedState` and `idfield` in the types, and `LazyComponent`.
- **Docs:**
  - a generated [error reference](https://sygnal.js.org/reference/errors) for all 64 codes;
  - new pages on diagnostics, strict mode, agents and the alternative forms;
  - the guide pages rewritten to the canonical forms.

### Changed

- **`simulateEvent` throws when its selector matches nothing.** The error names the selector after a short wait for a render. Before, the event was dropped silently and the test timed out later. Pass `{ allowMissing: true }` to get the old behavior (the event is dropped and reported as SYG103).
- **Model shorthand (`'ACTION | SINK'`) and `emit()` are now "alternative forms".** They keep working, but the docs, `llms.txt` and the templates use the object form and `event()`, and strict mode reports them (SYG504 for shorthand, SYG505 for `emit()`; `sygnal-check --fix` rewrites both).
- **Messages carry codes.** Existing console warnings and errors now start with `[Sygnal SYGnnn]`, including in production, and several misleading messages were corrected.
- **Inputs are fully controlled.** `value` and `checked` always reflect state after a render, as in React, even when renders are coalesced. A field with a `value` but no input listener gets a SYG111 warning.
- **Non-STATE sinks see the same state as STATE.** Every sink of one action (EVENTS, PARENT, EFFECT, drivers) now reads the same state snapshot, and runs synchronously unless a same-tick STATE reducer is still pending.
- **`driverFromAsync`** delivers `null` and `undefined` results to `select()`. Rejections go to the new `errors()` source and are still logged when nothing listens.
- **`data-sygnal-ready`** now appears only on child components that aren't ready yet, so extracting markup into a sub-component no longer changes the DOM.
- **`lazy()`** returns `LazyComponent<PROPS>`, which is used in JSX without a `state` prop.

### Fixed

- **Plain Node.**
  - `run()` threw `xs.create is not a function` under plain Node CommonJS (`require('sygnal')`) and native Node ESM; only bundlers worked.
  - The re-exported xstream extras (`debounce`, `concat`, …) were `{ default }` objects instead of functions there.
  - Both now work, with a test that runs a whole app in each.
- **State and sinks.**
  - EVENTS and other sinks could see stale state when an action arrived in the same tick as a state change.
  - Two same-tick actions inside a Collection item lost the first update.
  - An `isolatedState` sub-component without a `state` prop replaced its parent's state.
  - Returning `ABORT` from a PARENT, EVENTS, EFFECT or driver sink reported an error instead of sending nothing.
- **Rendering.**
  - A Collection didn't re-render when its items were only reordered.
  - An element patched from one text child to several children kept the old text.
  - A removed `className` stayed on a reused element.
  - A controlled input wasn't cleared when actions arrived in the same tick.
- **Collections and disposal.**
  - Nested Collection and Switchable items weren't disposed with their parent item (a leak, and DISPOSE never fired).
  - Two Collections whose items shared ids shared isolation scopes, so events could cross between them.
  - An invalid `from` was reported twice.
- **DOM events.** `.data('taskId')` failed when the event target was a nested child of the `data-task-id` element. `.data('task-id')` works too.
- **`driverFromAsync`.** A rejected promise was only logged, so loading UIs hung. A `null` result crashed. Teardown printed a spurious warning.
- **Testing.**
  - `renderComponent`'s mock DOM lacked the enriched event API (`.value()`, `.data()`).
  - Events sent right after `renderComponent()` were lost.
  - `simulateAction` ignored non-STATE sinks.
  - Switchable didn't render under the mock DOM.
  - `waitForState` could resolve before children re-rendered.
  - `hmrActions` and `components` were ignored.
- **Vite plugin.**
  - The HMR transform broke test files and other files that call `run()`: it produced invalid code or `__sygnal is not defined`.
  - Under Vite 8, the dependency scanner compiled JSX for React in every Sygnal app.
  - JSX wasn't configured under Vite 7.
  - The diagnostics setup file didn't load under jsdom.
- **Astro.** `sygnal/astro/client` bundled a second copy of the Sygnal core. Island props were nested on the client but spread on the server. Island roots were named "Wrapped" in diagnostics.
- **Vike.** `import vikeSygnal from 'sygnal/config'` failed type-checking (no default export).
- **Devtools.** EVENTS were always attributed to the root component, and devtools stamps broke `toEqual` on sink output.
- **Types.**
  - `lazy()` components required a `state` prop in JSX.
  - `Suspense`, `getDevTools`, `isolatedState` and `idfield` had no declarations.
  - `npm run build` now bundles the declarations, and `prepublishOnly` runs it. The published 5.0.0–5.1.1 declarations referenced a file missing from the package; 5.1.2–5.3.7 were complete.
- **Bundle size.** Unused xstream extras no longer ship in every app.

### Migration notes

No code changes are required. What an existing app may notice:

- **New warnings in development.** Under `vite` dev and in tests, the runtime checks and `sygnal-check` report wiring problems as `[Sygnal SYGnnn]` warnings in the terminal and console. They don't change behavior. Run `npx --no-install sygnal-check explain SYGnnn` or see the error reference for each code. To turn them down:
  - Vite plugin: `sygnal({ diagnostics: 'off', check: false, vitestSetup: false })`, or `diagnostics: { ignore: ['SYG105'] }` to drop single codes;
  - `run(App, drivers, { diagnostics: 'off' })` for a running app;
  - `// sygnal-ignore SYG110` on a line for `sygnal-check`.
- **Tests that relied on a silent no-match.** `simulateEvent` with a selector that matches nothing now throws instead of doing nothing. Fix the selector, or pass `{ allowMissing: true }` where a missing element is expected.
- **Tests that compare console output or markup.** Messages now start with a code, and `data-sygnal-ready` is gone from ready child components.
- **Inputs.** If a field relied on a stale `value` (for example, "save on blur" without an input listener), it now resets to state on every render. Keep the draft in state with an input listener.
