# PLAN-5 Status Tracker

Tracks progress for [PLAN-5.md](PLAN-5.md) (ecosystem components and integrations). The coordinator maintains it.

**Numbering:** decisions continue from **D189**, gaps from **G-355** (PLAN-4.6 ended at D188 / G-354). Earlier PLAN-5 decisions D101–D105 (recorded in `PLAN-4-status.md`) apply.

**Integration branch:** `plan5-integration`, cut from `plan46-complete` (`7146161`) on 2026-10-05, in worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** Phase 2: 2-B, 2-V, 2-U, 2-A merged; running: 2-Z (fromZag + Menu/Select/Combobox + fromReact), 2-R (fixes), 2-S (2-U/2-V review fixes). Known flaky test `p5-1s-forms` (fixed in 2-R).

## 0-A baseline (2026-10-05)

PLAN-5 was written against the PLAN-4 core. It now runs on the PLAN-4.6 core (`src/core/`): read `PLAN-4.6-status.md` (close-out), `HANDOFF-to-PLAN-5.md` (PLAN-4.6 sections) and `docs/.../guide/migrating-to-6.md` first.

**Budgets (P5-Q6: "address as we go"):**

| Budget | Left for PLAN-5 |
|---|---|
| Core (kanban gzip, nativeGlobalThis false; gate 42,300 B, D185) | **904 B** (41,396 B) |
| `llms.txt` | **24 lines** (291 / 315) |
| SKILL.md | **39 B** (38,873 / 38,912 B) |

PLAN-5's docs rules assumed ≈ 1 KB of SKILL.md; 39 B means F-1/W-1 agent lines need trims or a cap decision (raised with eval numbers when it comes up, P5-Q6).

**Code reservations (§4):** SYG140–149, 230–239, 430–439, 660–669, 720–729 are all free in `codes.ts` (checked 2026-10-05). PLAN-4's reservations are closed (PLAN-4.6 used SYG423–425 and SYG612 from PLAN-4's spare ranges). Highest codes per lane: 133, 226, 302, 425, 508, 645, 708, 903.

**PLAN-4 / PLAN-4.6 decisions that shape PLAN-5:**

| Decision | Effect on PLAN-5 |
|---|---|
| D101/D116 control spec contract (`{ kind, vnode(props, children, h), commands?, __props? }`), D102 widget commands via `ELEMENT`, D105 `onError` phase `'widget'` | W-1 builds on them; 0-A/0-S1 verify they still hold on the PLAN-4.6 core |
| **D141: controls are an alternative form** (selectors canonical; docs, examples and agent docs use canonical forms) | Resolved by D189: widgets are tags (canonical) that also work as controls |
| D114 `uses` behaviors, built-in `ELEMENT`, `persist()` helper, registered `makeTimerDriver()` | F-1 as a behavior; T-1/B-3 reuse the timers declaration shape |
| D127 GS-13 `sygnal/element` adopted | PLAN-5 owns the "Web components" guide (D104) |
| PLAN-4 View Transitions: form B (static + `makeViewTransitionDOMDriver`); form A out (D137) | A-1 (S-6): per-item `view-transition-name` on form B, FLIP only as a fallback |
| PLAN-4.6: hooks (`transformDef`, statics, marker registry, dev layers); no instance patching; removed forms (D162–D164) | Every PLAN-5 feature attaches through hooks; no removed forms in specs |
| PLAN-4.6 performance (select ≈ 3× React, Collection create 10k faster than React) | V-1's targets and default threshold (S-7) are re-based on these numbers |

## Phases

