<!-- sygnal-behaviour-report -->
## Behaviour report

`a990ebbc~1` (f933f615e1) → `a990ebbc`. Components: 1 changed, 0 added, 0 removed. Derived from the code by `sygnal-check`, not from the author's description.

### Look at these first
- **Check** (Branch removed): `App.ROUTE` STATE: logic that depended on `inWizard(state.route)` is gone (`examples/filter-wizard/src/App.jsx:36`)

### `App` · `examples/filter-wizard/src/App.jsx`

| | action | trigger | sinks | logic |
|---|---|---|---|---|
| ~ | `ROUTE` | reply | STATE, writes route, flow (same), reads -route | branches, conditions, values: fewer branches (2 → 1); condition gone: `inWizard(state.route)`; what it puts in `flow` differs |

### What this report did not look at
- Changed tests: 1 file
- Not analysed at all: what the view renders (markup, text, styling), what happens inside helpers beyond whether they changed, runtime data and timing.
