function TaskItem({ state }) {
  return (
    <div className={state.done ? 'task done' : 'task'}>
      <input type="checkbox" className="toggle" checked={state.done} />
      <span className="title">{state.title}</span>
      <button className="pin">Pin</button>
    </div>
  )
}

TaskItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.toggle'),
  PIN: DOM.click('.pin'),
})

TaskItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  PIN: {
    PARENT: (state) => ({ type: 'PIN', id: state.id }),
  },
}

export default TaskItem
