import { controls } from 'sygnal'

const { Toggle } = controls({ Toggle: 'input' })

function TaskItem({ state }) {
  return (
    <div className={state.done ? 'task done' : 'task'}>
      <Toggle type="checkbox" className="toggle" aria-label="Done" checked={state.done} />
      <span className="title">{state.title}</span>
    </div>
  )
}

TaskItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.change(Toggle),
})

TaskItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
}

export default TaskItem