| ID | Work | Status | Branch | Merge | Notes |
|---|---|---|---|---|---|
| 0-A | Interfaces on the new core, E1–E6 re-run, ROADMAP | ✅ merged | `exp/p5-0a` (`c063cf4`) | 2026-10-05 | All 5 PLAN-4 interfaces hold (15 tests, `test/p5-0a-interfaces.test.js`); E1–E6 pass unchanged; ROADMAP §18; `research/p5-0a-baseline.md` (D189 plug-in point: render hook + `widget` marker, registered on first `defineWidget`). Only Chromium launches with Playwright 1.58.2 → D191. Eval estimate ≈ $70 (tasks 30–34 both arms Opus+Haiku, F-1 A/B), ≈ $100 more for a full learn-time re-run |
| 0-B | Playwright bump to the cached Firefox/WebKit builds (D191) | ✅ merged | `p5-0b-playwright` (`4572d9e`) | 2026-10-05 | Playwright 1.63.0 (only release matching the cached builds; nothing downloaded) in browser-tests + benchmarks; `BROWSER=firefox\|webkit` opt-in. Coordinator fixes: Firefox submit test made cancelable; Firefox error-text patterns. Browser suite: Chromium 153 184/184, Firefox 155 184/184, WebKit 26.6 183/184 (G-355). Perf gate unchanged |
| 0-S4 | Toast top layer (confirm 0-S3's finding, 3 engines) | ✅ done (spike, not merged) | `exp/p5-s4` (`b91e30f`) | 2026-10-05 | Six strategies × 3 engines: only **`popover="manual"` re-parented into the topmost open modal** passes everything (on top, clickable, Tab-reachable and in the a11y tree inside the modal; survives close/reopen/removal; correct under transformed dialogs; Collection/Transition/timers keep working). Portal (S-5's fallback) fails (no component instantiation, fixed target, dies with the dialog). Needs a one-line core fix: `IsolateModule.getRootElement` throws for an element moved out of its component (−39 B). Toaster ≈ +0.94 KB gzip (+1.5 KB with the timer driver). Open: delegator bubbling still follows DOM parents (G-356), SYG202 on canonical item self-removal (G-357), real screen-reader check |
| 1-F | Foundations | ✅ merged | `p5-1f` (`707e54b`) | 2026-10-05 | D196 pragma attrs (+63 B), moved-element isolation incl. bubbling via `__sygnalHome` (−27 B), form-associated custom-element sync (+42 B), D197 `defineBehavior` (`timers`, options/key in handlers, `HOST` reducer; 0 B), D194 `focusWithin` (0 B), D199 diagnostics/check items, test helpers, G-355 fixed (test isolation, not a router bug). After merge with 1-W: **41,5xx B**; vitest 2,818; browser 213/214 on all three engines (G-358) |
| 1-R | Fixes: G-358 (merge interaction), 1-W review (G-359…G-369), D200 | ✅ merged | `p5-1r` (`451d9d5`) | 2026-10-05 | All 12 fixed (G-358 was the test: its view bound a value it never updated, which D196's re-sync correctly restores). Widget hosts keyed by widget + place (no reuse across widgets/plain/fallback); per-instance failures with recovery; Portal content destroyed on removal; Transition and refs on widgets; library classes kept; SSR IDL names + both kebab and lowercase attributes; SYG141/142 relaxed for unknown hosts; `__sw`; `dispatch`. Chromium/Firefox/WebKit 214/214; core **41,500 B** (800 B headroom); widget used ≈ 1.27 KB |
| R-1F | Review of 1-F + 1-F1 | ✅ done | | 2026-10-05 | 12 findings G-370…G-381 (2 high) |
| 1-S | Fixes G-370…G-381 + D205 + D201 `t.widget().dispatch` | ✅ merged | `p5-1s` (`e1a9e22`) | 2026-10-05 | All 12 + D205 (ABORT or same-state return on an input/change event restores the field; +27 B) + D201. Pragma routes attrs for element tags only (components get `role`/`for`/`tabindex`/`aria-*` too — breaking fix); ARIA `false` only on false-valued states; `__sygnalHome` cycle guard; forms: async double submit, initial validation, scoped focus, SYG237 two forms, field types (checkbox groups, select multiple, custom checkboxes; numbers stay strings), id-only rows. Core **41,652 B** (648 B headroom); form used ≈ 3.95 KB. After merge with 2-B: vitest 3,008; browser 230/230 ×3 |
| 2-U | sygnal/ui native parts + Toaster | ✅ merged | `p5-2u` (`3a02349`) | 2026-10-05 | `sygnal/ui` entry (D202): `dialog`, `popover`, `tooltip`, `tabs`/`tabsAttrs`, `accordion`/`accordionAttrs`, `disclosure`/`disclosureAttrs`, `<Toaster>` (re-parenting into modals, D198). 23 browser tests × 3 engines; tree-shaken per part; core 0 B; used 1.1–2.1 KB per part, all ≈ 4.4 KB. UI Parts docs section. Follow-ups: SYG105 false positive for Toaster users + `FIRST_PARTY` entries for the six behaviors; WebKit anchor positioning offset inside `position: fixed` (documented); CLAUDE.md entry count; copy-guides flattening of `ui/` pages (Phase 4) |
| 2-V | VirtualCollection | ✅ merged | `p5-2v` (`adf9a65`) | 2026-10-05 | `<VirtualCollection>` (Collection props + `estimateSize`, `overscan`; ARIA list semantics) exported from `sygnal` (registered on first render, 0 B unused); jumps as element commands on the container (`scrollToIndex`/`scrollToId`, D118 shape — supersedes S-7's `createCommand()`); SYG430–434; 9 browser tests × 3 engines. 10k rows at React+TanStack speed; threshold ≈ 1,000 rows. Used ≈ 8.8 KB (virtual-core ≈ 6.0 KB; now a regular dependency, D209) |
| 2-B | Browser sources + B-4 | ✅ merged | `p5-2b` (`ddbc2ed`) | 2026-10-05 | `makeBrowserDriver()` / `makeBrowserDriverWith(...)` + `Comp.browser` static (GS-7 shape): intersection, resize, media, storage, visibility, online, geolocation; clipboard and storage writes as commands; `t.browser.*` fakes; DOM binding via a definition hook registered with the first driver (0 B core). B-4 `lazy(load, { when: 'visible' \| 'idle' })` + `Comp.load()`. SYG663–665 (+ SYG643 extended). Browser suite 227/227 ×3 engines (WebKit skips cross-tab storage; paste denied in WebKit, error path tested). Used: driver ≈ 0.8 KB + ≈ 0.1–0.3 KB per source; all ≈ 2.0 KB. **Every `lazy()` user +≈ 0.55 KB** → P5-Q19 |
| 1-F1 | F-1 `form` behavior (D193) | ✅ merged | `p5-1f1` (`5c3d07b`) | 2026-10-05 | `form()` behavior on D197 (key-named reply actions) + public helpers (`checkForm`, `formErrors`, `setField`, `getField`, `fieldName(s)`, `replyErrors`, `focusInvalid` on `focusWithin`); 4 spike bugs fixed; SYG230–236 (dev); sygnal-check `form` entry; Forms guide; 38 tests + 3-engine browser test. Used ≈ **3.0 KB** (target 2.4 KB: `defineBehavior` grew to 0.9 KB with D197) → P5-Q18. After merge: vitest 2,890; browser 216/216 ×3; sygnal-check 553; samples 577 clean; core unchanged |
| 1-W | Widgets + web components | ✅ merged | `p5-1w` (`2c6053c`) | 2026-10-05 | `defineWidget` (tag canonical + control form; Portal support; D196 command precedence), `.detail()`, custom-event typings, SYG115 fix, `renderToString` custom elements, codes SYG140–144 + SYG660–662, guides `widgets` and `web-components` (Using + Publishing). flatpickr + Web Awesome browser tests in all three engines (Chromium/Firefox 208/208, WebKit 207 = G-355). Size: unused **41,419 B** (+23: D196 line +16, `.detail()` +7); used ≈ 1.1 KB (target 0.9). Review running |
| 0-S6 | Web components via tags/controls (3 engines) | ✅ done (spike, not merged) | `exp/p5-s6` (`81eb5a9`) | 2026-10-05 | Real Web Awesome 3.14 works canonically (tag + class) and as controls: 18 browser tests × Chromium/Firefox/WebKit (pointer + keyboard, shadow-DOM events, forms, Collection isolation, a11y names, late upgrade, SSR, publish + consume with `defineElement`). WA fires plain `change`/`input` (+ `wa-*` for library events; not CustomEvents). Fixed: custom event names in `events()` types (0 B), SYG115 on hyphenated shorthands (dev). sygnal-check had no false positives. +7 B core (`.detail()`). Caveats: `name` via `attrs` for some elements, Firefox FormData one keystroke behind, dashed JSX props, `renderToString` writes function/object props, controlled drift on custom elements. Guide outline drafted |
| 0-S1 | Widget as a tag + control kind (D189) | ✅ done (spike, not merged) | `exp/p5-s1` (`77aeaba`) | 2026-10-05 | `defineWidget` works as a tag (canonical) and a control: real flatpickr, 22 runtime + 3 Chromium + 3 sygnal-check + type tests; instance survives re-renders/keyed moves, newest props only, Collection isolation, `'widget'` errors to app onError + owner fallback, SSR host + fallback, `t.widget`, `.detail()`. Core: +7 B unused (`.detail()`); ≈ +1.27 KB when used (over 0-A's 450–750 B estimate; dev strings to move behind the dev bridge). Fixed false SYG110/SYG640 on widget tags in sygnal-check. Codes sketched SYG140–144, 660–663. Open questions → Phase-1 batch |
| 0-S2 | Forms: behavior vs helpers | ✅ done (spike, not merged) | `exp/p5-s2` (`b088427`) | 2026-10-05 | Both shapes on one signup+address form, 31 tests, 0 B core, 0 strict/a11y findings. **A (`form` behavior via `uses`)**: 57 user lines (18 wiring), name delegation on the `<form>` (array rows by id), queued submit, async schema/check, server errors + focus; ≈ 3.1 KB used. **B (helpers)**: 89 lines (50 wiring), ≈ 0.6 KB. Recommends A as the A/B lead (trim to ≤ 2.4 KB). Open questions → Phase-1 batch (P5-Q11…) |
| 0-S3 | Native Dialog, Popover, Tooltip (3 engines) | ✅ done (spike, not merged) | `exp/p5-s3` (`21f43d5`) | 2026-10-05 | **All three native in Chromium, Firefox and WebKit** (via the cached Playwright 1.63 builds): 23 browser tests × 3 engines + 7 mock-DOM tests; focus trap/return, Escape, light dismiss, exact anchor positioning, timer-driven tooltip delays, roles/names; 0 SYG7xx; 0 B core. Sizes when used: Dialog +1.05 KB, Popover +0.98 KB, Tooltip +1.84 KB, all three +2.16 KB (vs Zag dialog 18.5 KB / Floating UI 6.4 KB). **0-S4 answer:** a `popover="manual"` toast above an open modal is drawn but inert (no clicks, no Tab, not in Chromium's a11y tree); inside the open `<dialog>` it works. Gaps: `defineBehavior` lacks `timers`, behavior model can't see options, SYG102 on behavior-owned actions, sygnal-check doesn't follow `uses` through factories, `popovertarget`/`commandfor`/… routed to props. Browser-support floor is a release-policy question |
| 0-S5 | `sortable` behavior | ✅ done (spike, not merged) | `exp/p5-s5` (`5372df0`) | 2026-10-05 | **Behavior, no driver needed**: pointer (mouse/pen/touch via document listeners + `elementFromPoint`, no pointer capture), keyboard (lift/move/drop/Escape, live announcements), Collection items by delegation, two lists; focus restore via a spec-command target (0-S2's pattern); 13 mock + 8 Chromium tests; 0 SYG7xx; 0 B core; ≈ 2.3 KB when used (+0.67 KB `defineBehavior`). Gaps: behavior reducers see only their slice; no public "focus inside my children"; nested sortables; `uid` not available to Collection items |

## Phase 1 plan (2026-10-05)

| ID | Work | Depends | Owns |
|---|---|---|---|
| 1-F | Foundations: D196 core/pragma tweaks (except widget command precedence), D197 `defineBehavior` extensions, D194 `focusWithin`, D199 diagnostics/check items, G-356/G-357, adopt test helpers | — | pragma, `src/cycle/dom/**` (IsolateModule, controlledInputModule, EventDelegator), `src/extra/behaviors*`, sygnal-check behaviors/uses model, diagnostics checks |
| 1-W | W-1 `defineWidget` (from 0-S1, D189/D190, + D196 command precedence) and W-3 (`.detail()`, custom-event typings, SYG115 fix, "Web components" guide incl. Publishing, `renderToString` custom elements) | — | `src/extra/widget.ts`, `elementCommands.ts`, `ssr.ts`, `testing.ts` (`t.widget`), `MainDOMSource`/`DocumentDOMSource` types, sygnal-check widgets model, docs web-components |
| 1-F1 | F-1 `form` behavior (from 0-S2, D193) on 1-F's `defineBehavior` + `focusWithin` | 1-F | `src/extra/form*.ts`, docs forms |

## Phase 2 plan (2026-10-05)

| ID | Work | Owns |
|---|---|---|
| 2-U | `sygnal/ui` subpath entry (D202) + native parts from 0-S3/0-S4: Dialog, Popover, Tooltip (behaviors), Tabs, Accordion, Disclosure (behaviors, S-4), Toaster (T-1, D198) | `src/ui/**`, rollup/package exports for `sygnal/ui`, docs `ui/*` |
| 2-V | V-1 `<VirtualCollection>` on `@tanstack/virtual-core` | `src/extra/virtual*`, its entry, docs |
| 2-B | B-3 browser sources (timers declaration shape) + B-4 `lazy(…, { when })` | `src/extra/browserSources*`, `src/lazy.ts` (B-4), docs |
| 2-Z (next) | W-2 `fromZag` + Menu/Select/Combobox in `sygnal/ui`; `sygnal/react` `fromReact` | after 2-U |
| 2-A | A-1 Collection move transitions on View Transitions form B | merged (`7d56c62`) |

## Decisions

| ID | Date | Decision | By |
|---|---|---|---|
| D210 | 2026-10-05 | 2-A: `<Collection viewTransitionName="card">` (string prefix; `card-<id>` names + `view-transition-class`) lives in the core Collection host (+120 B), so SSR output, renderComponent and page-started transitions get names. No FLIP fallback: all three evergreen engines support same-document View Transitions (D195) | User |
| D209 | 2026-10-05 | P5-Q20 + **dependency rule**: don't bundle actively maintained third-party code into the npm builds (users must get patch/security releases through npm and see them in `npm audit`). Small framework-neutral libraries a feature needs → regular `dependencies` with a caret range, external in CJS/ESM, side-effect free (`@tanstack/virtual-core` `^3.17.11` now); heavy, framework-specific or rarely needed ones → optional peers (React, `@zag-js/*`); absorbing into `src/` only for unmaintained code (Cycle.js) or small patched copies. Only the UMD build bundles runtime dependencies. Recorded in CLAUDE.md | User |
| D208 | 2026-10-05 | 1-S follow-ups (coordinator): D205 also restores on a same-state return (same meaning as ABORT) and only for actions handled synchronously inside the input/change event (debounced/delayed actions don't restore; documented); G-370's forwarding of `role`/`for`/`tabindex`/`aria-*` to components is a breaking fix (CHANGELOG); SYG237 sits in PLAN-5's 230–239 range; **G-382**: `valid` should keep the previous validity while an async schema re-validates after the first answer (avoid `disabled={!valid}` flicker) — next fix pass | Coordinator |
| D207 | 2026-10-05 | P5-Q19: `lazy(load, { when: 'visible' \| 'idle' })` keeps the string form; every `lazy()` user carries ≈ +0.55 KB | User |
| D206 | 2026-10-05 | P5-Q18: the `form` behavior's ≈ 3.0 KB used size is accepted (opt-in; `defineBehavior` grew to ≈ 0.9 KB with D197) | User |
| D205 | 2026-10-05 | P5-Q17: an action triggered by input on a value-bound (controlled) field whose STATE handler ABORTs still re-renders that component, so the field is restored to the model's value (React-like). ABORT still means "no state change". Applies to native and form-associated custom elements; a few core bytes; CHANGELOG + docs | User |
| D204 | 2026-10-05 | P5-Q4: icons via a Lucide vanilla recipe; no icon package unless the eval shows agents struggle | User |
| D203 | 2026-10-05 | P5-Q3: adapters `fromZag` (for Menu/Select/Combobox) and `sygnal/react` `fromReact` with the preact/compat alias documented; `sygnal/vue` only on demand; docs present adapters as an escape hatch | User |
| D202 | 2026-10-05 | P5-Q2: the headless UI parts ship as a **subpath of `sygnal`** (e.g. `sygnal/ui`), tree-shaken, with `@zag-js/*` as optional peer dependencies (not a separate `sygnal-ui` package) | User |
| D201 | 2026-10-05 | 1-R follow-ups: widget used size ≈ 1.27 KB accepted (opt-in, outside the core); `t.widget(...).dispatch` added with `emit` kept as an alias (docs use `dispatch`); SSR writes both kebab and lowercase attributes for unknown camelCase props on custom elements (+ IDL names lowercase) | Coordinator |
| D200 | 2026-10-05 | 1-W follow-ups (coordinator): lift the `close`/`togglePopover` command-name reservation (D196's lookup passes `(el, options)` to widget commands, so they work); accept ≈ 1.1 KB used (opt-in, outside the core); shorter host property for the core lookup if it saves bytes; docs and agent context name `mount`'s third parameter `dispatch`, not `emit` (the removed `emit()` helper confuses agents); static SYG110 on unresolvable widget imports accepted (same as components). Applied in the 1-W review fix pass | Coordinator |
| D199 | 2026-10-05 | Coordinator calls from the spikes: SYG102 skips behavior-owned actions; sygnal-check follows `uses` through factory functions; SYG202 not reported for canonical Collection-item self-removal (G-357); `t.fail(sink, { status, body })` accepted as documented (code follows the JSDoc); `processForm` kept, documented as real-DOM (FormData) only; read-only `from` lens is canonical for form field arrays; the spike test helpers (`__pw`, `__pwInput`, `BROWSER_TESTS_ONLY`) are adopted; widget dev strings move behind the dev bridge (SYG14x/66x codes); `DOM.select(WidgetTag)` → dev warning (SYG143); widgets inside Portal: Portal children are walked by `pres` if cheap, else documented; `renderToString` for hyphenated tags skips function/object props and writes camelCase props as kebab-case attributes (SSR bundle only); custom-elements.json event-name checking deferred (post-6.0) | Coordinator |
| D198 | 2026-10-05 | P5-Q16 Toaster: `popover="manual"` region re-parented into the topmost open modal (MutationObserver in the Toaster's hooks), replacing S-5's "otherwise Portal". A real screen-reader check (VoiceOver/NVDA) is a release task | User |
| D197 | 2026-10-05 | P5-Q15: extend `defineBehavior` (helper-side, 0 B core): `timers: (slice, options) => …`, options passed to model handlers, an explicit host-state reducer form, and the behavior's `uses` key available to it. Additive | User |
| D196 | 2026-10-05 | P5-Q14 (all approved): pragma routes `aria-*` booleans as `"true"`/`"false"` and `popovertarget`, `popovertargetaction`, `commandfor`, `command`, `closedby`, `interestfor`, `anchor` to attributes; `IsolateModule` no longer throws for an element moved out of its component's DOM (−39 B); a widget tag's declared command wins over a native method of the same name (+9 B); form-associated custom elements get `value`/`checked` re-synced when the model rejects a change | User |
| D195 | 2026-10-05 | P5-Q13: sygnal-ui targets current evergreen browsers (Chromium, Firefox, Safari; Baseline 2026); no Floating UI fallback in the package; docs state the floor and show a Floating UI recipe for older browsers | User |
| D194 | 2026-10-05 | P5-Q12: an exported helper (e.g. `focusWithin(selector)`) built on the existing element-command mechanism lets a parent focus an element inside its children (0 B core); used by `form` and `sortable`; documented | User |
| D193 | 2026-10-05 | P5-Q11: the `form` behavior via `uses` (shape A, trimmed to ≤ 2.4 KB) is the lead and canonical recipe; shape B's helpers stay exported as the escape hatch; the Phase 4 A/B still measures both | User |
| D192 | 2026-10-05 | Phase 0 closed: all six spikes done (0-S1…S6), 0-A/0-B merged | Coordinator |
| D191 | 2026-10-05 | Firefox/WebKit for PLAN-5 browser tests: bump `browser-tests` (and `benchmarks`) Playwright to the version matching the cached builds (no browser download) | User |
| D190 | 2026-10-05 | W-1 design from 0-A: the widget tag carries the control render hook and returns a `widget` marker handled by a `pres.widget` registry entry during the owner's reconcile (gives the owner for `'widget'` errors), registered inside the first `defineWidget` call (not on import); declared commands installed as host own-methods (0 B core), with names colliding with specially-handled native methods (`close`, `togglePopover`) rejected; `DOM.select(WidgetTag)` is not canonical (dev warning unless free to support) | Coordinator |
| D189 | 2026-10-05 | P5-Q10 (widgets vs D141): `defineWidget` returns a **tag** rendered and selected canonically (`<DatePicker className="due" value={…} />`, `DOM.select('.due').events('change').detail()`, ELEMENT commands resolved through the host element), and the same spec also works as a control (`controls({ Due: datePicker })`, alternative form). Docs and agent docs show the tag + selector form. Implemented through the PLAN-4.6 marker registry (0 B when unused). Supersedes D101's "widget is a kind of control" as the only form | User |

## Gaps

| ID | Found | Sev | Area | Description | Status |
|---|---|---|---|---|---|
| G-358 | 1-F × 1-W merge | Med | web components | Web Awesome 'form-associated: processForm on input — FormData vs the element value per keystroke' times out on all three engines after merging 1-F (custom-element value sync / hyphenated tags non-plain) with 1-W | Fixed (1-R) |
| G-359 | review 1-W | High | widget/Portal | A widget inside a removed `<Portal>` is never unmounted (Portal destroy removes its content without running destroy hooks). Confirmed | Fixed (1-R) |
| G-360 | review 1-W | Med/High | widget | A host reused by snabbdom for a non-widget vnode (same sel/key; incl. the error fallback) is never unmounted. Confirmed | Fixed (1-R) |
| G-361 | review 1-W | Med | widget | Failure map keyed by `id ?? widget`, never cleared: healthy siblings and same-key other widgets render the fallback; fallback persists after recovery. Confirmed | Fixed (1-R) |
| G-362 | review 1-W | Med | widget | Shallow compare includes object host props (`style`/`attrs`/`class`), so every render remounts/updates. Confirmed | Fixed (1-R) |
| G-363 | review 1-W | Med | widget/Transition | Transition around a widget does nothing (widget host hooks replace Transition's); shared hook object hazard. Confirmed | Fixed (1-R) |
| G-364 | review 1-W | Med | widget | A `className` change wipes classes the library added to the host. Confirmed | Fixed (1-R) |
| G-365 | review 1-W | Med/Low | SSR | camelCase→kebab for custom elements is wrong for IDL names (`tabIndex`→`tab-index`) and regresses Lit's lowercase default attributes. Confirmed (IDL) | Fixed (1-R) |
| G-366 | review 1-W | Med/Low | sygnal-check | SYG141/SYG142 false positives when the host (custom element or library-driven element) provides the event/method; SYG142 is an error. Confirmed | Fixed (1-R) |
| G-367 | review 1-W | Low | widget | Remount path without `update`: a throwing `mount` reported as SYG661, stale record. Confirmed | Fixed (1-R) |
| G-368 | review 1-W | Low | widget | `ref` silently dropped (guide says every prop reaches the widget) | Fixed (1-R) |
| G-369 | review 1-W | Low | testing | Mock-DOM command check with a control wrapping a widget uses the wrong host tag; `widgetOf` not scoped | Fixed (1-R) |
| G-370 | review 1-F | High | pragma | D196 attribute routing also applies to component tags: props named `anchor`, `command`, `commandfor`, `closedby`, `popovertarget(action)`, `interestfor` no longer reach components (`role`/`for`/`tabindex`/`aria-*` already didn't). Confirmed | Fixed (1-S) |
| G-371 | review 1-F1 | High/Med | forms | Async schema: two submits before validation settles dispatch the submit action twice (double POST). Confirmed | Fixed (1-S) |
| G-372 | review 1-F | Med | pragma/a11y | `aria-*={false}` renders `"false"` on string/IDREF ARIA attributes (`aria-label={cond && label}` announces "false"); `null` → `"null"` (pre-existing). Confirmed | Fixed (1-S) |
| G-373 | review 1-F1 | Med | forms | `focusInvalid` not scoped to the form element: focuses a same-named field in another form or an earlier child. Confirmed | Fixed (1-S) |
| G-374 | review 1-F1 | Med/Low | forms | Two `form` uses in one host default to the same `'form'` selector and listen to each other, with no diagnostic. Confirmed | Fixed (1-S) |
| G-375 | review 1-F1 | Low/Med | forms | Async schema: initial state has no errors, so `valid` starts true; `form()` runs `validate` at module load. Confirmed | Fixed (1-S) |
| G-376 | review 1-F1 | Low/Med | forms | Field types beyond text/checkbox unsupported and undocumented (custom checkboxes, select multiple, checkbox groups, number/date coercion, file) | Fixed (1-S) |
| G-377 | review 1-F1 | Low | diagnostics | SYG233 false positives for schemas that reshape output (renames) | Fixed (1-S) |
| G-378 | review 1-F | Low | behaviors | A behavior model entry with both `STATE` and `HOST` silently loses `STATE`. Confirmed | Fixed (1-S) |
| G-379 | review 1-F1 | Low | forms | Presence checks use `!== undefined` (optional fields ignored + SYG230/235); named buttons raise SYG230 on focusout | Fixed (1-S) |
| G-380 | review 1-F1 | Low | forms | `replyErrors`/`getField` fall back from row id to index, misplacing index-keyed server errors | Fixed (1-S) |
| G-381 | review 1-F | Low | DOM | No guard against a `__sygnalHome` cycle (infinite loop / stack overflow) | Fixed (1-S) |
| G-383 | review 2-B | High | browser sources | A component defined before the first browser driver exists never gets its DOM binding (definitions cached; `browser` not in the staleness keys): intersection/resize silently do nothing (multi-island pages, test files mixing fake and real drivers). Confirmed | → 2-R |
| G-384 | review 2-B | Med/High | browser sources | The same-page synthetic `storage` event fires even for unchanged values, so a model that echoes the stored value loops forever (real driver and fake). Confirmed | → 2-R |
| G-385 | review 2-B | Med | lazy when | `lazy(…, { when: 'visible' })` inside Suspense counts as pending: blanks the boundary and the placeholder lands at the boundary's position, so it loads at once | → 2-R |
| G-386 | review 2-B | Low/Med | lazy when | A never-triggered `when` keeps disposed owners in memory (pending promise closures) | → 2-R |
| G-387 | review 2-B | Low/Med | testing | `t.browser` fake sends no initial observer report and ignores selectors, so tests can pass on the fake and fail for real | → 2-R |
| G-388 | review 2-B | Low | browser sources | Sink commands recognised only by their first key (`{ ok, copy }` is dropped) | → 2-R |
| G-389 | review 2-B | Low | browser sources | Synchronous throws in command handlers (JSON.stringify of BigInt/cycles, missing clipboard methods) skip the `error` action | → 2-R |
| G-390 | review 2-B | Low | perf | One observer and one ElementFinder subscription per declaration (1,000-item Collection → 1,000 observers, 1,000 `querySelectorAll` per patch) | → 2-R |
| G-391 | review 2-B | Low | browser-tests | `__pwBrowser` context changes (offline, permissions, media) aren't reset between suites | → 2-R |
| G-392 | 2-U | Low | sygnal-check | SYG105 false positive for every Toaster user (`TOAST` "emitted but nothing selects it"); `sygnal/ui` behaviors not in `FIRST_PARTY` (option typos unchecked) | → 2-R |
| G-393 | 2-U | Low | core/testing | A root component with a `model` but no `initialState` renders nothing under `renderComponent`, with no diagnostic (verify against today's documented behaviour, G-172) | → 2-R (verify) |
| G-394 | review 2-V | High | VirtualCollection | An inline `estimateSize` function (the guide's own pattern) clears every measured row height on each owner render; rows aren't re-measured. Confirmed | → 2-S |
| G-395 | review 2-V | Med/High | VirtualCollection | SYG430 "grows" misfires on a bounded container above viewport height that fits its rows; clamping then leaves unreachable blank rows. Confirmed | → 2-S |
| G-396 | review 2-V | Med/High | SSR | `renderVirtual` ignores filter, sort, lens/missing `from`, pass-through props and children (hydration mismatch). Confirmed | → 2-S |
| G-397 | review 2-U | Med/High | ui/tabs | Removing the selected tab leaves every tab `tabindex=-1` and every panel hidden. Confirmed | → 2-S |
| G-398 | review 2-U | Med | ui/toaster | Auto ids collide with user ids (and `'7'` vs `7`): a toast stays invisible and stuck in state. Confirmed | → 2-S |
| G-399 | review 2-U | Med | ui/toaster | One pause flag shared by pointer and focus: timers resume under keyboard focus; removed Dismiss button can leave the region paused | → 2-S |
| G-400 | review 2-U | Med | ui/dialog, popover | Unmounting an open dialog/popover leaves `open: true`, so it can never be reopened | → 2-S |
| G-401 | review 2-V | Med | VirtualCollection | Focus lost when the focused row scrolls out (keep the focused index in range) | → 2-S |
| G-402 | review 2-V | Low/Med | VirtualCollection | ResizeObserver loop errors from synchronous measurement + patch | → 2-S |
| G-403 | review 2-U | Low/Med | ui/tooltip | ENTER/LEAVE share one state across pointer and focus (touch taps never show; mouse-out hides a focused tip); one document keydown listener per instance | → 2-S |
| G-404 | review 2-U | Low/Med | ui/toaster | Modal dialogs inside shadow DOM (sygnal/element) aren't seen | → 2-S |
| G-405 | review 2-U | Low | ui/dialog | `cancelable: false` doesn't reliably stop Escape in Chromium (CloseWatcher) | → 2-S |
| G-406 | review 2-U | Low | ui/popover | OPEN then CLOSE in one tick leaves it open (state mirrored from async `toggle`) | → 2-S |
| G-407 | review 2-U/2-V | Low | misc | VirtualCollection `getItemKey` rebuilt on every array change (6.7 ms/flush at 100k); native ESM without a bundler hits virtual-core's `process.env.NODE_ENV`; Dialog `returnFocus` targets the first matching trigger; `idsOf` collisions / host reducers dropping the `keyed()` prefix | → 2-S |
| G-382 | 1-S | Low | forms | `valid` is false while an async schema re-validates, so `disabled={!valid}` flickers per keystroke; keep the previous validity after the first answer | → 2-R |
| G-356 | 0-S4 | Low | DOM/isolation | An element moved out of its component's DOM (toast re-parented into a modal): `IsolateModule.getRootElement` throws ("No root element found"); with the fix, the delegator's simulated bubbling still follows DOM parents, so intermediate scopes miss the moved region's events | Fixed (1-F; `__sygnalHome` for movers) |
| G-357 | 0-S4 | Low | diagnostics | SYG202 reported for `() => undefined` on Collection items although llms.txt documents it as the canonical self-removal | Fixed (1-F) |
| G-355 | 0-B | Low | router test | WebKit: 'link click, back, scroll restore, focus, document.title' (router-5-4b) fails: scroll not restored after back (`scrollY 1663`). Chromium/Firefox pass | Fixed (1-F: the test shared history with an earlier suite; not a router bug) |

## Log

- 2026-10-05 — Review of 2-U + 2-V: 14 findings (G-394…G-407). 2-S started.
- 2026-10-05 — Resumed. 2-A merged (D210, user: naming in the core); gates green on three engines (267/267) except the known flaky `p5-1s-forms` test (2-R). Review of 2-U+2-V, 2-Z and 2-R started.
- 2026-10-05 — D209 (user): dependency rule; `@tanstack/virtual-core` moved to `dependencies` (^3.17.11), external in the npm builds; all gates green.
- 2026-10-05 — 2-V and 2-U merged (resolved additive conflicts); all gates green on three engines (262/262; samples 621). Review of 2-B: 9 findings (G-383…G-391); 2-U follow-ups G-392/G-393.
- 2026-10-05 — 1-S merged (2 additive conflicts with 2-B; CHANGELOG dedup); all gates green on three engines (230/230); core 41,652 B. D207 (user), D208.
- 2026-10-05 — 2-B merged (three engines 227/227; core 41,500 B). Open: P5-Q19 (lazy `when` size).
- 2026-10-05 — Review of 1-F + 1-F1: 12 findings (G-370…G-381). 1-S started.
- 2026-10-05 — D205 (ABORT restores controlled fields), D206 (form size accepted). Review of 1-F + 1-F1 and Phase 2 (2-U, 2-V, 2-B) started.
- 2026-10-05 — 1-F1 merged (all gates green, three engines 216/216). D202–D204 (user: UI as a `sygnal` subpath; fromZag + React adapters; Lucide recipe).
- 2026-10-05 — 1-R merged (all gates green, three engines 214/214; 41,500 B). D201. 1-F1 running.
- 2026-10-05 — 1-F merged (3 conflicts with 1-W resolved); one cross-branch browser failure (G-358). Review of 1-W: 11 findings (G-359…G-369). 1-R started.
- 2026-10-05 — 1-W merged (gates green; 41,419 B). D200. Review of 1-W started.
- 2026-10-05 — Decision batch answered (D193–D198; D199 coordinator). Phase 0 closed (D192). Phase 1: 1-F and 1-W started.
- 2026-10-05 — 0-S4 done (toasts: manual popover re-parented into the open modal). All Phase 0 spikes done.
- 2026-10-05 — 0-S6 done (web components with real Web Awesome, three engines).
- 2026-10-05 — 0-S5 done (sortable as a behavior).
- 2026-10-05 — 0-B merged (Playwright 1.63, three engines); browser suite 184/184/183. 0-S4 and 0-S6 started.
- 2026-10-05 — 0-S3 done: native Dialog/Popover/Tooltip work in all three engines.
- 2026-10-05 — 0-S1 done (defineWidget prototype).
- 2026-10-05 — 0-A merged (interfaces hold; E1–E6 pass). D190, D191 (user: Playwright bump). 0-S2 done (forms A/B). 0-B started.
- 2026-10-05 — D189 (P5-Q10). 0-A, 0-S1, 0-S2, 0-S3 started.
- 2026-10-05 — `plan5-integration` cut from `plan46-complete`. Tracker created; budgets and code reservations recorded. 0-A started.
