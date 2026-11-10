<!-- sygnal-behaviour-report -->
## Behaviour report

`d3b10f54~1` (531261de9d) → `d3b10f54`. Components: 2 changed, 0 added, 0 removed. Derived from the code by `sygnal-check`, not from the author's description.

No side effect was added to an existing action, and no guard removed or write widened. That is all this line says: read the changes below.

### Also changed
- **Check** (Payload): `IssueRow.PICK` PARENT payload changed shape: a value → { pick }; check the receivers (`examples/tui-tracker/src/app.jsx:47`)

### `IssueRow` · `examples/tui-tracker/src/app.jsx`

| | action | trigger | sinks | logic |
|---|---|---|---|---|
| + | `DETAIL` | + `keydown .issue` when `(e) => e.key === 'ArrowRight'` | + PARENT |  |
| + | `MOVE` | + `keydown .issue` when `(e) => e.key in NAV` | + PARENT |  |
| ~ | `PICK` | `focus .issue` | PARENT, payload value → {pick} | payload |

- view code changed; context +tabStop (markup, text and styling are not classified)

**Blast radius:** PARENT → Tracker (SELECT, STEP, TO_DETAIL)

### `Tracker` · `examples/tui-tracker/src/app.jsx`

| | action | trigger | sinks | logic |
|---|---|---|---|---|
| ~ | `SELECT` | new filter `(m) => m.pick != null` | STATE |  |
| ~ | `STEP` | rewired: + `CHILD IssueRow`; new filter `(m) => m.step != null` | ELEMENT, STATE |  |
| + | `TO_DETAIL` | + `CHILD IssueRow` when `(m) => m.detail` | + ELEMENT |  |
| + | `TO_LIST` | + `keydown .detail` when `(e) => e.key === 'ArrowLeft'` | + ELEMENT, reads selectedId |  |

- context `tabStop` added
- view code changed (markup, text and styling are not classified)

### What this report did not look at
- Changed code where no behaviour difference was found (comments, formatting, code no component reaches, or a limit of the analysis): `examples/tui-tracker/src/styles.js`
- Changed tests: 1 file
- Not analysed at all: what the view renders (markup, text, styling), what happens inside helpers beyond whether they changed, runtime data and timing.
