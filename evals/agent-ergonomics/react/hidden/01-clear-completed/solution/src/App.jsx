import { useState } from 'react'

const initialTasks = [
  { id: 1, title: 'Buy milk', done: true },
  { id: 2, title: 'Walk the dog', done: false },
  { id: 3, title: 'Write report', done: true },
]

export default function App() {
  const [tasks, setTasks] = useState(initialTasks)
  const remaining = tasks.filter((task) => !task.done).length

  const toggle = (id) =>
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)))
  const clearCompleted = () => setTasks((current) => current.filter((task) => !task.done))

  return (
    <div className="app">
      <h1>Tasks</h1>
      <ul className="task-list">
        {tasks.map((task) => (
          <li className={task.done ? 'task done' : 'task'} key={task.id}>
            <input type="checkbox" className="toggle" checked={task.done} onChange={() => toggle(task.id)} />
            <span className="title">{task.title}</span>
          </li>
        ))}
      </ul>
      <button className="clear-completed" onClick={clearCompleted}>
        Clear completed
      </button>
      <p className="summary">{remaining} remaining</p>
    </div>
  )
}
