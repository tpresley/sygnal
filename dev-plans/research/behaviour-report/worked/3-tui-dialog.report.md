<!-- sygnal-behaviour-report -->
## Behaviour report

`73b084d8~1` (6be8223b97) → `73b084d8`. Components: 1 changed, 0 added, 0 removed. Derived from the code by `sygnal-check`, not from the author's description.

### Look at these first
- **Check** (Wider writes): `Tracker.ASK_DELETE` now also writes `confirm` (`examples/tui-tracker/src/app.jsx:289`)
- **Check** (Wider writes): `Tracker.DELETE` now also writes `confirm` (`examples/tui-tracker/src/app.jsx:290`)
- Note (Event without listener): `Tracker` emits `TOAST`, and no scanned component listens (a package component may: Toaster)

### `Tracker` · `examples/tui-tracker/src/app.jsx`

| | action | trigger | sinks | logic |
|---|---|---|---|---|
| ~ | `ASK_DELETE` | `click .delete`, `key d` | − ELEMENT<br>STATE, writes confirmId → confirmId, confirm, reads +confirm | STATE: written keys |
| − | `CANCEL_DELETE` | − `click .confirm-cancel`, `close Confirm` | − ELEMENT<br>− STATE |  |
| ~ | `CREATED` | `CHILD IssueForm` | + EVENTS, emits `TOAST`<br>STATE, writes issues, selectedId, show, query, view, message → issues, selectedId, show, query, view | STATE: written keys |
| ~ | `DELETE` | `click .confirm-ok` | − ELEMENT<br>STATE, writes issues, selectedId, confirmId → issues, selectedId, confirmId, confirm, reads +confirm | STATE: written keys |
| ~ | `DELETED` | reply | + EVENTS, emits `TOAST`<br>− STATE |  |
| ~ | `SAVED` | reply | + EVENTS, emits `TOAST`<br>− STATE |  |
| + | `confirm.CANCEL` | + (intent) | + STATE, writes confirmId, confirm |  |
| + | `confirm.CLOSE` | + (intent) | + STATE, writes confirmId, confirm |  |

- behavior `confirm` added
- view code changed; reads +confirm; children +sygnal/ui:Toaster (markup, text and styling are not classified)

**Blast radius:** state `issues` → IssueRow (Collection from 'issues'), IssueRow (context tabStop); state `query` → IssueRow (context tabStop); state `selectedId` → IssueRow (context selectedId), IssueRow (context tabStop); state `show` → IssueRow (context tabStop); event `TOAST` → no scanned listener

### What this report did not look at
- Changed code where no behaviour difference was found (comments, formatting, code no component reaches, or a limit of the analysis): `examples/tui-tracker/src/terminal.jsx`
- Changed tests: 1 file
- Not analysed at all: what the view renders (markup, text, styling), what happens inside helpers beyond whether they changed, runtime data and timing.
