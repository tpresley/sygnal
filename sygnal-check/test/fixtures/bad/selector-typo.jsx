// Real bug (evals task 06): the intent selector doesn't match the className.
import { xs, ABORT } from 'sygnal'

function App({ state }) {
  return (
    <div className="todo-app">
      <input className="new-todo-input" value={state.input} />
      <button className="add-todo-btn">Add</button>
      <ul className="todo-list">{state.todos.map(t => <li className="todo-item">{t}</li>)}</ul>
      <span id="count">{state.todos.length}</span>
    </div>
  )
}

App.initialState = { input: '', todos: [] }

App.intent = ({ DOM }) => ({
  INPUT: DOM.input('.new-todo-input').map(e => e.target.value),
  ADD: xs.merge(
    DOM.click('.add-todo-button'), // expect: SYG110
    DOM.keydown('.new-todo-input').filter(e => e.key === 'Enter'),
  ),
  CLEAR: DOM.select('#counter').events('dblclick'), // expect: SYG110
  PICK: DOM.click('ul.todo-list > li.todo-itm'), // expect: SYG110
})

App.model = {
  INPUT: (state, input) => ({ ...state, input }),
  ADD: (state) => state.input ? { ...state, input: '', todos: [...state.todos, state.input] } : ABORT,
  CLEAR: (state) => ({ ...state, todos: [] }),
  PICK: (state) => state,
}

export default App
