function TaskList({ state }) {
  return (
    <section className="task-list">
      <h1>Tasks</h1>
      <ul className="tasks">
        {state.tasks.map((task) => (
          <li>
            <button className="open" data-id={String(task.id)}>
              {task.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

TaskList.intent = ({ DOM }) => ({
  OPEN: DOM.click('.open').map((e) => Number(e.target.dataset.id)),
})

TaskList.model = {
  OPEN: (state, taskId) => ({ ...state, page: 'task', taskId }),
}

export default TaskList
