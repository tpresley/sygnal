import { ABORT, persist } from 'sygnal'
export function App({ state }) {
  return (
    <div>
      <label>New todo <input className="draft" value={state.draft} /></label>
      <button className="add">Add</button>
      <button className="reset">Start over</button>
      <ul>{state.todos.map(todo => <li>{todo}</li>)}</ul>
    </div>
  )
}
App.initialState = { todos: [], filter: 'all', draft: '' }
App.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), ADD: DOM.click('.add'), RESET: DOM.click('.reset') })
App.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state) => (state.draft ? { ...state, todos: [...state.todos, state.draft], draft: '' } : ABORT),
  RESET: { STATE: (state) => ({ ...state, todos: [] }), PERSIST: { clear: true } },
}
App.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'] })
