// @vitest-environment jsdom
// Generated from a Sygnal recording (record/replay spike): KanbanSync, 22 inputs, 21 checkpoints, 457 ms.
// The replay dispatches the recorded inputs to the same instances, gives every reducer the
// Date.now() / Math.random() / randomUUID() values it read, and compares each action's state
// and each checkpoint's root state and vnode with the recording.
//
// Timeline (inputs):
//   +   30ms  (root)                             ADD_LANE (intent) {"$event":"click","target":{"$el":"BUTTON"}}
//   +   37ms  LaneComponent[lane-1]              START_EDIT (intent) {"$event":"dblclick","target":{"$el":"H2"}}
//   +   43ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "B"
//   +   44ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Ba"
//   +   45ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Bac"
//   +   46ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Back"
//   +   47ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Backl"
//   +   48ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Backlo"
//   +   49ms  LaneComponent[lane-1]              EDIT_TITLE (intent) "Backlog"
//   +   50ms  LaneComponent[lane-1]              FINISH_EDIT (intent) "Backlog"
//   +   52ms  LaneComponent[lane-2]              SHOW_ADD_TASK (intent) {"$event":"click","target":{"$el":"BUTTON"}}
//   +   59ms  LaneComponent[lane-2]              ADD_TASK (intent) "Ship the replay spike"  [reads now]
//   +   62ms  (root)                             DRAG_START (intent) "task-1"
//   +   66ms  (root)                             DROP (intent) {"dropZone":{"$el":"DIV","dataset":{"laneId":"lane-3"}},"in…
//   +  218ms  (root)                             AUTOSAVE (reply) {"n":1,"t":1793336341438}
//   +  238ms  (root)                             SAVED (reply) {"saves":1}  [reads now, random]
//   +  240ms  LaneComponent[lane-1]              MOVE_RIGHT (intent) {"$event":"click","target":{"$el":"BUTTON"}}
//   +  240ms  (root)                             MOVE_LANE_RIGHT (intent) {"laneId":"lane-1"}
//   +  246ms  LaneComponent[lane-2]/TaskCard[task-3] DELETE (intent) {"$event":"click","target":{"$el":"BUTTON"}}
//   +  246ms  LaneComponent[lane-2]              DELETE_TASK (intent) "task-3"
//   +  417ms  (root)                             AUTOSAVE (reply) {"n":2,"t":1793336341637}
//   +  421ms  (root)                             SAVED (reply) {"saves":2}  [reads now, random]
import { it, expect } from 'vitest'
import { replay } from '../replayer.js'
import KanbanSync from '../fixtures/kanbanSync.jsx'
import log from './kanban.recording.json' with { type: 'json' }

it("kanban: a recorded session replays (generated)", async () => {
  const r = await replay(KanbanSync, log)
  try {
    expect(r.divergence).toBeNull()
    expect(r.view).toBeNull()
    expect(r.effects).toEqual([])
    expect(r.unhandled).toEqual([])
    expect(r.final).toEqual({
      "lanes": [
        {
          "id": "lane-2",
          "title": "In Progress",
          "tasks": [
            {
              "id": "task-1793336341280",
              "title": "Ship the replay spike",
              "description": ""
            }
          ],
          "isEditing": false,
          "isAddingTask": false,
          "isFirst": true,
          "isLast": false
        },
        {
          "id": "lane-1",
          "title": "Backlog",
          "tasks": [
            {
              "id": "task-2",
              "title": "Write API documentation",
              "description": ""
            }
          ],
          "isEditing": false,
          "isAddingTask": false,
          "isFirst": false,
          "isLast": false,
          "titleDraft": "Backlog"
        },
        {
          "id": "lane-3",
          "title": "Done",
          "tasks": [
            {
              "id": "task-1",
              "title": "Design homepage mockups",
              "description": ""
            }
          ],
          "isEditing": false,
          "isAddingTask": false,
          "isFirst": false,
          "isLast": false
        },
        {
          "id": "lane-4",
          "title": "New Lane",
          "tasks": [],
          "isEditing": false,
          "isAddingTask": false,
          "isFirst": false,
          "isLast": true
        }
      ],
      "dragging": null,
      "draggingLane": null,
      "nextId": 5,
      "saved": "lane-2:In Progress:task-1793336341280|lane-1:Backlog:task-2|lane-3:Done:task-1|lane-4:New Lane:",
      "saves": 2,
      "savedAt": 1793336341642,
      "saveId": "8d985j"
    })
  } finally {
    r.t.dispose()
  }
})
