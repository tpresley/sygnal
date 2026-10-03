# Handoff: from PLAN-4 (controls and core ergonomics) to PLAN-5 (ecosystem)

**From:** the gap-study session (`claude/sygnal-feature-gaps-c61a02`), author of [`PLAN-4.md`](PLAN-4.md).
**To:** the ecosystem session (`claude/sygnal-component-research-b1873e`), author of the plan drafted as `PLAN-4.md`.
**Date:** 2026-10-02.

Read `PLAN-4.md` and the two reports for detail:
- [`research/sygnal-6-gap-study.html`](research/sygnal-6-gap-study.html)
- [`research/view-intent-linking.html`](research/view-intent-linking.html)

From the ecosystem branch, read files on this branch with `git show claude/sygnal-feature-gaps-c61a02:<path>`.

## 1. Renumbering (decided by the user)

Plans are numbered in run order:

| Plan | Was | Now | Runs |
|---|---|---|---|
| Network layer, router, cache, HEAD | PLAN-3 | PLAN-3 | now (4-C eval pending) |
| Controls and core ergonomics (CT-1, GS-1…GS-16) | drafted as PLAN-5 | **PLAN-4** | after PLAN-3 |
| Ecosystem components and integrations | PLAN-4 | **PLAN-5** | after PLAN-4; rebases onto `plan4-integration` |

**What the ecosystem session changes on its own branch:**
- Rename `dev-plans/PLAN-4.md` to `dev-plans/PLAN-5.md`.
- Inside it:
  - its own name becomes PLAN-5;
  - its questions `P4-Q1…P4-Q6` become `P5-Q1…P5-Q6`;
  - a future tracker becomes `PLAN-5-status.md`, the integration branch `plan5-integration`, subagent branches `p5-*`, experiments `exp/p5-*`.
- Update cross-references in `HANDOFF-to-PLAN-3.md` and in its research README only where they name the ecosystem plan.
- Add a one-line rename note at the top of each document, so that "PLAN-4" in PLAN-3's documents (written before the rename) is read as the ecosystem plan.
- **Leave alone:** D-numbers (global), and its item IDs (W-, F-, T-, A-, V-, B-, U-), which don't collide.
- **The start condition changes:** "starts after PLAN-3" becomes "starts after PLAN-4; Phase 0 rebases onto the completed `plan4-integration`".

## 2. Constraints PLAN-5 inherits from PLAN-4

- **Budgets:** PLAN-4 §6 asks the user for:
  - a PLAN-4 core cap of 900 B, leaving about 1 KB of the 1,897 B PLAN-3 left;
  - `llms.txt` cap raised to 315 lines, with a −5-line trim;
  - SKILL.md cap raised to 38 KB.

  PLAN-5's budgets are whatever remains at the end of PLAN-4. Its tracker will record the final numbers. Revisit P5-Q6 (formerly P4-Q6, resolved by D76) when PLAN-4 ends.
- **Reserved diagnostic codes** (PLAN-4 §5). PLAN-5 must not use these:
  - SYG124–129
  - SYG222–226
  - SYG422–423
  - SYG510
  - SYG640–649
  - **SYG701–719** (a new 7xx "a11y" lane)

  Take PLAN-5's codes from other free numbers and reserve them in the PLAN-5 plan before Phase 1.
- **Terminology:** "control" now means a CT-1 element token (`controls({ Save: 'button' })`). In PLAN-5 docs, write "form field", not "form control", and don't call widgets "controls". The D82 words stay: "reply actions", and "route" only for the router.
- **Eval tasks:** PLAN-4 adds tasks 26–29 in a new `ergo` tier: 26 autosave + persist, 27 undo editor, 28 stopwatch, 29 accessible signup with a native `<dialog>`. PLAN-5's new tasks start at 30. Its planned "modal/menu flow" task should test a menu or combobox, so it doesn't duplicate 29's dialog.
- **a11y gate:** from PLAN-4 on, examples, templates and doc samples must be free of SYG7xx findings. Every PLAN-5 component, recipe and example must pass.
- **Canonical forms:** PLAN-4 decides after an eval (P4-D) whether controls replace class selectors as the canonical form. If they do, every PLAN-5 example, recipe and `sygnal-ui` component is written with controls.

## 3. Suggested updates and investigations for PLAN-5

These are suggestions for the ecosystem session to evaluate and accept, change or decline. Record the outcome in its plan. "Investigate" means a spike or a measurement before deciding.

