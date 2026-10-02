# Changelog

All notable changes to Sygnal are listed here. Versions follow [semantic versioning](https://semver.org). Releases before 5.4.0 are described in the [GitHub releases](https://github.com/tpresley/sygnal/releases) and tags.

## [Unreleased]

HTTP and testing get first-class support. `makeFetchDriver()` replaces hand-written `fetch` drivers and request-id bookkeeping, and `renderComponent()` tests answer requests with `t.respond()` / `t.fail()` without wiring a driver. Tests can run on fake timers, against a real DOM, and read `t.state`. This release also fixes Switchable, calculated-field, Collection and Vike bugs that the agent evals found, and makes apps built with `sygnal/vite` about 4 KB smaller.

Covers `sygnal`, `sygnal-check` and `create-sygnal-app`. A few fixes change behavior that an app or test could have relied on, and the TypeScript declarations are stricter in several places; both are listed under [Breaking changes](#breaking-changes-runtime-behavior) and [Migration](#migration).

**Measured impact.** _Placeholder: filled in from [`evals/agent-ergonomics/results/REPORT-v2.md`](evals/agent-ergonomics/results/REPORT-v2.md) (Sygnal vs React gap per tier, tier-3 pass rates, model sensitivity, against the 5.4.0 `v2-baseline`)._

### Added

- **`makeFetchDriver()`**, an HTTP driver over `fetch` ([guide](https://sygnal.js.org/guide/drivers/#http-requests-with-makefetchdriver)). `run(App, { HTTP: makeFetchDriver() })`, then the model sends requests and the intent reads replies:
  - a request is `{ url, category, method, query, json, body, headers, latest, timeoutMs, parse, init }` or a URL string; POST when `json`/`body` is set, else GET. Other `fetch()` options go under `init` (`init: { credentials: 'include' }`); any other key is app data that isn't sent and comes back on `request`;
  - `HTTP.select(category)` emits `{ category, value, status, request }` for 2xx responses; `HTTP.errors(category)` emits `{ error, category, request, status, body }` for non-2xx, network errors, parse errors and timeouts;
  - `latest: true` aborts the component's older requests of that category still in flight (their replies never arrive), and `{ category, abort: true }` cancels them, so search-as-you-type needs no request ids or stale checks;
  - isolated per component instance like `@cycle/http`: two `<Search>`es, or every Collection item, get only the replies to their own (and their children's) requests, and `latest`/`abort` stay per instance; the root sees everything. Header names are sent lowercased (`Headers` semantics);
  - driver options `baseUrl`, `headers`, `init`, `latest`, `timeoutMs`, `parse` and `fetch`; disposing the app aborts everything in flight; no requests during SSR;
  - 0 bytes when unused (about 1.3 KB gzipped in an app that uses it). New types `FetchRequest`, `FetchResponse`, `FetchError`, `FetchSource`, `FetchDriverOptions` and `FetchInit`.
- **Test fakes for drivers** ([testing](https://sygnal.js.org/integration/testing/#answering-requests-respond-and-fail)). In `renderComponent()`, a sink with no driver, in the component or any child, is recorded, and its source is a scriptable fake:
  - `t.requests(name)` lists what was sent (an alias of `sinkValues`);
  - `t.respond(name, value, opts?)` answers the newest pending request on `select()`, and `t.fail(name, 404 | error, opts?)` fails it on `errors()`; `opts` is a category or `{ category, request, status, body }`;
  - the fake follows `latest`, `abort` and instance isolation like the real driver, and fails the test with an explanation when nothing is pending or nothing listens.
- **More `renderComponent()` options and results** ([testing](https://sygnal.js.org/integration/testing/)):
  - `dom: 'real'` mounts into a real container (jsdom or happy-dom), so `checked`, `value`, `disabled`, focus, refs and Portals are real; `simulateEvent` then dispatches real events on any CSS selector, and `t.container`, `t.query(sel)` and `t.queryAll(sel)` read the DOM ([Real DOM](https://sygnal.js.org/integration/testing/#real-dom));
  - `timeoutMs` (2000), `settleMs` (20) and `eventWaitMs` (300) tune the waits; a timeout error names a model `next('X', data, ms)` that is still pending and a recorded state that already matched;
  - `t.state`, the latest state (`t.states.at(-1)`), read-only;
  - `t.sinkValues(name)` also records the sinks of children, grandchildren and Collection items, including their DISPOSE output.
- **Fake timers in tests.** `renderComponent()` works with `vi.useFakeTimers()` (and Jest's modern fake timers): `ready()`, `next()`, `waitForState()` and `settle()` advance the fake clock themselves, so tests of `debounce`, `delay` or `next('X', data, ms)` run in milliseconds ([Fake timers](https://sygnal.js.org/integration/testing/#fake-timers)). Before, every wait hung under fake timers.
- **`run(App, drivers, { diagnostics: { strict: true } })`** turns on the runtime strict checks (and `'warn'` diagnostics unless a `mode` is given); `dispose()` restores the previous setting.
- **New diagnostic codes:**
  - [SYG608](https://sygnal.js.org/reference/errors#syg608) (warn): strict mode requested from `run()` without the `sygnal/diagnostics` entry loaded;
  - [SYG609](https://sygnal.js.org/reference/errors#syg609) (warn, dev entry): a component sends to a sink, or reads a source, that has no driver under `run()` (before, the values were dropped silently and the source was `undefined`).
- **`sygnal/vite` `nativeGlobalThis`** (default `true`). xstream loads the `globalthis` npm polyfill and its dependency chain; the plugin now aliases it to a stub that returns the native `globalThis` in dev, build and Vitest, which makes a typical app about 4 KB gzipped smaller (kanban example: 42.1 → 38.1 KB). The Astro integration adds it to `astro build` too. A `globalthis` alias of your own wins; `nativeGlobalThis: false` keeps the polyfill ([details](https://sygnal.js.org/integration/bundler-config/#native-globalthis)). The stub is also exported as `sygnal/shims/globalthis` for other bundlers.
- **Collection `sort`** accepts `1`/`-1` per field and arrays of field names, sort objects and comparators (new `SortSpec` type).
- **`class`** accepts strings, arrays and clsx-style mixes: `class={['btn', { active: on }]}`.
- **Types** ([TypeScript guide](https://sygnal.js.org/integration/typescript/)):
  - a typed sub-component takes `state="slice"`, a lens or no `state` in JSX, plus its own props (`ViewProps`, `ElementProps` and `StateProp` exported);
  - `Component`'s 8th parameter `PROVIDED_CONTEXT` types a component's own `.context` separately from the context it reads;
  - an intent annotated `IntentSources<State>` is accepted on a component with `calculated` fields;
  - constants on non-STATE sinks (`LOG: 'saved'`) type-check (`NonStateSinkValue`).
- **Docs:** sections on sinks seeing the state from before the action, extracting a component without changing its markup, latest-only responses, HTTP, fake timers, the real DOM mode, and TypeScript sub-components and context.
- **`sygnal-check`:** explanations for SYG608 and SYG609 (`sygnal-check explain SYG609`), and the updated severity semantics below.
- **`create-sygnal-app`:** `README.md` in the package.

### Changed

- **Switchable pages stay alive and keep their state** ([Switchable](https://sygnal.js.org/guide/switchable/)). Every page is instantiated once and kept for the Switchable's lifetime. A hidden page keeps its own state and its sub-components, and its reducers, `EVENTS`/`PARENT`/`EFFECT` and `.context` see the current state, but it doesn't re-render while hidden: it renders the current state once when it is shown again. Before, a page's sub-components were re-created (their state reset) on every switch.
- **Severity and codes follow one rule** (`error` = the operation failed, thrown or caught and logged while the app keeps running; `warn` = likely mistake). A coded Sygnal error caught by a reducer, EFFECT or a parent is now reported under its own code (SYG215, SYG405, SYG413, SYG414, SYG903, …) instead of SYG216, SYG214 or SYG408. SYG405 is an `error` by default (still a warning for Collection and Switchable items). SYG420 (JSX tag is undefined) is now collected like other diagnostics.
- **SYG106 is an error in strict mode** (a parent prop named `state`, `children`, `slots`, `context` or `peers`); a warning otherwise.
- **Non-STATE reducers may return `null`, arrays and bigints**; they are sent to the driver as-is. Only a symbol other than `ABORT` is SYG218. Before, these were rejected with SYG218/SYG216 and nothing was sent.
- **`renderComponent()` waits:**
  - `ready()` is also a cursor: a `next()` right after `await t.ready()` also matches states produced by the calls buffered before it;
  - a `next()` right after another wait starts after the state that wait returned, so `await t.next(a); await t.next(b)` sees a `b` that arrived while `a` was rendering;
  - `t.html()` throws before the first render (it returned `''`), naming `await t.ready()`;
  - `t.html()` serializes like `innerHTML`: text escapes only `& < >` (`Couldn't`, not `Couldn&#39;t`), attributes only `& "`. `renderToString()` output is unchanged;
  - `dispose()` rejects waits still pending instead of leaving them open.
- **`sygnal-check` SYG111** also reports a literal `<select value="a">` with no change listener: the runtime puts the selection back on every render, like any controlled field.
- **Vike:**
  - `sygnal/config` (also `sygnal/vike` and `sygnal/vike/config`) is a single ESM file, `dist/vike/config/+config.js`; the CommonJS `+config.cjs.js` build is gone. This removes the `unexpected export { module.exports }` and `MODULE_TYPELESS_PACKAGE_JSON` warnings on every dev start;
  - `urlPathname` is no longer in `passToClient` (Vike provides it on the client, and listing it logged a warning); the client falls back to `window.location.pathname`;
  - in dev, `sygnal/vike/onRenderClient` is kept out of dependency pre-bundling, so the client entry and your pages share one Sygnal core;
  - Pages, Layouts and Wrappers keep their function names (or `componentName`) in diagnostics; the root is `VikeLayoutWrapper` when a Layout or Wrapper is configured.
- **Agent context:** `llms.txt` and the `sygnal-dev` skill cover `makeFetchDriver`, the test fakes, fake timers, `dom: 'real'`, `t.state` and TypeScript. The skill's `references/component-patterns.md` is removed (its content is in `SKILL.md`), and the agent docs no longer recommend the `sygnal-check` MCP server (the server itself is unchanged).
- **`create-sygnal-app` templates:** `AGENTS.md` tells agents to read the whole `npm test` output instead of piping it through `tail`, which hid the failure.

### Fixed

- **Switchable.**
  - A page's `PARENT` never reached the parent's `CHILD.select(Page)`: only sinks that were also sources were forwarded.
  - The Switchable could stay on the previous page after a switch (a page shown again while its stream chain was being torn down never rendered).
  - `stateSourceName` wasn't passed on by the stream form of `switchable()`.
- **State.**
  - After a child's lens write (a Collection item or a `state="slice"` child), the stored root state (`STATE` stream, devtools, `t.state`/`t.states`) kept stale calculated fields; the view was right.
  - `.context` reading a calculated field lagged one update behind a Collection item's write.
  - An `isolatedState` sub-component with `initialState` and no model never applied its `initialState`.
  - A sub-component with a `model` but no `intent` never got `BOOTSTRAP`.
  - A child rendered inside another child was instantiated once per ancestor; the duplicates ran BOOTSTRAP and timers and wrote state.
- **Collections.**
  - A Collection in a child component ignored a change to its `filter` or `sort` prop until some item's state changed.
  - `sort` without `filter` sorted the parent's state array in place; sorting now only changes what renders.
- **Rendering and forms.**
  - A string or array `class` became one class name or `[object Object]`.
  - A prop removed on re-render (`title`, `disabled`, `href`, …) stayed on the element, and `src={null}` / `title={null}` were written as the text "null". `null` and `undefined` props are never written; a removed prop is cleared.
  - `value={null}` and `checked={null}` clear a controlled field and keep it controlled, as in 5.4.0; leaving the prop out makes the field uncontrolled.
  - A `<select>`'s `value` was applied before its new options were patched, so it could select nothing.
- **Drivers.**
  - `driverFromAsync` lost replies and errors that arrived before the first `select()` / `errors()` listener (a request sent on `BOOTSTRAP`); they are buffered and delivered once a listener subscribes.
- **Testing.**
  - Waits hung under fake timers.
  - A child component's sink with no driver went to a no-op driver, so its output couldn't be asserted.
- **Vike.**
  - After client navigation with both a Wrapper and a Layout, the page's `+data` was lost. Shell components now each get a lens onto their own slice (serialized 5.4.0 state still hydrates).
  - In dev, the pre-bundled client entry inlined a second copy of the Sygnal core.
- **Types.**
  - The root component's view `state` was untyped (`RootComponent` props were `any`).
  - Typed sub-components couldn't be used in JSX with `state="slice"` or without `state`.
  - `CHILD.select(Child)` silently became `any` for an annotated child without a `PARENT` type.
  - DOM shorthands (`DOM.keydown('.x')`) were streams of plain `Event`.
  - `event()` with an unregistered name gave two errors; it gives one.
  - `SortObject` allowed a per-field function, which the runtime rejects (SYG418).
  - A `PARENT: false` constant was typed as `never`.
  - `npm run build` printed 56 TypeScript diagnostics; it prints none, and `test:types` type-checks the whole source.
- **Messages.** SYG218 says "returned null" / "returned an array" instead of "returned a object".

### Breaking changes (runtime behavior)

These are fixes, but code or tests may depend on the old behavior:

- **Hidden Switchable pages don't re-render** and keep their sub-components' state across switches (before: re-created on each switch). Code that relied on a page resetting when it is switched away should reset its state explicitly (for example on the action that switches).
- **`t.html()` throws before the first render** instead of returning `''`, and **escapes like `innerHTML`**, so stored snapshots containing `&#39;` or `&quot;` in text change.
- **`next()` cursor semantics:** a `next()` right after `await t.ready()` or after another wait can now match a state that the old `next()` skipped; a test that awaited `t.next()` to skip such a state needs a more specific predicate.
- **Codes and severities:** SYG405 is an `error`; errors caught by a handler are reported under their own code, so `ignore: ['SYG408']` or `['SYG216']` no longer silences a SYG405/414/903 or a SYG215. SYG106 is an error under strict mode. In `diagnostics: 'error'` mode, these throw.
- **Driver sinks receive `null`, arrays and bigints** from reducers instead of nothing (and an error).
- **Vike:** `require('sygnal/config')` loads the ESM config (Node's `require(esm)`); nothing points at `dist/vike/+config.js` or `+config.cjs.js` any more. `pageContext.urlPathname` isn't serialized to the client.
- **`sygnal/vite`** aliases `globalthis` for every dependency in the app, not only xstream. Set `nativeGlobalThis: false` if a dependency needs the polyfill package.

### Breaking changes (TypeScript)

Type-level only; JavaScript and runtime behavior are unaffected:

| Change | Before | Now | Migration |
|---|---|---|---|
| `CHILD.select(Child)` of a `Component<…>`-annotated child without a `PARENT` type | `Stream<any>` | `Stream<unknown>` | Declare the payload in the 7th parameter: `Component<S, P, D, A, C, X, { PARENT: Payload }>`, or annotate at the call site |
| DOM shorthands `DOM.click('.x')`, `DOM.keydown('.x')`, … | `Stream<Event>` | the event's own type (`MouseEvent`/`PointerEvent`, `KeyboardEvent`, … from `HTMLElementEventMap`) | Fix handlers annotated with the wrong event type. xstream streams are invariant, so `const clicks: Stream<Event> = DOM.click('.x')` no longer compiles: drop the annotation or use the specific type (`Stream<MouseEvent>`; `click` is `PointerEvent` in recent DOM typings). Custom event names (`DOM['my-event']`) are still `Event` |
| `RootComponent` view props | `any` | `{}` (state typed by `STATE`) | A root view gets no props: drop props destructured from it, or type the component as `Component<S, Props>` |
| View `context` | optional (`context?.x`) | required in `ViewProps` | Calling a view directly (`App({ state })` in a test) needs `context: {}`; `context?.` still compiles |
| `event()` | two overloads | one signature `event(type, payload?)` | No change for valid calls. With an empty `SygnalEvents` registry, a static payload was `any` and is now a plain value: an `interface`-typed object fails ("Index signature … is missing"). Declare it as a `type` alias, register the event in `SygnalEvents`, or pass a payload function (`event('X', () => payload)`) |
| `SortObject` | `'asc' \| 'desc' \| SortFunction` per field | `'asc' \| 'desc' \| 1 \| -1` (`sort` is `SortSpec`) | Use a comparator `sort={(a, b) => …}` or an array `[{ priority: -1 }, cmp]` (the runtime already rejected per-field functions, SYG418) |
| Non-STATE sink values | `true` or a reducer | also constants (`NonStateSinkValue`) | None (wider); an untyped sink's constant can't be a function |
| JSX attributes of a typed sub-component | the view's props, `state` required | own props + optional `state` (`ElementProps`) | Passing `context=` or `slots=` in JSX is now a type error (they were overwritten at runtime, SYG106) |

`FetchInit`, `FetchRequest` and the other fetch types are new.

### Removed

- `dist/vike/+config.cjs.js` (CommonJS Vike config); see Vike above.
- `skills/sygnal-dev/references/component-patterns.md` (content folded into `SKILL.md`).

### Migration

Most apps need no changes. Check these:

- **Switchable:** if a page should start fresh each time it's shown, reset its state on the switching action.
- **Tests:** replace `expect(t.html()).toBe('')` before a render with `await t.ready()` first; update `t.html()` snapshots containing `&#39;`/`&quot;` in text; tighten `next()` predicates that relied on skipping a state; update `ignore` lists and console expectations that named SYG408, SYG216 or SYG214 for errors that now carry their own code.
- **HTTP:** replace a hand-written `driverFromAsync(fetch…)` driver and request-id/ABORT bookkeeping with `makeFetchDriver()` and `latest: true` (optional). In tests, drop the driver and use `t.respond` / `t.fail`. `makeFetchDriver` sends header names in lowercase (`Headers` semantics): a `fetch` stub that reads `init.headers['Content-Type']` must read `content-type` or use `new Headers(init.headers).get(…)`.
- **Vike:** if you imported `sygnal/dist/vike/+config.js` or `+config.cjs.js` directly, import `sygnal/config` instead. If client code read `pageContext.urlPathname` without Client Routing, use `window.location.pathname`.
- **Bundles:** if a dependency needs the real `globalthis` package, set `sygnal({ nativeGlobalThis: false })`.
- **TypeScript:** see the table above. The most common fixes are adding `{ PARENT: Payload }` to children selected with `CHILD.select`, and correcting DOM event annotations.
- **Fake timers:** tests that switched fake timers off around `renderComponent()` can now keep them on.

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
