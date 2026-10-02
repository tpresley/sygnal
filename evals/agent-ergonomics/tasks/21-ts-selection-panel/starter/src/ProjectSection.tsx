import { Collection } from 'sygnal'
import type { Component } from 'sygnal'
import TaskRow from './TaskRow'
import type { ProjectState, TaskState, AppContext } from './types'

const TaskCollection = Collection<{ className?: string }, ProjectState>

const notDone = (task: TaskState) => !task.done

const ProjectSection: Component<ProjectState, {}, {}, {}, {}, AppContext> = ({ state, context }) => {
  const open = state.tasks.filter(notDone).length
  return (
    <section className="project">
      <h2>
        {state.name} <span className="open-count">({open} open)</span>
      </h2>
      <TaskCollection of={TaskRow} from="tasks" filter={context?.hideDone ? notDone : undefined} className="task-list" />
    </section>
  )
}

export default ProjectSection
