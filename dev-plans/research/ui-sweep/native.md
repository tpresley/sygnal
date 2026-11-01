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

## Round 4: the popover trigger, one dismissal per interaction, Zag layers

The maintainer's answers to round 3's four questions. Merged `claude/advanced-integration`
(aaf2b964) first.

### What changed

1. **`popover({ trigger })`** (Radix's `Popover.Trigger`):
   - Its clicks are prevented and dispatch `TOGGLE` with the value to go to. That value is read
     from the state at the press, not flipped at the click: an `auto` popover's light dismiss
     runs at the pointerup, between the press and the click, so a flip at the click would open it
     again (the reason round 2 had no `trigger` option). Keyboard clicks have no press and read
     the state at the click.
   - `TOGGLE` now takes optional data (`true` / `false`: go to that value; none: flip).
   - A press on the trigger isn't outside a controlled popover (its layer carries the selector, as
     the dialog's does).
   - ARIA: **`popoverAttrs(state, uid)`**, a new attribute helper like `disclosureAttrs`, gives
     the trigger `type="button"`, `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`,
     `data-state` and the popover its `id` and `data-state` (Radix's Trigger / Content). The
     popover is now `keyed` like disclosure and tabs, so its slice is `{ id, open }` (`id`
     option). A helper, not attributes the behavior writes on the element: the parts never set
     host attributes behind the view (the vnode would overwrite them on its next change).
   - Correction to the brief: the dialog's `trigger` sets no ARIA today (no `dialogAttrs`). Radix's
     `Dialog.Trigger` does (`aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`). Left as a
     follow-up, not done here.
   - `popovertarget` buttons work as before. SYG118's `triggers` gains `TOGGLE: 'trigger'`
     (checked: a host `'p.TOGGLE'` intent with `trigger` given warns); sygnal-check's first-party
     table gains the `trigger` / `id` options, the `id` state key and `listens ['trigger', 'TOGGLE']`.
2. **One dismissal per interaction**: from a pointerdown until that press ends (its click, a
   pointercancel, the next keydown), focusin isn't a dismissal. A press outside that moves the
   focus outside dispatches one `DISMISS` / `CANCEL`, with the pointerdown as its data (what Radix
   reports first). A touch press dismisses at its click, and the focus it moves before the click is
   covered too. Escape was already one.
3. **Zag layers on the stack**. Two designs were possible:
   - (a) the stack recognises Zag's own layers (read `@zag-js/dismissable`'s `layerStack`);
   - (b) the Zag parts register their open content on our stack.

   Picked (b):
   - (a) would reach into a private module of a peer dependency (`layerStack` isn't public API,
     and a second copy of `@zag-js/dismissable` would be a second stack). It would also add
     nothing for placement: Zag's layers know their node, not where they belong in the page.
   - (b) is three lines per part on code this repo owns: `layered(x, api.open)` in each part's
     render (`src/ui/zag/shared.ts`) adds the content element to the stack when the machine opens
     and removes it when it closes.
   - The entry is a layer the stack doesn't dismiss (`ctl` false): Zag still dismisses its part,
     through its own dismissable layer. The entry's **anchor** is the widget's host element.
   - The stack's "inside" test is now Radix's tree test. A target is inside layer L if it is in
     L's element (DOM, shadow root, `<Portal>`), or in a layer above L whose anchor is inside L. So
     a press in a Zag list counts as inside the popover or dialog its host is in, wherever the
     list renders.
   - The open Zag layer is on top, so Escape is Zag's (the stack does nothing when the top layer
     isn't controlled; Zag's own capture-phase handler closes it and prevents the event). The next
     Escape reaches the popover.
   - A press outside both: Zag closes its part, and the stack dismisses the popover (Radix's nested
     layers both dismiss).
   - An uncontrolled dialog's own Escape also skips while a Zag layer anchored in it is open
     (`covered()`).

   Size: the Zag bundles each carry their own copy of the stack. So the entries live in a separate
   module (`src/ui/stack.ts`: the global, `add`, `pull`) and the listeners stay in `layers.ts`,
   which only `sygnal/ui` loads. A Zag part never needs the listeners: on its own it isn't
   dismissed by the stack, and a controlled layer comes from `sygnal/ui`, which installs them. The
   listeners are installed once per page, by the first `sygnal/ui` copy that opens a layer, and
   stay (three document listeners), instead of being removed when the stack empties (with two
   copies, one copy's removal could take the other's listeners).
