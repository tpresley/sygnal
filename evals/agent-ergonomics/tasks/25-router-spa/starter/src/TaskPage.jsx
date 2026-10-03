function TaskPage({ state }) {
  const task = state.tasks.find((t) => t.id === state.taskId)
  return (
    <section className="task-page">
      <h1>{task ? task.title : ''}</h1>
      <button className="edit">Edit</button>
    </section>
  )
}

TaskPage.intent = ({ DOM }) => ({
  EDIT: DOM.click('.edit'),
})

TaskPage.model = {
  EDIT: (state) => ({ ...state, page: 'edit', draft: state.tasks.find((t) => t.id === state.taskId).title }),
}

export default TaskPage
