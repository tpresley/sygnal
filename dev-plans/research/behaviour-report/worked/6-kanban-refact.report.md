<!-- sygnal-behaviour-report -->
## Behaviour report

`bd18dc24~1` (9e66efe22e) → `bd18dc24`. Components: 1 changed, 0 added, 0 removed. Derived from the code by `sygnal-check`, not from the author's description.

Nothing here needs special attention: no new side effects, removed guards or wider writes were found.

### `RootComponent` · `examples/kanban/src/RootComponent.jsx`

| | action | trigger | sinks | logic |
|---|---|---|---|---|
| ~ | `DRAG_START` | rewired: + `DND.dragstart(task).data(taskId)`, − `DND.dragstart(task)` | STATE, writes dragging (same) | values: what it puts in `dragging` differs |

**Blast radius:** state `dragging` → TaskCard (context draggingTaskId)

### What this report did not look at
- Changed code where no behaviour difference was found (comments, formatting, code no component reaches, or a limit of the analysis): `examples/kanban/src/LaneComponent.jsx`
- Not analysed at all: what the view renders (markup, text, styling), what happens inside helpers beyond whether they changed, runtime data and timing.
