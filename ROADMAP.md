# Sygnal Feature Roadmap

Features identified by comparing React and Vue capabilities against Sygnal's functional reactive architecture. Each feature includes a Sygnal-idiomatic implementation approach — declarative, stream-based, and driver-oriented where possible.

> **Version note:** These features target a **major release**. Breaking changes are allowed when they **clearly improve developer experience** with no loss of functionality — but not arbitrarily.

---

## Tier 1 — High Value

### 1. Error Boundaries

**Status:** `DONE`

Catch and recover from errors in child component rendering or lifecycle processing. Without this, a single broken child can crash the entire application. React's `componentDidCatch` and Vue's `onErrorCaptured` are essential for production resilience.

**Implementation:**
- `onError` static property on components: a function receiving `(error, { componentName })` and returning fallback VNode(s)
- View function call wrapped in try/catch — on error, renders fallback from `onError` or an empty `<div data-sygnal-error="ComponentName">`
- Model reducers wrapped in try/catch — on error, returns previous state unchanged (state reducer) or ABORT (non-state reducer)
- Sub-component instantiation wrapped in try/catch — on error, replaces failed child with fallback VNode
- All errors logged to `console.error` with component name and context
- `onError` handler errors are caught separately to prevent cascading failures

---

### 2. Refs (Direct DOM Access)

**Status:** `DONE`

Imperative access to DOM elements is sometimes unavoidable — measuring dimensions, integrating third-party libraries (maps, charts, video players), or managing focus beyond `autoFocus`. Currently requires chaining `DOM.select().element()` streams, which is verbose for common cases.

