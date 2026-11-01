## KanbanSync: replay diverges

Recorded 2026-10-30T04:59:01.219Z · 457 ms · 22 inputs · 21 checkpoints

**Expected:** a new lane is called "New Lane"

### What happened

```
+   30ms  (root)                             ADD_LANE (intent) {"$event":"click","target":{"$el":"BUTTON"}}
+   37ms  LaneComponent[lane-1]              START_EDIT (intent) {"$event":"dblclick","target":{"$el":"H2"}}
+   43ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "B"
+   44ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Ba"
+   45ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Bac"
+   46ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Back"
+   47ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Backl"
+   48ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Backlo"
+   49ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Backlog"
+   50ms  LaneComponent[lane-1]              FINISH_EDIT (intent) "Backlog"
+   52ms  LaneComponent[lane-2]              SHOW_ADD_TASK (intent) {"$event":"click","target":{"$el":"BUTTON"}}
+   59ms  LaneComponent[lane-2]              ADD_TASK (intent) "Ship the replay spike"  [reads now]
+   62ms  (root)                             DRAG_START (intent) "task-1"
+   66ms  (root)                             DROP (intent) {"dropZone":{"$el":"DIV","dataset":{"laneId":"lane-3"}},"in…
+  218ms  (root)                             AUTOSAVE (reply) {"n":1,"t":1793336341438}
+  238ms  (root)                             SAVED (reply) {"saves":1}  [reads now, random]
+  240ms  LaneComponent[lane-1]              MOVE_RIGHT (intent) {"$event":"click","target":{"$el":"BUTTON"}}
+  240ms  (root)                             MOVE_LANE_RIGHT (intent) {"laneId":"lane-1"}
+  246ms  LaneComponent[lane-2]/TaskCard[task-3] DELETE (intent) {"$event":"click","target":{"$el":"BUTTON"}}
+  246ms  LaneComponent[lane-2]              DELETE_TASK (intent) "task-3"
+  417ms  (root)                             AUTOSAVE (reply) {"n":2,"t":1793336341637}
+  421ms  (root)                             SAVED (reply) {"saves":2}  [reads now, random]
```

### What the replay found

- First divergence: action #2 `ADD_LANE` on `KanbanSync` (the action produced a different state)
  - `lanes.3.title`: recorded `"New Lane"`, now `"Untitled"`
- `AUTOSAVE` (#17) sent other values than recorded (hashes c6ab4785 → 50901658); now: HTTP {"url":"http://api.test/board","method":"POST","json":{"lanes":[{"id":"lane-1","title":"Backlog","tasks":["task-2"]},{"id":"lane-2","title":"In Progress","task…
- `AUTOSAVE` (#23) sent other values than recorded (hashes eef6a08e → 39360eef); now: HTTP {"url":"http://api.test/board","method":"POST","json":{"lanes":[{"id":"lane-2","title":"In Progress","tasks":["task-1793336341280"]},{"id":"lane-1","title":"Ba…

### Reproduce

Attach `KanbanSync.recording.json`, then:

```js
const r = await replay(KanbanSync, log)
console.log(r.divergence)
```
