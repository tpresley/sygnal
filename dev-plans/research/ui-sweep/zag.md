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

## Round 2 (2026-10-31): the maintainer's decisions, built

Merged `claude/advanced-integration` (aa63f44f) first. The rules were:
- the proper fix, not the cheap one;
- when in doubt, match Radix / React Aria;
- size only measured and reported, never a reason to cut.

### 1. The widget field contract (open question 1, ZS-1, recommendation 5)

`src/extra/field.ts`: a widget that declares `field: true | { event, read }` (defineWidget, and fromZag through its options) is one form field,
named by its `name` prop.

- When it dispatches the field's event (`field.event`, else `value.event`, else `'change'`), `widget.ts` also fires a bubbling `input` from
  the host, marked with `Symbol.for('sygnal.field')`. While that event is dispatched, the field's value is the event's detail, because the
  value prop may not have caught up yet. The host record (`__sw`) gets `f()` (`{ name, value, disabled }`) and `h` (the host).
- `src/extra/form.ts`:
  - CHANGE reads a marked host `input` as a change of the field.
  - Other `input` events on or inside a field host don't count, unless their target has a `name` of its own. This also stops the nameless
    visible input of a Combobox sending `CHANGE { name: '' }` on every keystroke.
  - BLUR maps a focusout inside a field host to the field's name, and only when the focus leaves the host.
- `src/extra/processForm.ts`: a field widget's value is written over FormData's entry for it. Its own named fields follow its value prop,
  which may lag behind a pick. A `multiple` field gives an array: FormData would give only the last value.
- Mock DOM (`src/extra/testing.ts`):
  - `t.widget(sel).dispatch(fieldEvent, detail)` also simulates the `input` with `{ name, value }`, so the form behavior hears it.
  - A simulated `focusout` on a field host carries its `name`.
- Select and Combobox declare `field: { event: 'value-change', read }`. Their hidden named fields stay for native FormData and submission.
  Round 1's stand-in field (`announce`) and focusout re-dispatch (`leaving`) are gone.
- Types: `WidgetDefinition.field` (`src/index.d.ts`) and `FromZagOptions.field`.
- Docs: a new widgets-guide section, "Form fields", with a date-picker example. The forms guide's field-types table now lists Select,
  Combobox and widget fields, with the blur rule. `llms.txt` has one sentence on it (still within the budget test).
- Tests: `test/widget-field.test.js`:
  - a defineWidget date-picker-like field in the real and the mock DOM;
  - touched;
  - processForm, also during dispatch;
  - disabled;
  - the inner nameless input ignored;
  - a Select in the mock DOM.

  All round-1 ZS-1/ZS-5 tests pass on the contract.

### 2. Custom values committed on blur (open question 2, F-7)

As React Aria's `allowsCustomValue`: with `allowCustomValue` (single), the typed text is committed when the focus leaves the combobox, or on
Enter with no active option.

- Text equal to an item's label picks that item.
- Other text becomes the value itself. It is a machine value that no item has, reported with `value-change`, given to the controlled value
  and the form behavior.
- An empty input clears the value.
- Leaving also closes the list. Zag closes it only on a pointer or focus outside, so a programmatic blur in jsdom would have left it open.

Zag wipes the input of a value it can't find, both in `syncSelectedItems` and when the controlled value arrives. ZS-3's check now shows such a
value as its own text, and it runs on Zag's own input writes too (`onInputValueChange` with a non-typing reason, and on close), not only on
renders.

A refused commit (`ABORT`) puts the input back to the state's value. While the user is still typing, the hidden input submits the typed text
(G-435 / G-468 / G-494 unchanged).

I tried a shadow `cv` state with muted events first and dropped it: Zag calls `onValueChange` after its current transition, so muting by a
flag was unreliable. A plain value with no item turned out simpler and correct.

### 3. `position: fixed` by default (open question 3)

`placed()` in `shared.ts` merges `{ strategy: 'fixed' }` under the `positioning` prop, for all three parts and Menu's submenus, as Radix's
Popper does.

- The positioning sections of the three pages now explain:
  - the default;
  - the containing-block caveat (an ancestor with a `transform`, `filter`, `perspective` or `contain`);
  - the `strategy: 'absolute'` override, and that other options merge over the default.
- `UiPositioning` now types `strategy`.
- `test/p5-2t-g416-positioning.test.js` was updated to the new default.
- Browser test: a grouped Select inside a 40 px `overflow: hidden` box opens fully and is hit-testable below the box, in all three engines.

