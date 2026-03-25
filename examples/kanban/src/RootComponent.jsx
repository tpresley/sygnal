import { ABORT, Collection, set } from 'sygnal'
import LaneComponent from './LaneComponent.jsx'

function withPositions(lanes) {
  return lanes.map((lane, i) => ({
    ...lane,
    isFirst: i === 0,
    isLast:  i === lanes.length - 1,
  }))
}

function RootComponent() {
  return (
    <div className="kanban-board">
      <header className="board-header">
        <h1>Kanban Board</h1>
        <button type="button" className="add-lane-btn">+ Add Lane</button>
      </header>
      <Collection of={LaneComponent} from="lanes" className="lanes-container" />
    </div>
  )
}

RootComponent.initialState = {
  lanes: withPositions([
    {
      id: 'lane-1', title: 'To Do',
      tasks: [
        { id: 'task-1', title: 'Design homepage mockups', description: '' },
        { id: 'task-2', title: 'Write API documentation', description: '' },
      ],
      isEditing: false, isAddingTask: false,
    },
    {
      id: 'lane-2', title: 'In Progress',
      tasks: [
        { id: 'task-3', title: 'Build login page', description: '' },
      ],
      isEditing: false, isAddingTask: false,
    },
    {
      id: 'lane-3', title: 'Done',
      tasks: [],
      isEditing: false, isAddingTask: false,
    },
  ]),
  dragging: null,
  draggingLane: null,
  nextId: 4,
}

RootComponent.context = {
  draggingTaskId: state => state.dragging?.taskId ?? null,
  draggingLaneId: state => state.draggingLane ?? null,
}

RootComponent.intent = ({ DOM, DND, EVENTS }) => ({
  ADD_LANE:        DOM.click('.add-lane-btn'),
  DRAG_START:      DND.dragstart('task').data('taskId'),
  DROP:            DND.drop('lane'),
  DRAG_END:        DND.dragend('task'),
  LANE_DRAG_START: DND.dragstart('lane-sort').data('laneId'),
  LANE_DROP:       DND.drop('lane-sort'),
  LANE_DRAG_END:   DND.dragend('lane-sort'),
  DELETE_LANE:     EVENTS.select('DELETE_LANE'),
  MOVE_LANE_LEFT:  EVENTS.select('MOVE_LANE_LEFT'),
  MOVE_LANE_RIGHT: EVENTS.select('MOVE_LANE_RIGHT'),
})

RootComponent.model = {
  BOOTSTRAP: {
    DND: () => ({
      configs: [
        { category: 'task',      draggable: '.task-card' },
        { category: 'lane',      dropZone:  '.lane-drop-zone',   accepts: 'task'      },
        { category: 'lane-sort', draggable: '.lane-drag-handle', dropZone: '.lane-header',
                                  accepts:   'lane-sort',         dragImage: '.lane'   },
      ],
    }),
  },

  ADD_LANE: (state) => {
    const id = `lane-${state.nextId}`
    return {
      ...state,
      nextId: state.nextId + 1,
      lanes: withPositions([
        ...state.lanes,
        { id, title: 'New Lane', tasks: [], isEditing: false, isAddingTask: false },
      ]),
    }
  },

  DELETE_LANE: set((state, { laneId }) => ({
    lanes: withPositions(state.lanes.filter(l => l.id !== laneId)),
  })),

  MOVE_LANE_LEFT: (state, { laneId }) => {
    const idx = state.lanes.findIndex(l => l.id === laneId)
    if (idx <= 0) return ABORT
    const lanes = [...state.lanes];
    [lanes[idx - 1], lanes[idx]] = [lanes[idx], lanes[idx - 1]]
    return { ...state, lanes: withPositions(lanes) }
  },

  MOVE_LANE_RIGHT: (state, { laneId }) => {
    const idx = state.lanes.findIndex(l => l.id === laneId)
    if (idx >= state.lanes.length - 1) return ABORT
    const lanes = [...state.lanes];
    [lanes[idx], lanes[idx + 1]] = [lanes[idx + 1], lanes[idx]]
    return { ...state, lanes: withPositions(lanes) }
  },

  DRAG_START: set((_state, taskId) => ({ dragging: { taskId } })),

  DROP: (state, { dropZone, insertBefore }) => {
    if (!state.dragging) return ABORT
    const { taskId } = state.dragging
    const toLaneId = dropZone.dataset.laneId
    const insertBeforeTaskId = insertBefore?.dataset.taskId ?? null

    let task = null, fromLaneId = null
    for (const lane of state.lanes) {
      const found = lane.tasks.find(t => t.id === taskId)
      if (found) { task = found; fromLaneId = lane.id; break }
    }
    if (!task) return { ...state, dragging: null }

    const insertTask = (tasks) => {
      const without = tasks.filter(t => t.id !== taskId)
      if (!insertBeforeTaskId) return [...without, task]
      const idx = without.findIndex(t => t.id === insertBeforeTaskId)
      if (idx === -1) return [...without, task]
      return [...without.slice(0, idx), task, ...without.slice(idx)]
    }

    return {
      ...state,
      dragging: null,
      lanes: state.lanes.map(l => {
        if (l.id === fromLaneId && l.id === toLaneId) return { ...l, tasks: insertTask(l.tasks) }
        if (l.id === fromLaneId) return { ...l, tasks: l.tasks.filter(t => t.id !== taskId) }
        if (l.id === toLaneId)   return { ...l, tasks: insertTask(l.tasks) }
        return l
      }),
    }
  },

  DRAG_END: (state) => {
    if (!state.dragging) return ABORT
    return { ...state, dragging: null }
  },

  LANE_DRAG_START: set((_state, laneId) => ({ draggingLane: laneId })),

  LANE_DROP: (state, { dropZone }) => {
    if (!state.draggingLane) return ABORT
    const fromLaneId = state.draggingLane
    const toLaneId = dropZone.dataset.laneId
    if (!toLaneId || fromLaneId === toLaneId) return { ...state, draggingLane: null }

    const fromIdx = state.lanes.findIndex(l => l.id === fromLaneId)
    const toIdx   = state.lanes.findIndex(l => l.id === toLaneId)
    if (fromIdx === -1 || toIdx === -1) return { ...state, draggingLane: null }

    const lanes = [...state.lanes]
    const [dragged] = lanes.splice(fromIdx, 1)
    const newToIdx  = lanes.findIndex(l => l.id === toLaneId)
    // Insert after the target when moving right, before when moving left
    lanes.splice(toIdx > fromIdx ? newToIdx + 1 : newToIdx, 0, dragged)
    return { ...state, draggingLane: null, lanes: withPositions(lanes) }
  },

  LANE_DRAG_END: (state) => {
    if (!state.draggingLane) return ABORT
    return { ...state, draggingLane: null }
  },
}

export default RootComponent
