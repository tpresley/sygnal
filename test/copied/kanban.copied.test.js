// Copied from a sygnal/devtools session of RootComponent (10 recorded actions, 8 replayed)
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { RootComponent, mockDragDriver } from './kanban-app.js'

it('kanban: a recorded session replays (copied from sygnal/devtools)', async () => {
  const t = renderComponent(RootComponent, {
    drivers: { DND: mockDragDriver().driver },
  })
  try {
    await t.ready()
    // ADD_LANE: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('ADD_LANE', { type: 'click' })
    t.simulateAction('MOVE_LANE_RIGHT', { laneId: 'lane-1' })
    t.simulateAction('DRAG_START', 'task-1')
    // DROP: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('DROP', { dropZone: { dataset: { laneId: 'lane-3' } }, insertBefore: null })
    t.simulateAction('DRAG_END', {})
    t.simulateAction('LANE_DRAG_START', 'lane-3')
    // LANE_DROP: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('LANE_DROP', { dropZone: { dataset: { laneId: 'lane-1' } }, insertBefore: null })
    t.simulateAction('DELETE_LANE', { laneId: 'lane-4' })
    await t.settle()
    expect(t.state).toEqual({
      lanes: [
        {
          id: 'lane-2',
          title: 'In Progress',
          tasks: [{ id: 'task-3', title: 'Build login page', description: '' }],
          isEditing: false,
          isAddingTask: false,
          isFirst: true,
          isLast: false,
        },
        {
          id: 'lane-3',
          title: 'Done',
          tasks: [{ id: 'task-1', title: 'Design homepage mockups', description: '' }],
          isEditing: false,
          isAddingTask: false,
          isFirst: false,
          isLast: false,
        },
        {
          id: 'lane-1',
          title: 'To Do',
          tasks: [{ id: 'task-2', title: 'Write API documentation', description: '' }],
          isEditing: false,
          isAddingTask: false,
          isFirst: false,
          isLast: true,
        },
      ],
      dragging: null,
      draggingLane: null,
      nextId: 5,
    })
  } finally {
    t.dispose()
  }
})
