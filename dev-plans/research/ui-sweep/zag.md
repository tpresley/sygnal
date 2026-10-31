# UI sweep: Menu, Select, Combobox (the Zag-based parts)

Branch `claude/ui-sweep-zag-d53cc4` (from `claude/advanced-integration` at 18a73b35), 2026-10-31. Scope: `sygnal/ui/menu`,
`sygnal/ui/select`, `sygnal/ui/combobox` (`src/ui/zag/`, `src/zag.ts`, `src/ui-*.d.ts`) and their docs. The native
`sygnal/ui` parts are a sibling sweep's.

Fix IDs are `ZS-n`, not G-numbers, so parallel sweeps don't collide; the maintainer can renumber them at merge.

## How it was probed

- `zag-select.probe.js`, `zag-combobox.probe.js`, `zag-menu.probe.js`, `zag-forms.probe.js` (jsdom, `renderComponent(…, { dom: 'real' })`,
  51 probes). Each `it` states what an app author would expect, so a failure is a finding. Where the right answer is open, the probe records what it saw
  (`zag-rec.js` → `$ZAG_PROBE_LOG`). Run them with
  `ZAG_PROBE_LOG=/tmp/zag.log npx vitest run --config dev-plans/research/ui-sweep/zag.vitest.config.mjs`.
- Real browsers: three new tests in `browser-tests/src/tests/ui-zag-p5z.jsx`, using Playwright's real pointer and keyboard. Run them with
  `BROWSER=chromium|firefox|webkit BROWSER_TESTS_ONLY=uiZag npm --prefix browser-tests test`. All 13 Zag tests pass in the three engines.
