# sygnal/ui native parts: bug and friction sweep

Scope: `sygnal/ui`'s native parts (accordion, disclosure, dialog, popover, tooltip / tooltips, tabs,
Toaster), met the way an app author or a coding agent would: state-driven use, composition, several
instances, Collection / isolated child / Portal, keyboard and focus, forms in dialogs, tests with
`renderComponent` (mock DOM and `dom: 'real'`), the three browser engines, the docs' own examples,
`sygnal-check --strict` and the types. Menu / Select / Combobox (Zag) are a sibling sweep.

Branch `claude/ui-sweep-native-3bf603` (off `claude/advanced-integration` at 18a73b35), 2026-10-31. Round 2 (below) on aa63f44f.

## The accordion lead

The maintainer remembered feedback that an accordion whose open state is driven from component
state "didn't behave as expected". It is real, in three ways, all in how `accordion()` read a slice
the host wrote:

1. **Numbers in `expanded` never opened.** The behavior stored values as strings (the `expanded`
   option and clicks: `data-value` is a string), but `accordionAttrs` and the reducers compared
   with `includes(String(v))` against whatever the host wrote. Ids from data are often numbers:
   `{ ...state.faq, expanded: [order.id] }` opened nothing, and a click on that header then
   *added* `'7'` next to `7` instead of closing it.
2. **A single value matched by substring.** `expanded: '12'` (a host writing one value for a
   single-open accordion) went through `String.prototype.includes`: panels `1`, `2` and `12` all
   opened.
3. **`collapsible: false` was lost** when a host reducer replaced the slice (`faq: { expanded: ['b'] }`):
   the flag lived only in the slice, so the last panel could then be closed.

Plus two forms that look like they should work and don't, both now documented on the accordion
page: the same key in `initialState` (the behavior's slice replaces it; this is SYG127 in dev and
in `sygnal-check`, but nothing in the accordion page said how to set the start state), and a host
`'faq.TOGGLE'` entry returning `ABORT` to refuse a toggle (it keeps the behavior's update; the
working veto is `props.previousState`).

Which of these the original feedback was is unknown; (1) is the likeliest, as it fails silently
with the most natural code.

