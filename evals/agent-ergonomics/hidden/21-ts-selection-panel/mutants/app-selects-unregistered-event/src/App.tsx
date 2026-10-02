import { ABORT, Collection } from 'sygnal'
import type { Component, IntentSources, ActionsOf } from 'sygnal'
import Toolbar from './Toolbar'
import ProjectSection from './ProjectSection'
import DetailsPanel from './DetailsPanel'
import type { AppState, AppCalculated, AppContext, SelectedTask } from './types'

const ProjectCollection = Collection<{ className?: string }, AppState>

const intent = ({ DOM, EVENTS }: IntentSources<AppState & AppCalculated>) => ({
  SELECT_TASK: EVENTS.select('SELECTED_TASK'),
  CLEAR_SELECTION: DOM.select('document')
    .events('keydown')
    .filter((e) => e.key === 'Escape'),
})

type AppActions = ActionsOf<typeof intent>

const App: Component<AppState, {}, {}, AppActions, AppCalculated, AppContext> = ({ state }) => (
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
  selectedTaskId: null,
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

// Look the selected task up in the current data every time, so the panel
// follows toggles and a deleted task simply stops being selected.
function findSelected(state: AppState): SelectedTask | null {
  for (const project of state.projects) {
    const task = project.tasks.find((t) => t.id === state.selectedTaskId)
    if (task) return { ...task, projectName: project.name }
  }
  return null
}

App.calculated = {
  openCount: (state) =>
    state.projects.reduce((sum, project) => sum + project.tasks.filter((task) => !task.done).length, 0),
}

App.context = {
  hideDone: (state) => state.filters.hideDone,
  selectedTask: (state) => findSelected(state),
  selectedTaskId: (state) => findSelected(state)?.id ?? null,
}

App.intent = intent

App.model = {
  SELECT_TASK: (state, taskId) => ({ ...state, selectedTaskId: taskId }),
  CLEAR_SELECTION: (state) => (state.selectedTaskId === null ? ABORT : { ...state, selectedTaskId: null }),
}

export default App
