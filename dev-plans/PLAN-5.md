> **Renamed 2026-10-02:** this plan was drafted as PLAN-4. Plans are now numbered in run order, so it is PLAN-5. PLAN-3 documents written before the rename say "PLAN-4" for this plan.

# PLAN-5: Ecosystem components and integrations for 6.0.0

**Goal:** give Sygnal ready-made answers to the problems other frameworks solve with their most-used libraries, so users don't rebuild them. Part of the answer is native Sygnal features. The rest is one integration primitive that brings in framework-agnostic libraries, web components and, as an opt-in escape hatch, React/Preact/Vue components.

**Release:** 6.0.0, one major release together with PLAN-3 (network layer, router, cache, HEAD) and PLAN-4 (controls and core ergonomics). The release stays held until the user says otherwise (D56).

**Status:** plan only. **Execution starts after PLAN-4 is complete.** Phase 0 rebases this branch onto the completed `plan4-integration`. The tracker, `dev-plans/PLAN-5-status.md`, is created in Phase 0 in the PLAN-3/PLAN-4 format.

**Branches:**
- integration: `plan5-integration`;
- subagent branches: `p5-*`;
- experiments and spikes: `exp/p5-*`.

**IDs:**
- items W-, F-, T-, A-, V-, B-, U- (unchanged by the rename);
- questions P5-Q1…;
- decisions and gaps continue the global D-/G- numbering.

**Inputs:**
- Research report: https://claude.ai/artifact/3BYaNEUmLK5Z9w25cEHiXD (npm downloads for 2026-09-24…30, a category-by-category assessment, six experiments).
- Experiments: [`research/ecosystem-experiments/`](research/ecosystem-experiments/) (E1–E6; see its README).
- Handoff to PLAN-3: [`HANDOFF-to-PLAN-3.md`](HANDOFF-to-PLAN-3.md), accepted with changes as D74–D82.
- PLAN-4, its handoff and its reports, read with `git show claude/sygnal-feature-gaps-c61a02:<path>` until `plan4-integration` exists:
  - `dev-plans/PLAN-4.md` and `dev-plans/HANDOFF-to-PLAN-5.md`;
  - `dev-plans/research/sygnal-6-gap-study.html` and `dev-plans/research/view-intent-linking.html`.

**Invariants:** MVI stays intact, as in PLAN-1…4.
- Models return descriptions of effects, and drivers perform them.
- Every state change is an action.
- **Views have no event binding and never name an action.**
- Foreign widgets report through DOM events on their host element, which `intent` reads.

**Words:**
- "reply actions" for `ok`/`error` continuations (D82);
- "route" only for the router;
- **"control" means a PLAN-4 CT-1 element token** (`controls({ Save: 'button' })`). Write "form field", not "form control".

  With S-1 (§0.3), a control token can name a widget. Docs then say "a control for a widget" or "a widget's control", and "widget" stays the noun for the foreign thing.

---

## 0. Context from the other 6.0 plans

### 0.1 Handed over to PLAN-3

On 2026-10-02 this plan handed these items to PLAN-3. The user accepted them with changes as D74–D82, recorded on `plan3-integration` in `PLAN-3.md` and `PLAN-3-status.md` ("Handoff items from PLAN-4", meaning this plan before the rename).

| Item | PLAN-3 outcome |
|---|---|
| `resources` ships in 6.0.0 | D74; the final eval decides only canonical vs advanced form |
| Query cache (shared cache, dedupe, refetch on focus/reconnect) | Opt-in: `makeFetchDriver({ cache })`; `refetchEvery` per resource (D79) |
| Keep data while reloading | A same-request refetch keeps `data` with `refreshing: true`; a key change clears it unless `keepPrevious: true` (D78) |
| Invalidation, retries, SSR seeding, `validate` | Explicit tags or URL prefixes; retries default 0; `{ prefetch }`; Standard Schema `validate` in `src/extra/standardSchema.ts` (D80) |
| HTTP fake runs the real driver; recipes; inspect | Accepted (D80) |
| Router (R-1…R-9, R-11) and the `HEAD` driver (X-1) | Taken (D81). K-1 is dropped from this plan. |
| Naming | "Reply actions"; `routing.ts` → `replies.ts` (D82) |
| DevTools out of production builds | Frees about 2.3 KB of core as a shared reserve (D77) |

