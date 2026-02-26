import { xs, ABORT, Collection, processDrag } from 'sygnal'
import TaskCard from './TaskCard.jsx'

function LaneComponent({ state }) {
  return (
    <div className="lane">
      <div className="lane-header">
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
      <Collection of={TaskCard} from="tasks" className="lane-drop-zone" />
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

LaneComponent.intent = ({ DOM, CHILD }) => {
  const { dragOver$, drop$ } = processDrag({
    dropZone: DOM.select('.lane-drop-zone'),
  })

  return {
    TASK_DRAG_OVER: dragOver$,
    TASK_DROP:      drop$,

    START_EDIT:  DOM.select('.lane-title').events('dblclick'),
    FINISH_EDIT: xs.merge(
      DOM.select('.lane-title-input').events('blur')
        .map(e => e.target.value),
      DOM.select('.lane-title-input').events('keydown')
        .filter(e => e.key === 'Enter')
        .map(e => e.target.value),
    ),

    SHOW_ADD_TASK:   DOM.select('.add-task-btn').events('click'),
    ADD_TASK:        DOM.select('.new-task-input').events('keydown')
      .filter(e => e.key === 'Enter')
      .map(e => e.target.value),
    CANCEL_ADD_TASK: DOM.select('.new-task-input').events('blur'),

    DELETE_LANE:  DOM.select('.delete-lane-btn').events('click'),
    MOVE_LEFT:    DOM.select('.move-lane-left').events('click'),
    MOVE_RIGHT:   DOM.select('.move-lane-right').events('click'),

    DELETE_TASK: CHILD.select('TaskCard')
      .filter(e => e.type === 'DELETE')
      .map(e => e.taskId),
    DROPPED_ON: CHILD.select('TaskCard')
      .filter(e => e.type === 'DROPPED_ON')
      .map(e => e.taskId),
  }
}

LaneComponent.model = {
  TASK_DRAG_OVER: () => ABORT,

  TASK_DROP: {
    EVENTS: (state) => ({ type: 'DROP', data: { toLaneId: state.id, insertBeforeTaskId: null } }),
  },

  DROPPED_ON: {
    EVENTS: (state, insertBeforeTaskId) => ({ type: 'DROP', data: { toLaneId: state.id, insertBeforeTaskId } }),
  },

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
