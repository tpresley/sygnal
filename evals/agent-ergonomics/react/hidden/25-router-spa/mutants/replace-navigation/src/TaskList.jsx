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
            <Link replace to={`/tasks/${task.id}`}> {/* mutant: replaces the history entry */}{task.title}</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
