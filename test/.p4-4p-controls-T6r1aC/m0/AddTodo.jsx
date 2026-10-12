// AddTodo.jsx
import { ABORT, controls } from 'sygnal'

export const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })

export function AddTodo({ state }) {
  return (
    <form>
      <label>New todo <Draft value={state.draft} /></label>
      <Add type="button">Add</Add>
      <ul>{state.todos.map((todo) => <li>{todo}</li>)}</ul>
    </form>
  )
}

AddTodo.initialState = { draft: '', todos: [] }

AddTodo.intent = ({ DOM }) => ({
  DRAFT: DOM.input(Draft).value(),
  ADD: DOM.click(Add),
})

AddTodo.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state) => (state.draft ? { ...state, todos: [...state.todos, state.draft], draft: '' } : ABORT),
}