### 4. ZS-3's per-render check (open question 4)

Kept, and extended to Zag's own writes. Keying it on the items' identity would miss the other mismatch sources:
- a refused pick;
- Zag's microtask writes after a value change, which happen outside a render;
- a custom value.

### 5. F-1: SYG141 on the parts

`sygnal-check/src/rules/syg140-widgets.js`: `events('change' | 'input')` (or the `DOM.change` shorthand) on a selector that resolves only to
Menu / Select / Combobox is reported.

- The message: "listens for the native 'change' on '.size' (Select): the part reports its value with 'value-change' … did you mean
  'value-change'?". Menu suggests `'select'`.
- It comes with the rename as a quick fix.
- No new code: the native session owns new codes this round.
- The explanation and the generated error reference were updated.
- `model/widgets.js` marks the first-party parts (`part`) and lists Menu's `checked-change` and Combobox's `remove`.
- Tests: `sygnal-check/test/ui-zag-habit.vtest.js`.

### 6. F-2: chips for a multiple Combobox

- Each value is a `[data-part="item-chip"]` (`role="listitem"`), with `item-chip-text` and an `item-chip-remove` button, in an
  `[data-part="item-chips"]` `role="list"` named by the label (`chipsLabel`).
- The remove button:
  - is named by `removeLabel`, a prefix or `(label) => name`, so it can be translated (default "Remove Paris");
  - calls Zag's `clearValue(value)`;
  - is out of the tab order, and preventDefaults `mousedown` so the input keeps the focus;
  - is disabled with `disabled` / `readOnly`.
- Backspace in the empty input removes the last chip. A Backspace that deletes text doesn't.
- The `remove` command: `{ remove: '.tags', value }` (without a value: the last).
- `chips={false}` renders no chips.
- Docs: a "Several values (chips)" section with a styled live demo.

### 7. F-3: groups, Menu item kinds, submenus

- **Groups** (Select, Combobox):
  - `items: [{ group, items }]` flattens into items with `group`. The collection gets `groupBy`, and Zag orders navigation by group.
  - Each group renders as `getItemGroupProps` (`role="group"`, `aria-labelledby`) with a `getItemGroupLabelProps` label.
  - Combobox filtering drops the groups with no matches.
  - The hidden native `<select>` lists every item.
  - Docs: a Select "Groups" section with a live demo.
- **Menu item kinds**:
  - `{ type: 'checkbox' | 'radio', value, label, checked }` uses Zag's option items (role `menuitemcheckbox` / `menuitemradio`,
    `aria-checked`, a `✓` indicator). A pick reports `checked-change` `{ value, checked, type }`, plus `select`. The app keeps `checked` in
    state, as Radix's controlled `checked`.
  - `{ href, value, label, target, rel }` renders an `<a>` menu item.
- **Submenus**: `{ value, label, items }`, nestable.
  - Each submenu is its own VanillaMachine, kept on the instance by path.
  - Its props come from the Menu's (`dir`, `loopFocus`, `typeahead`, `closeOnSelect`, the strategy); `placement` is `right-start`
    (`left-start` with rtl).
  - The machines are linked with `setChild` / `setParent` once both run. The item is `getTriggerItemProps(childApi)` with a `›` indicator.
  - The submenu's positioner renders next to the Menu's, outside its `role="menu"`.
  - A submenu pick is the Menu's `select` and closes every level.
  - Keyboard (Zag's, as Radix's Sub): ArrowRight / Enter / hover opens it; ArrowLeft / Escape closes it and returns to the item.
- `fromZag` gained, for parts with machines of their own:
  - `x.draw` and `x.normalize`;
  - `x.off`, run on stop: the submenus' machines stop with the Menu.
- Bugs found on the way:
  - **Zag's connect spreads one prop getter's result over another's** (`getOptionItemProps` over `getItemProps`, the `mergeProps` in
    `getTriggerItemProps`). Our nested snabbdom bags (`{ attrs, on, … }`) don't survive that: the second `attrs` replaced the first and lost
    `id` / `data-ownedby`, so the items weren't navigable. Menu's item rows now use a flat (identity) normaliser and convert with `zagProps`
    at the end. Select and Combobox don't call these getters.
  - **Zag's menu item indicator has no `aria-hidden`**, so a checked item's accessible name became "✓ Grid". The Menu now sets it; found by
    the real-browser role query.
