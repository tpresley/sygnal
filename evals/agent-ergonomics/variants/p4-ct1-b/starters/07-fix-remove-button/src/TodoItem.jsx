import { controls } from 'sygnal'

const { Toggle } = controls({ Toggle: 'input' })

function TodoItem({ state }) {
  return (
    <div className={state.done ? 'todo done' : 'todo'}>
      <Toggle type="checkbox" className="toggle" aria-label="Done" checked={state.done} />
      <span className="title">{state.title}</span>
      <button className="remove" data-id={String(state.id)} title="Remove">×</button>
    </div>
  )
}

TodoItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.change(Toggle),
})

TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
}

export default TodoItem