4. **No change**: a modal dialog not rendered inside a controlled popover dismisses it when it takes
   the focus, as in Radix. Documented in ui/popover with the two ways to keep it open (render the
   dialog inside the popover, or refuse `DISMISS` while it is open).

### Tests

- `test/ui-native-sweep.test.js`, 6 new:
  - the trigger: prevented, `TOGGLE` with data, the popoverAttrs ARIA;
  - an uncontrolled light dismiss between the press and the click doesn't reopen it;
  - a controlled popover: a press on the trigger isn't outside;
  - one `DISMISS` for a press plus the focus it moves (data: pointerdown), then a later focus
    outside is one;
  - a layer anchored inside the popover but rendered elsewhere counts as inside, and Escape is
    its own while it is on top;
  - a real Zag `Menu` in a controlled popover: a press in the menu isn't outside, Escape closes
    the menu only, the next Escape closes the popover.
- `browser-tests/src/tests/ui-sweep-native.jsx`, chromium / firefox / webkit, real input, 2 new:
  - the trigger on an auto popover (opens, then closes with no reopen after the light dismiss),
    on a controlled one, with the ARIA; one DISMISS for a click outside that moves the focus;
  - a Zag `Menu` in a controlled popover: Escape and a pick close the menu only, the next Escape
    the popover, a press outside both closes both.
- SYG118 for a host `'p.TOGGLE'` intent with `trigger` given: a dev test (`test/ui-sweep-diagnostics.test.js`) and a sygnal-check one (`ui-sweep-round2.vtest.js`).
- Updated: two `p5-2u-ui` expectations of the popover slice (now with `id`); type tests for
  `trigger`, `id`, `popoverAttrs` and `TOGGLE`'s data.

### Size (round 4)

- Core: unchanged (no core file touched); size gate below.
- Parts (esbuild, minified + gzip; the core, `sygnal/zag` and `@zag-js/*` external), round 3 →
  round 4:

| | Round 3 | Round 4 | |
|---|---|---|---|
| dialog | 3,090 B | 3,227 B | +137 (the stack's anchor, press handling) |
| popover | 2,441 B | 2,826 B | +385 (trigger, keyed) |
| popover + popoverAttrs | | 3,020 B | |
| dialog + popover + tooltip | 4,244 B | 4,634 B | +390 |
| Menu | 1,527 B | 1,732 B | +205 (stack entries) |
| Select | 1,250 B | 1,465 B | +215 |
| Combobox | 3,224 B | 3,416 B | +192 |

  (The round-3 numbers here are measured from aaf2b964 with the same script, which externalises
  `sygnal/zag` and `@zag-js/*`; round 3's own table used a narrower external list, hence
  3,039 → 3,090 for the dialog.)

### Open questions (round 4)

1. `dialogAttrs(state, uid)` for the dialog's trigger (`aria-haspopup="dialog"`,
   `aria-expanded`, `aria-controls`), matching Radix's `Dialog.Trigger`: add it the same way?
2. A Zag part opened over a controlled layer but rendered outside it (not nested) is on top for
   Escape: the first Escape closes it, the second the popover. That is Radix's order; only noting
   it.

### Gate (round 4)

2026-10-31, this branch, on a loaded machine (load average ~36, other sessions running):
- `npm run build` OK; `node scripts/size-gate.mjs` OK (**42,734 B, 266 B headroom: core
  unchanged**); `node scripts/gen-error-docs.mjs --check` OK; `node scripts/check-doc-samples.mjs`
  981 clean; `npm --prefix docs run build` OK; `node docs/scripts/check-live.mjs` on chromium,
  firefox and webkit OK (130 demos each); UI browser suites on firefox and webkit
  (`uiSweepNative` 18, `uiTestsP5U` 37, `uiZag` 18) all passed, and `uiSweepNative` 18/18 on
  chromium too.