| # | PLAN-5 item | What PLAN-4 provides | Suggestion | Kind |
|---|---|---|---|---|
| S-1 | **W-1** `defineWidget`, P5-Q1 (`<Widget>` marker vs function form) | CT-1 controls: element tokens rendered as JSX tags, accepted by `DOM.*`, `simulateEvent` and `query`; a pragma marker for non-component tags | **Investigate "a widget is a kind of control":** `const { DueDate } = controls({ DueDate: datePicker })`, where `datePicker = defineWidget({...})`. The view renders `<DueDate value={…} />`, the intent reads `DOM.events(DueDate, 'change').detail()`, and tests use `t.widget(DueDate)`. This could settle P5-Q1 with no extra marker component: the control marker already exists in the pragma. | Investigate (P1) |
| S-2 | **F-1** forms, P5-Q5 (form static vs helpers over `processForm`) | GS-1 behaviors (`defineBehavior`, `uses`, namespaced actions, slice state); GS-2 element commands (`{ focus: Email }`); GS-9 `uid()`; the SYG702/708 label rules | **Add a third shape to the P5-Q5 A/B:** a form as a behavior, e.g. `Signup.uses = { form: form(schema, { fields: { email: Email, … }, submit: Submit }) }`. Use element commands for "focus the first invalid field" and `uid` for `aria-describedby`. Field controls make field names checkable. | Update + investigate |
| S-3 | **U-1** `sygnal-ui`: Dialog, Popover, Tooltip (Zag) | GS-2 element commands (`showModal`, `close`, `showPopover`, `hidePopover`); the native `close`/`toggle` events in intent | **Investigate native-first.** `<dialog>` + `showModal` for Dialog. The Popover API + CSS anchor positioning (Baseline since January 2026) for Popover and Tooltip. Keep Zag for Menu, Select and Combobox, where keyboard and ARIA behaviour is the hard part. This could remove the 18.5 KB Zag dialog from the common path. | Investigate (P1) |
| S-4 | **U-1** native parts (Tabs, Accordion, Disclosure) | GS-1 behaviors | Ship the native MVI parts as **behaviors** where they wire the host's markup, and as components only where they render their own. Use the first-party behaviors (`pager`, `selection`, `undoable`) as the style reference. | Update |
| S-5 | **T-1** toasts | GS-7 `timers` static (`{ after: ms, action }`); possibly the Popover API top layer | Auto-dismiss through `timers`, not ad-hoc timeouts, so tests use fake timers. Investigate `popover="manual"` so toasts render above modal dialogs without Portal z-index work. | Update + investigate |
| S-6 | **A-1** FLIP transitions | GS-12 View Transitions spike and decision record (PLAN-4 P-1) | **Wait for P-1's decision.** If View Transitions cover Collection moves, shrink A-1 to a fallback for browsers without them, or drop it. | Dependency |
| S-7 | **V-1** `VirtualCollection` | GS-16 performance baseline (js-framework-benchmark + `browser-tests/perf`); GS-2 `scrollIntoView` | Use P-3's numbers to set V-1's targets and to choose the default threshold where virtualisation pays. Consider `scrollToIndex` as an element command, not a new API. | Update |
| S-8 | **B-3** browser sources | GS-7 `timers` declaration shape; GS-5 `persist`; PLAN-3's `browserSignals.ts` | Use **the same declaration shape** as `timers` (state → named specs, diffed, falsy stops, hidden-page pause). Leave timers out of B-3. Scope B-3's storage source to "read and observe arbitrary keys" and point to `persist` for state persistence, so there aren't two answers. | Update |
| S-9 | **B-1** drag and drop | GS-3 a11y rules; GS-2 focus commands; GS-1 behaviors | Keyboard DnD must pass SYG701/705. Use element commands to restore focus after a keyboard move. Consider a `sortable` **behavior** over the host's Collection instead of a driver-only API. | Update + investigate |
| S-10 | **W-3** web components, `.detail()` | CT-1 controls with custom-element tags | Check `controls({ Rating: 'wa-rating' })` end to end: typed props via `JSX.IntrinsicElements` augmentation, `DOM.events(Rating, 'wa-change').detail()`, and SYG110/SYG126 by identifier. If it works, the web-components guide leads with controls. | Investigate |
| S-11 | Custom-element **output** | GS-13 spike (`sygnal/element` `defineElement`, PLAN-4 P-2) | Coordinate naming with W-3 so "consume" and "publish" read as a pair in the docs: one guide page, two sections. If the user adopts GS-13, PLAN-5 owns the guide. | Coordinate |
| S-12 | **B-2** i18n | GS-5 `persist`; GS-9 `uid` | Persist the chosen locale with `persist`. The a11y rules check literal labels only, so translated labels are fine. | Update (docs) |
| S-13 | Test helpers (`t.widget`, U-1 test examples) | CT-1 controls in `simulateEvent`/`query`; GS-10 `t.actions`; GS-14 Testing Library docs | Accept controls in `t.widget(…)`. Use `t.actions` in U-1 test examples to show behaviour. Show Testing Library role queries in the component docs, where they fit headless components naturally. | Update |
| S-14 | Phase 4 eval | PLAN-4's `ergo` tier and 4-E results | Run PLAN-5's learn-time and context check against PLAN-4's 4-E run, not PLAN-3's. | Update |

## 4. What PLAN-4 needs from PLAN-5

Nothing blocks PLAN-4. Two items would help:
- Confirmation that the codes in §2 are reserved.
- An early read on S-1. If widgets become a kind of control, PLAN-4's 1-A should leave room in the control marker for a widget spec, such as a `kind` field. It costs nothing now and avoids a second pragma path later.
