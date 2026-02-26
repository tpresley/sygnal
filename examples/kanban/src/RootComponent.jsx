import { xs, ABORT } from 'sygnal'

function RootComponent({ state }) {
  const { lanes, dragging, editingLane, addingTaskTo } = state

  return (
    <div className="kanban-board">
      <header className="board-header">
        <h1>Kanban Board</h1>
        <button type="button" className="add-lane-btn">+ Add Lane</button>
      </header>
      <div className="lanes-container">
        {lanes.map((lane, index) =>
          <div className="lane" key={lane.id}>
            <div className="lane-header">
              {editingLane === lane.id
                ? <input
                    className="lane-title-input"
                    type="text"
                    value={lane.title}
                    data={{ laneId: lane.id }}
                  />
                : <h2 className="lane-title" data={{ laneId: lane.id }}>{lane.title}</h2>
              }
              <div className="lane-actions">
                {index > 0 &&
                  <button type="button" className="move-lane-left" data={{ laneId: lane.id }}>←</button>
                }
                {index < lanes.length - 1 &&
                  <button type="button" className="move-lane-right" data={{ laneId: lane.id }}>→</button>
                }
                <button type="button" className="delete-lane-btn" data={{ laneId: lane.id }}>×</button>
              </div>
            </div>
            <div className="lane-drop-zone" data={{ laneId: lane.id }}>
              {lane.tasks.map(task =>
                <div
                  className={'task-card' + (dragging && dragging.taskId === task.id ? ' dragging' : '')}
                  key={task.id}
                  draggable={true}
                  data={{ taskId: task.id, laneId: lane.id }}
                >
                  <span className="task-title">{task.title}</span>
                  <button
                    type="button"
                    className="delete-task-btn"
                    data={{ taskId: task.id, laneId: lane.id }}
                  >×</button>
                </div>
              )}
            </div>
            <div className="lane-footer">
              {addingTaskTo === lane.id
                ? <input
                    className="new-task-input"
                    type="text"
                    placeholder="Task title, then Enter"
                    data={{ laneId: lane.id }}
                  />
                : <button type="button" className="add-task-btn" data={{ laneId: lane.id }}>+ Add Task</button>
              }
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

RootComponent.initialState = {
  lanes: [
    { id: 'lane-1', title: 'To Do', tasks: [
      { id: 'task-1', title: 'Design homepage mockups', description: '' },
      { id: 'task-2', title: 'Write API documentation', description: '' },
    ]},
    { id: 'lane-2', title: 'In Progress', tasks: [
      { id: 'task-3', title: 'Build login page', description: '' },
    ]},
    { id: 'lane-3', title: 'Done', tasks: [] },
  ],
  dragging: null,
  editingLane: null,
  addingTaskTo: null,
  nextId: 4,
}

RootComponent.intent = ({ DOM }) => {
  // ── Lane management ──

  const addLane$ = DOM.select('.add-lane-btn').events('click')

  const deleteLane$ = DOM.select('.delete-lane-btn').events('click')
    .map(e => e.target.closest('.delete-lane-btn').dataset.laneId)

  const startEditLane$ = DOM.select('.lane-title').events('dblclick')
    .map(e => e.target.closest('[data-lane-id]').dataset.laneId)

  const finishEditLane$ = xs.merge(
    DOM.select('.lane-title-input').events('blur')
      .map(e => ({ laneId: e.target.dataset.laneId, title: e.target.value })),
    DOM.select('.lane-title-input').events('keydown')
      .filter(e => e.key === 'Enter')
      .map(e => ({ laneId: e.target.dataset.laneId, title: e.target.value })),
  )

  const moveLaneLeft$ = DOM.select('.move-lane-left').events('click')
    .map(e => e.target.closest('.move-lane-left').dataset.laneId)

  const moveLaneRight$ = DOM.select('.move-lane-right').events('click')
    .map(e => e.target.closest('.move-lane-right').dataset.laneId)

  // ── Task management ──

  const showAddTask$ = DOM.select('.add-task-btn').events('click')
    .map(e => e.target.closest('.add-task-btn').dataset.laneId)

  const addTask$ = DOM.select('.new-task-input').events('keydown')
    .filter(e => e.key === 'Enter')
    .map(e => ({ laneId: e.target.dataset.laneId, title: e.target.value }))

  const cancelAddTask$ = DOM.select('.new-task-input').events('blur')

  const deleteTask$ = DOM.select('.delete-task-btn').events('click')
    .map(e => {
      const btn = e.target.closest('.delete-task-btn')
      return { taskId: btn.dataset.taskId, laneId: btn.dataset.laneId }
    })

  // ── Drag and drop ──

  const dragStart$ = DOM.select('.task-card').events('dragstart')
    .map(e => {
      e.dataTransfer.effectAllowed = 'move'
      const card = e.target.closest('.task-card')
      return { taskId: card.dataset.taskId, laneId: card.dataset.laneId }
    })

  const dragOver$ = DOM.select('.lane-drop-zone').events('dragover')
    .map(e => { e.preventDefault(); return null })

  const drop$ = DOM.select('.lane-drop-zone').events('drop')
    .map(e => {
      e.preventDefault()
      const zone = e.target.closest('.lane-drop-zone')
      return { toLaneId: zone.dataset.laneId }
    })

  const dragEnd$ = DOM.select('.task-card').events('dragend')

  return {
    ADD_LANE:        addLane$,
    DELETE_LANE:     deleteLane$,
    START_EDIT_LANE: startEditLane$,
    FINISH_EDIT_LANE: finishEditLane$,
    MOVE_LANE_LEFT:  moveLaneLeft$,
    MOVE_LANE_RIGHT: moveLaneRight$,
    SHOW_ADD_TASK:   showAddTask$,
    ADD_TASK:        addTask$,
    CANCEL_ADD_TASK: cancelAddTask$,
    DELETE_TASK:     deleteTask$,
    DRAG_START:      dragStart$,
    DRAG_OVER:       dragOver$,
    DROP:            drop$,
    DRAG_END:        dragEnd$,
  }
}

RootComponent.model = {
  ADD_LANE: (state) => {
    const id = `lane-${state.nextId}`
    return {
      ...state,
      nextId: state.nextId + 1,
      lanes: [...state.lanes, { id, title: 'New Lane', tasks: [] }],
    }
  },

  DELETE_LANE: (state, laneId) => ({
    ...state,
    lanes: state.lanes.filter(l => l.id !== laneId),
  }),

  START_EDIT_LANE: (state, laneId) => ({ ...state, editingLane: laneId }),

  FINISH_EDIT_LANE: (state, { laneId, title }) => {
    if (!state.editingLane) return ABORT
    return {
      ...state,
      editingLane: null,
      lanes: state.lanes.map(l =>
        l.id === laneId ? { ...l, title: title.trim() || l.title } : l
      ),
    }
  },

  MOVE_LANE_LEFT: (state, laneId) => {
    const idx = state.lanes.findIndex(l => l.id === laneId)
    if (idx <= 0) return ABORT
    const lanes = [...state.lanes];
    [lanes[idx - 1], lanes[idx]] = [lanes[idx], lanes[idx - 1]]
    return { ...state, lanes }
  },

  MOVE_LANE_RIGHT: (state, laneId) => {
    const idx = state.lanes.findIndex(l => l.id === laneId)
    if (idx >= state.lanes.length - 1) return ABORT
    const lanes = [...state.lanes];
    [lanes[idx], lanes[idx + 1]] = [lanes[idx + 1], lanes[idx]]
    return { ...state, lanes }
  },

  SHOW_ADD_TASK: (state, laneId) => ({ ...state, addingTaskTo: laneId }),

  ADD_TASK: (state, { laneId, title }) => {
    const trimmed = title.trim()
    if (!trimmed) return ABORT
    const id = `task-${state.nextId}`
    return {
      ...state,
      nextId: state.nextId + 1,
      addingTaskTo: null,
      lanes: state.lanes.map(l =>
        l.id === laneId
          ? { ...l, tasks: [...l.tasks, { id, title: trimmed, description: '' }] }
          : l
      ),
    }
  },

  CANCEL_ADD_TASK: (state) => {
    if (!state.addingTaskTo) return ABORT
    return { ...state, addingTaskTo: null }
  },

  DELETE_TASK: (state, { taskId, laneId }) => ({
    ...state,
    lanes: state.lanes.map(l =>
      l.id === laneId ? { ...l, tasks: l.tasks.filter(t => t.id !== taskId) } : l
    ),
  }),

  DRAG_START: (state, { taskId, laneId }) => ({
    ...state,
    dragging: { taskId, fromLaneId: laneId },
  }),

  DRAG_OVER: () => ABORT,

  DROP: (state, { toLaneId }) => {
    if (!state.dragging) return ABORT
    const { taskId, fromLaneId } = state.dragging
    // Same lane — just clear dragging
    if (fromLaneId === toLaneId) return { ...state, dragging: null }
    const fromLane = state.lanes.find(l => l.id === fromLaneId)
    const task = fromLane && fromLane.tasks.find(t => t.id === taskId)
    if (!task) return { ...state, dragging: null }
    return {
      ...state,
      dragging: null,
      lanes: state.lanes.map(l => {
        if (l.id === fromLaneId) return { ...l, tasks: l.tasks.filter(t => t.id !== taskId) }
        if (l.id === toLaneId)   return { ...l, tasks: [...l.tasks, task] }
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
