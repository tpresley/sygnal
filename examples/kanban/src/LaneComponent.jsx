import { xs, ABORT, Collection } from 'sygnal'
import TaskCard from './TaskCard.jsx'

function LaneComponent({ state, context }) {
  const isDragging = context?.draggingLaneId === state.id

  return (
    <div className={'lane' + (isDragging ? ' dragging' : '')}>
      <div className="lane-header" data={{ laneId: state.id }}>
        <span className="lane-drag-handle" draggable={true} data={{ laneId: state.id }}>⠿</span>
        {state.isEditing
          ? <input
              className="lane-title-input"
              type="text"
              value={state.title}
            />
          : <h2 className="lane-title">{state.title}</h2>
        }
        <div className="lane-actions">
          {!state.isFirst &&
            <button type="button" className="move-lane-left">←</button>
          }
          {!state.isLast &&
            <button type="button" className="move-lane-right">→</button>
          }
          <button type="button" className="delete-lane-btn">×</button>
        </div>
      </div>
      <Collection of={TaskCard} from="tasks" className="lane-drop-zone" data={{ laneId: state.id }} />
      <div className="lane-footer">
        {state.isAddingTask
          ? <input
              className="new-task-input"
              type="text"
              placeholder="Task title, then Enter"
            />
          : <button type="button" className="add-task-btn">+ Add Task</button>
        }
      </div>
    </div>
  )
}

LaneComponent.intent = ({ DOM, CHILD }) => ({
  START_EDIT:  DOM.dblclick('.lane-title'),
  FINISH_EDIT: xs.merge(
    DOM.blur('.lane-title-input')
      .map(e => e.target.value),
    DOM.keydown('.lane-title-input')
      .filter(e => e.key === 'Enter')
      .map(e => e.target.value),
  ),

  SHOW_ADD_TASK:   DOM.click('.add-task-btn'),
  ADD_TASK:        DOM.keydown('.new-task-input')
    .filter(e => e.key === 'Enter')
    .map(e => e.target.value),
  CANCEL_ADD_TASK: DOM.blur('.new-task-input'),

  DELETE_LANE:  DOM.click('.delete-lane-btn'),
  MOVE_LEFT:    DOM.click('.move-lane-left'),
  MOVE_RIGHT:   DOM.click('.move-lane-right'),

  DELETE_TASK: CHILD.select('TaskCard')
    .filter(e => e.type === 'DELETE')
    .map(e => e.taskId),
})

LaneComponent.model = {
  START_EDIT:  (state) => ({ ...state, isEditing: true }),

  FINISH_EDIT: (state, title) => ({
    ...state,
    isEditing: false,
    title: title.trim() || state.title,
  }),

  SHOW_ADD_TASK:   (state) => ({ ...state, isAddingTask: true }),

  ADD_TASK: (state, title) => {
    const trimmed = title.trim()
    if (!trimmed) return ABORT
    return {
      ...state,
      isAddingTask: false,
      tasks: [...state.tasks, { id: `task-${Date.now()}`, title: trimmed, description: '' }],
    }
  },

  CANCEL_ADD_TASK: (state) => {
    if (!state.isAddingTask) return ABORT
    return { ...state, isAddingTask: false }
  },

  DELETE_TASK: (state, taskId) => ({
    ...state,
    tasks: state.tasks.filter(t => t.id !== taskId),
  }),

  DELETE_LANE: {
    EVENTS: (state) => ({ type: 'DELETE_LANE', data: { laneId: state.id } }),
  },

  MOVE_LEFT: {
    EVENTS: (state) => ({ type: 'MOVE_LANE_LEFT', data: { laneId: state.id } }),
  },

  MOVE_RIGHT: {
    EVENTS: (state) => ({ type: 'MOVE_LANE_RIGHT', data: { laneId: state.id } }),
  },
}

export default LaneComponent
