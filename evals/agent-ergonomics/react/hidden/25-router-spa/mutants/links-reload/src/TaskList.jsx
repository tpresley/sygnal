import { Link } from 'react-router'
import { useTasks, useTitle } from './tasks.js'

export default function TaskList() {
  const { tasks } = useTasks()
  useTitle('Tasks')
  return (
    <section className="task-list">
      <h1>Tasks</h1>
      <ul className="tasks">
        {tasks.map((task) => (
          <li key={task.id}>
            <a href={`/tasks/${task.id}`}>{task.title}</a> {/* mutant: a plain link, the browser loads the page */}
          </li>
        ))}
      </ul>
    </section>
  )
}
