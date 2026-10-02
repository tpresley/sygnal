# PLAN-4: Ecosystem components and integrations for 6.0.0

**Goal:** give Sygnal ready-made answers to the problems other frameworks solve with their most-used libraries, so users don't rebuild them. Part of the answer is native Sygnal features. The rest is one integration primitive that brings in framework-agnostic libraries, web components and, as an opt-in escape hatch, React/Preact/Vue components.

**Release:** 6.0.0, together with PLAN-3 (network layer). One major release, not a 6.x sequence.

**Status:** plan only. **Execution starts after PLAN-3 is complete** and its work is merged. A tracker, `dev-plans/PLAN-4-status.md`, is created in Phase 0 in the PLAN-2/PLAN-3 format.

**Inputs:**
- Research report: https://claude.ai/artifact/3BYaNEUmLK5Z9w25cEHiXD (npm downloads for 2026-09-24…30, a category-by-category assessment, six experiments).
- Experiments: [`research/ecosystem-experiments/`](research/ecosystem-experiments/) (Vitest + jsdom, `npm i && npm test`, 6/6 passing on 5.4.0):

  | # | Experiment | File | Adapter size |
  |---|---|---|---|
  | E1 | web components | `e1-webcomponents.test.jsx` | none |
  | E2 | React island | `island.js`, `reactAdapter.js` | about 35 lines |
  | E3 | Zag.js dialog | `zag.js` | about 45 lines |
  | E4 | TanStack table-core v8 | `e4-table.test.jsx` | none |
  | E5 | query-core driver | `queryDriver.js` | reference for PLAN-3 |
  | E6 | preact/compat island | `e6-preact-compat.test.jsx` | |

- Handoff to PLAN-3: [`HANDOFF-to-PLAN-3.md`](HANDOFF-to-PLAN-3.md).

MVI stays intact, as in PLAN-1…3. Models return descriptions of effects, drivers perform them, every state change is an action, and **views have no event binding**. Foreign widgets report through DOM events on their host element, which `intent` reads.

---

## 0. Handed over to PLAN-3 (not in this plan)

On 2026-10-02 this plan gave the following to the PLAN-3 session. Details and rationale are in the handoff note.

| Item | Was in the research report as | Now |
|---|---|---|
| Query cache: shared cache, `staleTime`, dedupe, invalidation, retries, refetch on focus, reconnect or interval, SSR cache seeding, response validation, devtools | "Fold a query cache into the network layer" (P2) | PLAN-3 H-1…H-11 |
| `resources` "keep data while reloading" | (found in the PLAN-3 review) | PLAN-3 H-1 |
| **Router** (SPA routing, links, guards, route data, Vike interplay) | "Router (native)" (P1) | PLAN-3 §3 (R-1…R-11) |
| `HEAD` driver (title/meta) | P3 | **Offered** to PLAN-3 (X-1). If PLAN-3 declines, it comes back here as K-1 |
| Network recipes (optimistic updates, pagination, infinite lists) | (implied by the query cache) | PLAN-3 H-10 |

**PLAN-4 depends on these PLAN-3 outputs** (asked for in handoff §5):
- the generic `__sygnalStatic` declaration mechanism (B-3);
- a Standard Schema helper module (F-1);
- the focus/online/visibility listener module (B-3);
- the remaining core-size and `llms.txt` budgets.

If one of them doesn't land, the workstream that needs it builds it itself.

## 1. Scope

### 1.1 Foundation: integration primitive

**W-1 `Widget` / `defineWidget`** (core, tree-shaken: 0 B when unused) (P1)

```jsx
const DatePicker = defineWidget({
  mount(el, props, emit) { const fp = flatpickr(el, { ...props, onChange: (d) => emit('change', d[0]) }); return fp },
  update(fp, props)      { fp.setDate(props.value, false) },
  unmount(fp)            { fp.destroy() },
  events: ['change'],
})
// view:   <Widget of={DatePicker} className="due" value={state.due} />
// intent: DUE: DOM.select('.due').events('change').detail()
```

- **The host is opaque to snabbdom.** The vnode has no children, and the host keeps its widget instance across re-renders and key moves. `update` gets the newest props in every hook; E3's stale-closure bug must be impossible by construction.
- **Sygnal builds the vnode.** E2 found that a hand-built vnode without `children`/`text`/`elm` keys is silently dropped.
- **`emit(name, detail)` dispatches a bubbling `CustomEvent` on the host.** Declared `events` let sygnal-check and the runtime know the names (SYG110 stays quiet, and an undeclared emit is diagnosed).
- **Errors:** a `mount`/`update` that throws goes through the component's `onError` boundary.
- **Tests:**
  - under the mock DOM, `t.widget(sel).props` shows the latest props and `t.widget(sel).emit(name, detail)` fakes output;
  - under `dom: 'real'`, the widget actually mounts.
