import { Collection } from 'sygnal'
import type { Component } from 'sygnal'
import Toolbar from './Toolbar'
import ProjectSection from './ProjectSection'
import DetailsPanel from './DetailsPanel'
import type { AppState, AppCalculated, AppContext } from './types'

const ProjectCollection = Collection<{ className?: string }, AppState>

const App: Component<AppState, {}, {}, {}, AppCalculated, AppContext> = ({ state }) => (
  <div className="tracker">
    <header className="tracker-header">
      <h1>Team tasks</h1>
      <p className="summary">{state.openCount} open</p>
    </header>
    <Toolbar state="filters" />
    <div className="layout">
      <main className="projects">
        <ProjectCollection of={ProjectSection} from="projects" className="project-list" />
      </main>
      <DetailsPanel />
    </div>
  </div>
)

App.initialState = {
  filters: { hideDone: false },
  projects: [
    {
      id: 'web',
      name: 'Website',
      tasks: [
        { id: 1, title: 'Fix login bug', assignee: 'Priya', done: false },
        { id: 2, title: 'Update footer links', assignee: 'Sam', done: true },
        { id: 3, title: 'Write release notes', assignee: 'Lee', done: false },
      ],
    },
    {
      id: 'app',
      name: 'Mobile app',
      tasks: [
        { id: 4, title: 'Crash on startup', assignee: 'Sam', done: false },
        { id: 5, title: 'Dark mode', assignee: 'Priya', done: false },
      ],
    },
  ],
}

App.calculated = {
  openCount: (state) =>
    state.projects.reduce((sum, project) => sum + project.tasks.filter((task) => !task.done).length, 0),
}

App.context = {
  hideDone: (state) => state.filters.hideDone,
}

export default App
