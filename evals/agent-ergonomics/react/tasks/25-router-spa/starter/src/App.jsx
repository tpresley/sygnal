import { useState } from 'react'
import TaskList from './TaskList.jsx'
import TaskPage from './TaskPage.jsx'
import EditPage from './EditPage.jsx'

const TASKS = [
  { id: 1, title: 'Write the report' },
  { id: 2, title: 'Book the venue' },
  { id: 3, title: 'Send the invites' },
]

export default function App() {
  // page: 'list' | 'task' | 'edit'
  const [page, setPage] = useState('list')
  const [taskId, setTaskId] = useState(null)
  const [tasks, setTasks] = useState(TASKS)
  const task = tasks.find((t) => t.id === taskId)

  const open = (id) => {
    setTaskId(id)
    setPage('task')
  }
  const save = (title) => {
    setTasks((all) => all.map((t) => (t.id === taskId ? { ...t, title } : t)))
    setPage('task')
  }

  return (
    <div className="app">
      <nav>
        <button className="home" onClick={() => setPage('list')}>
          All tasks
        </button>
      </nav>
      <main>
        {page === 'list' && <TaskList tasks={tasks} onOpen={open} />}
        {page === 'task' && <TaskPage task={task} onEdit={() => setPage('edit')} />}
        {page === 'edit' && <EditPage task={task} onSave={save} onCancel={() => setPage('task')} />}
      </main>
    </div>
  )
}