- **SSR:** render the host (with an optional `fallback`) and mount on the client.
- **Open design question (P4-Q1):** a `<Widget>` marker component processed in the pipeline (like Portal; costs core bytes), or a function returning a hooked vnode (like the E2 `island()`; 0 B). Prefer the 0 B form if JSX ergonomics allow it.

**W-2 Adapters on `defineWidget`** (separate entries, opt-in) (P2)

| Adapter | Shape | Cost (gzip) |
|---|---|---|
| `fromZag(machine, render)` | Generalise E3. It needs a snabbdom normaliser for Zag props (`{ attrs, on, props, style }`) and a private patch. It is the base for U-1. | Zag dialog 18.5 KB; dialog + menu + select + tooltip 47.6 KB |
| `sygnal/react` `fromReact(Comp, { events })` | | React 19 + react-dom 69 KB |
| documented `preact/compat` alias path | Same adapter with a bundler alias (E6). | 9.8 KB |
| `sygnal/vue` `fromVue(Comp)` | Only if the user wants it in 6.0 (P4-Q3). | Vue runtime 24.7 KB |

- **Docs say plainly:** for the one component you can't replace. Context and providers don't cross the boundary; portals escape the host; the default mock DOM can't run them in tests.

**W-3 Web components as a first-class path** (P1)

- A "Using web components" guide with a Web Awesome recipe: properties vs `attrs={{}}` (E1), custom events crossing shadow DOM, forms with form-associated elements, and SSR caveats.
- **Types:** `JSX.IntrinsicElements` augmentation for custom elements, with a documented pattern to type a library's tags.
- **`.detail(fn?)` stream enricher**, next to `.value()`, `.checked()` and `.data()`.
- **sygnal-check:** custom-element events are valid event names; check that SYG115 and SYG110 don't flag `DOM.select('wa-input').events('wa-change')`.
- Verify Web Awesome itself in `browser-tests`. E1 used a jsdom stand-in.

### 1.2 Native features