- Types: `MenuItem` (a union of the kinds), `MenuCheckedChange`, Menu's events now include `'checked-change'`, `UiGroup`. Type tests cover each
  kind, groups, chips, `empty` and a bad strategy.
- Docs: an "Item kinds" section with a live demo and CSS; the keyboard and styling tables.

### 8. F-4: Combobox `empty`

`empty="No results"`:
- a `[data-part="empty"]` row after the listbox, inside the positioner, `hidden` unless the list is open with no items;
- the same text in a visually hidden `role="status"` region, which screen readers announce.

Docs: a "No results" section; the chips demo uses it.

### Tests (round 2)

- `test/ui-zag-round2.test.js` (17):
  - Q2: blur, Enter, label match, clear, refused, uncontrolled with the form behavior, without `allowCustomValue`;
  - Q3;
  - chips: list and labels, click remove, Backspace, the `remove` command, `chips={false}`, `removeLabel`, disabled;
  - empty;
  - Select groups (roles, labels, keyboard across groups, the hidden select) and Combobox groups (filtering);
  - Menu checkbox / radio, link, submenu keyboard and pick, the indicator's aria-hidden.
- `test/widget-field.test.js` (6).
- Updated: `test/ui-sweep-zag.test.js` (ZS-6 is now everywhere; the custom-text test commits) and `test/p5-2t-g416-positioning.test.js`.
- `browser-tests/src/tests/ui-zag-p5z.jsx`, 4 new tests, all 17 Zag tests passing in Chromium, Firefox and WebKit:
  - Q2: Tab and Enter commit;
  - F-2/F-4: chip remove by pointer, Backspace, the empty row and status;
  - F-3/Q3: a grouped Select in a clipping box, keyboard across groups;
  - F-3: Menu checkbox by Enter, the link item, submenu ArrowRight / ArrowLeft / pick.

  The submenu test waits for focus to move between levels. Without those waits, real input raced Zag's focus moves.
- `sygnal-check/test/ui-zag-habit.vtest.js` (2).
- `type-tests/p5-2z-adapters.tsx`.

### Size (round 2)

The core is unchanged: none of `src/core/**` and nothing the kanban size-gate app uses changed. The size gate's figure is under the gate
results below.

Each module is minified with esbuild, with its local helpers bundled (`shared.ts` for the parts, `field.ts` for the form modules) and
everything else external. Gzip bytes:

| Module | Before the sweep (18a73b35) | Round 1 (f1d7eb33) | Round 2 | Round 2 − round 1 |
|---|---|---|---|---|
| `sygnal/ui/menu` (menu.ts + shared) | 620 | 669 | 1,530 | +861 (item kinds, submenus, flat normaliser) |
| `sygnal/ui/select` (select.ts + shared) | 978 | 1,422 | 1,253 | −169 (stand-in gone; groups added) |
| `sygnal/ui/combobox` (combobox.ts + shared) | 1,303 | 2,012 | 2,644 | +632 (commit, chips, empty, groups) |
| `sygnal/zag` (zag.ts) | 1,947 | 1,947 | 1,979 | +32 (`draw`, `normalize`, `off`) |
| main bundle `form` behavior (form.ts + field.ts) | 3,048 | 3,048 | 3,191 | +143, only for apps that use `form` |
| main bundle `processForm` (+ field.ts) | 415 | 415 | 476 | +61, only for apps that use it |
| main bundle `defineWidget` (widget.ts + field.ts) | 2,255 | 2,255 | 2,412 | +157, only for apps that use widgets |

Next to Zag's ~33 KB per part, the parts' growth is small.

### Left for the maintainer

- `processForm` gives an array for a `multiple` widget field, where FormData's last-wins gives a native `<select multiple>` only its last value.
  Arrays are more correct, but the two field kinds now disagree. The types already say `[key: string]: any`.
- A controlled `allowCustomValue` combobox whose value arrives before its items shows the raw value as text until the items load ("par", then
  "Paris"): the value is no item's yet, so it counts as custom.
- The chip remove buttons are out of the tab order (the input + Backspace pattern). React Aria's TagGroup also makes the chips arrow-navigable.
  That would need its own focus model; say if you want it.
- Removing a chip isn't announced. A screen reader hears the list change only when it revisits the list. A status message ("Paris removed")
  would need a translatable string, like `removeLabel`.
