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
- No changes to `component.ts` rendering pipeline needed — the wrapper is a normal component function
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

**Status:** `NOT STARTED`

Pass multiple named content regions from parent to child — headers, footers, sidebars, actions — rather than a single flat `children` array. Vue's named slots and React's compound component patterns solve this.

**Implementation Plan:**
- Define a `<Slot name="header">` JSX component that marks children for named placement
- In the parent's JSX, wrap content in `<Slot>` tags: `<Card><Slot name="header"><h1>Title</h1></Slot></Card>`
- The child component receives slots via the `peers` parameter (4th argument to the view function), already partially supported by Sygnal's peer system
- Extend the pragma to extract `<Slot>` children and pass them as a `slots` object: `{ header: VNode[], default: VNode[] }`
- Unnamed children become the `default` slot

---

### 9. Forward Refs / Imperative Handle

**Status:** `NOT STARTED`

Let a parent invoke actions on a child component — play/pause a video player, reset a form, scroll to a position. Currently achievable via EVENTS but without a direct parent-to-specific-child channel.

**Implementation Plan:**
- Formalize a `COMMAND` pattern: parent emits a command stream as a prop, child subscribes to it in intent
- Export a `createCommand<T>()` helper that returns `{ send: (value: T) => void, stream: Stream<T> }` — parent calls `send()`, child reads `stream`
- The parent passes the command object as a prop: `<VideoPlayer commands={playerCommands} />`
- The child maps `props.commands.stream` to actions in intent: `{ PLAY: props.commands.stream.filter(c => c === 'play') }`
- This stays declarative — the parent declares *what* to command, the child declares *how* to handle it

---

## Tier 3 — Lower Priority

### 10. SSR Utilities

**Status:** `NOT STARTED`

Render Sygnal components to HTML strings on the server for initial page load performance and SEO. Currently Astro integration handles SSR for Astro projects, but standalone SSR (Next.js-style) isn't supported.

**Implementation Plan:**
- Create `renderToString(component, {state, props})` in `src/extra/ssr.ts` using snabbdom's VNode serialization
- Run the component's view function with the provided state to produce a VNode tree, then serialize to HTML
- Handle sub-components recursively — instantiate each child component's view with its scoped state
- Skip intent/model processing (SSR is render-only); include serialized state as `<script>` for client hydration
- Integrate with the existing `HYDRATE` action for client-side rehydration

---

### 11. Testing Utilities

**Status:** `NOT STARTED`

A lightweight test helper for rendering components in isolation and asserting on their outputs. Currently tests use vitest with manual stream setup, which is verbose.

**Implementation Plan:**
- Export `renderComponent(Component, {initialState, props, drivers})` from `src/extra/testing.ts`
- Returns `{ state$, dom$, events$, sinks, dispose }` — streams of component outputs that tests can subscribe to
- Internally creates a minimal Cycle.js runtime with mock DOM and state drivers
- Add `simulateAction(actionName, data)` helper to push values into the intent→model pipeline
- Provide `waitForState(predicate)` and `waitForDom(predicate)` async helpers for assertion timing

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
