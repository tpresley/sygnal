// @vitest-environment jsdom
// Copied from a sygnal/devtools session of KanbanSync (9 recorded actions, 6 replayed)
// NOTE: the app had a driver for TIMER: pass it with copyAsTest(..., { drivers: { TIMER: '...' } }) if the component reads it
// NOTE: no final-state assertion: the AUTOSAVE reply could not be replayed
// NOTE: no final-state assertion: the AUTOSAVE reply could not be replayed
// NOTE: no final-state assertion: child components changed the state through their own actions (LaneComponent#KanbanSync/LaneComponent[lane-1] START_EDIT, LaneComponent#KanbanSync/LaneComponent[lane-1] EDIT_TITLE, LaneComponent#KanbanSync/LaneComponent[lane-1] EDIT_TITLE, LaneComponent#KanbanSync/LaneComponent[lane-1] EDIT_TITLE, LaneComponent#KanbanSync/LaneComponent[lane-1] EDIT_TITLE, ...): copy the test from that component instance instead
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { inertDriver as inert } from '../inert.js'
import KanbanSync from '../fixtures/kanbanSync.jsx'

it('KanbanSync session (copied from sygnal/devtools)', async () => {
  const t = renderComponent(KanbanSync, {
    drivers: { DND: inert() },
  })
  try {
    await t.ready()
    // ADD_LANE: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('ADD_LANE', { type: 'click' })
    t.simulateAction('DRAG_START', 'task-1')
    // DROP: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('DROP', { dropZone: { dataset: { laneId: 'lane-3' } }, insertBefore: null })
    // reply AUTOSAVE from TIMER: not replayed (renderComponent fakes makeFetchDriver sources only)
    await t.respond('HTTP', { saves: 1 }, 'SAVED')
    t.simulateAction('MOVE_LANE_RIGHT', { laneId: 'lane-1' })
    // reply AUTOSAVE from TIMER: not replayed (renderComponent fakes makeFetchDriver sources only)
    await t.respond('HTTP', { saves: 2 }, 'SAVED')
    await t.settle()
    // No final-state assertion: the AUTOSAVE reply could not be replayed; the AUTOSAVE reply could not be replayed; child components changed the state through their own actions (LaneComponent#KanbanSync/LaneComponent[lane-1] START_EDIT, LaneComponent#KanbanSync/LaneComponent[lane-1] EDIT_TITLE, LaneComponent#KanbanSync/LaneComponent[lane-1] EDIT_TITLE, LaneComponent#KanbanSync/LaneComponent[lane-1] EDIT_TITLE, LaneComponent#KanbanSync/LaneComponent[lane-1] EDIT_TITLE, ...): copy the test from that component instance instead
  } finally {
    t.dispose()
  }
})
