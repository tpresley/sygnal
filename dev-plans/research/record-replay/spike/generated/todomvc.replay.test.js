// @vitest-environment jsdom
// Generated from a Sygnal recording (record/replay spike): TodoSync, 48 inputs, 23 checkpoints, 298 ms.
// The replay dispatches the recorded inputs to the same instances, gives every reducer the
// Date.now() / Math.random() / randomUUID() values it read, and compares each action's state
// and each checkpoint's root state and vnode with the recording.
//
// Timeline (inputs):
//   +    2ms  (root)                             FROM_STORE (intent) []
//   +   15ms  (root)                             ADD_ROUTE (next) "all"
//   +   15ms  (root)                             ADD_ROUTE (next) "active"
//   +   15ms  (root)                             ADD_ROUTE (next) "completed"
//   +   24ms  (root)                             SEEDED (reply) [{"title":"Read the record/replay notes"},{"title":"Try a r…
//   +   24ms  (root)                             TO_STORE (intent) "<its state>"
//   +   33ms  (root)                             NEW_TODO (intent) "Buy milk"  [reads uuid]
//   +   34ms  (root)                             TO_STORE (intent) "<its state>"
//   +  154ms  (root)                             TOAST_DONE (reply) {"t":1793336341834}
//   +  154ms  (root)                             TO_STORE (intent) "<its state>"
//   +  156ms  (root)                             NEW_TODO (intent) "Walk the dog"  [reads uuid]
//   +  156ms  (root)                             TO_STORE (intent) "<its state>"
//   +  159ms  TODO[1]                            TOGGLE (intent) "on"
//   +  159ms  (root)                             TO_STORE (intent) "<its state>"
//   +  162ms  TODO[4]                            EDIT_START (intent) {"$event":"dblclick","target":{"$el":"LABEL"}}
//   +  162ms  (root)                             TO_STORE (intent) "<its state>"
//   +  163ms  TODO[4]                            EDIT_INPUT (intent) "W"
//   +  163ms  (root)                             TO_STORE (intent) "<its state>"
//   +  164ms  TODO[4]                            EDIT_INPUT (intent) "Wa"
//   +  164ms  (root)                             TO_STORE (intent) "<its state>"
//   +  165ms  TODO[4]                            EDIT_INPUT (intent) "Wal"
//   +  165ms  (root)                             TO_STORE (intent) "<its state>"
//   +  166ms  TODO[4]                            EDIT_INPUT (intent) "Walk"
//   +  166ms  (root)                             TO_STORE (intent) "<its state>"
//   +  167ms  TODO[4]                            EDIT_INPUT (intent) "Walk "
//   +  167ms  (root)                             TO_STORE (intent) "<its state>"
//   +  168ms  TODO[4]                            EDIT_INPUT (intent) "Walk t"
//   +  168ms  (root)                             TO_STORE (intent) "<its state>"
//   +  169ms  TODO[4]                            EDIT_INPUT (intent) "Walk th"
//   +  169ms  (root)                             TO_STORE (intent) "<its state>"
//   +  170ms  TODO[4]                            EDIT_INPUT (intent) "Walk the"
//   +  170ms  (root)                             TO_STORE (intent) "<its state>"
//   +  172ms  TODO[4]                            EDIT_INPUT (intent) "Walk the "
//   +  172ms  (root)                             TO_STORE (intent) "<its state>"
//   +  173ms  TODO[4]                            EDIT_INPUT (intent) "Walk the c"
//   +  173ms  (root)                             TO_STORE (intent) "<its state>"
//   +  174ms  TODO[4]                            EDIT_INPUT (intent) "Walk the ca"
//   +  174ms  (root)                             TO_STORE (intent) "<its state>"
//   +  175ms  TODO[4]                            EDIT_INPUT (intent) "Walk the cat"
//   +  175ms  (root)                             TO_STORE (intent) "<its state>"
//   +  176ms  TODO[4]                            EDIT_DONE (intent) "Walk the cat"
//   +  176ms  (root)                             TO_STORE (intent) "<its state>"
//   +  177ms  (root)                             VISIBILITY (intent) "active"
//   +  177ms  (root)                             TO_STORE (intent) "<its state>"
//   +  178ms  (root)                             CLEAR_COMPLETED (intent) {"$event":"click","target":{"$el":"BUTTON"}}
//   +  178ms  (root)                             TO_STORE (intent) "<its state>"
//   +  273ms  (root)                             TOAST_DONE (reply) {"t":1793336341957}
//   +  273ms  (root)                             TO_STORE (intent) "<its state>"
import { it, expect } from 'vitest'
import { replay } from '../replayer.js'
import TodoSync from '../fixtures/todoSync.tsx'
import log from './todomvc.recording.json' with { type: 'json' }

it("todomvc: a recorded session replays (generated)", async () => {
  const r = await replay(TodoSync, log)
  try {
    expect(r.divergence).toBeNull()
    expect(r.view).toBeNull()
    expect(r.effects).toEqual([])
    expect(r.unhandled).toEqual([])
    expect(r.final).toEqual({
      "visibility": "active",
      "todos": [
        {
          "id": 3,
          "title": "Buy milk",
          "completed": false
        },
        {
          "id": 4,
          "title": "Walk the cat",
          "completed": false,
          "displayTitle": "Walk the cat",
          "editing": false,
          "editValue": "",
          "cachedTitle": ""
        }
      ],
      "toast": null,
      "seeded": true,
      "total": 2,
      "remaining": 2,
      "completed": 0,
      "allDone": false
    })
  } finally {
    r.t.dispose()
  }
})