- `npm test`, first run: 5,800 passed, 1 failed (`p45-a2-vnode-identity`, a Suspense timing test
  that doesn't load `sygnal/ui`; 3/3 green alone). Second run: different timing failures
  (`compose-generated-*`, `api-plugin`: the sandbox / Vite-build tests round 1 already saw as
  load flakes), all green alone.
- `npm --prefix sygnal-check test`: 1,857–1,858 of 1,865 passed; the failures are
  `lsp-completion`, `lsp-parts`, `lsp-rename`, `p10-watch` (LSP / watcher timing), green alone
  (`lsp-parts` 4/4). The same four files fail on aaf2b964 (round 3's base) in a worktree run, so
  this round didn't cause them.

## Round 5: `dialogAttrs`

Maintainer's answer to round 4's open question 1: the dialog's trigger gets ARIA like Radix's
`Dialog.Trigger`, through a helper in the `popoverAttrs` / `disclosureAttrs` pattern.

### What changed

- `dialogAttrs(state, uid)` (`src/ui/dialog.ts`, exported from `sygnal/ui`) returns the attributes
  of Radix's Dialog parts, computed from the slice:

  | Part | Radix | Attributes |
  |---|---|---|
  | `trigger` | `Dialog.Trigger` | `type="button"`, `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls` (the dialog's id), `data-state` |
  | `dialog` | `Dialog.Content` | `id`, `aria-labelledby` (the title's id), `aria-describedby` (the description's id), `data-state` |
  | `title` | `Dialog.Title` | `id` |
  | `description` | `Dialog.Description` | `id` |
  | `close` | `Dialog.Close` | `type="button"` |

- The dialog behavior is `keyed()` now, as popover, tabs, accordion and disclosure are: the slice
  is `{ id, open, returnValue }`, with an `id` option for the prefix (default: the key in
  `uses`), and a host reducer that replaces the slice without `id` gets it back (the calculated
  field). The ids go through `uid()`, so two instances never share one.
- Types (`DialogState.id`, `DialogOptions.id`, `DialogAttrs`, `dialogAttrs`), type tests,
  sygnal-check's first-party table (`stateKeys`, `options`), the dialog guide (the main example
  uses it; a "The parts' attributes" section with an "Alert dialogs" subsection), the overview
  (table row, `data-state` row, the slice shape), `llms/ui.md` (the import list and one clause);
  `llms.txt` itself is unchanged (65,041 B: the UI line lives in the topic file).

### What's left out, and why

- **`role`.** Radix's Content writes `role="dialog"` on a `<div>`; a `<dialog>` has the role
  natively and a modal one is `aria-modal` to assistive technology, so writing it would only
  repeat it. Radix's Content also sets `aria-modal`-like behavior through its focus scope, which
  `showModal()` gives us.
- **`alertdialog` as an option.** Radix's `AlertDialog` differs from `Dialog` in three ways: the
  role, no dismissal by a press outside, and the initial focus on Cancel. A modal `<dialog>`
  already ignores presses outside (unless the host writes `closedby="any"`), `cancelable: false`
  keeps Escape from closing it if wanted (Radix's AlertDialog *does* close on Escape, so it is
  not the default), and `autofocus` on Cancel is the native initial focus. What remains is the
  role, which is markup: the guide writes `role="alertdialog"` after the spread. A `role` option
  or a third `dialogAttrs` argument would carry one attribute the host already writes as easily,
  and the slice would have to grow a field for the helper to read it. `aria-haspopup="dialog"`
  stays right for an alert dialog's trigger (ARIA has no `alertdialog` value; Radix's
  `AlertDialog.Trigger` writes `dialog` too).
- **An overlay part.** Radix's `Dialog.Overlay` is an element; ours is `::backdrop`.
- **`Dialog.Portal`.** Not an attribute; the dialog already works inside `<Portal>` (R4), and the
  top layer makes it rarely needed.
- **Radix's dev warnings for a missing Title / Description.** Radix warns when Content has no
  Title, and when it has no Description unless `aria-describedby={undefined}` is passed. We
  match the attribute contract (the helper always names a description; the guide says to write
  `aria-describedby={undefined}` after the spread for a dialog without one), not the warning: see
  below.

### A diagnostic for a trigger without the ARIA? No

Disclosure and popover have none: no sygnal-check rule or dev check looks for a trigger that
lacks `disclosureAttrs` / `popoverAttrs`. A dialog trigger without them is also not broken: the
WAI-ARIA APG's own modal dialog example has no `aria-haspopup` or `aria-expanded` on its
openers (the focus moves into the dialog, which announces itself by its name), and
`aria-haspopup="dialog"` is announced unevenly across screen readers. So a missing spread is a
choice a host may make on purpose, not clearly a mistake, and a hint would be noise. A static
check couldn't see through the spread reliably either (`{...a.trigger}` from any variable). The
same goes for a missing title / description: SYG707 (a11y) already handles explicit ARIA, and a
`<dialog>` without a name is a broader a11y rule than this helper.

### Tests

- `test/ui-native-sweep.test.js` (real DOM): the attributes on the trigger, the dialog, title,
  description and close, before and after OPEN / CLOSE (`aria-expanded`, `data-state`), with
  `role="alertdialog"` kept after the spread; the `id` option names the ids; a host reducer that
  replaces the slice without `id` keeps the ids.
- Existing expectations of the dialog slice now include `id` (`p5-2u-ui`, `ui-native-sweep`).
- `type-tests/p5-2u-ui.tsx`: `dialogAttrs`, `DialogAttrs`, `DialogState.id`, the `id` option.
- `browser-tests/src/tests/ui-sweep-native.jsx`, "Round 5: dialogAttrs names and describes an
  alert dialog": Playwright role queries (the trigger collapsed / expanded, the `alertdialog`
  named by its title), the focus on Cancel (`autofocus`), Escape closes it and resets
  `aria-expanded` / `data-state`; on Chromium the engine's own accessibility tree reports the
  description. Chromium, Firefox and WebKit.