- `sygnal-check --strict` on a typical app that uses all three parts, a typo'd event and a wrong command.
- `tsc` on prop combinations an author would write (an icon menu, numeric values, the parts' Zag callbacks).
- The docs' demos (`check-live`) and code samples (`check-doc-samples`).

Covered: controlled and uncontrolled value and open state; state → selection and selection → state; a reducer that refuses (ABORT) or overrides a
pick; items that load late, change while the list is open, get relabelled or lose the selected item; empty and disabled items; `multiple`; two
instances; Collection rows, Switchable pages, a `sygnal/ui` dialog, a Portal, an isolated child; `processForm`, the `form` behavior, `FormData`,
native reset; keyboard (arrows, typeahead, Escape, focus return); mock-DOM `t.widget().dispatch` and `simulateEvent`.

## Findings

| ID | Part | Class | Severity | Finding | Status |
|---|---|---|---|---|---|
| ZS-1 | Select, Combobox | bug | high | The `form` behavior, Sygnal's canonical form recipe, never heard a pick: `form.values.size` stayed `''`. processForm on its default `['input', 'submit']` didn't fire either. Zag changes the hidden fields without an `input` event. Select's `change` fires only once a controlled value has changed, so it can't drive a controlled value. | fixed |
| ZS-2 | Select | bug | low | When the items no longer contain the selected value, the trigger still shows "Medium" (Zag keeps the item), but the hidden `<select>` has no such option, so the form submits `''`. | fixed |
| ZS-3 | Combobox | bug | medium | The input text didn't match the state. (a) A value set before the items arrive (async loading) left the input empty after they arrived. (b) A pick that the model refused (`ABORT`) or overrode left the refused label ("Lisbon") in the input while the state said `nyc`. (c) A relabelled item kept its old label. Zag writes the label only when the value changes, and on a pick it writes the label whatever the controlled value says. | fixed |
| ZS-4 | Combobox | bug | medium | A native form reset (a reset button, `form.reset()`) emptied the visible input but left the hidden input on the old pick. The form then submitted `lis` while showing nothing. Zag's Select handles reset; Zag's combobox has no hidden field. | fixed |
| ZS-5 | Select, Combobox | bug (friction) | medium | The `form` behavior never marked these fields touched, because the focused trigger or visible input has no `name`. With the default `show: 'blur'`, their errors appeared only after a submit. | fixed |
| ZS-6 | all three | bug | medium-high | Inside a `<dialog>`, whose UA style is `overflow: auto`, Firefox and WebKit flipped the listbox above the trigger and off-screen (list top −82 px). Chromium placed it correctly. `positioning={{ strategy: 'fixed' }}` fixes it in all three engines. | fixed: the default inside a dialog |
| T-1 | Menu | types gap | low | `label` was required in `MenuProps`. An icon menu named by `aria-label` works at runtime but didn't type-check. | fixed: optional; docs say how to name an icon trigger |
| T-2 | Select, Combobox | types / docs gap | low | `ListboxProps.name` said Combobox submits through "the input". It submits through hidden inputs; the visible input has no name (G-411). | fixed |
| F-1 | Select, Combobox, Menu | friction (agent) | medium | `DOM.select('.size').events('change').detail()`, a native `<select>` habit, gives `null`: the hidden select's change event bubbles out, and so does ZS-1's `input`. sygnal-check stays silent because SYG141 skips names elements fire natively, and the parts' events are already in `sygnal-check/src/model/widgets.js`. | recommendation; `llms/ui.md` now says "never `events('change')`" |
| F-2 | Combobox | friction | medium | With `multiple`, the input clears after each pick and the part shows nothing of what is selected. The app has to render its own chips and has no remove-one command (only `clear`, which clears all). | docs (the `multiple` row); recommendation |
| F-3 | Select, Combobox, Menu | friction (missing option) | medium | No groups (Zag's collection has `groupBy`). Menu has no checkbox/radio items, links or submenus (Zag's menu has option items and nested menus). | recommendation |
| F-4 | Combobox | friction | low | With no matches, the list opens as an empty box: no "No results" text, and nothing tells assistive technology that nothing matched. | recommendation |
| F-5 | Select, Combobox | docs gap | low | Values are strings: `{ value: 1 }` comes back as `'1'` in `value-change`. The types accept numeric item values but not a numeric `value`. | docs; types left as they are |
| F-6 | all three | docs gap | low | In a `<Portal>`, the part's events must be read through `DOM.select('document').select('.x')`. The widgets guide says so; the UI pages and `llms/ui.md` didn't. | `llms/ui.md` |
| F-7 | Combobox | open question | low | With `allowCustomValue`, typed text that matches no item never reaches the `form` behavior. Only picks are announced (ZS-1), and the visible input has no name. | open question 2 |
| N-1 | Menu | not worth acting on | — | In jsdom, `element.click()` on a second menu's trigger leaves the first open, because Zag's outside detection listens for `pointerdown`. Real browsers close it (`Menu: … an outside click closes`). | — |
| N-2 | Select | not worth acting on | — | Select's form reset follows Zag: back to the first value. A controlled select reports it with `value-change`. | works |
| N-3 | all three | not worth acting on | — | Zag's own callbacks (`onValueChange`, `onInputValueChange`) are passed through at runtime (G-414) but aren't in the prop types. The canonical form is the events. | — |

These worked as expected, and the probes and tests keep them that way: a refused or overridden Select pick shows the state; late items in a Select;
controlled `open` with a refusing reducer, for all three parts; uncontrolled `defaultValue`; disabled parts and items; empty items; typeahead;
Escape and focus return; two instances; Collection rows; Switchable pages; an isolated child (the parent's intent doesn't hear the child's part);
Escape on a Select inside a `sygnal/ui` dialog closes only the list (jsdom and the three engines); `processForm` on submit; `FormData` single and
multiple; mock-DOM `t.widget('.s').dispatch('value-change', …)`; SYG142 on an undeclared command (`toggle` on a Select); the docs' demos and
testing snippets as written.

## What changed

`src/ui/zag/shared.ts`:
- `announce(x, p, values, type)` (ZS-1, ZS-5) puts a stand-in field with the part's `name` and the picked value(s) in the host and dispatches a
  bubbling `input` (or `focusout`) event from it. The stand-in is a `<select multiple>` when the part is `multiple`. While it is there, the part's
  own fields lose their `name`, so FormData and processForm see the pick exactly once. The rendered fields never change: a refused pick leaves the
  submitted value alone, and no field is left behind.
- `leaving(rootProps, x, p)` (ZS-5) announces a `focusout` when the focus leaves the host, but not when it moves into the listbox.
- `placed(p, x)` (ZS-6) defaults `positioning.strategy` to `'fixed'` inside a `<dialog>`. A `positioning` prop still wins.

`select.ts`:
- `onValueChange` announces the pick.
- The root has `leaving`.
- The props pass through `placed`.
- The hidden `<select>` also has options for selected items that are no longer in `items` (ZS-2).

`combobox.ts`:
- `sync` (ZS-3) runs on each render, and once more after a microtask so the app's flush has run first. When the input shows something other than
  the value's label, and the list is closed, nothing has been typed since the last pick, the combobox is single and `selectionBehavior` is
  `'replace'`, it calls Zag's `syncSelectedItems()`. Typed text, `allowCustomValue`, `'preserve'` and `'clear'` are left alone.
- A `reset` listener on the input's form (its ancestor, or the form named by the `form` attribute; added in the input's insert hook, removed in
  destroy) puts the machine's initial value back, as Zag's Select does (ZS-4). That is the controlled value's first one, or `defaultValue`. After
  the browser's own reset (a `setTimeout`), the input is given the label.
- `onValueChange` announces the pick; `leaving` and `placed` as for Select.

`menu.ts`: `placed`.

Types: `MenuProps.label` is optional (T-1); `ListboxProps.name` and `value` have corrected docs (T-2, F-5).

Docs:
- `ui/select.md` has a new **Forms** section: the `form` behavior, processForm, reset.
- `ui/combobox.md`: the `value` row (the label follows the state), the `name` row (the form behavior, reset), and a `multiple` row (render the
  chips yourself).
- `ui/menu.md`: the `label` row (icon trigger).
- All three Positioning sections: `'fixed'` is the default in a dialog.
- `llms/ui.md`: no `events('change')`, the form behavior, Portal, plus the copies `scripts/build-llms.mjs` writes.

Tests:
- `test/ui-sweep-zag.test.js` (13 tests): ZS-1 to ZS-6. Without the fix, 10 of the 13 fail (ZS-6 was added later).
- `type-tests/p5-2z-adapters.tsx`: an icon `Menu`.
- `browser-tests/src/tests/ui-zag-p5z.jsx`:
  - ZS-1/ZS-5: the form behavior, with keyboard and pointer, and blur.
  - ZS-3/ZS-4: a refused pick, late items, a reset button.
  - ZS-6: a Select in a dialog (Escape, position, pick).

Size: the core is unchanged; the size gate result is under Gate. Each part's own module, with `shared.ts` and minified by esbuild with Zag,
`sygnal/zag` and `sygnal` external, grows in gzip as follows:

| Part | Before | After | Change |
|---|---|---|---|
| Select | 980 B | 1,426 B | +446 B |
| Combobox | 1,306 B | 2,022 B | +716 B |
| Menu | 617 B | 665 B | +48 B |

Next to Zag's ~33 KB per part, this is noise.

## Recommendations

1. **F-1 (small, ~1 h): a sygnal-check rule for first-party parts.** `model/widgets.js` already lists the events of Menu, Select and Combobox.
   Report `events('change' | 'input')` on a selector that resolves only to one of them, and suggest the declared name (`'value-change'`, or
   `'select'` for Menu). A new code, or SYG141 extended to "a native name on a first-party part". Agents reach for `change` first.
2. **F-2 (medium, ~½ day): a `chips` render for multiple Combobox.** Built-in chips (`data-part="item-chip"`, each with a remove button wired to
   Zag's `clearValue(value)`), or at least a `remove` command (`ELEMENT: { remove: '.c', value }`) and a docs recipe. Today the app needs its own
   remove action that rewrites `value`.
3. **F-3 (medium, 1–2 days each): groups and menu item kinds.** `items: [{ group: 'Fruit', items: [...] }]` maps to Zag's `groupBy` and
   `getItemGroupProps`. Menu `{ type: 'checkbox' | 'radio', checked }` maps to Zag's option items. Links: `{ href }` rendered as `<a>`.
   Submenus: Zag's nested machines, the largest piece.
4. **F-4 (small, ~1 h): Combobox `empty="No results"`.** A row (`data-part="empty"`) shown when the list is open with no items, announced through
   a status region.
5. **ZS-1 follow-through (small):** the guide's forms page could name Select and Combobox among the fields the form behavior hears.

## Open questions for the maintainer

1. **ZS-1's mechanism.** A stand-in field and an `input` event keeps the form behavior and processForm unchanged, and they keep reading
   `e.target`. The alternative is a form-behavior hook for widgets, for example a widget that declares `field: { name, value }`. That is cleaner
   but touches `src/extra/form.ts` and the core size budget. Is the stand-in acceptable, or should widgets get a field contract (which would also
   serve `defineWidget` date pickers and the like)?
2. **F-7, custom text and the form behavior.** Announcing the typed text with `allowCustomValue` would make the controlled value the typed text.
   Zag then rewrites the input to that value's label, which is `''` for a value with no item, and the user's typing is lost. Options: announce
   only on blur (when Zag keeps the custom text), or leave it and document that `allowCustomValue` text reaches the app through `input-change`.
   Which do you want?
3. **ZS-6's default.** `'fixed'` only inside a `<dialog>`. Other clipping containers (`overflow: hidden` cards) still need the prop, as the docs
   say. Should `'fixed'` be the default everywhere? Floating UI recommends it for most popovers. The cost: an ancestor with a transform then
   becomes the containing block.
4. **ZS-3 runs on every render** (one comparison while closed, and a microtask only on a mismatch). It could instead be keyed on the items'
   identity. Fine as it is?

## Gate (2026-10-31)

- `npm run build`: ok.
- `npm test`:
  - vitest: 5,726 passed. `vite-plugin-dev` timed out once under load, then passed alone and on the rerun.
  - test:examples: ok. The worktree needed `TEST_EXAMPLES_INSTALL=1` for `examples/advanced-feature-tests`.
  - test:types: ok.
  - test:browser: 401 passed on Chromium.
  - test:perf-gate: ok.
- The Zag browser suite (`BROWSER_TESTS_ONLY=uiZag`): 13/13 on Chromium, Firefox and WebKit.
- `node scripts/size-gate.mjs`: 42,647 B (353 B headroom). The core is unchanged.
- `node scripts/check-doc-samples.mjs`: 973 clean.
- `npm --prefix docs run build`: ok.
- `check-live`: 126 demos ok on Chromium, Firefox and WebKit.