- Docs budget: the forms guide's agent-size test (`test/p5-4d-forms-recipe.test.js`) allowed 18,500 B, and the page was already 16 B under. The
  field-types row for Select, Combobox and widget fields adds 137 B (18,621 B), so the limit is now 18,700 B, with a comment. Please confirm,
  or say which text to drop instead.

### Gate (round 2)

- `npm run build`: ok.
- `npm test`: every stage passes.
  - vitest: 5,753 passed.
  - test:examples: ok (with `TEST_EXAMPLES_INSTALL=1`).
  - test:types: ok.
  - test:browser: 412 passed on Chromium.
  - test:perf-gate: within limits.
- `node scripts/size-gate.mjs`: 42,647 B (353 B headroom). The core is unchanged.
- `npm --prefix sygnal-check test`: 1,850 passed in both runs (plain and per-file).
- The Zag browser suite: 17/17 on Chromium, Firefox and WebKit.
- `npm --prefix docs run build`: ok.
- `check-live`: 130 demos ok on Chromium, Firefox and WebKit (4 of them new).
- `check-doc-samples`: 977 clean.

## Round 3 (2026-10-31): chip keyboard and announcements, processForm arrays

The maintainer approved two items from round 2's list: chips you can reach and remove with the keyboard, with removals announced, and
`processForm()` arrays for a native `<select multiple>`. Merged `claude/advanced-integration` (60cd4b5f) first.

### 1. Combobox chips as React Aria's TagGroup

Read from React Aria's source (`packages/react-aria/src/tag/useTag.ts`, `useTagGroup.ts`, main, 2026-10-31):

- The group is `role="grid"` (`group` when empty) with `role="row"` tags holding a `gridcell`, on a horizontal `ListKeyboardDelegate`
  (Left / Right swapped in RTL, Home / End to the first / last, `shouldFocusWrap: true`).
- One tab stop: the focused tag has `tabIndex=0`, the others −1; before any focus, the first enabled tag.
- Delete and Backspace on a tag call `onRemove`; the list state then focuses the tag in the removed one's place (the next), else the
  previous; with none left, the group's container.
- The remove button is named "Remove" plus the tag (`aria-labelledby` button + row); tags are described by "Press Delete to remove tag." in
  keyboard modality.
- Announcements: the grid is `aria-live="polite"`, `aria-relevant="additions"`, only while the focus is inside it. So added tags are
  announced while the user is in the group, and removals are not announced at all.

What Sygnal does now (`src/ui/zag/combobox.ts`):

- `[data-part=item-chips]` is `role="grid"` (named by `chipsLabel`, default the label); each chip `role="row"`, named by its label, with a
  `role="gridcell"` (`data-part=item-chip-cell`) holding the text and the remove button. The remove button stays `tabindex="-1"`, and its
  mousedown is prevented, so a click keeps the focus where it is.
