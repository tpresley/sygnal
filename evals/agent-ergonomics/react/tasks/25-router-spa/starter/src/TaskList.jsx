export default function TaskList({ tasks, onOpen }) {
  return (
    <section className="task-list">
      <h1>Tasks</h1>
      <ul className="tasks">
        {tasks.map((task) => (
          <li key={task.id}>
            <button className="open" onClick={() => onOpen(task.id)}>
              {task.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
