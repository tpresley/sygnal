// Helper for strict/bad/model-forms.jsx (not scanned on its own).
function TodoItem({ state }) {
  return (
    <li className="todo-item">
      <button className="done">done</button>
    </li>
  )
}

TodoItem.intent = ({ DOM }) => ({ DONE: DOM.click('.done') })
TodoItem.model = { DONE: { PARENT: (state) => state.id } }

export default TodoItem