- Roving tabindex: the chip focused last while it is still a value, else the first, is the one tab stop; none when `disabled`.
- Keys, as in the request and React Aria, with the multi-select-combobox convention (Downshift's `useMultipleSelection`, MUI) for the input:
  - ArrowLeft with the caret at the start of the input (no selection) focuses the last chip; ArrowRight with `dir="rtl"`.
  - On a chip: ArrowLeft / ArrowRight move (swapped in RTL); ArrowLeft on the first stays; ArrowRight on the last returns to the input.
    React Aria wraps instead; inside a combobox the input is "after" the chips, so going there is the expected move. Home / End: first / last.
  - Delete / Backspace remove the focused chip and focus the next (else the previous, else the input), as React Aria. The neighbour's row is
    keyed, so it keeps its element whether the removal is in yet (a controlled value only changes after the app's flush) and keeps the focus.
  - `readOnly`: the chips navigate but don't remove.
- Description: one hidden `Press Delete to remove.` element the chips point at with `aria-describedby` (`removeHint`, `false` for none).
  React Aria adds it in keyboard modality only; ours is always there (a describedby on a focusable row is read when it is focused).
- Announcements: a polite `role="status"` region (the one `empty` already had, now also rendered for chips) says "Paris removed" once the
  value is gone, whatever removed it: a chip key, a remove button, Backspace in the input, the `remove` command. A removal the model refuses
  says nothing. `removedMessage={(label) => …}` localizes it; `false` turns it off. Every other message gets a trailing zero-width space,
  so removing the same city twice is announced twice. The text is cleared when `empty` takes the region, so it is not read again after.
  This goes past React Aria, which doesn't announce removals; the request asked for it, and it is what the round-2 report flagged.
- Additions are not announced. React Aria announces new tags only while the focus is in the group, and in a combobox a tag is added by a
  pick in the list, where the focus is in the input. The pick itself is announced (the option's `aria-selected`); a second message would
  repeat it.

Behaviour change from round 2 (unreleased): the chips were `role="list"` / `listitem`.

### 2. processForm: `<select multiple>` is an array

`processForm()` copied FormData's entries into an object, so a `<select multiple>` gave its last selected value, and no entry at all when
nothing was selected. It now gives every selected value as an array, `[]` when none (`src/extra/processForm.ts`: the form's `elements`, so a
`form="id"` control outside the form counts, as FormData does; one that is disabled, itself or by a fieldset, is left out, as FormData does).

- The `form` behavior already did this (its `CHANGE`, `native()`, G-376), and its values come from state, so it has nothing to change. No
  `formHelpers` export reads the DOM's selects (`focusInvalid` only builds a selector).
- A `multiple` Select or Combobox already gave an array (round 2's field contract).
- Types: `FormData<FIELDS>` and `processForm<FIELDS>` take `Record<string, any>` (were `Record<string, string>`), so
  `processForm<{ tags: string[] }>(…)` types. The default stays `Record<string, string>`, so untyped code doesn't change.
- A `sygnal/host` form (`toFormData()`) has no `elements`, so the host path is unchanged. Its select has no `selectedOptions`; a renderer
  target's multiple select would need both.
- Changelog: a **Changed.** entry under 7.2.0-preview.0, and the header's "everything is additive" line now names it. There is no 7.2
  migration page (`guide/migrating-to-7` is about 7.0), so the migration line (`data.tags.at(-1)` for the old value) is in the changelog
  entry and the forms reference.

Checkbox groups (several checkboxes with one name) have the same issue in `processForm()`: the last checked box's value, and no entry when
none is checked (a test pins this). Not changed, as asked. A fix would give an array when more than one box shares the name. A group with
a single box is the hard case: it can't be told apart from a single checkbox, which should stay a string. Options: always an array for a
name that more than one checkbox has (a group that renders one box changes type); or an array only on `name="tags[]"`, the PHP/Rails
convention. The `form` behavior already collects them into an array field (`item`), so `processForm()` is the only reader with the issue.

### Tests (round 3)

- `test/ui-zag-round3.test.js` (11, jsdom, real DOM): roles and names, the tab stop, the description, `disabled`; the input's ArrowLeft,
  arrows, Home / End, Right past the last, RTL; Delete / Backspace and the focus after them, the last chip, `readOnly`; announcements from
  each removal path, an addition not announced, the same text twice, `removedMessage` and `false`, a refused removal.
- `test/ui-zag-round2.test.js`: the chip roles (grid / row).
- `test/processform-select-multiple.test.js` (2): arrays, `[]`, a disabled select and a disabled fieldset left out, `form="id"` in, a
  single select unchanged; checkbox groups unchanged.
- `type-tests/public-api.ts` (array fields), `type-tests/p5-2z-adapters.tsx` (`removedMessage`, `removeHint`).
- `browser-tests/src/tests/ui-zag-p5z.jsx`: "Round 3" with Playwright's trusted keyboard: the grid / row / button roles by name, Tab and
  Shift+Tab (one stop, then the last focused chip), ArrowLeft from the input, the arrows, Home / End, Right back to the input, Delete and
  Backspace with the focus after them, the three status messages, and no message for an addition. 18/18 on Chromium, Firefox and WebKit.

### Size (round 3)

The core is unchanged (nothing under `src/core/**` or in the kanban app's path); the size gate's figure is below. Measured as in round 2:

| Module | Round 2 | Round 3 | Change |
|---|---|---|---|
| `sygnal/ui/combobox` (combobox.ts + shared) | 2,644 | 3,227 | +583 (chip keys, roving tabindex, status messages, hint) |
| main bundle `processForm` (+ field.ts) | 476 | 539 | +63, only for apps that use it |

Menu, Select, `sygnal/zag`, `form` and `defineWidget` are unchanged.

### Gate (round 3)

- `npm run build`: ok.
- `npm test`: every stage passes: vitest 5,784 passed; test:examples ok; test:types ok; test:browser ok on Chromium; test:perf-gate within limits.
- `node scripts/size-gate.mjs`: 42,734 B (266 B headroom). Round 3 adds 0 B: the figure is the same with HEAD's `processForm.ts`
  (kanban doesn't use it). The 87 B over round 2's 42,647 B came in with the merge of `claude/advanced-integration` (60cd4b5f).
- `npm --prefix sygnal-check test`: 1,860 passed in both runs.
- The Zag browser suite: 18/18 on Chromium, Firefox and WebKit.
- `npm --prefix docs run build`: ok. `check-live`: 130 demos ok on Chromium, Firefox and WebKit.
- `check-doc-samples`: 979 clean.

## Round 4: processForm arrays for checkbox groups

The maintainer chose the first option from round 3: checkboxes sharing a name are a group when more than one is in the form.

### The rule (`src/extra/processForm.ts`)

- The form's controls (`elements`: `form="id"` boxes in, boxes outside the form out) are read when the event happens. A name with more than
  one `type=checkbox` control is a group, and its entry is the checked, enabled boxes' values in document order, `[]` when none is checked:
  `FormData.getAll(name)`. A box without a `value` gives `"on"`, as FormData does.
- Disabled boxes (their own `disabled` or a disabled fieldset, `:disabled`) count toward the group but give no value, so disabling one box
  never changes the field's type. A group whose boxes are all disabled has no entry, as a disabled `<select multiple>` and FormData.
- A lone checkbox is unchanged: its value when checked, no entry when not (`FormData.get`). Radios are unchanged: a radio group has at most
  one value, and FormData gives one entry.
- A `sygnal/host` form (no `elements`: terminal, worker, agent-ui) gets the same rule from its `input` elements and their `disabled`
  property. Before, it had the old last-wins value from `toFormData()`. The host's `<select multiple>` is still not an array: host
  elements have no `selectedOptions` (follow-up).

### A group that renders one box

A list of options that is filtered, or loaded, down to one box gives a string for that box (and no entry when it is unchecked), because
processForm sees only what is rendered. The forms reference and the changelog say to read such a field as `[].concat(data.tags ?? [])`,
or to use the `form` behavior, whose array fields stay arrays whatever renders. An app can also keep two boxes rendered.

### The form behavior and processForm

They don't decide "group" the same way, and can't: the `form` behavior has a declared shape and processForm has only the DOM.

- The `form` behavior (`src/extra/form.ts`, G-376): a checkbox on a field whose value is an array is one of a group. Checking adds its
  value, unchecking removes it, however many boxes render. A checkbox on any other field gives `checked` (a boolean).
- processForm: more than one box with the name in the form.

With two or more boxes on an array field both give arrays of the same values, with two differences:

- **A group that renders one box**: the `form` behavior gives an array, processForm a string.
- **Order**: the `form` behavior appends in the order the boxes were checked (`[...rest, item]`), processForm and FormData in document
  order. Not changed: `src/extra/form.ts` is outside this round's scope. Sorting the form behavior's array into document order would need
  the DOM in a state step. Keeping it as it is seems right (it is state the app owns). An option to change it is a maintainer call.

An app that uses the `form` behavior doesn't call processForm on the same form, so the two only meet in docs and in migrations.

### Tests (round 4)

- `test/processform-arrays.test.js` (renamed from `processform-select-multiple.test.js`; 5 tests). Covers:
  - a group: `[]`, the checked values in document order, an unchecked box removed;
  - a disabled box counted with no value, and an all-disabled group with no entry;
  - a `form="id"` box in, and boxes outside the form out;
  - a lone checkbox (`"on"` and a value) and radios unchanged;
  - a `sygnal/host` form.
- `type-tests/public-api.ts`: the array-field test's name.

### Size (round 4)

- Size gate: 42,734 B, unchanged from round 3 (266 B headroom); kanban doesn't use `processForm`.
- `processForm` in the main bundle (esbuild, minified, gzip, xstream external): 539 → 655 B (+116), only for apps that use it.

### Gate (round 4)

The machine was shared with other sessions' gates (load average up to 141).

- `npm run build`: ok.
- vitest: the first full runs had load timeouts in sandbox, compose-generated, LSP, MCP and sortable suites, none of them form code. Each
  failing file then passed on its own: 102 + 7 tests.
- test:examples, test:types, test:browser (Chromium) and test:perf-gate: ok.
- Size gate: ok.
- sygnal-check: the failing LSP / graph files passed on their own (109). Otherwise 1,856 passed.
- `npm --prefix docs run build`: ok. `check-live`: 130 demos ok on Chromium, Firefox and WebKit.
- `check-doc-samples`: 980 clean.
