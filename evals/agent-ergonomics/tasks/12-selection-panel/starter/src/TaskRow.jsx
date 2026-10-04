function TaskRow({ state }) {
  return (
    <div className={state.done ? 'task-row done' : 'task-row'}>
      <input type="checkbox" className="toggle" aria-label="Done" checked={state.done} />
      <span className="task-title">{state.title}</span>
      <span className="assignee">{state.assignee}</span>
      <button className="delete">Delete</button>
    </div>
  )
}

TaskRow.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.toggle'),
  DELETE: DOM.click('.delete'),
})

TaskRow.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
}

export default TaskRow
