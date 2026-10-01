import TaskRow from './TaskRow.jsx'

const notDone = (task) => !task.done

export default function ProjectSection({ project, hideDone, selectedId, onSelect, onToggle, onDelete }) {
  const open = project.tasks.filter(notDone).length
  const visible = hideDone ? project.tasks.filter(notDone) : project.tasks
  return (
    <section className="project">
      <h2>
        {project.name} <span className="open-count">({open} open)</span>
      </h2>
      <div className="task-list">
        {visible.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={task.id === selectedId}
            onSelect={() => onSelect(task.id)}
            onToggle={() => onToggle(task.id)}
            onDelete={() => onDelete(task.id)}
          />
        ))}
      </div>
    </section>
  )
}
