import { Collection } from 'sygnal'
import TaskRow from './TaskRow.jsx'

const notDone = (task) => !task.done

function ProjectSection({ state, context }) {
  const open = state.tasks.filter(notDone).length
  return (
    <section className="project">
      <h2>
        {state.name} <span className="open-count">({open} open)</span>
      </h2>
      <Collection of={TaskRow} from="tasks" filter={context.hideDone ? notDone : undefined} className="task-list" />
    </section>
  )
}

export default ProjectSection