**From PLAN-3, PLAN-5 uses:**

| PLAN-3 output | Used by |
|---|---|
| the `__sygnalStatic` declaration mechanism | B-3, through PLAN-4 GS-7's shape |
| `src/extra/standardSchema.ts` | F-1 |
| `src/extra/browserSignals.ts` (focus, online, visibility) | B-3 |
| the reply-action machinery | F-1 async validation |
| the docs layout: `guide/http`, `guide/sockets`, `guide/custom-drivers`, `integration/server-functions`, plus the router, cache and HEAD pages | §1.4 recipes and Phase 4 |

The final page names are in the PLAN-3 tracker.

### 0.2 Inherited from PLAN-4 (HANDOFF-to-PLAN-5 §2)

| Constraint | Effect on this plan |
|---|---|
| **Run order** | PLAN-3 → PLAN-4 → PLAN-5. Phase 0 rebases onto `plan4-integration`. |
| **Budgets** | Whatever PLAN-4 leaves: core, `llms.txt` and SKILL.md. PLAN-4 §6 proposes a 900 B PLAN-4 core cap (leaving about 1 KB of PLAN-3's 1,897 B), a `llms.txt` cap of 315 lines with a −5-line trim, and a SKILL.md cap of 38 KB. The final numbers come from the PLAN-4 tracker; P5-Q6 is revisited then. Design every core addition at **0 B**. Any core byte comes from what PLAN-4 leaves, with the user's approval. |
| **Reserved codes** | PLAN-5 never uses SYG124–129, SYG222–226, SYG422–423, SYG510, SYG640–649 or SYG701–719. PLAN-5's own reservations are in §4. |
| **Canonical controls (PLAN-4 P4-D)** | If controls become canonical after PLAN-4's 1-E eval, every PLAN-5 example, recipe, `sygnal-ui` component and test is written with controls. If they become an alternative form, PLAN-5 still uses controls where they *are* the API (S-1 widgets, S-10 web components), and class selectors elsewhere. |
| **a11y gate** | From PLAN-4 on, examples, templates and doc samples have no SYG7xx findings. Every PLAN-5 component, recipe, example and eval reference solution must pass. |
| **Eval tasks** | PLAN-4's `ergo` tier uses 26–29, and task 29 is an accessible signup with a native `<dialog>`. PLAN-5's tasks start at **30** and don't repeat 29's dialog (§2, Phase 4). |
| **Learn-time check** | PLAN-5's final eval compares learn time and peak context against **PLAN-4's 4-E run** (S-14). More than about 10% worse → trim before release. |

### 0.3 PLAN-4's suggestions S-1…S-14: outcomes

| # | Suggestion | Verdict | What changes here |
|---|---|---|---|
| **S-1** | A widget is a kind of control | **Accepted (early answer given to PLAN-4)** | W-1 becomes `controls({ DueDate: datePicker })` with `datePicker = defineWidget({...})`, with no `<Widget>` marker component. This settles P5-Q1. PLAN-4 1-A's request: see "Early answer" below. Spike 0-S1 confirms bytes and types. |
| **S-2** | A form as a behavior; a third shape in the P5-Q5 A/B | **Accepted, changed** | The form as a GS-1 behavior is the **lead** shape. The A/B is behavior vs helpers over `processForm`. A dedicated form static is **dropped**, because it would be a second static doing what `uses` does. Element commands focus the first invalid field, `uid()` drives `aria-describedby`, and field controls make field names checkable. Spike 0-S2. |
| **S-3** | Native-first Dialog, Popover and Tooltip | **Accepted, changed** | Dialog = native `<dialog>` + GS-2 `showModal`/`close`. Popover = the Popover API. Tooltip = popover + CSS anchor positioning + GS-7 timers for show/hide delays, if spike 0-S3 confirms support and a11y in all three engines; otherwise Floating UI (6.4 KB) positions it. Zag stays for Menu, Select and Combobox. The 18.5 KB Zag dialog leaves the common path. |
| **S-4** | Native parts as behaviors | **Accepted, changed** | Tabs, Accordion and Disclosure ship as behaviors that the host's markup uses: the host renders its own controls and spreads ARIA attribute objects that the behavior computes (`calculated`), with roving focus through element commands. Components only where the part renders its own markup (the Toaster). `pager`/`selection`/`undoable` are the style reference. |
| **S-5** | Toasts through `timers`; maybe `popover="manual"` | **Accepted** | Auto-dismiss through GS-7 `timers` (fake-timer testable). Spike 0-S4 checks whether a manual popover shows toasts above an open modal `<dialog>` and stays interactive. If not, the Toaster uses Portal and the docs explain the modal limitation. |
| **S-6** | A-1 waits for PLAN-4 P-1 (View Transitions) | **Accepted** | A-1 is conditional. If View Transitions are adopted, A-1 becomes a Collection option that sets a `view-transition-name` per keyed item (or is dropped if P-1 covers that), plus a FLIP fallback only if the record shows a real gap. If not adopted, A-1 stays as planned. |
| **S-7** | V-1 targets from P-3; `scrollToIndex` as an element command | **Accepted, changed** | P-3's numbers set V-1's targets and default threshold. **`scrollToIndex` isn't an element command:** the target row is usually not rendered, so no element exists to scroll. V-1 takes the existing `createCommand()` (`list.send('scrollToIndex', 40)`). Widget-declared commands are question P5-Q7. |
| **S-8** | B-3 uses `timers`' declaration shape; no timers; storage scoped down | **Accepted** | B-3 = intersection, resize, media query, storage (read and observe arbitrary keys only; state persistence is GS-5 `persist`), visibility, online, clipboard and geolocation. It uses the GS-7 shape: state → named specs, diffed, falsy stops, pauses on hidden pages. No timers. |
| **S-9** | Keyboard DnD passes a11y; focus via element commands; `sortable` as a behavior | **Accepted; the behavior form is investigated** | Keyboard DnD must pass SYG701/705, with focus restored through element commands. Spike 0-S5 tries `sortable` as a behavior over a host's Collection, using the document-level drag source. Items are isolated child components, so the behavior can't see their controls. If that breaks the behavior form, `sortable` stays a driver helper. |
| **S-10** | Web components through controls | **Accepted (investigate)** | Spike 0-S6 runs `controls({ Rating: 'wa-rating' })` end to end with real Web Awesome: typed props, `DOM.events(Rating, 'wa-change').detail()`, SYG110/SYG126 by identifier. If it works, the web-components guide leads with controls. |
| **S-11** | Pair consume and publish in one guide | **Accepted** | If GS-13 (`defineElement`) is adopted, PLAN-5 owns one "Web components" guide with "Using" (W-3) and "Publishing" (GS-13) sections. The similar names `defineWidget` (foreign into Sygnal) and `defineElement` (Sygnal out as a custom element) are question P5-Q8. |
| **S-12** | i18n persists the locale with `persist` | **Accepted** | B-2's recipe uses GS-5 `persist` for the locale. Translated labels pass the a11y rules (they check literals only). |
| **S-13** | Tests: controls in `t.widget`, `t.actions` and Testing Library | **Accepted** | `t.widget(DueDate)` takes a control. U-1 test examples assert behaviour with `t.actions`. Component docs show Testing Library role queries (`within(t.container)`, `dom: 'real'`), following GS-14's docs. |
| **S-14** | Learn-time check against PLAN-4's 4-E | **Accepted** | §0.2 and Phase 4. |

**Early answer on S-1, for PLAN-4 1-A.** Yes: PLAN-5 will make a widget a kind of control. This costs PLAN-4 a few bytes and no widget code. 1-A should leave room for:
1. **A control spec that isn't a tag string.** An object such as `{ kind: 'widget', … }` is accepted by `controls()`. The pragma passes vnode creation to it (for example `spec.vnode(props, children)`), then stamps `data-control` on the vnode it returns exactly as for an intrinsic tag.
2. **Kind-blind acceptance.** `DOM.*`, `simulateEvent`, `query` and element commands resolve every control to `[data-control="<Key>"]`, whatever its kind.
3. **A type hook.** `controls()` takes a control's props type from the spec (a phantom field on the widget spec), not only from `JSX.IntrinsicElements`.
4. **Requested (P5-Q7, user-approved 2026-10-02):** GS-2's unknown-method check (SYG641) asks the control's spec before failing, so a widget can declare commands (`ELEMENT: { open: DueDate }` → `datePicker.commands.open(instance)`).

If 1-A can't fit these, PLAN-5 falls back to the 0 B function form (`widget(DatePicker, props)`, the E2 `island()` shape) with a class selector or a plain control around the host.

## 1. Scope

### 1.1 Foundation: integration primitive

**W-1 `defineWidget`: a widget as a kind of control** (0 B when unused; P1)

```jsx
import { controls, defineWidget } from 'sygnal'

const datePicker = defineWidget({
  tag: 'input',                                         // host element (default 'div')
  mount(el, props, emit) { return flatpickr(el, { ...props, onChange: (d) => emit('change', d[0]) }) },
  update(fp, props)      { fp.setDate(props.value, false) },
  unmount(fp)            { fp.destroy() },
  events: ['change'],
  commands: { open: (fp) => fp.open() },                // P5-Q7
})
const { DueDate } = controls({ DueDate: datePicker })

// view:   <label>Due <DueDate value={state.due} /></label>
// intent: DUE: DOM.events(DueDate, 'change').detail()
// test:   t.widget(DueDate).emit('change', date); t.widget(DueDate).props.value
```

- **The host is opaque to snabbdom.** The vnode has no children, and the host keeps its widget instance across re-renders and key moves. `update` gets the newest props in every hook. E3's stale-closure bug must be impossible by construction.
- **Sygnal builds the vnode.** E2 found that a hand-built vnode without `children`/`text`/`elm` keys is silently dropped.
- **Events:** `emit(name, detail)` dispatches a bubbling `CustomEvent` on the host. Declared `events` tell sygnal-check and the runtime which names exist: SYG110 and SYG126 work by identifier, and an undeclared emit is diagnosed (§4 codes).
- **Isolation:** a widget's control in a Collection item matches only that item's host, as for any control.
- **Errors:** a `mount`/`update` that throws goes through the component's `onError` boundary and is reported by GS-11 `onError` with phase `'widget'` (if PLAN-4 accepts the extra phase name).
- **Tests:**
  - in the mock DOM, `t.widget(Control).props` and `t.widget(Control).emit(name, detail)`;
  - with `dom: 'real'`, the widget mounts.
- **SSR:** render the host (with an optional `fallback`) and mount on the client.
- **a11y:** the widget's control is an element in the host's markup, so SYG702 (labels) applies to `input`-hosted widgets. The docs show labelling a widget.
- **Fallback** if PLAN-4 1-A leaves no room for a control kind: the 0 B function form (§0.3).

**W-2 Adapters on `defineWidget`** (separate entries, opt-in; P2)

| Adapter | Shape | Cost (gzip) |
|---|---|---|
| `fromZag(machine, render)` | Generalises E3: a snabbdom normaliser for Zag props (`{ attrs, on, props, style }`) and a private patch. The base for U-1's Menu, Select and Combobox. | Zag dialog 18.5 KB (no longer on the common path, S-3); dialog + menu + select + tooltip 47.6 KB; combobox 31.4 KB |
| `sygnal/react`: `fromReact(Comp, { events })` | Each returns a widget spec: `controls({ Stars: fromReact(StarRating, { events: ['onChange'] }) })` | React 19 + react-dom 69 KB |
| a documented `preact/compat` alias path | The same adapter with a bundler alias (E6) | 9.8 KB |
| `sygnal/vue`: `fromVue(Comp)` | Only on demand (P5-Q3) | Vue runtime 24.7 KB |

The docs say plainly that adapters are for the one component you can't replace. Context and providers don't cross the boundary, portals escape the host, and the default mock DOM can't run them in tests.

**W-3 Web components as a first-class path** (P1)
- **Guide:** "Web components", with a Using section (and Publishing if GS-13 is adopted, S-11). It leads with controls if spike 0-S6 passes (`controls({ Rating: 'wa-rating' })`). It covers properties vs `attrs={{}}` (E1), custom events crossing shadow DOM, form-associated elements and SSR caveats.
- **Types:** a `JSX.IntrinsicElements` augmentation pattern for a library's tags, which also types the controls made from those tags.
- **`.detail(fn?)` stream enricher**, next to `.value()`, `.checked()` and `.data()`.
- **sygnal-check:** custom-element events are valid event names. SYG115, SYG110 and SYG126 don't flag `DOM.events(Rating, 'wa-change')` or `DOM.select('wa-input').events('wa-change')`.
- **Browser test** with real Web Awesome. E1 used a jsdom stand-in.

### 1.2 Native features

| # | Feature | Notes | Priority |
|---|---|---|---|
| **F-1** | **Forms with validation, as a behavior** (S-2). `Signup.uses = { form: form(schema, { fields: { email: Email, password: Password }, submit: Submit }) }`: field state in `state.form` (value, touched, dirty, error per form field; submitting/submitted), any Standard Schema validator through PLAN-3's `standardSchema.ts`, with no validator dependency. | Validate on input, blur or submit. On a failed submit, focus the first invalid field (GS-2 `{ focus }`). `uid()` ids wire `aria-describedby` to error text, which keeps SYG702/708 clean. Field controls make form-field names checkable. Field arrays use per-item controls in a Collection (spike 0-S2 checks this). Async validation through a reply action; server errors mapped onto fields. Builds on `processForm` and bound `value` fields (SYG111) rather than adding a second model. The A/B is behavior vs helpers (P5-Q5). Benchmarked against react-hook-form (68.4M/wk) and TanStack Form. | P1 |
| **T-1** | **Toasts.** `EVENTS: event('TOAST', { text, kind, timeoutMs })` from anywhere, rendered by a `<Toaster>` component (Transition + Collection) in an ARIA live region. Auto-dismiss via GS-7 `timers`; top layer via `popover="manual"` if spike 0-S4 passes, otherwise Portal (S-5). | sonner (61.6M/wk) is the target feel. | P2 |
| **A-1** | **Collection move transitions**, conditional on PLAN-4 P-1 (S-6): a per-item `view-transition-name` option if View Transitions are adopted, otherwise FLIP extending `<Transition>`. | Plus AutoAnimate (3.1 KB) and Motion `animate()` recipes via `ref`. | P2 |
| **V-1** | **`<VirtualCollection>`** on `@tanstack/virtual-core` (7.1 KB). Same `of`/`from`/`filter`/`sort` props as Collection; `commands={list}` with `scrollToIndex` (S-7). | Targets and the default threshold come from PLAN-4 P-3's numbers. Browser-tested (jsdom has no layout). | P2 |
| **B-3** | **Browser sources pack** in GS-7's declaration shape (S-8): intersection, resize, media query, storage (read and observe keys), visibility, online, clipboard, geolocation. This is Sygnal's VueUse (14.0M/wk). | No timers (GS-7) and no persistence (GS-5). Test fakes for each source. | P2 |
| **B-4** | **Deferred loading triggers**: `lazy(() => import('./Chart'), { when: 'visible' \| 'idle' })`. This is gap-study G-17, which PLAN-4 left out of scope pending B-3. | Small once B-3's intersection and idle sources exist. In scope (P5-Q9). | P3 |
| **B-1** | **Drag and drop:** pointer, touch and keyboard support, plus `sortable` (S-9: a behavior if spike 0-S5 works, otherwise a driver helper). Keyboard moves pass SYG701/705 and restore focus with element commands. | Option: `@dnd-kit/dom` behind the driver if it reaches 1.0 by then (0.5 today). | P3 |
| **B-2** | **i18n:** a recipe (an i18next instance, `.context` for `t()`, a locale driver, and the locale saved with GS-5 `persist`, S-12), plus a helper if the recipe is clumsy. | | P3 |

### 1.3 Headless UI package

**U-1 `sygnal-ui`** (packaging per P5-Q2; P2)

| Part | Built as | Notes |
|---|---|---|
| Dialog | behavior over a native `<dialog>` control + GS-2 commands | S-3; no Zag |
| Popover | behavior over the Popover API | S-3 |
| Tooltip | behavior: popover + anchor positioning + GS-7 delays | Floating UI fallback if spike 0-S3 says so |
| Tabs, Accordion, Disclosure | behaviors | S-4: ARIA attribute objects from `calculated`; roving focus via element commands |
| Menu, Select, Combobox | `fromZag` widgets (W-2) | Keyboard and ARIA behaviour is the hard part |
| Toaster | component | T-1 |

- **Unstyled:** class hooks plus documented data attributes, so the parts work with Tailwind and with web-component themes.
- **Every part ships:**
  - a test example asserting behaviour with `t.actions` and Testing Library role queries (S-13);
  - strict-clean and SYG7xx-clean code;
  - a guide page.

  Agent context follows the docs rules in Phase 4: no per-part `llms.txt` lines.
- Benchmarked against Radix (88.1M/wk for `react-dialog`) and Base UI (18.4M).

### 1.4 Docs-only recipes

P1 for the first three; P3 for the rest. All are a11y-clean (§0.2).

| Recipe | Built on |
|---|---|
| Chart.js / ECharts | W-1 |
| Tiptap | W-1 |
| CodeMirror | W-1 |
| Embla carousel | W-1 |
| Floating UI | `ref`, or the U-1 Tooltip fallback |
| AutoAnimate | `ref` |
| TanStack Table | in-view, E4; re-checked against v9's API (9.2.4 current) |
| AG Grid | W-1 |
| Icons | Lucide vanilla or a small JSX icon set (P5-Q4) |

### 1.5 Not doing

| Item | Reason |
|---|---|
| State libraries (zustand, redux, pinia, jotai) | The state tree, context and EVENTS cover them. |
| XState | Zag covers the UI use. |
| Utility-hook ports | B-3, GS-5, GS-6 and GS-7 cover them. |
| Wrapping MUI, antd or other component *systems* | Provider-heavy and a poor fit across the adapter boundary. Web components are the themed-library answer. |
| A dedicated form static | S-2: a behavior covers it through `uses`. |

## 2. Phases

| Phase | Work | Detail |
|---|---|---|
| **0: Setup** (coordinator, spikes by subagents on `exp/p5-*`) | **0-A** rebase and baseline | Rebase onto the completed `plan4-integration`. Create `PLAN-5-status.md`. Record the budgets PLAN-4 left (P5-Q6) and the §4 code reservations. Read PLAN-4's decisions: P4-D (canonical controls), P4-Q4 (`uses` vs `withBehaviors`), P4-Q6 (`ELEMENT` sink), P4-Q8 (timers), and the P-1, P-2 and P-3 records. Re-run E1–E6 on the 6.0 build. Answer P5-Q1…Q9. |
| | **0-S1** widget as a control kind (S-1) | `defineWidget` on PLAN-4's control marker: core bytes (target 0), typed props through `controls()`, Collection isolation, SSR, and widget commands through `ELEMENT` if PLAN-4 left room. |
| | **0-S2** forms (S-2) | The `form` behavior and the helper shape side by side on the same signup-plus-address form: field arrays in a Collection, async validation via a reply action, server errors, focus on the first invalid field, `uid`-linked errors with 0 SYG7xx findings. Output: the two shapes for the Phase 4 A/B. |
| | **0-S3** native Dialog, Popover and Tooltip (S-3) | Browser tests in Chromium, Firefox and WebKit: focus trap and return, Escape, light dismiss, anchor positioning, tooltip hover/focus delays with GS-7, screen-reader names. Output: native or Zag/Floating UI per part. |
| | **0-S4** toast top layer (S-5) | `popover="manual"` above an open modal `<dialog>`: visible, announced, and dismissible. |
| | **0-S5** `sortable` behavior (S-9) | A behavior over a host's Collection with pointer and keyboard moves. Output: behavior or driver helper. |
| | **0-S6** web components via controls (S-10) | Real Web Awesome in `browser-tests`: typed control props, `.detail()`, SYG110/SYG126 by identifier. |
| **1: Foundation** | W-1 → W-3; F-1 in parallel | F-1 needs PLAN-4's GS-1. |
| **2: Components** (parallel where files don't overlap) | W-2 (`fromZag` first) → U-1; T-1, A-1 (per P-1), V-1, B-3 | |
| **3: Remaining items** | B-1, B-2, B-4, §1.4 recipes | |
| **4: Docs, agent context, measure** | Agent sync, eval, report | `llms.txt`/SKILL sync within the budgets PLAN-4 leaves (docs rules below), then the eval and REPORT-v5. |

**Phase 4 eval:**
- **New tier, tasks from 30:**

  | Task | What it tests |
  |---|---|
  | 30 | Checkout form: schema validation, a field array, server-side errors |
  | 31 | Command menu / combobox: keyboard, filtering, selection; not a dialog (29 covers that) |
  | 32 | Chart widget that updates from state, through `defineWidget` |
  | 33 | 10,000-row list: virtualised, jump to a row |
  | 34 | Sortable list with keyboard moves (optional, if B-1 lands) |

- **React arm:** react-hook-form + zod, Radix/shadcn (`cmdk`), Chart.js, TanStack Virtual, dnd-kit.
- **F-1 A/B** (P5-Q5): behavior vs helpers.
- **Learn time and peak context** are checked against PLAN-4's 4-E run (S-14); more than about 10% worse → trim before release.
- **Spend** is estimated in 0-A and asked for before any run.

**ROADMAP:** add PLAN-5's entries in 0-A. ROADMAP §16 is PLAN-3's; PLAN-4 adds its own.

### Docs rules (agent context)

The budgets are whatever PLAN-4 leaves: probably about 10–15 `llms.txt` lines and about 1 KB of SKILL.md (P5-Q6). Every line costs tokens and context per agent trial.

| Rank | Feature | Agent context |
|---|---|---|
| 1 | F-1 forms | A short canonical recipe (≈ 6–8 lines; shorter if the behavior form reuses GS-1's recipe lines) |
| 2 | W-1 `defineWidget` + W-3 `.detail()` | ≈ 4 lines. With S-1 it extends the controls recipe rather than adding a new concept. One fact line for web components. |
| 3 | Everything else (U-1, T-1, A-1, V-1, B-1…B-4, adapters, recipes) | Guide pages only, reached from one `llms.txt` line that lists them |

## 3. Gates

Every merge runs the PLAN-3 and PLAN-4 gates:
- `npm run build:all`, `npm test`, `npm --prefix sygnal-check test`;
- doc samples, error docs `--check`, docs build;
- size gate, `llms.txt` and SKILL.md limits;
- tree-shaking, SSR determinism;
- **0 SYG7xx findings** on examples, templates and doc samples.

PLAN-5 adds:
- browser tests (Chromium, Firefox, WebKit) for:
  - W-1 with a real third-party widget;
  - real Web Awesome;
  - V-1 scrolling;
  - U-1 keyboard, focus and screen-reader names;
  - native Dialog, Popover and Tooltip;
- a tree-shaking test that unused W-1, W-2, U-1, V-1 and B-3 add 0 B to kanban;
- every U-1 part and every recipe is SYG7xx-clean, and so is every eval reference solution.

## 4. Diagnostic code reservations

Chosen to avoid PLAN-4's reservations (SYG124–129, 222–226, 422–423, 510, 640–649, 701–719) and the codes PLAN-3 already uses (SYG112, 115, 116, 130–133, 221, 421, 508, 608–611, 620, 630–635). **Confirm against the final `codes.ts` in 0-A**, since PLAN-3 and PLAN-4 may still add codes.

| Range | Reserved for |
|---|---|
| 1xx wiring: **SYG140–149** | Widget emits an undeclared event; a form field control is listened to but isn't one of the form's fields; a widget command that the widget doesn't declare |
| 2xx model/state: **SYG230–239** | `form` behavior: a field name not in the schema; a schema that isn't a Standard Schema object; a submit while already submitting |
| 4xx components: **SYG430–439** | `VirtualCollection` (no scroll container, items without keys); a `sygnal-ui` part used without its required controls |
| 6xx drivers/setup: **SYG660–669** | Widget `mount`/`update` threw; an adapter's peer dependency is missing (`react-dom`, `@zag-js/*`); an invalid browser-source spec; a browser source used without its driver |
| 7xx a11y: **SYG720–729** | Rules specific to PLAN-5 parts (for example a `sygnal-ui` Menu or Combobox without an accessible name), after PLAN-4's SYG701–719 |

Per CLAUDE.md, each code goes into both tables in `codes.ts` (non-core codes in `DEV_CODE_SEVERITY`), gets an explanation, and is followed by a regeneration of `explanations.json` and the errors doc.

## 5. Decisions needed before Phase 1 (recommendations first)

The user answered P5-Q6…Q9 on 2026-10-02. 0-A records them in the tracker with global D-numbers, taking the next free numbers after PLAN-4's.

| # | Question | Recommendation |
|---|---|---|
| P5-Q1 | Widget form | **Answered by S-1:** a widget is a kind of control (`controls({ X: defineWidget(…) })`), with no marker component. Fallback: the 0 B function form if PLAN-4 1-A leaves no room. |
| P5-Q2 | `sygnal-ui` packaging | A separate package (`sygnal-ui`), like `sygnal-check`. It keeps Zag out of `sygnal`'s dependencies and versions independently, though it ships with 6.0.0. |
| P5-Q3 | Foreign-framework adapters in 6.0 | `fromZag` (needed by U-1) and `sygnal/react` with the preact/compat alias documented. `sygnal/vue` only on demand. |
| P5-Q4 | Icons | Docs for Lucide vanilla; no package unless the eval shows agents struggle. |
| P5-Q5 | Forms API shape | A/B in the Phase 4 eval: a `form` behavior through `uses` (lead, S-2) vs helpers over `processForm`. No dedicated form static. |
| P5-Q6 | Budgets | **User, 2026-10-02: address as we go.** Whatever PLAN-4 leaves (core, `llms.txt`, SKILL.md) is recorded in 0-A. If F-1 + W-1 need more than is left, raise it with eval numbers when it comes up. (Was "resolved by D76" before PLAN-4 existed.) |
| P5-Q7 | Widget commands through `ELEMENT` (S-1 item 4) | **User, 2026-10-02: yes.** Requested from PLAN-4: GS-2's SYG641 asks the control's spec before failing. If PLAN-4 can't fit it, widgets take a `createCommand()` like V-1. |
| P5-Q8 | `defineWidget` vs `defineElement` naming (S-11) | **User, 2026-10-02: keep both** (if GS-13 is adopted). They describe opposite directions, so the guide pairs them in one table ("bring a foreign widget in" / "publish a Sygnal component as an element"). Revisit if the eval shows confusion. |
| P5-Q9 | Add B-4 (deferred loading triggers, gap-study G-17) | **User, 2026-10-02: yes.** B-4 is in scope as P3, after B-3. |

## 6. Risks

| Risk | Mitigation |
|---|---|
| Agent-doc budget too small after PLAN-4 | The docs rules: two features get `llms.txt` lines, and S-1/S-2 reuse PLAN-4's controls and behavior recipes instead of adding concepts. The Phase 4 eval measures learn time and peak context. If that isn't enough, ask the user with numbers. |
| Core bytes | Everything is designed for 0 B. Anything else comes from what PLAN-4 leaves, with the user's approval. |
| PLAN-4 decisions change PLAN-5's shapes (controls canonical or not, `uses` vs `withBehaviors`, built-in vs registered `ELEMENT`/timers, View Transitions) | 0-A reads the decision records before any code. S-1 has a fallback form. A-1 is conditional. |
| Native Dialog/Popover/Tooltip differ across engines | Spike 0-S3 runs in three engines; parts fall back to Zag or Floating UI per the result. |
| Zag's bundle weight (18–48 KB) surprises users | The native parts cover Dialog, Popover, Tooltip, Tabs, Accordion, Disclosure and Toast; Zag only for Menu, Select and Combobox; sizes documented per part. |
| Adapters invite misuse ("just wrap the React lib") | The docs lead with native and web-component answers; adapters are documented as an escape hatch with their limits. |
| Zag vanilla 2.0 changes its API (2.0.0-next in progress) | Pin a version; `fromZag` isolates the API surface. |
| TanStack Table v9 API change | The recipe is written against v9. |
| Behaviors can't see controls inside Collection items (isolation) | Spikes 0-S2 (field arrays) and 0-S5 (`sortable`) test it first; driver or helper fallbacks exist. |
