// Helper for strict/good/canonical.jsx: a Collection item.
function TaskCard({ state }) {
  return (
    <div className="task-card">
      <button className="delete-task">x</button>
      <button className="done">done</button>
    </div>
  )
}

TaskCard.intent = ({ DOM }) => ({
  DELETE: DOM.click('.delete-task'),
  DONE: DOM.click('.done'),
})

TaskCard.model = {
  DELETE: { PARENT: (state) => ({ taskId: state.id }) },
  // an explicit undefined removes a Collection item; not a SYG502 no-op
  DONE: () => undefined,
}

export default TaskCard
