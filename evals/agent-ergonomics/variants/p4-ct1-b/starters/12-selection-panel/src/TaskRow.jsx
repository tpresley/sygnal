import { controls } from 'sygnal'

const { Toggle, Delete } = controls({ Toggle: 'input', Delete: 'button' })

function TaskRow({ state }) {
  return (
    <div className={state.done ? 'task-row done' : 'task-row'}>
      <Toggle type="checkbox" className="toggle" aria-label="Done" checked={state.done} />
      <span className="task-title">{state.title}</span>
      <span className="assignee">{state.assignee}</span>
      <Delete className="delete">Delete</Delete>
    </div>
  )
}

TaskRow.intent = ({ DOM }) => ({
  TOGGLE: DOM.change(Toggle),
  DELETE: DOM.click(Delete),
})

TaskRow.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
}

export default TaskRow
