function TaskItem({ state }) {
  return (
    <div className={`task-item ${state.done ? 'done' : ''}`}>
      <button className="toggle">{state.done ? '\u2713' : '\u25CB'}</button>
      <span className="task-text">{state.text}</span>
      <button className="delete">\u00D7</button>
    </div>
  )
}

TaskItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.click('.toggle'),
  DELETE: DOM.click('.delete'),
})

TaskItem.model = {
  TOGGLE: {
    PARENT: (state) => state.id,
  },
  DELETE: () => undefined,
}

export default TaskItem
