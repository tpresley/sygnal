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

On 2026-10-02 this plan handed the following to the PLAN-3 session ([handoff note](HANDOFF-to-PLAN-3.md)). The user approved the handoff with changes as **D74–D82**, recorded on `plan3-integration` in `PLAN-3.md` (§1.4, §1.6, §1.7, Phase 5) and in `PLAN-3-status.md` under "Handoff items from PLAN-4". All of it is now PLAN-3 scope for 6.0.0.

| Item | PLAN-3 outcome |
|---|---|
| `resources` ships in 6.0.0 (H-0a) | Accepted (D74). The final eval only decides canonical vs advanced form. |
| Query cache: shared cache, dedupe, refetch on focus/reconnect (H-2, H-3, H-6) | **Opt-in**: `makeFetchDriver({ cache: true \| { staleTime, gcTime, refetchOnFocus, refetchOnReconnect } })`; `refetchEvery` per resource, opt-in (D79) |
| Keep data while reloading (H-1) | Changed (D78): a same-request refetch keeps `data` with `refreshing: true`; a **key change clears `data`** unless `keepPrevious: true` |
| Invalidation, retries, SSR seeding, `validate` (H-4, H-5, H-7, H-8) | Explicit tags or URL-prefix strings; retries default 0; SSR seeding and `{ prefetch }` accepted; Standard Schema `validate` in its own module (D80) |
| HTTP fake runs the real driver (H-9); recipes (H-10); inspect (H-11) | Accepted; `t.cache()` + inspect data, devtools panel a stretch item (D80) |
| **Router** (R-1…R-9, R-11) | Taken, R-2 option (a): the root declares the action that writes the route into state (D81) |
| `HEAD` driver (X-1) | Taken (D81). **K-1 is dropped from this plan.** |
| Naming (R-10) | Done first (D82). The `ok`/`error` continuations are **"reply actions"**, `src/extra/routing.ts` → `replies.ts`, the inspect trigger is `'reply'`. "Route" means the router only. |
| DevTools out of production builds (D77) | `sygnal/vite` injects them in dev only, which frees about 2.3 KB of core as a **shared reserve** |

**Terminology for every PLAN-4 doc, test and diagnostic:** say "reply actions" for `ok`/`error` continuations (never "routed requests"), and keep "route"/"routing" for the router.

**What PLAN-4 gets from PLAN-3:**

| Dependency | Status | Used by |
|---|---|---|
| Generic `__sygnalStatic` declaration mechanism | Lands with `resources` (PLAN-3 5-2a) | B-3 |
| `src/extra/standardSchema.ts` | Will exist (H-8) | F-1 |
| Focus/online/visibility listener module | Internal module; its name is recorded in the PLAN-3 tracker when it lands | B-3 |
| Docs layout | `guide/http`, `guide/sockets`, `guide/custom-drivers`, `integration/server-functions`; router, cache and HEAD pages coming (final names in the PLAN-3 tracker) | §1.4, Phase 4 |

**Budgets for PLAN-4 (D76):**

| Budget | Cap | PLAN-3 uses | Left for PLAN-4 |
|---|---|---|---|
| Core size gate (kanban, gated) | 42,300 B | recorded at the end of PLAN-3 Phase 5 | design everything at **0 B**; the D77 reserve is shared, so ask before using it |
| `llms.txt` | 300 lines | ≤ 285 | **≥ 15 lines** |
| `skills/sygnal-dev/SKILL.md` | 36 KB | ≤ 35 KB | **≥ 1 KB** |
| Agent cost | final eval vs `p3-final` | the bigger docs already cost +6% tokens and +1.8k peak context per trial | learn time or peak context more than ~10% worse → trim before release |

**The budgets leave room for only a few `llms.txt` lines.** Agent-facing text for PLAN-4 is ranked in §2's docs rules: only F-1 and W-1 (with W-3's `.detail()`) get `llms.txt` lines. Everything else is guide pages linked from one line.

