// TodoList.jsx
import { Collection, controls } from 'sygnal'

export const { Done, Remove } = controls({ Done: 'input', Remove: 'button' })

function TodoItem({ state }) {
  return (
    <li data-id={state.id}>
      <label><Done type="checkbox" checked={state.done} /> {state.title}</label>
      <Remove>Remove</Remove>
    </li>
  )
}

TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.click(Done), REMOVE: DOM.click(Remove) })
TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  REMOVE: () => undefined,
}

export function TodoList() {
  return (
    <ul>
      <Collection of={TodoItem} from="todos" />
    </ul>
  )
}

TodoList.initialState = {
  todos: [{ id: 1, title: 'Milk', done: false }, { id: 2, title: 'Eggs', done: false }, { id: 3, title: 'Bread', done: false }],
}
