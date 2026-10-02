import type { Task } from './types'

type TaskItemProps = {
  task: Task
  onToggle: () => void
  onPin: () => void
}

export default function TaskItem({ task, onToggle, onPin }: TaskItemProps) {
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
