function App({ state }) {
  return (
    <div className="app">
      <h1>Todos</h1>
      <div className="new-todo">
        <input className="new-todo-title" value={state.draft} placeholder="What needs to be done?" />
        <button className="add-todo-btn">Add</button>
      </div>
      <ul className="todo-list">
        {state.todos.map((todo) => (
          <li className="todo" key={todo.id}>
            {todo.title}
          </li>
        ))}
      </ul>
      <p className="count">{state.todos.length} items</p>
    </div>
  )
}

App.initialState = {
  draft: '',
  nextId: 3,
  todos: [
    { id: 1, title: 'Buy milk' },
    { id: 2, title: 'Walk the dog' },
  ],
}

App.intent = ({ DOM }) => ({
  SET_DRAFT: DOM.input('.new-todo-title').value(),
  ADD: DOM.click('.add-todo-btn'),
})

App.model = {
  SET_DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state) => {
    const title = state.draft.trim()
    if (!title) return state
    return {
      ...state,
      draft: '',
      nextId: state.nextId + 1,
      todos: [...state.todos, { id: state.nextId, title }],
    }
  },
}

export default App
