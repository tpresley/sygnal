# sygnal/ui native parts: bug and friction sweep

Scope: `sygnal/ui`'s native parts (accordion, disclosure, dialog, popover, tooltip / tooltips, tabs,
Toaster), met the way an app author or a coding agent would: state-driven use, composition, several
instances, Collection / isolated child / Portal, keyboard and focus, forms in dialogs, tests with
`renderComponent` (mock DOM and `dom: 'real'`), the three browser engines, the docs' own examples,
`sygnal-check --strict` and the types. Menu / Select / Combobox (Zag) are a sibling sweep.

Branch `claude/ui-sweep-native-3bf603` (off `claude/advanced-integration` at 18a73b35), 2026-10-31.

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
