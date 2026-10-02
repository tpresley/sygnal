import TaskRow from './TaskRow'
import type { ProjectData, TaskData } from './types'

const notDone = (task: TaskData) => !task.done

type ProjectSectionProps = {
  project: ProjectData
  hideDone: boolean
  onToggle: (taskId: number) => void
  onDelete: (taskId: number) => void
}

export default function ProjectSection({ project, hideDone, onToggle, onDelete }: ProjectSectionProps) {
  const open = project.tasks.filter(notDone).length
  const visible = hideDone ? project.tasks.filter(notDone) : project.tasks
  return (
    <section className="project">
      <h2>
        {project.name} <span className="open-count">({open} open)</span>
      </h2>
      <div className="task-list">
        {visible.map((task) => (
          <TaskRow key={task.id} task={task} onToggle={() => onToggle(task.id)} onDelete={() => onDelete(task.id)} />
        ))}
      </div>
    </section>
  )
}
