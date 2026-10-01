export default function TaskRow({ task, selected, onSelect, onToggle, onDelete }) {
  const classes = ['task-row']
  if (task.done) classes.push('done')
  if (selected) classes.push('selected')
  return (
    <div className={classes.join(' ')}>
      <input type="checkbox" className="toggle" checked={task.done} onChange={onToggle} />
      <span className="task-title" onClick={onSelect}>
        {task.title}
      </span>
      <span className="assignee">{task.assignee}</span>
      <button className="delete" onClick={onDelete}>
        Delete
      </button>
    </div>
  )
}
