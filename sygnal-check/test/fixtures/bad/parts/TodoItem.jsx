// Helper for bad/parent-selects-child.jsx (not scanned on its own).
function TodoItem({ state }) {
  return (
    <li className="todo-item">
      <span role="button" tabIndex={0}>{state.text}</span>
      <button className="remove">x</button>
      <Badge />
    </li>
  )
}

function Badge() {
  return <i className="badge">!</i>
}

TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.todo-item span') })
TodoItem.model = { TOGGLE: (s) => ({ ...s, done: !s.done }) }

export default TodoItem
