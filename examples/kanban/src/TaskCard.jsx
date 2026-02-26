import { ABORT } from 'sygnal'

function TaskCard({ state, context }) {
  const isDragging = context?.draggingTaskId === state.id

  return (
    <div
      className={'task-card' + (isDragging ? ' dragging' : '')}
      draggable={true}
      data={{ taskId: state.id }}
    >
      <span className="task-title">{state.title}</span>
      <button type="button" className="delete-task-btn">×</button>
    </div>
  )
}

TaskCard.intent = ({ DOM }) => ({
  DRAG_START: DOM.select('.task-card').events('dragstart').map(e => {
    e.dataTransfer.effectAllowed = 'move'
    return e
  }),
  DRAG_OVER:  DOM.select('.task-card').events('dragover').map(e => { e.preventDefault(); return e }),
  DROP_ON:    DOM.select('.task-card').events('drop').map(e => { e.preventDefault(); return e }),
  DRAG_END:   DOM.select('.task-card').events('dragend'),
  DELETE:     DOM.select('.delete-task-btn').events('click'),
})

TaskCard.model = {
  DRAG_START: {
    EVENTS: (state) => ({ type: 'DRAG_START', data: { taskId: state.id } }),
  },
  DRAG_OVER: () => ABORT,
  DROP_ON: {
    PARENT: (state) => ({ type: 'DROPPED_ON', taskId: state.id }),
  },
  DRAG_END: {
    EVENTS: () => ({ type: 'DRAG_END', data: null }),
  },
  DELETE: {
    PARENT: (state) => ({ type: 'DELETE', taskId: state.id }),
  },
}

export default TaskCard
