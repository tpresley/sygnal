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
  DELETE: DOM.click('.delete-task-btn'),
})

TaskCard.model = {
  DELETE: {
    PARENT: (state) => ({ type: 'DELETE', taskId: state.id }),
  },
}

export default TaskCard
