export default function TaskRow({ task, onToggle, onDelete }) {
  return (
    <div className={task.done ? 'task-row done' : 'task-row'}>
      <input type="checkbox" className="toggle" checked={task.done} onChange={onToggle} />
      <span className="task-title">{task.title}</span>
      <span className="assignee">{task.assignee}</span>
      <button className="delete" onClick={onDelete}>
        Delete
      </button>
    </div>
  )
}