**PLAN-3 runs the final 4-C eval once, after its Phase 5.** PLAN-4 still starts after PLAN-3 is complete and has its own eval in Phase 4.

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
| **F-1** | **Forms with validation.** Field state in the state tree (value, touched, dirty, error per field; form-level submitting/submitted); any Standard Schema validator (zod 365M/wk, valibot 24.5M, yup 14.4M, arktype) via PLAN-3's `src/extra/standardSchema.ts` (the same helper behind the fetch driver's `validate`), with no validator dependency. | Validate on input/blur/submit; field arrays; async validation through a reply action (`HTTP: { …, ok, error }`); server errors mapped onto fields. Must build on `processForm` and controlled inputs (SYG111) rather than add a second model. Benchmarked against react-hook-form (68.4M/wk) and TanStack Form. Includes test helpers and diagnostics (a field name the form doesn't have). | P1 |
| **T-1** | **Toasts.** `EVENTS: event('TOAST', { text, kind, timeoutMs })` from anywhere, rendered by `<Toaster>` (Portal + Transition + Collection), with an ARIA live region. | Small. sonner (61.6M/wk) is the target feel. | P2 |
| **A-1** | **FLIP list transitions for Collection** (moves, like Vue's TransitionGroup), extending `<Transition>`. | Plus auto-animate (3.1 KB) and Motion `animate()` recipes via `ref`. | P2 |
| **V-1** | **`<VirtualCollection>`** on `@tanstack/virtual-core` (7.1 KB; its Lit adapter is 89 lines). | Same `of`/`from`/`filter`/`sort` props as Collection. Needs scroll-element access (W-1 hooks or `ref`). Browser-tested; jsdom has no layout. | P2 |
| **B-3** | **Browser sources pack**: intersection, resize, media query, storage, visibility, online, clipboard, geolocation as streams/drivers with test fakes. This is Sygnal's VueUse (14.0M/wk). | Built on PLAN-3's `__sygnalStatic` (declare what to observe from state) and its listener module. | P2 |
| **B-1** | **Drag and drop:** pointer, touch and keyboard support plus a sortable helper for `makeDragDriver`, which today uses HTML5 DnD only. | Option: adopt `@dnd-kit/dom` behind the driver if it reaches 1.0 by then (0.5 today). | P3 |
| **B-2** | **i18n:** a recipe (i18next instance, `.context` for `t()`, a locale driver), plus a helper if the recipe is clumsy. | | P3 |

### 1.3 Headless UI package

**U-1 `sygnal-ui`** (P4-Q2: a separate npm package or a `sygnal/ui` entry) (P2)

- **Zag-backed (W-2), where accessibility behaviour is the hard part:** Dialog, Popover, Menu, Tooltip, Select, Combobox.
- **Native MVI, to save weight:** Tabs, Accordion, Disclosure, and Toast (T-1).
- **Unstyled:** class hooks plus documented data attributes, so the components work with Tailwind and with the web-component themes.
- Every component ships a test example, strict-clean code and a guide page. Agent context follows §2's docs rules (no per-component `llms.txt` lines). Benchmarked against Radix (88.1M/wk for `react-dialog`) and Base UI (18.4M).

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
| **3: Remaining items** | B-1, B-2, §1.4 recipes | |
| **4: Docs, agent context, measure** | Agent sync, eval, report | `llms.txt`/SKILL sync within the D76 budget (§2's docs rules). One eval, which also checks learn time and peak context against PLAN-3's final 4-C run (more than ~10% worse → trim before release): new tasks for a form with validation, a modal/menu flow, a chart widget and a long list, with the React arm on react-hook-form + zod, Radix/shadcn, Chart.js and TanStack Virtual. Then a report. |

**ROADMAP:** add entries for PLAN-4 after PLAN-3 merges. PLAN-3 is editing ROADMAP §16, so editing it now would conflict.

### Docs rules (agent context)

The D76 budget is ≥ 15 `llms.txt` lines and ≥ 1 KB of SKILL.md. PLAN-3's checkpoint showed that every addition costs tokens and context per agent trial.

| Rank | Feature | Agent context |
|---|---|---|
| 1 | F-1 forms | A short canonical recipe in `llms.txt` (≈ 8 lines) and SKILL.md |
| 2 | W-1 `defineWidget` + W-3 `.detail()` | A recipe of ≈ 5 lines; one fact line for web components (properties, `attrs`, custom events) |
| 3 | Everything else (U-1, T-1, A-1, V-1, B-1…B-3, adapters, recipes) | Guide pages only, reached from one `llms.txt` line that lists them |

Words: "reply actions" for `ok`/`error` continuations, "route" only for the router (D82).

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
| P4-Q1 | `Widget` form | Function/vnode form if it reads well in JSX (0 B core); the `<Widget>` marker component only if the pipeline needs it, paid from the shared D77 reserve with the user's approval. Decide with measured bytes. |
| P4-Q2 | `sygnal-ui` packaging | A separate package (`sygnal-ui`), like `sygnal-check`. It keeps Zag out of `sygnal`'s dependencies and lets it version independently, though it ships with 6.0.0. |
| P4-Q3 | Foreign-framework adapters in 6.0 | `fromZag` (needed by U-1) and `sygnal/react` with the preact/compat alias documented. `sygnal/vue` only on demand. |
| P4-Q4 | Icons | Docs for Lucide vanilla; no package unless the eval shows agents struggle. |
| P4-Q5 | Forms API shape | Prototype two shapes (a form-level static like `connections`, or helpers over `processForm`) and A/B them in the eval, as PLAN-3 did for `resources`. |
| P4-Q6 | `llms.txt` budget | **Resolved (D76):** ≥ 15 lines of `llms.txt` and ≥ 1 KB of SKILL.md; see §0. |

## 5. Risks

| Risk | Mitigation |
|---|---|
| Agent-doc budget too small for the scope (15 `llms.txt` lines, 1 KB of skill) | §2's docs rules: two features get `llms.txt` lines, the rest is guide pages; the Phase 4 eval measures learn time and peak context. If forms or Widget need more, trim elsewhere or ask the user for more budget, with eval numbers. |
| Core bytes | Everything is designed for 0 core bytes; the D77 reserve (~2.3 KB) is shared with PLAN-3 and used only with the user's approval. |
| Zag's bundle weight (18–48 KB) surprises users | Native Tabs, Accordion and Toast; per-component imports; sizes documented per component. |
| Adapters invite misuse ("just wrap the React lib") | The docs lead with native and web-component answers; adapters are documented as an escape hatch with their limits. |
| Zag vanilla 2.0 changes API (2.0.0-next in progress) | Pin a version; `fromZag` isolates the API surface. |
| TanStack Table v9 API change | Recipe written against v9. |