### Size (round 5)

- Core: unchanged (no core file touched); size gate below.
- Parts (the round-4 script: esbuild, minified + gzip; the core, `sygnal/zag`, `@zag-js/*`
  external), round 4 (2be11123) → round 5:

| | Round 4 | Round 5 | |
|---|---|---|---|
| dialog | 3,227 B | 3,342 B | +115 (`keyed`, the `id` field) |
| dialog + dialogAttrs | | 3,587 B | +245 for the helper (`idsOf` shared) |
| popover | 2,826 B | 2,826 B | |
| dialog + popover + tooltip | 4,634 B | 4,631 B | −3 (`keyed` shared with popover) |
| Menu / Select / Combobox | 1,732 / 1,465 / 3,416 B | unchanged | |

### Gate (round 5)

2026-10-31, this branch (merged bdf65850 first):
- `npm run build` OK; `node scripts/size-gate.mjs` OK (**42,734 B, 266 B headroom: core
  unchanged**); `node scripts/gen-error-docs.mjs --check` OK; `node scripts/check-doc-samples.mjs`
  982 clean; `npm --prefix docs run build` OK; `node docs/scripts/check-live.mjs` on chromium,
  firefox and webkit OK; UI browser suites on firefox and webkit (`uiSweepNative` 19,
  `uiTestsP5U` 37, `uiZag` 18) all passed, `uiSweepNative` 19/19 on chromium too.
- `npm test` vitest, first run: 1 real failure, `p5-2s-ui` expecting the dialog slice without
  `id` (fixed). Second run, at load average ~110: 5,802 passed, 5 failed (`compose-generated-*`,
  `p4-3b-persist`, `replay`, `vite-plugin-mcp`: timing, none touches `sygnal/ui`), 91/91 green
  alone. The stages after vitest, run separately: `test:examples` OK, `test:types` OK,
  `test:browser` 424/425 on chromium (one Zag Combobox typing test, ZS-3/ZS-4, input 'berParis'
  under load; `src/ui/zag/` is untouched this round; the suite 18/18 twice alone), sygnal/sandbox
  page 4/4, `test:perf-gate` OK.
- `npm --prefix sygnal-check test`: plain 1,861 passed; the per-file run had one `lsp-parts`
  timeout (the round-4 flake), 11/11 green alone.

## Round 6: the parts read the element's own document

