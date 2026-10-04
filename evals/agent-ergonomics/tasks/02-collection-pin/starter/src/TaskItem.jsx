function TaskItem({ state }) {
  return (
    <div className={state.done ? 'task done' : 'task'}>
      <input type="checkbox" className="toggle" aria-label="Done" checked={state.done} />
      <span className="title">{state.title}</span>
    </div>
  )
}

TaskItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.toggle'),
})

TaskItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
}

export default TaskItem
