import { ABORT, Collection } from 'sygnal'
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
  nextId: 4,
}

RootComponent.context = {
  draggingTaskId: state => state.dragging?.taskId ?? null,
}

RootComponent.intent = ({ DOM, DND, EVENTS }) => ({
  ADD_LANE:        DOM.select('.add-lane-btn').events('click'),
  DRAG_START:      DND.select('dragstart'),
  DROP:            DND.select('drop'),
  DRAG_END:        DND.select('dragend'),
  DELETE_LANE:     EVENTS.select('DELETE_LANE'),
  MOVE_LANE_LEFT:  EVENTS.select('MOVE_LANE_LEFT'),
  MOVE_LANE_RIGHT: EVENTS.select('MOVE_LANE_RIGHT'),
})

RootComponent.model = {
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

  DELETE_LANE: (state, { laneId }) => ({
    ...state,
    lanes: withPositions(state.lanes.filter(l => l.id !== laneId)),
  }),

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

  DRAG_START: (state, { dataset }) => ({
    ...state,
    dragging: { taskId: dataset.taskId },
  }),

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
}

export default RootComponent
