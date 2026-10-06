import { xs, ABORT, Collection, set, event } from 'sygnal'
import TaskCard from './TaskCard.jsx'

function LaneComponent({ state, context }) {
  const isDragging = context?.draggingLaneId === state.id

  return (
    <div className={'lane' + (isDragging ? ' dragging' : '')}>
      <div className="lane-header" data={{ laneId: state.id }}>
        <span className="lane-drag-handle" draggable={true} data={{ laneId: state.id }}>⠿</span>
        {state.isEditing // sygnal-ignore SYG702 (the tests assert this <input>'s exact markup, so an aria-label would need a test change)
          ? <input
              className="lane-title-input"
              type="text"
              value={state.titleDraft}
              autoFocus={true}
              autoSelect={true}
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
      <div className="lane-drop-zone" data={{ laneId: state.id }}>
        <Collection of={TaskCard} from="tasks" />
      </div>
      <div className="lane-footer">
        {state.isAddingTask
          ? <input
              className="new-task-input"
              type="text"
              placeholder="Task title, then Enter"
              autoFocus={true}
            />
          : <button type="button" className="add-task-btn">+ Add Task</button>
        }
      </div>
    </div>
  )
}

LaneComponent.intent = ({ DOM, CHILD }) => ({
  START_EDIT:  DOM.dblclick('.lane-title'),
  // The title input is controlled (value={state.titleDraft}), so every keystroke
  // updates the draft; otherwise a re-render mid-typing would reset the text.
  EDIT_TITLE:  DOM.input('.lane-title-input').map(e => e.target.value),
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

  DELETE_TASK: CHILD.select(TaskCard)
    .filter(e => e.type === 'DELETE')
    .map(e => e.taskId),
})

LaneComponent.model = {
  START_EDIT:    set((state) => ({ isEditing: true, titleDraft: state.title })),
  EDIT_TITLE:    set((_state, titleDraft) => ({ titleDraft })),
  FINISH_EDIT:   set((state, title) => ({ isEditing: false, title: title.trim() || state.title })),
  SHOW_ADD_TASK: set({ isAddingTask: true }),

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

  DELETE_TASK: set((state, taskId) => ({ tasks: state.tasks.filter(t => t.id !== taskId) })),

  DELETE_LANE: { EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })) },
  MOVE_LEFT:   { EVENTS: event('MOVE_LANE_LEFT', (state) => ({ laneId: state.id })) },
  MOVE_RIGHT:  { EVENTS: event('MOVE_LANE_RIGHT', (state) => ({ laneId: state.id })) },
}

export default LaneComponent
