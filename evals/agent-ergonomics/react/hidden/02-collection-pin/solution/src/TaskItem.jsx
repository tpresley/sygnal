export default function TaskItem({ task, onToggle, onPin }) {
  return (
    <div className={task.done ? 'task done' : 'task'}>
      <input type="checkbox" className="toggle" checked={task.done} onChange={onToggle} />
      <span className="title">{task.title}</span>
      <button className="pin" onClick={onPin}>
        Pin
      </button>
    </div>
  )
}
