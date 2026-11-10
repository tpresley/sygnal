<!-- sygnal-behaviour-report -->
## Behaviour report

`43026613~1` (4bdf224104) → `43026613`. Components: 1 changed, 0 added, 0 removed. Derived from the code by `sygnal-check`, not from the author's description.

Nothing here needs special attention: no new side effects, removed guards or wider writes were found.

### `RootComponent` · `examples/kanban/src/RootComponent.jsx`

| | action | trigger | sinks | logic |
|---|---|---|---|---|
| ~ | `LANE_DRAG_START` | rewired: + `DND.dragstart(lane-sort).data(laneId)`, − `DND.dragstart(lane-sort)` | STATE, writes draggingLane (same) | values: what it puts in `draggingLane` differs |

**Blast radius:** state `draggingLane` → LaneComponent (context draggingLaneId)

### What this report did not look at
- Changed tests: 1 file
- Not analysed at all: what the view renders (markup, text, styling), what happens inside helpers beyond whether they changed, runtime data and timing.
