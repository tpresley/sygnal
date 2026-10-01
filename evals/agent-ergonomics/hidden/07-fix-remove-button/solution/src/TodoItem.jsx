function TodoItem({ state }) {
  return (
    <div className={state.done ? 'todo done' : 'todo'}>
      <input type="checkbox" className="toggle" checked={state.done} />
      <span className="title">{state.title}</span>
      <button className="remove" data-id={String(state.id)} title="Remove">×</button>
    </div>
  )
}

// The × button lives inside this (isolated) Collection item, so the click
// must be handled here and reported up to the parent.
TodoItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.toggle'),
  REMOVE: DOM.click('.remove'),
})

TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  REMOVE: {
    PARENT: (state) => ({ type: 'REMOVE', id: state.id }),
  },
}

export default TodoItem
