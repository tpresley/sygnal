import { Link, useParams } from 'react-router'
import { useTasks, useTitle } from './tasks.js'
import NotFound from './NotFound.jsx'

function TaskView({ task }) {
  useTitle(`${task.title} · Tasks`)
  return (
    <section className="task-page">
      <h1>{task.title}</h1>
      <Link to={`/tasks/${task.id}/edit`}>Edit</Link>
    </section>
  )
}

export default function TaskPage() {
  const { id } = useParams()
  const task = useTasks().tasks.find((t) => String(t.id) === id)
  return task ? <TaskView task={task} /> : <NotFound />
}
