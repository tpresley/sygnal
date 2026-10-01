export default function TaskItem({ task, onToggle }) {
  return (
    <div className={task.done ? 'task done' : 'task'}>
      <input type="checkbox" className="toggle" checked={task.done} onChange={onToggle} />
      <span className="title">{task.title}</span>
    </div>
  )
}