| # | Feature | Notes | Priority |
|---|---|---|---|
| **F-1** | **Forms with validation.** Field state in the state tree (value, touched, dirty, error per field; form-level submitting/submitted); any Standard Schema validator (zod 365M/wk, valibot 24.5M, yup 14.4M, arktype) via PLAN-3's helper, with no validator dependency. | Validate on input/blur/submit; field arrays; async validation through a routed request; server errors mapped onto fields. Must build on `processForm` and controlled inputs (SYG111) rather than add a second model. Benchmarked against react-hook-form (68.4M/wk) and TanStack Form. Includes test helpers and diagnostics (a field name the form doesn't have). | P1 |
| **T-1** | **Toasts.** `EVENTS: event('TOAST', { text, kind, timeoutMs })` from anywhere, rendered by `<Toaster>` (Portal + Transition + Collection), with an ARIA live region. | Small. sonner (61.6M/wk) is the target feel. | P2 |
| **A-1** | **FLIP list transitions for Collection** (moves, like Vue's TransitionGroup), extending `<Transition>`. | Plus auto-animate (3.1 KB) and Motion `animate()` recipes via `ref`. | P2 |
| **V-1** | **`<VirtualCollection>`** on `@tanstack/virtual-core` (7.1 KB; its Lit adapter is 89 lines). | Same `of`/`from`/`filter`/`sort` props as Collection. Needs scroll-element access (W-1 hooks or `ref`). Browser-tested; jsdom has no layout. | P2 |
| **B-3** | **Browser sources pack**: intersection, resize, media query, storage, visibility, online, clipboard, geolocation as streams/drivers with test fakes. This is Sygnal's VueUse (14.0M/wk). | Built on PLAN-3's `__sygnalStatic` (declare what to observe from state) and its listener module. | P2 |
| **B-1** | **Drag and drop:** pointer, touch and keyboard support plus a sortable helper for `makeDragDriver`, which today uses HTML5 DnD only. | Option: adopt `@dnd-kit/dom` behind the driver if it reaches 1.0 by then (0.5 today). | P3 |
| **B-2** | **i18n:** a recipe (i18next instance, `.context` for `t()`, a locale driver), plus a helper if the recipe is clumsy. | | P3 |
| **K-1** | **`HEAD` driver**, only if PLAN-3 declines X-1. | | P3 |

### 1.3 Headless UI package

**U-1 `sygnal-ui`** (P4-Q2: a separate npm package or a `sygnal/ui` entry) (P2)

- **Zag-backed (W-2), where accessibility behaviour is the hard part:** Dialog, Popover, Menu, Tooltip, Select, Combobox.
- **Native MVI, to save weight:** Tabs, Accordion, Disclosure, and Toast (T-1).
- **Unstyled:** class hooks plus documented data attributes, so the components work with Tailwind and with the web-component themes.
- Every component ships a test example, strict-clean code and `llms.txt`/skill coverage. Benchmarked against Radix (88.1M/wk for `react-dialog`) and Base UI (18.4M).

### 1.4 Docs-only recipes

(P1 for the first three; P3 for the rest)

| Recipe | Built on |
|---|---|
| Chart.js / ECharts | W-1 |
| Tiptap | W-1 |
| CodeMirror | W-1 |
| Embla carousel | W-1 |
| Floating UI | `ref` |
| AutoAnimate | `ref` |
| TanStack Table | in-view, E4; **re-checked against v9's new API**, current is 9.2.4 |
| AG Grid | W-1 |
| Icons | Lucide vanilla or a small JSX icon set (P4-Q4) |

### 1.5 Not doing

| Item | Reason |
|---|---|
| State libraries (zustand, redux, pinia, jotai) | The state tree, context and EVENTS cover them. |
| XState | Zag covers the UI use. |
| Utility-hook ports | B-3 covers them. |
| Wrapping MUI, antd or other component *systems* | Provider-heavy; poor fit across the adapter boundary. Web components are the themed-library answer. |

## 2. Phases

| Phase | Work | Detail |
|---|---|---|
| **0: Setup** (coordinator) | Rebase and baseline | Rebase this branch onto the completed `plan3-integration`. Re-measure the size gate and `llms.txt` budget. Create the tracker. Answer P4-Q1…Q6. Re-run the experiments against the 6.0 build. |
| **1: Foundation** | W-1 → W-3 | Docs, types, enricher, checker. |
| | F-1 | In parallel with W-1. |
| **2: Components** (parallel where files don't overlap) | W-2 (`fromZag` first) → U-1 | |
| | T-1, A-1, V-1, B-3 | |
| **3: Remaining items** | B-1, B-2, K-1 (if needed), §1.4 recipes | |
| **4: Docs, agent context, measure** | Agent sync, eval, report | `llms.txt`/SKILL sync within the agreed budget. One eval: new tasks for a form with validation, a modal/menu flow, a chart widget and a long list, with the React arm on react-hook-form + zod, Radix/shadcn, Chart.js and TanStack Virtual. Then a report. |

**ROADMAP:** add entries for PLAN-4 after PLAN-3 merges. PLAN-3 is editing ROADMAP §16, so editing it now would conflict.

## 3. Gates

The PLAN-3 gates on every merge:
- `npm run build:all`, `npm test`, `npm --prefix sygnal-check test`;
- doc samples, error docs `--check`, docs build;
- size gate, `llms.txt` limit.

Added by PLAN-4:
- browser tests for W-1 with a real third-party widget, a real Web Awesome element, V-1 scrolling and U-1 keyboard/focus behaviour;
- a tree-shaking test that unused W-1, W-2, U-1 and V-1 add 0 B to kanban.

## 4. Decisions needed before Phase 1 (recommendations first)

| # | Question | Recommendation |
|---|---|---|
| P4-Q1 | `Widget` form | Function/vnode form if it reads well in JSX (0 B core); the `<Widget>` marker component only if the pipeline needs it. Decide with measured bytes. |
| P4-Q2 | `sygnal-ui` packaging | A separate package (`sygnal-ui`), like `sygnal-check`. It keeps Zag out of `sygnal`'s dependencies and lets it version independently, though it ships with 6.0.0. |
| P4-Q3 | Foreign-framework adapters in 6.0 | `fromZag` (needed by U-1) and `sygnal/react` with the preact/compat alias documented. `sygnal/vue` only on demand. |
| P4-Q4 | Icons | Docs for Lucide vanilla; no package unless the eval shows agents struggle. |
| P4-Q5 | Forms API shape | Prototype two shapes (a form-level static like `connections`, or helpers over `processForm`) and A/B them in the eval, as PLAN-3 did for `resources`. |
| P4-Q6 | `llms.txt` budget | Agree a combined 6.0 budget with PLAN-3 (handoff H-0c). |

## 5. Risks

| Risk | Mitigation |
|---|---|
| PLAN-3 consumes the size and `llms.txt` headroom | Everything here is designed for 0 core bytes; the budget is agreed in Phase 0 (P4-Q6). |
| Zag's bundle weight (18–48 KB) surprises users | Native Tabs, Accordion and Toast; per-component imports; sizes documented per component. |
| Adapters invite misuse ("just wrap the React lib") | The docs lead with native and web-component answers; adapters are documented as an escape hatch with their limits. |
| Zag vanilla 2.0 changes API (2.0.0-next in progress) | Pin a version; `fromZag` isolates the API surface. |
| TanStack Table v9 API change | Recipe written against v9. |
