function TodoItem({ state }) {
  return (
    <div className={state.done ? 'todo done' : 'todo'}>
      <input type="checkbox" className="toggle" checked={state.done} />
      <span className="title">{state.title}</span>
      <button className="remove" data-id={String(state.id)} title="Remove">×</button>
    </div>
  )
}

TodoItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.toggle'),
})

TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
}

export default TodoItem
