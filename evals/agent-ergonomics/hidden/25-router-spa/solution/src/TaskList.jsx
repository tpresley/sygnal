import { href } from './routes.js'

function TaskList({ state }) {
  return (
    <section className="task-list">
      <h1>Tasks</h1>
      <ul className="tasks">
        {state.tasks.map((task) => (
          <li>
            <a href={href('task', { id: task.id })}>{task.title}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default TaskList
