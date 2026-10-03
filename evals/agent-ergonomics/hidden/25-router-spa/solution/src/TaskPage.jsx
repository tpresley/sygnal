import { href, taskOf } from './routes.js'

function TaskPage({ state }) {
  const task = taskOf(state)
  return (
    <section className="task-page">
      <h1>{task ? task.title : ''}</h1>
      {task && <a href={href('edit', { id: task.id })}>Edit</a>}
    </section>
  )
}

export default TaskPage