**Implementation:**
- `ref` prop on any JSX element: accepts a callback `(el: HTMLElement | null) => void` or an object `{ current: HTMLElement | null }`
- Implemented via snabbdom `insert` hook (element on insert) and `destroy` hook (`null` on destroy), following the existing `autoFocus` pattern
- `createRef<T>()` — returns `{ current: T | null }`, a simple mutable container (like React's `useRef`)
- `createRef$<T>()` — returns `{ current: T | null, stream: MemoryStream<T | null> }`, a reactive ref that pushes to a stream for use in intent
- `DOM.select().element()` remains the idiomatic FRP approach; refs are the escape hatch for imperative integrations

---

### 3. Portals / Teleport

**Status:** `DONE`

Render component output into a DOM node outside the component's own mount point. Essential for modals, tooltips, dropdown menus, and toast notifications that need to escape overflow/z-index stacking contexts.

**Implementation:**
- `<Portal target="#selector">children</Portal>` JSX component with `preventInstantiation` pattern (`src/portal.ts`)
- Portal VNodes detected and replaced by `processPortals()` before sub-component instantiation in the render pipeline
- Uses a separate snabbdom `init()` patch instance to render children into the target container
- Snabbdom hooks manage lifecycle: `insert` (first render into target), `postpatch` (update on re-render), `destroy` (cleanup on unmount)
- Hidden placeholder `<div>` remains in the component tree; portal content renders in the target container
- Note: Portal content is outside the component's DOM event delegation scope — use the parent component's own DOM elements for interaction (e.g., toggle buttons), or the EVENTS driver for cross-component communication

---

### 4. Transition / Animation Components

**Status:** `DONE`

Declarative enter/leave animations for conditionally rendered elements and collection items. Snabbdom already supports `delayed` and `remove` style hooks, but there's no high-level component to orchestrate CSS class-based transitions.

**Implementation:**
- `<Transition name="fade">` wrapper component (`src/transition.ts`) applies CSS classes during enter/leave phases
- Enter: `.fade-enter-from` + `.fade-enter-active` on insert, swap to `.fade-enter-to` on next frame (double rAF), remove classes after `transitionend`
- Leave: `.fade-leave-from` + `.fade-leave-active`, swap to `.fade-leave-to`, delay VNode removal until `transitionend` fires via snabbdom's `remove` hook
- Props: `name` (class prefix, default `'v'`), `duration` (explicit ms override)
- No wrapper div — hooks are applied directly to the child VNode
- Processed in the rendering pipeline via `processTransitions()` (same pattern as `processPortals()`)

---

### 5. Lazy Loading / Code Splitting

**Status:** `DONE`

Defer loading of component code until it's needed, reducing initial bundle size. Critical for larger applications with many routes or heavy feature panels.

**Implementation:**
- `lazy(() => import('./Component'))` function (`src/lazy.ts`) returns a wrapper component function
- The wrapper delegates to the loaded component's view once the import resolves; renders a placeholder div while loading
- Static properties (model, intent, context, etc.) are copied from the loaded component to the wrapper asynchronously
- Module is cached — subsequent renders use the cached component instantly
- Import errors are caught and logged; an error placeholder div is rendered
- No changes to `component.ts` (the 5.x core; `src/core/` since PLAN-4.6) rendering pipeline needed — the wrapper is a normal component function
- Note: lazy-loaded sub-components should NOT use `initialState` (use parent state lens instead)

---

## Tier 2 — Medium Value

### 6. Component Cleanup / Disposal Hooks

**Status:** `DONE`

Run cleanup logic when a component unmounts — close WebSocket connections, clear intervals, disconnect ResizeObservers, release resources. Previously there was no component-level teardown; disposal only existed at the app level.

**Implementation:**
- **`dispose$` source stream**: Added to all component sources. Emits `true` once when the component is being removed. Use in intent: `CLEANUP: sources.dispose$` → model triggers cleanup actions declaratively via driver sinks
- **Internal subscription tracking**: Context and sub-component sink subscriptions are now tracked and unsubscribed on disposal (fixes memory leaks)
- **Sub-component removal detection**: `instantiateSubComponents` fold now detects when sub-components are removed (conditional rendering, `entries.length === 0`) and calls `dispose()` on removed instances
- **Collection item disposal**: `Collection.ts` calls `__dispose()` on sinks when items are removed from the collection
- **`component()` factory**: Attaches `__dispose` callback to returned sinks, linking to the Component instance's `dispose()` method

---

### 7. Suspense (Loading States)

**Status:** `DONE`

Show fallback UI while waiting for async children to resolve. Pairs with lazy-loaded components and async data fetching to provide a declarative loading experience.

**Implementation:**
- `<Suspense fallback={<Loading />}>children</Suspense>` JSX component (`src/suspense.ts`) with `preventInstantiation` pattern
- Built-in `READY` sink: components emit boolean values to control Suspense visibility
- Components without explicit `READY` model entries auto-emit `READY: true` on instantiation
- Components with `READY` model entries start as not-ready; emit `READY: true` when loading completes
- `processSuspensePost()` runs after sub-component injection in `renderVdom`, checking `data-sygnal-ready` attributes
- READY state tracked on parent Component instance (`_childReadyState`), persists across render cycles
- READY changes trigger parent re-render via dedicated `_readyChanged$` stream for seamless fallback→content transitions
- Also detects `data-sygnal-lazy="loading"` placeholders from lazy-loaded components within Suspense boundaries
- Cleared `_childReadyState` entries on component disposal for correct re-mount behavior
- Nested Suspense boundaries respected — inner `<Suspense>` catches its own children without triggering outer boundary
- Supports VNode or string fallback props

---

### 8. Slots (Named Children)

**Status:** `DONE`

Pass multiple named content regions from parent to child — headers, footers, sidebars, actions — rather than a single flat `children` array. Vue's named slots and React's compound component patterns solve this.

**Implementation:**
- `<Slot name="header">` JSX component (`src/slot.ts`) with `preventInstantiation` pattern — creates a marker VNode with `sel: 'slot'`
- Slot VNodes are extracted from children by `extractSlots()` before reaching the child component's view function (`src/core/instance.ts` since PLAN-4.6; `src/component.ts`, the 5.x core, at the time)
- Child components receive `slots` in their view parameters: `{ header: VNode[], footer: VNode[], default: VNode[] }`
- Unnamed children become the `default` slot; `children` parameter continues to work as before (contains only non-slot children, which are also in `slots.default`)
- A `<Slot>` with no `name` prop contributes to the `default` slot
- Multiple children within a single `<Slot>` are collected into one array
- `slots` is always an object (empty `{}` when no children) — no null checks needed
- Fully backward compatible: components that don't use slots see no change in behavior

---

### 9. Forward Refs / Imperative Handle

**Status:** `DONE`

Let a parent invoke actions on a child component — play/pause a video player, reset a form, scroll to a position. Currently achievable via EVENTS but without a direct parent-to-specific-child channel.

**Implementation:**
- `createCommand()` helper (`src/extra/command.ts`) returns `{ send(type, data?) }` — parent calls `send('play', payload)`
- Parent passes the command object as any prop: `<VideoPlayer commands={playerCommands} />`
- Sygnal detects `Command` objects in props (via `__sygnalCommand` marker) and wires a `commands$` source into the child's intent
- Child reads via `commands$.select('play')` — returns a stream that emits the `data` argument, matching the EVENTS `.select()` pattern
- Uses `xs.create()` (not `createWithMemory`) — commands are transient fire-and-forget signals
- Parent can call `send()` imperatively from model reducers with `ABORT` to skip state updates
- `makeCommandSource()` internal helper creates the `commands$` source from a `Command` object

---

## Tier 3 — Lower Priority

### 10. SSR Utilities

**Status:** `DONE`

Render Sygnal components to HTML strings on the server for initial page load performance and SEO. Previously only the Astro integration provided SSR (and it was stubbed out); now standalone SSR works for any server environment.

**Implementation:**
- `renderToString(component, {state, props, context, hydrateState})` in `src/extra/ssr.ts`
- Calls the component's view function with provided (or initial) state, recursively renders sub-components via `sygnalOptions` detection
- Handles all special component types: Portals (rendered inline), Transitions (unwrapped to child), Suspense (renders content not fallback), Slots, Collections, Switchable
- State lensing via `state="propName"` prop resolves child state from parent state
- Context propagation: component `.context` definitions computed from state and merged with parent context
- Error boundaries: `onError` handler produces fallback VNode; without handler, renders `<div data-sygnal-error>`
- HTML serialization: proper escaping, void elements, inline styles (camelCase→kebab-case), selector parsing (tag#id.class), data-* attributes, boolean attributes
- `hydrateState: true` appends `<script>window.__SYGNAL_STATE__=...</script>` for client rehydration; accepts custom variable name
- Astro server integration (`src/astro/server.ts`) updated to use `renderToString` instead of returning empty HTML
- Exported from `src/index.ts`; type declarations in `src/index.d.ts`

---

### 11. Testing Utilities

**Status:** `DONE`

A lightweight test helper for rendering components in isolation and asserting on their outputs. Currently tests use vitest with manual stream setup, which is verbose.

**Implementation:**
- `renderComponent(Component, {initialState, mockConfig, drivers})` exported from `src/extra/testing.ts`
- Returns `{ state$, dom$, events$, sinks, sources, simulateAction, waitForState, states, dispose }`
- Internally creates a minimal Cycle.js runtime with mock DOM, event bus, log, and state drivers
- `simulateAction(actionName, data)` pushes actions into the intent→model pipeline via a test action stream merged into intent; handles plain reducers, object-style entries with STATE/EFFECT sinks, and shorthand model entries
- `waitForState(predicate, timeoutMs?)` returns a promise that resolves when the state matches, or rejects on timeout
- `states` array collects all emitted state values for snapshot assertions
- `dispose()` tears down the component and all listeners

---

### 12. Concurrent Rendering

**Status:** `NOT STARTED`

Break large render trees into chunks scheduled via `requestIdleCallback` to avoid blocking the main thread. Useful for apps with hundreds of components or expensive calculated fields.

**Implementation Plan:**
- Add an optional `concurrent: true` flag to `run()` options
- When enabled, batch VNode diffing across multiple frames using `requestIdleCallback` (with `requestAnimationFrame` fallback)
- Prioritize user-interaction-driven updates (intent→model) over background re-renders
- Keep the default synchronous rendering unchanged — concurrent mode is opt-in
- Measure frame budget and yield when approaching 16ms to maintain 60fps

---

### 13. Scoped Slots

**Status:** `NOT STARTED`

Let a child component pass data back to the parent's slot content — the parent provides a render template, the child fills it with data. Vue's scoped slots and React's render props pattern.

**Implementation Plan:**
- Extend the `<Slot>` system (feature #8) to accept a render function as children: `<Slot name="item">{(data) => <span>{data.label}</span>}</Slot>`
- The child component calls the slot function with its own data when rendering: `slots.item({ label: state.name })`
- Detect function children in the pragma and preserve them as callbacks rather than evaluating them immediately
- Falls back to static children if no function is provided
- Requires Slots (feature #8) to be implemented first

---

## Agent Ergonomics (PLAN-1)

### 14. Diagnostics, Strict Mode and Agent Tooling

**Status:** `DONE`: shipped in **5.4.0** (see [`CHANGELOG.md`](CHANGELOG.md)), with `sygnal-check` 0.1.0 and `create-sygnal-app` 1.1.0. Plan: [`dev-plans/PLAN-1.md`](dev-plans/PLAN-1.md).

Make Sygnal's silent failures loud and give coding agents one unambiguous way to write each concept, measured with an agent eval against React.

**Implementation:**
- Coded diagnostics (`SYGnnn`) with a fix and a docs link for every runtime warning and error; modes `off` / `collect` / `warn` / `error` via `run()`'s `diagnostics` option
- `sygnal/diagnostics` dev entry: wiring, selector/isolation, EVENTS, state-shape, RxJS-operator and Collection checks, plus `inspect()` (a machine-readable app graph); 0 bytes in app bundles
- `sygnal-check` static checker (separate package): the same wiring rules across a project, strict mode (`--strict`, `--fix`), `--graph`, `explain`, and an MCP server
- Canonical forms (object-form model entries, `event()`, `EFFECT`, `ABORT`, `CHILD.select(Comp)`, destructured views) with strict-mode rules SYG501–507; other forms keep working
- Typed links: `ActionsOf`, `IntentSources`, the `SygnalEvents` registry, typed `CHILD.select()`, typed Collection `from`
- `renderComponent()` test helpers: `simulateEvent`, `ready`, `next`, `settle`, `html`, `sinkValues`/`emitted`, `expectNoDiagnostics`, `inspect`
- Vite plugin: dev-only diagnostics injection, `sygnal-check` in the dev server, Vitest setup, Vike/Astro dev mode, Vite 7 and 8 JSX
- Framework fixes found along the way: per-action state snapshots for non-STATE sinks, fully controlled inputs, `driverFromAsync` `errors()`, Collection reorders and nested disposal, stale text and className patches
- Agent context: `llms.txt`, the `sygnal-dev` skill, and the docs (error reference, diagnostics, strict mode, agents)
- Eval harness (`evals/agent-ergonomics`): Sygnal vs React tasks with hidden acceptance tests. Re-run after the changes: the gap to React fell from 46 s to 16 s per trial (standard tasks) and from 29 s to 15 s (harder tasks), with every trial passing ([report](evals/agent-ergonomics/results/REPORT.md))
- Release: `run()` works under plain Node CommonJS and native ESM (tested with a full app in jsdom), and `create-sygnal-app` templates depend on `sygnal` ^5.4.0 and `sygnal-check`

**Follow-ups:** the open PLAN-1 items were taken up by PLAN-2 (below).

---

## Agent Ergonomics, Round 2 (PLAN-2)

### 15. HTTP, Testing and the PLAN-1 Backlog

**Status:** `DONE` (pending release): merged on the integration branch for the next major (6.0.0, in progress), not yet published. The release notes are under `[Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md). Plan: [`dev-plans/PLAN-2.md`](dev-plans/PLAN-2.md).

Close the rest of the Sygnal↔React gap for agents, clear the correctness backlog PLAN-1 left, and run the experiments that decide what to build next.

**Implementation:**
- `makeFetchDriver()`: an opt-in HTTP driver (`HTTP.select(category)` / `HTTP.errors(category)`, `latest: true` aborts superseded requests, per-instance isolation, no requests during SSR); 0 bytes when unused
- `renderComponent()`: scriptable fakes for driverless sinks (`t.respond` / `t.fail` / `t.requests`), fake timers (the waits drive the clock), `dom: 'real'` (real DOM container, real events), `t.state`, tunable timeouts
- Diagnostics: SYG608 (strict mode without the dev entry), SYG609 (sink or source with no driver under `run()`); `run()`'s `diagnostics: { strict: true }`
- Framework fixes from the evals and the PLAN-1 tracker: Switchable, calculated fields, Collection props (`filter`/`sort` changes in child components), Vike shell state, controlled-field null semantics, removed props
- `sygnal/vite` aliases the `globalthis` polyfill to the native global (apps about 4 KB gzipped smaller); size gate `node scripts/size-gate.mjs`
- Agent context: a leaner `sygnal-dev` skill (the unused `references/component-patterns.md` folded into `SKILL.md`), `llms.txt` covering the new APIs
- Eval harness: variants, task-matched comparisons, a third task tier, usage-limit resilience

---

## Next Major

### 16. Network Layer (HTTP + WebSocket)

**Status:** `IN PROGRESS` for 6.0.0 ([PLAN-3](dev-plans/PLAN-3.md), tracker [PLAN-3-status](dev-plans/PLAN-3-status.md))

Done on `plan3-integration`: reply actions (`ok`/`error`) for `makeFetchDriver` and `driverFromAsync`; `makeSocketDriver` (WebSocket + SSE) with the `connections` static; async EFFECT hardening; test fakes for routed requests and sockets (`t.respond`/`t.fail` by content, `t.push`/`t.drop`/`t.sent`/`t.connections`); checker rules SYG112/SYG508/SYG610/SYG611; `HYDRATE` and the legacy `@cycle/http` hydration removed. Also done: the agent docs, `resources` (advanced form, D92), `queryCache()` with SSR seeding, the router, the HEAD driver, and the final eval ([REPORT-v3](evals/agent-ergonomics/results/REPORT-v3.md)). Open: the report's recommendations (G-184…G-188). Server functions: docs for Telefunc via routed `driverFromAsync`; a native `serverFn` is deferred.

`makeFetchDriver()` moved every agent-written side effect out of components in the PLAN-2 evals (20/20 trials used the driver; 0 hand-rolled request ids, against 15/15 before), but it covers HTTP only and is one driver among several hand-written ones. Rethink network calls as a first-class network layer for the next major version, covering HTTP and WebSocket with one model.

**Approach (to be designed):**
- One request/response and subscription model for HTTP and WebSocket (connect, send, message, reconnect, close), isolated per component instance like `makeFetchDriver()`, with `latest`/abort semantics carried over
- Test fakes in `renderComponent()` that script both (respond/fail for requests; push messages and close events for sockets), matching requests by content, not identity
- Open questions from the E2 prototype: whether components can declare the drivers they need (so `run()` and tests need no wiring), a clearer error when a test omits a driver, SSR and hydration of in-flight requests, and cleanup on disposal
- Inputs: the E2/E3 results in [`evals/agent-ergonomics/results/PHASE3-RESULTS.md`](evals/agent-ergonomics/results/PHASE3-RESULTS.md) and the N-1 row in [`dev-plans/PLAN-2-status.md`](dev-plans/PLAN-2-status.md)

---

### 17. Controls and Core Ergonomics (PLAN-4)

**Status:** `IN PROGRESS` for 6.0.0 ([PLAN-4](dev-plans/PLAN-4.md), tracker [PLAN-4-status](dev-plans/PLAN-4-status.md)). Phases 1–3 are merged on `plan4-integration`; the docs, agent context and final eval (Phase 4) are next. The release notes are under `[Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).

Close the everyday gaps that the gap study found between Sygnal and React/Vue apps: the ones agents and people hit in forms, dialogs, lists, persistence and debugging. Every feature had a size spike first; helpers that an app doesn't import cost 0 bytes, and PLAN-4 adds about 0.8 KB gzipped to the core.

**What 6.0 gains:**
- `controls()`: views and intents linked by identifier (`DOM.click(Add)`, `<Add>`), accepted wherever a selector is, with SYG124–126/128 and `sygnal-check --fix --controls`. They ship as an [alternative form](docs/src/content/docs/advanced/alternative-forms.md) with their own guide page (`guide/controls`); class selectors stay canonical, with no strict rule against them (P4-D, D141)
- Behaviors: `defineBehavior()` and the `uses` static, with first-party `pager`, `selection` and `undo` (plus `undoable()` for a whole model)
- Element commands: the built-in `ELEMENT` sink (`focus`, `<dialog>` and popover methods, `scrollIntoView`, any element method), resolved in the sender's own view after the next patch
- `persist()` for the root's state (versions and `migrate`, cross-tab `sync`, automatic restore after hydration), `STATE.watch()`, and declarative `timers` with `makeTimerDriver()`
- `uid()` (stable, SSR-safe ids), `run(…, { onError })` (one app-level error hook, also for Vike, Astro, `renderToString` and tests), View Transitions (`viewTransitions` static + `makeViewTransitionDOMDriver()`), and `sygnal/element` (`defineElement`, a component as a custom element; `run()` is now scoped to its app so several apps share a page)
- Debugging and tests: `t.actions` / `t.explain`, `t.commands` / `t.timers` / `t.storage`, `inspect({ actions })`, and in DevTools an action log, "Copy as test" and a Redux DevTools bridge
- `sygnal-check`: an accessibility lane (SYG701–708, warnings also under `--strict`; `--a11y=error` opts in to errors, D144), and resolution of controls, behaviors, timers, element commands and persist
- Breaking: a STATE reducer returning the object it received means "no change" (SYG502 retired, SYG222 for in-place mutation); `uid` and the new statics are reserved
- Fixes and speed: dialog/popover/media events reach intent, a card moved between Collections is never painted missing, Collection edit and swap about twice as fast (O(1) item lookups), and a performance baseline against React and Vue (`benchmarks/RESULTS.md`)

**Deferred past 6.0:**
- GS-15 live dev-server context for agents (`/__sygnal/inspect` and an MCP tool): no code in 6.0 (D132). The design note, with a cost estimate and an eval design (about $44), is in `dev-plans/research/p4-dev-context.md` for a 6.x minor
- `persist()` on Vike pages (SYG224 says so in 6.0)
- Drivers for Astro islands (G-229), so that `timers`, `connections` and `resources` can run in an island; possibly a `drivers` integration option like `onError`
- View Transitions form A (the transition hook in the core instead of an opt-in DOM driver): at least +139 B over the shipped form, beyond the agreed limit (D129, D137); kept on `exp/p4-vt-slim`
- Elm-style `lazy` view memoization (about 250–400 B), which the performance record didn't propose; slice-equality skipping beyond the O(1) lookups also waits for a measured need
- `t.screen` / `t.user` Testing Library getters: built only if the 4-E A/B shows less test-authoring time; until then the docs stand alone
- A runtime a11y pass for dynamic markup, and async storage adapters for `persist()`

**Controls outcome (1-E, P4-D):** the A/B eval (12 tasks × 5 trials, selectors vs controls) met two of its four bars. Opus passed every task either way, but its wall time rose 1.06× (bar: at most +5%); Haiku's pass rate fell from 91.7% to 73.3% (bar: not lower), mostly because it read a control's name as the button's label (`<Pin>📌</Pin>`, dropping the visible text) and imported one component's controls into a sibling. Learn time (+0.6 s Opus, −1.7 s Haiku) and wiring failures (0% both) met theirs. With mixed results, controls are an alternative form in 6.0 (D141): fully supported and documented, not canonical, and no migration of examples or templates.

**Open:** the 4-E final eval and REPORT-v4 <!-- TODO(4-E): link REPORT-v4 and the measured impact. -->. Components and integrations (widgets, browser sources, the "Web components" guide) follow in PLAN-5.

---

### 18. Ecosystem Components and Integrations (PLAN-5)

**Status:** `IN PROGRESS` for 6.0.0 ([PLAN-5](dev-plans/PLAN-5.md), tracker [PLAN-5-status](dev-plans/PLAN-5-status.md)). Phase 0 (baseline and spikes) runs on `plan5-integration`, on the PLAN-4.6 core (`src/core/`). Every feature attaches through the core's hooks and registries and is designed to add 0 B to an app that doesn't use it; the core has 904 B of the size gate left.

Ready-made answers to what other frameworks solve with their most-used libraries: native features where Sygnal can own the problem, and one integration primitive for framework-agnostic libraries, web components and (opt-in) React/Preact/Vue components. Foreign widgets report through DOM events on their host element, which `intent` reads; views still bind no events.

| Item | What | Priority |
|---|---|---|
| W-1 | `defineWidget`: a foreign widget as a tag rendered and selected canonically (`<DatePicker className="due" value={…} />`, `DOM.select('.due').events('change').detail()`), that also works as a control (D189); element commands through the host; `onError` phase `'widget'` | P1 |
| W-2 | Adapters on `defineWidget` (separate entries): `fromZag`, `sygnal/react` (+ the `preact/compat` alias), `sygnal/vue` on demand | P2 |
| W-3 | Web components first-class: a "Web components" guide (using, and publishing with `defineElement`), `JSX.IntrinsicElements` augmentation, the `.detail()` stream enricher, custom-element events in `sygnal-check` | P1 |
| F-1 | Forms with validation as a behavior (`uses = { form: form(schema, …) }`): field state, any Standard Schema validator, focus the first invalid field, `uid`-linked errors, async and server errors; A/B against helpers over `processForm` | P1 |
| T-1 | Toasts: `EVENTS: event('TOAST', …)` rendered by a `<Toaster>` in a live region, auto-dismiss through `timers` | P2 |
| A-1 | Collection move transitions: a per-item `view-transition-name` on the View Transitions driver, FLIP only as a fallback | P2 |
| V-1 | `<VirtualCollection>` on `@tanstack/virtual-core`, with `scrollToIndex` through `createCommand()` | P2 |
| B-1 | Drag and drop with pointer, touch and keyboard support; `sortable` as a behavior or a driver helper | P3 |
| B-2 | i18n recipe (i18next, `.context`, a locale driver, `persist` for the locale) | P3 |
| B-3 | Browser sources pack (intersection, resize, media query, storage, visibility, online, clipboard, geolocation) in the `timers` declaration shape, with test fakes | P2 |
| B-4 | Deferred loading triggers: `lazy(…, { when: 'visible' \| 'idle' })` | P3 |
| U-1 | `sygnal-ui`, a separate headless package: native Dialog, Popover, Tooltip; Tabs, Accordion, Disclosure as behaviors; Menu, Select, Combobox on `fromZag`; the Toaster | P2 |

Also docs-only recipes (Chart.js/ECharts, Tiptap, CodeMirror first; Embla, Floating UI, AutoAnimate, TanStack Table, AG Grid, icons later) and a final eval with new tasks 30–34 against React with its usual libraries.