What already worked (probes, no change needed): a host reducer setting several values with
`multiple`, toggling back and forth in sync, an accordion in every Collection item (the item's own
`faq` slice from the parent's array is respected; a click writes it back), in an isolated child,
items removed while open (no error; the stale value stays in `expanded`), SSR (`renderToString`
renders `hidden` / `aria-expanded` from the `expanded` option).

## Findings

Severity: **bug** (wrong behaviour), **friction** (works, but needs boilerplate, a surprising form
or a missing option), **docs/types** (gap), **n/a** (not worth acting on).

| # | Part | Class | Finding | Status |
|---|---|---|---|---|
| 1 | accordion | bug | Numbers in a host-written `expanded` never open; a click adds a duplicate | **fixed** |
| 2 | accordion | bug | A string `expanded` matches by substring (`'12'` opens 1, 2, 12) | **fixed** |
| 3 | accordion | bug | `collapsible: false` lost when a host reducer replaces the slice | **fixed** |
| 4 | dialog | bug | Firefox / WebKit: Escape after an earlier `'ok'` close reports `returnValue: 'ok'` again: the app commits the cancelled edit | **fixed** |
| 5 | tooltip, tooltips | bug | Chromium / Firefox: a mouse click focuses the trigger, so the tip stays after the pointer leaves (until something else takes the focus); also comes back when a dialog opened from that trigger is closed with the mouse | **fixed** |
| 6 | dialog, tabs (docs) | docs (bug in effect) | The overview, dialog and tabs pages say an intent action of the same name *adds* a trigger (`'tabs.SELECT': DOM.click('.go-billing')`); it *replaces* the behavior's: tab clicks stop selecting, the dialog's own trigger stops opening it | **docs fixed**; API question below |
| 7 | dialog, popover | docs + friction | `state.x.open` is a mirror: a reducer writing `open: true` opens nothing, and the state then says open while the element is closed | **docs fixed**; diagnostic recommended |
| 8 | dialog, popover, tooltip | docs | Inside a `<Portal>` the behavior never finds its element: the dialog never opens and `SYNC` sets the state back to closed, silently. The Portals page called portals "essential for modals" | **docs fixed** (Portals, dialog, popover pages) |
| 9 | accordion | docs | No guidance on driving it from state: start values (option, not `initialState`), string comparison, vetoing a toggle, stale values after removal | **docs fixed** |
| 10 | dialog | types | `DialogActions.SYNC` was `false`; it is `true` when `showModal()` threw | **fixed** (`boolean`, docs row) |
| 11 | dialog | docs | A `method="dialog"` form: Enter submits with the *first* submit button, so a Cancel button placed first makes Enter cancel | **docs fixed** |
| 12 | tooltip | friction | WebKit: a tooltip on a dialog trigger stays open (state `open`, under the backdrop) while the dialog is open: WebKit sends no `pointerleave` for a covered element and doesn't focus a clicked button | open (recommendation R3) |
| 13 | tooltip | n/a | After a keyboard close of a dialog the returned focus shows the trigger's tip in Chromium and WebKit, not in Firefox (its `:focus-visible` call) | engine difference |
| 14 | tabs | n/a | Without `selected`, `state.tabs.selected` is `null` while the first tab shows (typed and documented) | none |
| 15 | accordion | n/a | Values of removed items stay in `expanded` (harmless; documented now) | none |
| 16 | (core, out of scope) | friction | `EVENTS: (s) => event('TOAST', { … })` (the function form around `event()`) sends nothing, with no dev diagnostic and nothing from `sygnal-check --strict`; the canonical form is `event('TOAST', (s) => …)` | follow-up |

Checked and fine (no finding): tabs inside an accordion panel (Left / Right stay in the tabs,
Up / Down in the headers, a closed section hides them); a popover in a dialog (already covered);
a dialog in every Collection item (each opens its own, Escape returns the focus to that row's
trigger); a dialog in an isolated child, two instances (the slice lives in the parent); a form in a
dialog (`required` blocks OK, Enter submits, `CLOSED` gets the value); the Toaster with toasts from
a Collection item and an isolated child and the `<Toaster>` rendered deep in the tree; the docs'
Testing snippets for dialog, disclosure, popover and accordion, run as written; SSR of accordion,
tabs and disclosure; `sygnal-check --strict` on typical usage (`probes/Typical.jsx`, and the browser
suite: clean once the inputs had labels, SYG702); the other `ui.d.ts` action and state types against the
runtime.

## Minimal repros (before the fixes)

```jsx
// 1, 2: renderComponent(Faq, { dom: 'real' }) then click .set
Faq.uses = { faq: accordion({ trigger: '.trig' }) }
Faq.model = { SET: (s) => ({ ...s, faq: { ...s.faq, expanded: [2] } }) }    // panel 2 stays hidden
Faq.model = { SET: (s) => ({ ...s, faq: { ...s.faq, expanded: '12' } }) }   // panels 1, 2, 12 open
// 3
Faq.uses = { faq: accordion({ trigger: '.trig', collapsible: false, expanded: 1 }) }
Faq.model = { SET: (s) => ({ ...s, faq: { expanded: ['2'] } }) }           // then a click closes 2

// 4 (Firefox, WebKit): open, OK (value="ok"), open again, Escape → 'rn.CLOSED' gets 'ok'
Rename.uses = { rn: dialog({ dialog: '.rn', trigger: '.rename' }) }
Rename.model = { 'rn.CLOSED': (s, rv) => (rv === 'ok' ? { ...s, name: s.draft } : { ...s, draft: s.name }) }

// 5 (Chromium, Firefox): hover .act, click it, move the mouse away → the tip stays
Tb.uses = { tip: tooltip({ trigger: '.act', tip: '.tip' }) }

// 6: clicks on .tab no longer select
S.uses = { tabs: tabs({ tab: '.tab' }) }
S.intent = ({ DOM }) => ({ 'tabs.SELECT': DOM.click('.go-b').mapTo('b') })

// 7: state.d.open is true, no showModal command, the dialog stays closed
P.model = { GO: (s) => ({ ...s, d: { ...s.d, open: true } }) }

// 8: <Portal target="#root2"><dialog className="d">…</dialog></Portal> with dialog({ dialog: '.d', trigger: '.open' })
```

## What changed

- `src/ui/accordion.ts`: one `open(slice)` helper (values as strings, a single value as a list)
  used by `accordionAttrs` and the reducers; `collapsible` is a calculated field like `id`
  (`s.collapsible ?? option`). The reducers store strings, so after the next toggle the slice is
  canonical again.
- `src/ui/dialog.ts`: OPEN's command sets `el.returnValue = ''` before `showModal()` / `show()`.
  (A dialog opened without the model, `commandfor`, still keeps the element's old value; the
  state's `returnValue` is reset by `TOGGLED` as before.)
- `src/ui/shared.ts` + `tooltip.ts` / `tooltips.ts`: `visible(e)`: a focus shows the tip only
  when it is `:focus-visible`, React Aria's rule. A focus event on an element that doesn't have the
  focus (a test's `simulateEvent(…, 'focus')`), or without `matches` (the mock DOM), still counts,
  so existing tests are unchanged. **Behaviour change:** a tap (touch) no longer shows a tip
  through the focus it gives, and a programmatic focus after mouse use doesn't either.
- `src/ui.d.ts`: `DialogActions.SYNC: boolean`.
- Tests: `test/ui-native-sweep.test.js` (1–3 and the `previousState` veto, failing first);
  `browser-tests/src/tests/ui-sweep-native.jsx` (7 composed scenarios, all three engines; 4 and 5
  fail without the fixes in the engines named). The three tooltip tests in
  `browser-tests/src/tests/ui-p5u.jsx` that focused the trigger with Playwright's `locator.focus()`
  now focus it from the keyboard (Shift+Tab from the next button), as a user does.
- Docs: `ui/accordion` (driving it from state, string values, start values, veto), `ui/dialog`
  (`open` mirrors, not in a Portal, another opener via a selector list, `next('profile.OPEN')` over
  a raw `showModal` command, Enter in a form, SYNC data), `ui/popover` (same two notes), `ui/tabs`
  (the broken `'tabs.SELECT'` intent example replaced), `ui/overview` (replace, not add),
  `ui/tooltip` (keyboard focus only; touch), `advanced/portals` (a tip box: top-layer parts don't
  need a portal and don't work in one). `llms/ui.md` gets one clause (slices drive tabs / accordion /
  disclosure; dialog / popover `open` only mirrors; never in a Portal), copies regenerated.

Size (esbuild, minified + gzip, the part alone with the core external): accordion 1,158 → 1,202 B
(+44), tooltip 695 → 787 B (+92), tooltips 994 → 1,081 B (+87), dialog 1,264 → 1,269 B (+5). The
core is unchanged (`sygnal/ui` is its own entry); size-gate result in the gate section.

## Recommendations

- **R1 (finding 6): host intents for a behavior action.** Today an intent action named like a
  behavior action replaces the behavior's trigger (the behaviors guide says so), but three UI pages
  taught it as "adds a trigger", which is how people read it. Options: (a) keep the semantics and
  have `sygnal-check` (and the dev checks) warn when a host intent replaces a trigger that the
  behavior builds from an option the host passed (`trigger`, `tab`, `close`): a new SYG127 reason,
  effort S–M; (b) merge instead of replace (as renderComponent's test streams already are), with
  an explicit way to replace (`'tabs.SELECT': replace(stream)`): semantic change across all
  behaviors, effort M, needs a decision. I'd do (a) now; (b) only if more behaviors get triggers.
- **R2 (finding 7): writes to a mirrored `open`.** A dev diagnostic when a host STATE reducer changes
  `open` on a `dialog()` / `popover()` slice outside the behavior's own actions ("open mirrors the
  element; dispatch 'd.OPEN'"), effort S–M in `checks/behaviors.ts`. A controlled mode (the behavior
  reconciling the element from `open`) is the larger alternative (M) and conflicts with the
  "the browser owns the open state" design (D202), so I'd not.
- **R3 (finding 12): hide a tooltip when its trigger is pressed.** Radix and React Aria close the tip
  on the trigger's pointerdown; it would also cover WebKit's stale tip under a modal. An ESCAPE-like
  `PRESS` action, effort S, behaviour change (a hovering user loses the tip after a click until
  re-entering).
- **R4 (finding 8): a dev diagnostic for a part element outside the component's DOM** (`SYNC`
  right after `OPEN` with no element found), effort S. The docs fix probably suffices.
- **R5 (finding 16, out of scope): flag `EVENTS: (…) => event(…)`** in `sygnal-check` (a model value
  sink function returning a handler is never what's meant), effort S.

## Open questions for the maintainer

1. R1: warn (a) or merge (b)?
2. The tooltip `:focus-visible` rule changes touch and programmatic-focus behaviour (no tip on a
   tap; no tip when code focuses the trigger after mouse use). React Aria and Radix behave this way;
   OK to keep?
3. Should `accordion` keep the host's numeric values as they are in the slice, or is normalising to
   strings on the next toggle (what it does now, as tabs do) fine? `AccordionState.expanded` stays
   `string[]` in the types.
4. Is the original accordion feedback one of 1–3, or something else (an example would settle it)?

## Gate

2026-10-31, this branch:

- `npm run build`: OK.
- `npm test`: vitest 523 files / 5,717 tests passed (33 skipped); test:examples (all, after
  `TEST_EXAMPLES_INSTALL=1`), test:types, test:browser (Chromium, 405 passed), test:perf-gate (all
  within limits): OK. (A first run failed only on `test/docs-live-server.test.js` before `npm ci
  --prefix docs` and one `vite-plugin-dev` startup timeout; both passed on the re-run.)
- Browser suites in the other engines: `BROWSER_TESTS_ONLY=uisweep` and `uitestsp5u` on chromium,
  firefox and webkit: all passed (7 / 37 tests each).
- `node scripts/size-gate.mjs`: OK, kanban 42,647 B (353 B headroom; core unchanged).
- `npm --prefix docs run build`: OK; `node docs/scripts/check-live.mjs` on chromium, firefox and
  webkit: OK. `node scripts/check-doc-samples.mjs`: 973 clean.

## Round 2 (the maintainer's decisions)

Built on `claude/advanced-integration` at aa63f44f (round 1 and the Zag sweep merged). The rules:
proper fixes, match Radix / React Aria, report size rather than trim for it.

A correction to round 1: R2 there called "the browser owns the open state" D202. D202 is the
packaging decision (the parts as a `sygnal` subpath). The "open mirrors the element" design was
the parts' own (their file headers, the docs); those are what round 2 supersedes.

### R1: a warning when a host intent replaces an option-built trigger (SYG118)

- New code **SYG118** (warn, "Host intent replaces a behavior trigger"), reported by the dev entry
  and `sygnal-check`, with its explanation and the regenerated error reference.
- Dev (`checks/behaviors.ts` `onIntent`, once per component name): a behavior declares
  `triggers: { ACTION: 'option' }` (new optional `defineBehavior` field, typed); the intent
  combine already removes a host-replaced action from `_behaviorActions`, so after the intent ran
  the check knows which ones the host took. Declared on every `sygnal/ui` part and on `pager`,
  `selection` and `undo`.
- Static (`rules/syg118-trigger-replaced.js`): a host intent action `<key>.<ACTION>` when the
  `uses` entry passes the option the behavior's `listens` ties to that action: the first-party
  table, and `defineBehavior()` calls it follows (it already worked out `listens` from their
  intents). `tooltips` was missing from the first-party table (its uses entries were opaque);
  added.
- Docs that taught "adds": round 1 fixed overview / dialog / tabs; round 2 also the behaviors
  guide's override table, `llms.txt` (the shortcut line now says the option's clicks stop and what
  to do) and an agent-doc sample in `test/p4-4a1-agent-doc-samples.test.js`, which combined
  `toggle: '.more'` with a `'more.TOGGLE'` keyboard override (so the button didn't toggle); it now
  uses its own `SHORTCUT` action whose `EFFECT` calls `next('more.TOGGLE')`.

### R2: a controlled `open` (dialog, popover)

`state.<key>.open` is the source of truth. Mechanism (`src/ui/dialog.ts`, `popover.ts`,
`shared.ts`):

- Every behavior entry that can change `open` (OPEN, CLOSE, CANCEL, CLOSED, TOGGLED) sends the
  commands for the slice it **ends with**: 7.0 outputs get the committed state, the host's entry
  for the same action included. So a host entry that keeps `open: true` keeps the element open.
- Everything that would close a dialog asks the model first, prevented: Escape (OPEN gives a modal
  dialog `closedby="none"` unless the host set `closedby`; the keydown becomes CANCEL, which also
  stops Chromium's CloseWatcher closing it on a second Escape), a light dismiss with the host's
  own `closedby` (the cancel event, prevented), the close button and a `method="dialog"` form's
  submit (the submitter's value) as CLOSE, `commandfor` `show-modal` / `close` / `request-close`
  as OPEN / CLOSE / CANCEL (the `command` event, prevented; all three engines have it). The
  dialog never closes in between, so the focus stays (Radix's `onOpenChange(false)` ignored).
- A host reducer that writes `open` (any action, a parent's write, `setState`): `watch()` (the
  new APPLY trigger) compares the slice with the element when the slice changes or the element is
  new, after that change's own commands could run (two microtasks after the next patch, or 20 ms
  when no patch comes; no timer while they match), and APPLY makes the element match. The
  behavior's own actions match by then, so APPLY appears only for host writes (`t.actions`:
  `SET_OPEN`, `d.APPLY`).
- What the browser does on its own still flows back: CLOSED (a close the model didn't make; a host
  entry that keeps it open opens it again), TOGGLED (an open without the model; a refusing host
  closes it again; popover light dismiss / Escape, which can't be prevented, so a refused one
  reopens, possibly after one frame). Stale events are dropped: a close event that arrives after
  the model opened it again, a toggle that no longer says what the element is.
- `open` option (Radix `defaultOpen`) on dialog and popover; G-400's "first look" no longer closes
  a state that says open (the dialog opens instead); an element that leaves while open still
  sets `open: false` (SYNC).
- A dialog the host renders only while open (G-430): CLOSE removes it before any close event, so
  `show()` now watches for its removal (a MutationObserver only while open) and returns the focus
  to the opener, as Radix's focus scope does on unmount; the closing command's target is marked
  `optional` (a new `spec.optional` on ELEMENT spec commands: no SYG640 when nothing matches).
- Types: `DialogOptions.open`, `PopoverOptions.open`, `APPLY` actions, the controlled wording.
  Docs: dialog (Controlled open section with the refusal recipe; the actions table rewritten),
  popover, overview, `llms/ui.md`; round 1's "open mirrors, writing it does nothing" text is gone.
- Testing note: APPLY reads the element, so a host write is applied with `dom: 'real'` or in a
  browser; on the mock DOM, tests check the state (documented).

Behaviour changes to note: Escape on a modal dialog is now handled by the behavior (keydown), not
the browser, while the dialog has `closedby="none"`; an Android back gesture no longer closes it
unless the host sets `closedby`. The cancel event is always prevented (the state decides).
`CLOSE` now sets the state at once (before, only the close event did).

### R3: the tooltip closes on the trigger's pointerdown

`tooltip()` and `tooltips()` get PRESS (pointerdown on a trigger): the tip hides at once and a
pending show is cancelled; `pressed` stays set until the pointer leaves, so hovering on doesn't
reopen it (Radix's behaviour). This also fixes WebKit's stale tip under a modal the click opened
(finding 12). State gains `pressed`; types and docs updated.

### R4: dialog, popover and tooltip inside a `<Portal>`

They work; no part had to be left out.

- Core (`core/markers/portal.ts`): the placeholder element names its content (`__portal`).
- Core (`extra/elementCommands.ts`): an ELEMENT command whose target isn't in the component's own
  DOM is looked for in the content of the portals it renders (found from `DOM.elements()`, the
  component's roots, so the dev selector checks see nothing new). Useful beyond `sygnal/ui`:
  `{ focus: '.title' }` now reaches a portal's content (Portals and element-commands guides).
- `sygnal/ui` (`shared.ts`): `find()` (the part's elements: own DOM, else its portals) for SYNC /
  APPLY, and `ev()` (events on the part's elements in its own DOM plus a document capture
  listener for its portals, `ownerTarget` and `preventDefault` applied as the DOM driver does) for
  every listener of dialog, popover, tooltip and tooltips. Tabs, accordion and disclosure in a
  portal are not covered (not asked; their triggers' clicks are DOM.click).
- Docs: the Portals page's tip now says the parts work in a portal (rarely needed for top-layer
  elements); dialog / popover / tooltip pages; `llms/ui.md` no longer says "never in a Portal".

### R5: `EVENTS: (…) => event(…)`

The dev entry already reported it (SYG116, when the function reaches the EVENTS bus). New static
rule `rules/syg116-event-returned.js`: a non-STATE sink entry that is a function returning
`event()` / `emit()` from 'sygnal' is SYG116 (error); SYG116's `reportedBy` now includes static.

### Tests (round 2)

- `test/ui-native-sweep.test.js`: controlled dialog (host write open / close, `open` option, Escape
  refused and not, a refused browser close, form submit and its refusal, `commandfor`), controlled
  popover (host write, refused light dismiss), tooltip / tooltips PRESS.
- `test/ui-sweep-diagnostics.test.js`: SYG118 dev (reported; not without the option; not for
  simulateAction), SYG116 dev for the function form.
- `sygnal-check/test/ui-sweep-round2.vtest.js`: SYG118 (first-party parts, a local behavior, no
  report without the option), SYG116 static (and not for the canonical form).
- `browser-tests/src/tests/ui-sweep-native.jsx`, three engines: R2 dialog (host write, Escape,
  focus return; a dirty editor refusing Escape twice and Enter; form submit value; `commandfor`),
  R2 popover (host write; a refused light dismiss), R3 (press hides, no reopen while hovered;
  the dialog-trigger tip), R4 (dialog, popover, tooltip in a portal: open, state, Escape, close
  button, focus return).
- Existing tests updated to the controlled contract where they encoded the old one: mock-DOM
  simulations of a `close` / `toggle` event the element didn't actually do (a real close event
  only comes from a closed dialog: they now call the faked `close()` or set `open`), the cancel
  event now prevented, the `open` option now honoured, `pressed` in exact-state checks.

### Size (round 2)

- Core, kanban gzip with `nativeGlobalThis: false`: **42,647 → 42,734 B (+87 B; headroom 353 →
  266 B)**: the portal fallback and `spec.optional` in `elementCommands.ts`. (The Zag merge didn't
  touch the core.)
- `sygnal/ui` (esbuild, minified + gzip, the core external): dialog 1,269 → 2,239 B, popover 551 →
  1,292 B, tooltip 787 → 1,222 B, tooltips 1,081 → 1,528 B, accordion 1,202 → 1,219 B, tabs 1,172 →
  1,191 B, disclosure 585 → 601 B; dialog + popover + tooltip together 1,940 → 3,097 B (+1,157 B;
  the shared `find` / `ev` / `watch` once).

### Open questions (round 2)

1. Escape on a modal dialog now goes through the behavior (`closedby="none"` + keydown), so the
   Android back gesture / CloseWatcher no longer closes a behavior-opened dialog unless the host
   sets `closedby`. Radix doesn't handle the back gesture either; OK, or should the behavior
   listen to the CloseWatcher path (a `closedby="closerequest"` dialog's cancel event, which is
   only cancelable once per user activation)?
2. A refused popover light dismiss reopens (the browser closes an auto popover before any event);
   acceptable, or should controlled popovers use `popover="manual"` plus the behavior's own
   outside-click / Escape handling (as Radix does) so a refusal never flickers?
3. `triggers` is opt-in for user behaviors (the dev SYG118); `sygnal-check` infers it. Should
   `defineBehavior` infer it at run time instead (it would need to see which option each intent
   stream came from)?

### Gate (round 2)

2026-10-31, this branch: `npm run build` OK; `TEST_EXAMPLES_INSTALL=1 npm test` OK (vitest 525 files /
5,748 tests; examples; types; the Chromium browser suite; perf gate); the UI browser suites
(`uisweep` 14, `uitestsp5u` 37, `uizag` 13) on chromium, firefox and webkit: all passed;
`node scripts/size-gate.mjs` OK (42,734 B, 266 B headroom); `npm --prefix sygnal-check test` OK
(1,858 tests, plain and per-file; two existing tests updated: the range-coverage list gains SYG116 /
SYG118, and a pager fixture that overrides `pager.NEXT` while passing `next` now expects SYG118);
`node scripts/gen-error-docs.mjs --check` OK; `node scripts/check-doc-samples.mjs` 976 clean;
`npm --prefix docs run build` OK; `node docs/scripts/check-live.mjs` on chromium, firefox and webkit OK.

## Round 3: controlled parts dismiss through the state

The maintainer approved open question 2 of round 2: a controlled popover must never flicker when
the host refuses a dismiss (match Radix). Merged `claude/advanced-integration` (60cd4b5f) first.

### What changed

- **Controlled = the `open` option given** (even `open: false`), as Radix's `open` prop. Without
  it the parts keep the round-2 behaviour (the slice is still the source of truth for writes;
  only dismissal differs).
- **`src/ui/layers.ts`, a dismissable-layer stack** (Radix `DismissableLayer`), one per page
  (`Symbol.for('sygnal.layers')` on `globalThis`, so every copy of `sygnal/ui` shares it):
  - Escape (a document keydown, bubble phase, so an element that handles it with
    `preventDefault()`, a Zag menu say, wins): the top layer only; not while an auto / hint popover
    inside it is open (the browser closes that first, G-579); not an IME Escape.
  - pointerdown outside (capture): every controlled layer the target is outside of, top first.
    "Inside" is logical: in its DOM, in a shadow root in it, or in a `<Portal>` rendered in it (the
    placeholder's `__portal` link from round 2, walked backwards), so a child layer counts as inside
    its parent, as Radix's React-tree containment does. A press on a layer's own
    `popovertarget` / `commandfor` button (or the dialog's `trigger`) isn't outside (Radix exempts
    the trigger). A modal dialog's backdrop (a press on the dialog outside its box) is outside.
    Layers under the top modal dialog get none (Radix's `disableOutsidePointerEvents` floor).
    Touch: dismissed at the click after the pointerdown (Radix), so a scroll gesture doesn't.
  - focusin outside (capture): as pointerdown, without the modal floor (Radix's `onFocusOutside`).
  - Each dismissal is a `sygnaldismiss` event on the layer's element (detail: the original event);
    the behavior's intent turns it into its close request.
- **Popover, controlled**: the behavior sets `popover="manual"` before it shows it (so the browser
  never light-dismisses it, whatever the markup says) and puts it on the stack. New action
  `DISMISS` (data: the keydown / pointerdown / focusin event) with the same entries as `CLOSE`, so a
  host entry returning `previousState` keeps it shown and no hide command is ever sent. Its
  `popovertarget` buttons and `commandfor` show / hide / toggle commands are prevented and dispatched
  as `TOGGLE` / `OPEN` / `CLOSE` (otherwise the browser's invoker would hide a manual popover behind
  the state's back). The hide command takes it off the stack at once (its toggle event comes later).
- **Dialog, controlled**: `closedby="none"` while open even when the host set `closedby` (the
  host's value comes back on close); the host's value says what the stack dismisses it on (none
  given: Escape for a modal, nothing for a non-modal; `closerequest`: Escape; `any`: Escape, a
  press on the backdrop, focus outside; `none`: nothing), each as `CANCEL` with the event as the
  data. Its own keydown `CANCEL` is off (the stack's Escape replaces it).
- **Every behavior-opened dialog is a layer** (uncontrolled ones with `ctl: false`), so the stack
  knows what is on top: a controlled popover under an uncontrolled modal doesn't take Escape, and
  presses don't reach it. An uncontrolled dialog keeps its own Escape, skipped while a layer
  opened inside it is open (`covered()`), so a controlled popover in an uncontrolled dialog closes
  first.
- Types (`DISMISS`, the `open` doc comments), sygnal-check's first-party table (popover `DISMISS`),
  docs (ui/popover "Controlled dismissal", ui/dialog "Controlled dismissal" with the `closedby`
  table, ui/overview), `llms/ui.md` (+ copies).

### Why uncontrolled popovers stay on the native light dismiss

As asked, kept. The reasons the two paths differ rather than match: the native `auto` path gives,
with no script, one auto popover at a time (opening one closes the others that aren't its
ancestors), `hint` popovers, the browser's own Escape ordering and the exemption for
`popovertarget` buttons; an app that never refuses a dismiss loses nothing by keeping them. Moving
everything to manual would change existing apps' behaviour (a programmatic `OPEN` of a second
popover would no longer close the first) for a benefit only hosts that refuse get. The cost of the
split is one more rule to learn ("give `open` to refuse without a flicker"), which the docs state
next to the `TOGGLED` refusal pattern.

### Tests

- `test/ui-native-sweep.test.js` (jsdom, `dom: 'real'`): 10 new. Popover: `popovertarget`
  prevented → `TOGGLE`, `popover="manual"`; press outside / Escape → `DISMISS` with the event; a
  press inside or on its button isn't; a refused press / Escape / focus outside → no hide command
  and no closing toggle; a handled Escape isn't a dismiss; touch press waits for the click; nested
  popovers (Escape and a press on the parent close only the child, a press outside both closes
  both); an uncontrolled popover is untouched. Dialog: Escape from the stack as `CANCEL`, closedby
  none while open and the host's back after, `closerequest` ignores presses; `any` + a refused
  backdrop press and Escape → no close event; a controlled popover in an uncontrolled dialog takes
  the first Escape and the press on the dialog. 8 of the 9 written before the touch case fail on the round-2 sources (the
  uncontrolled one passes there, as it should).
- `browser-tests/src/tests/ui-sweep-native.jsx`, chromium / firefox / webkit, real input:
  - a pinned controlled popover across a real Escape, a real click outside and a focus outside:
    `:popover-open` checked every animation frame and `beforetoggle` / `toggle` recorded → 0 hidden
    frames, no closing event; unpinned, a click outside closes it; its button toggles it.
  - a controlled popover in a controlled modal dialog: Escape, a click on the dialog and a focus on
    the dialog close the popover only; the next Escape closes the dialog.
  - Against the round-2 sources the frame check reports "hidden in 20 of 21 frames,
    beforetoggle:closed toggle:closed" (chromium, webkit).

### Size (round 3)

- Core: unchanged (no `src/core` / core-bundle file touched; `layers.ts` is in `sygnal/ui`).
  Size gate in the gate section.
- `sygnal/ui` (esbuild, minified + gzip, the core external): dialog 2,232 → 3,039 B, popover 1,295 →
  2,392 B; dialog + popover + tooltip together 3,097 → 4,202 B (+1,105 B, the layer stack once).

### Open questions (round 3)

1. Focus outside has no modal floor (Radix): a modal dialog that is *not* rendered inside a
   controlled popover, opened from a button in it, moves the focus out and dismisses the popover
   (a host can refuse, or render the dialog inside the popover / in a portal from it). OK?
2. A host's own (non-`popovertarget`) button that toggles a controlled popover through the model:
   its press is outside, so `DISMISS` closes it and the click's `TOGGLE` opens it again. Radix
   exempts only its own trigger; a `trigger` option for `popover()` (exempt + `TOGGLE`) would fix
   it. Add?
3. A press and the focus it moves both dispatch a dismissal (Radix calls `onPointerDownOutside`
   and `onFocusOutside` too), so a refusing entry runs twice; harmless for the `previousState`
   pattern. Dedupe?
4. A Zag menu / select inside a controlled popover but positioned through a portal outside it
   isn't on this stack (Zag has its own dismissable layer), so a press inside that menu counts as
   outside the popover. Zag positions inside its host by default; a shared stack is possible later.

### Gate (round 3)

2026-10-31, this branch: `npm run build` OK; `npm test` OK (vitest 527 files / 5,781 tests;
examples; types; the Chromium browser suite 421/421; perf gate); the UI browser suites on firefox
and webkit (`uiSweepNative` 16, `uiTestsP5U` 37, `uiZag` 17) all passed; `node
scripts/size-gate.mjs` OK (**42,734 B, 266 B headroom: core unchanged**); `npm --prefix
sygnal-check test` OK (1,860, plain and per-file); `node scripts/gen-error-docs.mjs --check` OK;
`node scripts/check-doc-samples.mjs` 980 clean; `npm --prefix docs run build` OK; `node
docs/scripts/check-live.mjs` on chromium, firefox and webkit OK (130 demos each).
