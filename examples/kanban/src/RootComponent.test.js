import { describe, it, expect } from 'vitest'
import { ABORT } from 'sygnal'
import RootComponent from './RootComponent.jsx'

const { model, initialState, context } = RootComponent

function makeState(overrides = {}) {
  return {
    lanes: [
      { id: 'lane-1', title: 'To Do', tasks: [
        { id: 'task-1', title: 'Task 1', description: '' },
        { id: 'task-2', title: 'Task 2', description: '' },
      ], isEditing: false, isAddingTask: false, isFirst: true, isLast: false },
      { id: 'lane-2', title: 'In Progress', tasks: [
        { id: 'task-3', title: 'Task 3', description: '' },
      ], isEditing: false, isAddingTask: false, isFirst: false, isLast: false },
      { id: 'lane-3', title: 'Done', tasks: [], isEditing: false, isAddingTask: false, isFirst: false, isLast: true },
    ],
    dragging: null,
    draggingLane: null,
    nextId: 4,
    ...overrides,
  }
}

describe('RootComponent', () => {
  describe('initialState', () => {
    it('has three default lanes', () => {
      expect(initialState.lanes).toHaveLength(3)
    })

    it('sets isFirst/isLast positions correctly', () => {
      expect(initialState.lanes[0].isFirst).toBe(true)
      expect(initialState.lanes[0].isLast).toBe(false)
      expect(initialState.lanes[1].isFirst).toBe(false)
      expect(initialState.lanes[1].isLast).toBe(false)
      expect(initialState.lanes[2].isFirst).toBe(false)
      expect(initialState.lanes[2].isLast).toBe(true)
    })

    it('starts with no dragging state', () => {
      expect(initialState.dragging).toBe(null)
      expect(initialState.draggingLane).toBe(null)
    })

    it('has default tasks in first two lanes', () => {
      expect(initialState.lanes[0].tasks).toHaveLength(2)
      expect(initialState.lanes[1].tasks).toHaveLength(1)
      expect(initialState.lanes[2].tasks).toHaveLength(0)
    })
  })

  describe('context', () => {
    it('returns dragging task id when dragging', () => {
      const state = makeState({ dragging: { taskId: 'task-1' } })
      expect(context.draggingTaskId(state)).toBe('task-1')
    })

    it('returns null when not dragging task', () => {
      expect(context.draggingTaskId(makeState())).toBe(null)
    })

    it('returns dragging lane id when dragging lane', () => {
      const state = makeState({ draggingLane: 'lane-2' })
      expect(context.draggingLaneId(state)).toBe('lane-2')
    })

    it('returns null when not dragging lane', () => {
      expect(context.draggingLaneId(makeState())).toBe(null)
    })
  })

  describe('ADD_LANE', () => {
    it('adds a new lane with incremented id', () => {
      const state = makeState()
      const result = model.ADD_LANE(state)
      expect(result.lanes).toHaveLength(4)
      expect(result.lanes[3].id).toBe('lane-4')
      expect(result.lanes[3].title).toBe('New Lane')
      expect(result.nextId).toBe(5)
    })

    it('new lane has empty tasks and default flags', () => {
      const result = model.ADD_LANE(makeState())
      const newLane = result.lanes[3]
      expect(newLane.tasks).toEqual([])
      expect(newLane.isEditing).toBe(false)
      expect(newLane.isAddingTask).toBe(false)
    })

    it('updates isFirst/isLast positions', () => {
      const result = model.ADD_LANE(makeState())
      expect(result.lanes[2].isLast).toBe(false)
      expect(result.lanes[3].isLast).toBe(true)
      expect(result.lanes[0].isFirst).toBe(true)
    })
  })

  describe('DELETE_LANE', () => {
    it('removes the specified lane', () => {
      const result = model.DELETE_LANE(makeState(), { laneId: 'lane-2' })
      expect(result.lanes).toHaveLength(2)
      expect(result.lanes.find(l => l.id === 'lane-2')).toBeUndefined()
    })

    it('updates positions after deletion', () => {
      const result = model.DELETE_LANE(makeState(), { laneId: 'lane-3' })
      expect(result.lanes[1].isLast).toBe(true)
    })

    it('handles deleting the first lane', () => {
      const result = model.DELETE_LANE(makeState(), { laneId: 'lane-1' })
      expect(result.lanes[0].isFirst).toBe(true)
      expect(result.lanes[0].id).toBe('lane-2')
    })
  })

  describe('MOVE_LANE_LEFT', () => {
    it('swaps lane with the one to its left', () => {
      const result = model.MOVE_LANE_LEFT(makeState(), { laneId: 'lane-2' })
      expect(result.lanes[0].id).toBe('lane-2')
      expect(result.lanes[1].id).toBe('lane-1')
    })

    it('returns ABORT when lane is already first', () => {
      const result = model.MOVE_LANE_LEFT(makeState(), { laneId: 'lane-1' })
      expect(result).toBe(ABORT)
    })

    it('updates isFirst/isLast positions after move', () => {
      const result = model.MOVE_LANE_LEFT(makeState(), { laneId: 'lane-2' })
      expect(result.lanes[0].isFirst).toBe(true)
      expect(result.lanes[0].id).toBe('lane-2')
      expect(result.lanes[2].isLast).toBe(true)
    })
  })

  describe('MOVE_LANE_RIGHT', () => {
    it('swaps lane with the one to its right', () => {
      const result = model.MOVE_LANE_RIGHT(makeState(), { laneId: 'lane-2' })
      expect(result.lanes[1].id).toBe('lane-3')
      expect(result.lanes[2].id).toBe('lane-2')
    })

    it('returns ABORT when lane is already last', () => {
      const result = model.MOVE_LANE_RIGHT(makeState(), { laneId: 'lane-3' })
      expect(result).toBe(ABORT)
    })

    it('updates isFirst/isLast positions after move', () => {
      const result = model.MOVE_LANE_RIGHT(makeState(), { laneId: 'lane-1' })
      expect(result.lanes[0].isFirst).toBe(true)
      expect(result.lanes[0].id).toBe('lane-2')
    })
  })

  describe('DRAG_START', () => {
    it('sets dragging state with task id', () => {
      const result = model.DRAG_START(makeState(), { dataset: { taskId: 'task-1' } })
      expect(result.dragging).toEqual({ taskId: 'task-1' })
    })
  })

  describe('DROP', () => {
    it('returns ABORT when not dragging', () => {
      const result = model.DROP(makeState(), {
        dropZone: { dataset: { laneId: 'lane-2' } },
        insertBefore: null,
      })
      expect(result).toBe(ABORT)
    })

    it('moves task to a different lane', () => {
      const state = makeState({ dragging: { taskId: 'task-1' } })
      const result = model.DROP(state, {
        dropZone: { dataset: { laneId: 'lane-2' } },
        insertBefore: null,
      })
      expect(result.dragging).toBe(null)
      expect(result.lanes[0].tasks.find(t => t.id === 'task-1')).toBeUndefined()
      expect(result.lanes[1].tasks.find(t => t.id === 'task-1')).toBeDefined()
    })

    it('appends task to end of target lane when no insertBefore', () => {
      const state = makeState({ dragging: { taskId: 'task-1' } })
      const result = model.DROP(state, {
        dropZone: { dataset: { laneId: 'lane-2' } },
        insertBefore: null,
      })
      const lane2Tasks = result.lanes[1].tasks.map(t => t.id)
      expect(lane2Tasks).toEqual(['task-3', 'task-1'])
    })

    it('inserts task before a specific task', () => {
      const state = makeState({ dragging: { taskId: 'task-1' } })
      const result = model.DROP(state, {
        dropZone: { dataset: { laneId: 'lane-2' } },
        insertBefore: { dataset: { taskId: 'task-3' } },
      })
      const lane2Tasks = result.lanes[1].tasks.map(t => t.id)
      expect(lane2Tasks).toEqual(['task-1', 'task-3'])
    })

    it('reorders task within the same lane', () => {
      const state = makeState({ dragging: { taskId: 'task-2' } })
      const result = model.DROP(state, {
        dropZone: { dataset: { laneId: 'lane-1' } },
        insertBefore: { dataset: { taskId: 'task-1' } },
      })
      const taskIds = result.lanes[0].tasks.map(t => t.id)
      expect(taskIds).toEqual(['task-2', 'task-1'])
    })

    it('clears dragging state when task not found', () => {
      const state = makeState({ dragging: { taskId: 'nonexistent' } })
      const result = model.DROP(state, {
        dropZone: { dataset: { laneId: 'lane-1' } },
        insertBefore: null,
      })
      expect(result.dragging).toBe(null)
    })

    it('appends task when insertBefore task not found in target lane', () => {
      const state = makeState({ dragging: { taskId: 'task-1' } })
      const result = model.DROP(state, {
        dropZone: { dataset: { laneId: 'lane-2' } },
        insertBefore: { dataset: { taskId: 'nonexistent' } },
      })
      const lane2Tasks = result.lanes[1].tasks.map(t => t.id)
      expect(lane2Tasks).toEqual(['task-3', 'task-1'])
    })
  })

  describe('DRAG_END', () => {
    it('clears dragging state', () => {
      const state = makeState({ dragging: { taskId: 'task-1' } })
      const result = model.DRAG_END(state)
      expect(result.dragging).toBe(null)
    })

    it('returns ABORT when not dragging', () => {
      const result = model.DRAG_END(makeState())
      expect(result).toBe(ABORT)
    })
  })

  describe('LANE_DRAG_START', () => {
    it('sets draggingLane state', () => {
      const result = model.LANE_DRAG_START(makeState(), { dataset: { laneId: 'lane-2' } })
      expect(result.draggingLane).toBe('lane-2')
    })
  })

  describe('LANE_DROP', () => {
    it('returns ABORT when not dragging a lane', () => {
      const result = model.LANE_DROP(makeState(), {
        dropZone: { dataset: { laneId: 'lane-2' } },
      })
      expect(result).toBe(ABORT)
    })

    it('clears draggingLane when dropping on same lane', () => {
      const state = makeState({ draggingLane: 'lane-1' })
      const result = model.LANE_DROP(state, {
        dropZone: { dataset: { laneId: 'lane-1' } },
      })
      expect(result.draggingLane).toBe(null)
    })

    it('moves lane to the right (lane-1 dropped on lane-3)', () => {
      const state = makeState({ draggingLane: 'lane-1' })
      const result = model.LANE_DROP(state, {
        dropZone: { dataset: { laneId: 'lane-3' } },
      })
      expect(result.lanes.map(l => l.id)).toEqual(['lane-2', 'lane-3', 'lane-1'])
      expect(result.draggingLane).toBe(null)
    })

    it('moves lane to the left (lane-3 dropped on lane-1)', () => {
      const state = makeState({ draggingLane: 'lane-3' })
      const result = model.LANE_DROP(state, {
        dropZone: { dataset: { laneId: 'lane-1' } },
      })
      expect(result.lanes.map(l => l.id)).toEqual(['lane-3', 'lane-1', 'lane-2'])
      expect(result.draggingLane).toBe(null)
    })

    it('updates isFirst/isLast after lane drag', () => {
      const state = makeState({ draggingLane: 'lane-1' })
      const result = model.LANE_DROP(state, {
        dropZone: { dataset: { laneId: 'lane-3' } },
      })
      expect(result.lanes[0].isFirst).toBe(true)
      expect(result.lanes[2].isLast).toBe(true)
    })

    it('clears draggingLane when from lane not found', () => {
      const state = makeState({ draggingLane: 'nonexistent' })
      const result = model.LANE_DROP(state, {
        dropZone: { dataset: { laneId: 'lane-1' } },
      })
      expect(result.draggingLane).toBe(null)
    })

    it('clears draggingLane when drop zone has no laneId', () => {
      const state = makeState({ draggingLane: 'lane-1' })
      const result = model.LANE_DROP(state, {
        dropZone: { dataset: {} },
      })
      expect(result.draggingLane).toBe(null)
    })
  })

  describe('LANE_DRAG_END', () => {
    it('clears draggingLane state', () => {
      const state = makeState({ draggingLane: 'lane-2' })
      const result = model.LANE_DRAG_END(state)
      expect(result.draggingLane).toBe(null)
    })

    it('returns ABORT when not dragging a lane', () => {
      const result = model.LANE_DRAG_END(makeState())
      expect(result).toBe(ABORT)
    })
  })
})
