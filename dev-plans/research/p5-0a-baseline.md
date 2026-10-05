# PLAN-5 0-A: foundations on the PLAN-4.6 core

**Branch:** `exp/p5-0a` (from `plan5-integration` @ `8cfb770`). **Date:** 2026-10-05.
**Inputs:** [PLAN-5](../PLAN-5.md), [PLAN-5-status](../PLAN-5-status.md) (0-A baseline, D189), [HANDOFF-to-PLAN-5](../HANDOFF-to-PLAN-5.md), [PLAN-4-status](../PLAN-4-status.md) §"Interfaces promised to PLAN-5", [04-hooks-contract](core-rewrite/04-hooks-contract.md).

Line numbers are for `8cfb770`, paths under `src/` unless stated.

## 1. Interfaces promised to PLAN-5: all hold

Checked against the **build** (`dist/`) by `test/p5-0a-interfaces.test.js` (15 tests, mock and real DOM, top level and inside Collection items) and `type-tests/p5-0a-interfaces.tsx` (in `npm run test:types`). The runtime test uses a widget-shaped spec object (`kind: 'widget'`, an opaque `div` host whose insert hook stores an instance on the element and whose `update` hook gets the newest props).

| # | Interface (decision) | Result | Where it lives now |
|---|---|---|---|
| I1 | Spec contract `{ kind, vnode(props, children, h), commands?, __props? }`; the pragma passes its own `h`, stamps `data-control`, keeps hooks, copies `key` (D101/D116) | **pass**: `h` is the core `createElement` from both the classic pragma and the automatic JSX runtime (which imports the core's, D188); insert/update hooks kept; props key copied, the vnode's own key wins; SSR renders the stamp | `extra/controls.ts:28–47` (vnode call :34, stamp :36–37, key :38, kind/spec :42–43); `pragma/index.ts:275` (the `__sygnalControl` render hook, passes `ce`); `jsx-runtime.ts:4` |
| I2 | Kind-blind acceptance: `DOM.*`, `simulateEvent`, `query`/`queryAll`, element commands resolve any control to `[data-control="<Key>"]` (D101) | **pass**: `DOM.select(W).events`, `DOM.click(W)`, `simulateEvent(W, …, { within })`, `query`/`queryAll`, `ELEMENT: { open: W }`; a host-dispatched bubbling `CustomEvent` reaches only its own Collection item; the host is patched, not re-mounted | `cycle/dom/MainDOMSource.ts:84–85`; `extra/testing.ts:527–528` (`selOf`); `extra/elementCommands.ts:37` |
| I3 | Props type from the spec (`__props` phantom) (D101) | **pass** (types): required/typed props enforced from `__props` | `index.d.ts:413–421` (`ControlSpecObject`), `:520–526` (`ControlPropsOf`) |
| I4 | Element commands call `spec.commands[name](hostElement, options)` before native methods; SYG641 only after (D102) | **pass**: the host element and the options reach the spec command (the widget instance is found through the host); a spec `focus` overrides the native one; in a Collection item the command reaches only that item's host; an unknown method → SYG641 naming the spec's commands; a spec command → no SYG641 (mock and real DOM) | `extra/elementCommands.ts:40,45` (spec first, then `e[m]`, then the dev bridge :46); `extra/diagnostics/checks/elementCommands.ts:109–128`; `extra/testing.ts:1394` (mock-DOM check) |
| I5 | `onError` phase `'widget'` in the type union (D105) | **pass** (types): `AppErrorPhase` and `AppErrorInfo` accept it; the run/renderComponent hook sees it | `index.d.ts:1241`; `core/hooks.ts:222` |

**Findings for 0-S1 (not broken promises, so no G- item):**
- **F-a (types):** a spec object's JSX props are exactly `P & { key, children, ref }` (`ControlCommonProps`, `index.d.ts:490–494`). `className`, `class`, `attrs`, `style` are not added, so D189's `<DatePicker className="due" />` needs `defineWidget`'s props type to add them (type-only, 0 B).
- **F-b (I5 runtime):** nothing can report phase `'widget'` today, and no public API lets a widget reach its owner's `onError` boundary. The only path is the raw runtime (`Runtime.appError(inst, e, phase)`, `core/runtime.ts:360`), which registry entries get through their `owner` argument (04-hooks §2.1 R2). That argues for the marker-registry plug-in point below.
- **F-c (testing, string targets):** in the mock DOM, `ELEMENT: { open: '.due' }` (D189's canonical form, a selector, no spec) is checked by `elementHas` (`extra/testing.ts:1218–1227`), which knows only native methods → a false SYG641. The widget's commands must be visible to the mock-DOM check through the host vnode (dev/testing bytes only).
- **E2's rule still holds on the new core:** a hand-built vnode without `children` and `text` keys is dropped silently (`pragma/is.ts:18`; probed 2026-10-05). `defineWidget` must build its vnodes with `h` or with all six keys.

## 2. D189 feasibility: where a widget tag plugs in

D189: `defineWidget(spec)` returns a **tag** rendered directly (`<DatePicker className="due" value={…} />`), selected canonically (`DOM.select('.due').events('change').detail()`), ELEMENT commands resolved through the host element (`{ open: '.due' }`), and the same value works as a control spec (`controls({ Due: datePicker })`).

### Options

| | A. Pragma render hook only (`__sygnalControl` on the tag) | B. Marker registry `pres` (per-widget `componentName` + `preventInstantiation`, like Portal) | **C. Render hook → one `widget` marker → `pres.widget`** (recommended) |
|---|---|---|---|
| How | the tag builds the host vnode at JSX time, as `controls()` does | each `defineWidget` registers `pres['sygnal-widget-<n>']`; the marker carries only sanitized props | the tag's `__sygnalControl` returns a marker `{ sel: 'widget', data: { w: spec, p: rawProps }, children: [], text, elm, key }`; one `pres.widget` (registered inside the first `defineWidget` call) turns it into the host during the owner's reconcile walk (`core/instance.ts:472–478`) |
| Owner instance (onError, phase `'widget'`) | none (built before any instance sees it) | yes (`pres(vnode, owner)`) | yes |
| Raw props/spec on the marker | n/a | no: a `preventInstantiation` tag gets only its sanitized props and its `sel` | yes |
| Control form | spec = the tag (`vnode`, `commands`, `__props` on the function) | same | same: `vnode(props, children, h) => h(Tag, props, ...children)`; the stamp lands on the marker's `attrs`, which `pres.widget` copies onto the host (SYG125 accepts the marker: `checks/controls.ts:55–62`) |
| Registry growth | none | one entry per widget definition | one entry |
| Core bytes when unused | 0 | 0 if registered in the call, not on import | 0 if registered in the call, not on import |

**Why C:** it keeps the pragma path that already exists for controls (no new pragma code), gives the widget its owner (F-b: `owner.app.appError(owner, e, 'widget')` and the owner's `onError` fallback with `owner.refresh()`), and the marker carries the spec and the raw props, so `t.widget(…)`, inspect and the mock-DOM command check (F-c) can read them from the rendered tree.

**Register in the call, not on import.** Portal, Transition, ClientOnly and lazy register at module top level (`dist/index.esm.js` has `pres.portal = …` etc. as top-level statements), and D157 lists "marker handlers registered on import" as bytes every app pays. `defineWidget` should do `pres.widget ||= renderWidget` inside its body, so an app that never calls it keeps 0 B.

**Caveats to cover in 0-S1:**
- The tag is a function with `__sygnalControl`, so `MainDOMSource.select` (`:84`) and testing's `selOf` treat it as a control and stringify it. Give it a `toString` that returns a selector (e.g. `[data-widget="DatePicker"]`, with the attribute set on the host), or let strict mode flag `DOM.select(DatePicker)` as an alternative form. Decide which (D189 says canonical is the class selector).
- `pres` runs only in an instance's reconcile walk. A widget inside `<Portal>` children is not rewritten (as components there are not instantiated, `core/markers/portal.ts` header). SSR (`extra/ssr.ts:310–360`) handles markers by name, not through `pres`: it needs a `widget` case (render the host plus an optional `fallback`), paid only by apps that import `renderToString`.
- P46-P `sameTree` never reuses a vnode with a `hook` (`core/instance.ts:86–99`, G-349), so the host's `update`/`postpatch` hooks always run; the parent of a marker is never plain (the marker has no `$p`), so the walk always reaches it.

### Host-element storage for ELEMENT commands

The core resolves a command's method as `t?.spec?.commands?.[m]` then `e[m]` (`extra/elementCommands.ts:40,45`). A selector target (`{ open: '.due' }`) has no spec, so the canonical form has to go through the element:

| Option | Core bytes | Notes |
|---|---|---|
| **1. Own methods on the host** (recommended): at mount, `defineWidget` sets `el.open = (o) => commands.open(instance, o)` for each declared command, and deletes them at unmount; the instance itself on a non-enumerable `el.__sygnalWidget` (for `t.widget`, devtools) | **0 B**: the existing `e[m](o)` path runs them | An own property shadows a native method of the same name (a widget `focus` wins, as D102's spec commands do). The core passes `o.returnValue` to `close` and `o.force` to `togglePopover`, so a widget command with one of those names gets that value, not the options: document it, or have `defineWidget` refuse those names. The mock-DOM SYG641 check (F-c) and the dev check need to read the commands from the host vnode (dev/testing bytes only) |
| 2. A WeakMap or `el.$w` read by the core (`f = t?.spec?.commands?.[m] \|\| e?.$w?.[m]`) | about +10–15 B gzip, in every app (elementCommands is part of the core's ELEMENT sink, `core/actions.ts:19,86`) | Cleaner precedence; not 0 B |

The control form keeps D102 as is: `defineWidget` builds `spec.commands` as `(el, o) => author.commands[name](el.__sygnalWidget.instance, o)`, so both forms run the same author code.

### Expected bytes

- **Core: 0 B when unused** (options C + 1; `registry.ts` and the `pres` lookup already exist).
- **An app that uses `defineWidget`:** the widget module only (marker, `pres.widget`, mount/update/unmount hooks, `emit` as a bubbling `CustomEvent`, the commands install, error routing): estimated 450–750 B gzip, outside the core budget. SSR's `widget` case: about 40–80 B in apps that import `renderToString`.
- **Dev entry / testing:** `t.widget(…)`, SYG14x (undeclared emit, undeclared command) and SYG66x (mount/update threw), the mock-DOM command check (F-c).

## 3. E1–E6 on the 6.0 build

`npm --prefix dev-plans/research/ecosystem-experiments install` (153 packages, network allowed) and `test`: **6/6 pass with no changes** (vitest 5.0.3, jsdom, `sygnal` linked to this checkout's `dist/`). The experiments already used only canonical forms (destructured views, object-form models, no `component(`, pipe keys, `.components` or custom source names), so D162–D164 needed nothing. No behaviour differences observed; E2's hand-built-vnode rule still applies (§1). The install wrote a `package-lock.json` in the experiments dir (not committed: the experiments are throwaway and unpinned except table-core v8).

| E | Result |
|---|---|
| E1 web components (shadow DOM, props vs `attrs`, composed events) | pass |
| E2 React 19 island | pass |
| E3 Zag dialog (private snabbdom patch, controlled `open`) | pass |
| E4 TanStack table-core v8 in the view | pass |
| E5 query-core as a driver | pass |
| E6 preact/compat island | pass |

## 4. Playwright engines (browser-tests)

`browser-tests` has Playwright **1.58.2**, which expects `chromium-1208`, `firefox-1509`, `webkit-2248`. The local cache (`~/Library/Caches/ms-playwright`) has `chromium-1208` (+1117, 1243), `firefox-1543`, `webkit-2359` (from a newer Playwright). Nothing was downloaded.

| Engine | Default launch | With `executablePath` to the cached newer build |
|---|---|---|
| Chromium 145.0.7632.6 | **works** (`<dialog>`, Popover API, `anchor-name` supported) | n/a |
| Firefox | fails: `firefox-1509` missing | **works**: Firefox 155.0 from `firefox-1543` (dialog, popover, anchor positioning supported); a version mismatch, so not a supported pairing |
| WebKit | fails: `webkit-2248` missing | **hangs** (`webkit-2359` with the 1.58 driver; killed after the timeout) |

0-S3/S6 need three engines: either `npx playwright install firefox webkit` for 1.58.2 (a download, needs the user's go-ahead), or a Playwright bump in `browser-tests` to the version that matches the cached `firefox-1543`/`webkit-2359` (also an install).

## 5. Budgets and gates (confirmed 2026-10-05)

| Gate | Result |
|---|---|
| `npm test` (vitest 2,706 + 1 skipped, 241 files; examples; types; browser 184; perf count gate) | green (examples needed `TEST_EXAMPLES_INSTALL=1` in a fresh worktree) |
| `npm --prefix sygnal-check test` | 498 passed |
| Size gate (kanban gzip, nativeGlobalThis false) | **41,396 B** of 42,300 B: **904 B left** (default build 37,405 B) |
| `llms.txt` | **291** of 315 lines: **24 left** (`test/llms-txt.test.js`) |
| `skills/sygnal-dev/SKILL.md` | **38,873 B** of 38,912 B: **39 B left**. No test enforces this cap (only the tracker) |

The tracker's numbers are confirmed.

## 6. Phase 4 eval spend estimate

Per-trial costs are the means of every scored record in `evals/agent-ergonomics/results/*.json` (starter 2 for the Sygnal arm), for the tasks most like each new one, plus 20% for new libraries and new APIs. Tasks 30–34 don't exist yet, so `orchestrate.mjs --dry-run` would only fall back to arm-wide means; the table does the same math per task.

| Task | Analogues | Opus Sygnal | Opus React | Haiku Sygnal | Haiku React |
|---|---|---|---|---|---|
| 30 checkout form | 10, 16, 29 | $0.63 | $0.35 | $0.44 | $0.33 |
| 31 command menu / combobox | 11, 12, 29 | $0.51 | $0.27 | $0.47 | $0.32 |
| 32 chart widget | 05, 13, 17 | $0.43 | $0.24 | $0.41 | $0.31 |
| 33 10k-row virtual list | 02, 12, 24 | $0.50 | $0.21 | $0.40 | $0.26 |
| 34 sortable (optional) | 09, 27 | $0.45 | $0.25 | $0.41 | $0.25 |
| **× 5 trials, all five tasks** | | **$12.61** | **$6.60** | **$10.62** | **$7.33** |

| Run | Trials | Estimate |
|---|---|---|
| Tasks 30–34, both arms, Opus | 50 | ≈ $19 |
| Tasks 30–34, both arms, Haiku | 50 | ≈ $18 |
| F-1 A/B (behavior vs helpers): Sygnal arm, form tasks 10, 29, 30 × 2 variants × 5 trials, Opus ($0.63 a trial) | 30 | ≈ $19 |
| F-1 A/B, same on Haiku ($0.44 a trial) | 30 | ≈ $13 |
| **Subtotal (new tier + A/B, both models)** | 160 | **≈ $70** (≈ $63 without task 34) |
| Optional: S-14 learn-time/peak-context check, a full re-run at 4-E's size (p4-final6: Opus 145 trials $57, Haiku 105 trials $33, React ergo ≈ $10) | ≈ 270 | ≈ $100 |

Budget about +10% for redone trials (crashes, timeouts, harness failures). No eval was run; no `orchestrate.mjs` call was made.
