<!-- sygnal-behaviour-report -->
## Behaviour report

`916e23e7~1` (4a8cbc95ad) → `916e23e7`. Components: 2 changed, 0 added, 0 removed. Derived from the code by `sygnal-check`, not from the author's description.

No side effect was added to an existing action, and no guard removed or write widened. That is all this line says: read the changes below.

### `LaneComponent` · `examples/kanban/src/LaneComponent.jsx`

- view code changed; context +draggingLaneId (markup, text and styling are not classified)

### `RootComponent` · `examples/kanban/src/RootComponent.jsx`

| | action | trigger | sinks | logic |
|---|---|---|---|---|
| + | `BOOTSTRAP` | + (builtin) | + DND, + `{ configs }` |  |
| ~ | `DRAG_END` | rewired: + `DND.select(task).events(dragend)`, − `DND.select(dragend)` | STATE |  |
| ~ | `DRAG_START` | rewired: + `DND.select(task).events(dragstart)`, − `DND.select(dragstart)` | STATE |  |
| ~ | `DROP` | rewired: + `DND.select(lane).events(drop)`, − `DND.select(drop)` | STATE |  |
| + | `LANE_DRAG_END` | + `DND.select(lane-sort).events(dragend)` | + STATE, writes draggingLane, reads draggingLane |  |
| + | `LANE_DRAG_START` | + `DND.select(lane-sort).events(dragstart)` | + STATE, writes draggingLane |  |
| + | `LANE_DROP` | + `DND.select(lane-sort).events(drop)` | + STATE, writes draggingLane, lanes, reads draggingLane, lanes |  |

**Guards (ABORT / no change)**
- + `LANE_DRAG_END STATE` stops when `!state.draggingLane`
- + `LANE_DROP STATE` stops when `!state.draggingLane`

- initial state `draggingLane`: + `null`
- context `draggingLaneId` added
- view reads +draggingLane

**Blast radius:** state `draggingLane` → LaneComponent (context draggingLaneId); state `lanes` → LaneComponent (Collection from 'lanes')

### What this report did not look at
- Changed code where no behaviour difference was found (comments, formatting, code no component reaches, or a limit of the analysis): `examples/kanban/src/main.js`
- Changed files that aren't code: `examples/kanban/src/styles.css`
- Not analysed at all: what the view renders (markup, text, styling), what happens inside helpers beyond whether they changed, runtime data and timing.
