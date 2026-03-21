/**
 * A todo list component — demonstrates SSR with nested elements and arrays.
 */
function TodoList({ state }) {
  return (
    <div className="todo-list">
      <h2>Todo List</h2>
      <div className="todo-input">
        <input type="text" className="new-todo" placeholder="What needs to be done?" value={state.inputValue} />
        <button className="add-btn">Add</button>
      </div>
      <ul>
        {state.items.map(item => (
          <li className={item.done ? 'done' : ''}>
            <label>
              <input type="checkbox" className="toggle" attrs={{ checked: item.done }} data={{ id: String(item.id) }} />
              <span>{item.text}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="todo-count">{state.items.filter(i => !i.done).length} items left</p>
    </div>
  )
}

TodoList.initialState = {
  items: [],
  inputValue: '',
  nextId: 1,
}

TodoList.intent = ({ DOM }) => ({
  UPDATE_INPUT: DOM.select('.new-todo').events('input').map(e => e.target.value),
  ADD_TODO:     DOM.select('.add-btn').events('click'),
  TOGGLE:       DOM.select('.toggle').events('change').map(e => Number(e.target.dataset.id)),
})

TodoList.model = {
  UPDATE_INPUT: (state, value) => ({ ...state, inputValue: value }),
  ADD_TODO: (state) => {
    if (!state.inputValue.trim()) return state
    return {
      ...state,
      items: [...state.items, { id: state.nextId, text: state.inputValue.trim(), done: false }],
      inputValue: '',
      nextId: state.nextId + 1,
    }
  },
  TOGGLE: (state, id) => ({
    ...state,
    items: state.items.map(item =>
      item.id === id ? { ...item, done: !item.done } : item
    ),
  }),
}

export default TodoList