Maintainer-approved, from the TUI spike's F13 (`dev-plans/research/tui-spike/README.md`): the
dialog behavior and `<Toaster />` read the global `document` / `Event`, so they didn't run on a
`sygnal/host` tree (the terminal), and a global read is wrong in a shadow root or an iframe too.
Merged `claude/advanced-integration` (6be8223b, with the TUI spike) first.

### What changed

- **`src/ui/dom.ts`** (new, a few helpers every part shares):
  - `docOf(n)`: the node's document, else the global one;
  - `focused(n)`: the focus in its root (a shadow root's `activeElement`), else in its document;
  - `evt(n, type, init, C)`: an event from its window (`defaultView[C]`, else `Event`);
  - `all(n, sel)`: matches in its document and in its own root;
  - `observer(n)`: its window's `MutationObserver` (a host tree has none: a browser's can't observe it).
- **dialog**:
  - `lost(el)` and the opener in `show()` read `focused(el)` and `docOf(el).body`;
  - the `FAIL` event comes from `evt()`;
  - the removal observer is `observer(el)`.
- **layers**:
  - the listeners are installed once per document (`S.docs`, a WeakSet, in place of the `S.on` flag), on the layer element's document;
  - `owners()` and Escape's popover check search the layer's document and root;
  - `DISMISS` is that window's `CustomEvent`;
  - the touch deferral listens on the pressed element's document;
  - a press on a dialog element itself is inside it where there are no boxes (no `getBoundingClientRect`).
- **popover**: the `popovertarget` fallback looks the id up in the button's root (a shadow root, the host document), else its document.
- **Toaster**:
  - the placement reads the region's document and root (`all(el, 'dialog')`);
  - `act` is `focused` (G-426: still the root's first; now the document's when the focus is outside the root);
  - the focusout it sends comes from `evt()`;
  - it observes `doc.body` with `observer(el)`.
- **Zag Menu**: `getRootNode`'s fallback for a disconnected host is its `ownerDocument`.
- Swept the rest: tabs, accordion, disclosure, tooltip, tooltips, stack.ts and the Zag parts' layer registration read no globals. `DOM.select('document')` is a driver source, and the host driver has it.
- **`sygnal/host`**, three small DOM-correct additions, each with a test:
  1. **Document listeners and a capture phase.** `HostDocument.addEventListener` / `removeEventListener`. A connected element's events reach the document: capture listeners run from the document down to the target's parent, then the root delegates, then the target's own (capture first), then bubbling up to the document. There is one registration per listener and capture flag, as in the DOM. `stopPropagation` ends the dispatch after the current node; `stopImmediatePropagation` also stops the rest of that node's listeners. The layer stack's `pointerdown` / `focusin` capture listeners and its `keydown` need these. Before, capture listeners ran with the others and the document had none.
  2. **`defaultView.CustomEvent`** (a `HostEvent`, which keeps `detail`). Node's own `CustomEvent` would reach a host element as a plain event without `detail`.
  3. **`ownerTarget` on the host driver's events.** The DOM driver always sets it, and the parts' filters read it: the dialog's Escape (`e.target.closest('dialog') == e.ownerTarget`), `CANCEL`, the Toaster's focusout. Without it, Escape on a dialog behavior did nothing in a terminal.
- **`examples/tui-tracker`**:
  - the confirm is a `dialog()`: `d` writes `open: true`; Cancel and Escape close it through the behavior; the focus goes back to the row;
  - `dialogAttrs` is on the Delete button and the dialog, which keeps `aria-label` because the terminal titles a box from it;
  - "#2 deleted", "#41 created" and "#3 closed" are toasts (`<Toaster />`, `makeTimerDriver()` in `terminal.jsx` and the tests);
  - the spike's F13 row reads fixed.
- **Docs**:
  - the terminal page's `sygnal/ui` section (every part works, a dialog example, the Toaster's `TIMER` and its modal limit);
  - the UI overview (shadow roots, iframes, host trees);
  - `llms/renderers.md` (regenerated; `llms.txt` unchanged at 65,041 B).

### What the host still lacks (not changed here)

