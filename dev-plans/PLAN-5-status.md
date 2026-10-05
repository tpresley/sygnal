# PLAN-5 Status Tracker

Tracks progress for [PLAN-5.md](PLAN-5.md) (ecosystem components and integrations). The coordinator maintains it.

**Numbering:** decisions continue from **D189**, gaps from **G-355** (PLAN-4.6 ended at D188 / G-354). Earlier PLAN-5 decisions D101–D105 (recorded in `PLAN-4-status.md`) apply.

**Integration branch:** `plan5-integration`, cut from `plan46-complete` (`7146161`) on 2026-10-05, in worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** Phase 1: 1-W and 1-F merged; 1-R (fixes) running; 1-F1 (forms) next.

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
| 1-R | Fixes: G-358 (merge interaction), 1-W review (G-359…G-369), D200 | 🟡 running | `p5-1r` | | |
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

## Decisions

| ID | Date | Decision | By |
|---|---|---|---|
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
| G-358 | 1-F × 1-W merge | Med | web components | Web Awesome 'form-associated: processForm on input — FormData vs the element value per keystroke' times out on all three engines after merging 1-F (custom-element value sync / hyphenated tags non-plain) with 1-W | → 1-R |
| G-359 | review 1-W | High | widget/Portal | A widget inside a removed `<Portal>` is never unmounted (Portal destroy removes its content without running destroy hooks). Confirmed | → 1-R |
| G-360 | review 1-W | Med/High | widget | A host reused by snabbdom for a non-widget vnode (same sel/key; incl. the error fallback) is never unmounted. Confirmed | → 1-R |
| G-361 | review 1-W | Med | widget | Failure map keyed by `id ?? widget`, never cleared: healthy siblings and same-key other widgets render the fallback; fallback persists after recovery. Confirmed | → 1-R |
| G-362 | review 1-W | Med | widget | Shallow compare includes object host props (`style`/`attrs`/`class`), so every render remounts/updates. Confirmed | → 1-R |
| G-363 | review 1-W | Med | widget/Transition | Transition around a widget does nothing (widget host hooks replace Transition's); shared hook object hazard. Confirmed | → 1-R |
| G-364 | review 1-W | Med | widget | A `className` change wipes classes the library added to the host. Confirmed | → 1-R |
| G-365 | review 1-W | Med/Low | SSR | camelCase→kebab for custom elements is wrong for IDL names (`tabIndex`→`tab-index`) and regresses Lit's lowercase default attributes. Confirmed (IDL) | → 1-R |
| G-366 | review 1-W | Med/Low | sygnal-check | SYG141/SYG142 false positives when the host (custom element or library-driven element) provides the event/method; SYG142 is an error. Confirmed | → 1-R |
| G-367 | review 1-W | Low | widget | Remount path without `update`: a throwing `mount` reported as SYG661, stale record. Confirmed | → 1-R |
| G-368 | review 1-W | Low | widget | `ref` silently dropped (guide says every prop reaches the widget) | → 1-R |
| G-369 | review 1-W | Low | testing | Mock-DOM command check with a control wrapping a widget uses the wrong host tag; `widgetOf` not scoped | → 1-R |
| G-356 | 0-S4 | Low | DOM/isolation | An element moved out of its component's DOM (toast re-parented into a modal): `IsolateModule.getRootElement` throws ("No root element found"); with the fix, the delegator's simulated bubbling still follows DOM parents, so intermediate scopes miss the moved region's events | Fixed (1-F; `__sygnalHome` for movers) |
| G-357 | 0-S4 | Low | diagnostics | SYG202 reported for `() => undefined` on Collection items although llms.txt documents it as the canonical self-removal | Fixed (1-F) |
| G-355 | 0-B | Low | router test | WebKit: 'link click, back, scroll restore, focus, document.title' (router-5-4b) fails: scroll not restored after back (`scrollY 1663`). Chromium/Firefox pass | Fixed (1-F: the test shared history with an earlier suite; not a router bug) |

## Log

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
