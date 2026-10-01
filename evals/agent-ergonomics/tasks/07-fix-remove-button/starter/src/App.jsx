import { Collection } from 'sygnal'
import TodoItem from './TodoItem.jsx'

function App({ state }) {
  const left = state.todos.filter((todo) => !todo.done).length
  return (
    <div className="app">
      <h1>Todos</h1>
      <Collection of={TodoItem} from="todos" className="todo-list" />
      <p className="count">{left} left of {state.todos.length}</p>
    </div>
  )
}

App.initialState = {
  todos: [
    { id: 1, title: 'Buy milk', done: false },
    { id: 2, title: 'Walk the dog', done: false },
    { id: 3, title: 'Write report', done: true },
  ],
}

App.intent = ({ DOM }) => ({
  REMOVE: DOM.click('.remove').data('id', Number),
})

App.model = {
  REMOVE: (state, id) => ({
    ...state,
    todos: state.todos.filter((todo) => todo.id !== id),
  }),
}

export default App