- **`MutationObserver`.** The Toaster moves its region into an open modal dialog with one (D198). On a host tree it doesn't, so a toast that comes while a modal is open is drawn over the dialog (the terminal paints popovers on top) and times out, but its Dismiss button is inert until the dialog closes. A minimal observer on `HostDocument.changed()` (`childList` / `attributes` with a filter) would fix it. That is a bigger addition than this round's, so it is a follow-up for `sygnal/host`.
- **A box title from `aria-labelledby`.** The terminal titles a dialog's border from `aria-label` / `title` only, so a `dialogAttrs` dialog (named by `aria-labelledby`) has no title there. A `src/terminal/paint.ts` follow-up: read the referenced element's text.

### Tests

- `test/renderers-terminal-tui.test.js`, a round-6 block under `createTerminal()`:
  - dialog: the trigger opens it modal with `dialogAttrs`; Escape closes it through `CANCEL`; the focus returns; the close button closes it;
  - a refused `CANCEL` keeps an uncontrolled and a controlled dialog open (the controlled one's Escape comes from the layer stack's listener on the host document);
  - a controlled popover with a trigger: the trigger toggles it, Escape is a `DISMISS`;
  - tabs (← / →);
  - `<Toaster />`: a toast appears at the top right and times out; an error toast is dismissed by Enter;
  - host: the capture → target → bubble order across the document; registration, removal and `once` by capture flag; `stopPropagation`; a detached element's events don't reach the document; `defaultView.CustomEvent`'s `detail`; the driver's `ownerTarget`.
  - The spike's disclosure / accordion / popover / tooltip tests stay.
- `examples/tui-tracker`: its 11 tests with the `dialog()` confirm and the toasts.
- `browser-tests/src/tests/ui-sweep-native.jsx`, "Round 6: in a shadow root": a dialog opened and closed by mouse clicks returns the focus to its trigger (the root's `activeElement`; WebKit doesn't focus a clicked button); a controlled popover isn't dismissed by a press inside and is by a press outside (`composedPath()` into the shadow root). Chromium, Firefox and WebKit. (This passes on round 5's code too: the browser returns the focus itself here, and `pointerdown` reaches the document from a shadow root. It guards the shadow-root path; the terminal tests are the ones that failed before.)

### Size (round 6)

- Core: unchanged (no core file touched); size gate below.
- Parts (the round-4 script), round 5 (824a65a1) → round 6:

| | Round 5 | Round 6 | |
|---|---|---|---|
| dialog | 3,342 B | 3,513 B | +171 (dom.ts, the per-document listeners) |
| dialog + dialogAttrs | 3,587 B | 3,756 B | +169 |
| popover | 2,826 B | 3,000 B | +174 (layers via dom.ts, `tgt`) |
| popover + popoverAttrs | 3,020 B | 3,194 B | +174 |
| dialog + popover + tooltip | 4,631 B | 4,836 B | +205 |
| Toaster | 1,975 B | 2,113 B | +138 |
| tabs, tooltip, Select, Combobox | 856 / 1,218 / 1,465 / 3,416 B | unchanged | |
| Menu | 1,732 B | 1,739 B | +7 |
| `sygnal/host` (all of it) | 15,339 B | 15,602 B | +263 (listeners, phases) |

### Gate (round 6)

2026-10-31, this branch (merged 6be8223b first):
- `npm run build` OK; `node scripts/size-gate.mjs` OK (**42,734 B, 266 B headroom: core
  unchanged**); `node scripts/gen-error-docs.mjs --check` OK; `node scripts/check-doc-samples.mjs`
  987 clean; `npm --prefix docs run build` OK; `node docs/scripts/check-live.mjs` on chromium,
  firefox and webkit OK.
- `npm test`: vitest 5,843 passed; `test:examples` OK (tui-tracker 11); `test:types` caught an
  implicit `any` in the Toaster's observer callback (fixed, then OK); `test:browser` 426/426 on
  chromium, sygnal/sandbox page 4/4; `test:perf-gate` OK.
- UI browser suites on firefox and webkit: `uiSweepNative` 20, `uiTestsP5U` 37, `uiZag` 18,
  `uiZagTestsP5Z` 18, all passed.
- `npm --prefix sygnal-check test`: 1,865 passed in both runs (plain and per-file).
