import { useState } from 'react'
import TaskItem from './TaskItem.jsx'

const initialTasks = [
  { id: 1, title: 'Buy milk', done: false },
  { id: 2, title: 'Walk the dog', done: false },
  { id: 3, title: 'Write report', done: true },
]

export default function App() {
  const [tasks, setTasks] = useState(initialTasks)
  const [pinnedId, setPinnedId] = useState(null)
  const pinned = tasks.find((task) => task.id === pinnedId)

  const toggle = (id) =>
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)))

  return (
    <div className="app">
      <h1>Tasks</h1>
      <p className="pinned">{pinned ? `Pinned: ${pinned.title}` : 'Nothing pinned'}</p>
      <div className="task-list">
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} onToggle={() => toggle(task.id)} onPin={() => setPinnedId(task.id)} />
        ))}
      </div>
    </div>
  )
}
