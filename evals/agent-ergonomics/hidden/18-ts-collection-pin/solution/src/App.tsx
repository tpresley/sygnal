import { Collection } from 'sygnal'
import type { Component, IntentSources, ActionsOf } from 'sygnal'
import TaskItem from './TaskItem'
import type { AppState } from './types'

const TaskCollection = Collection<{ className?: string }, AppState>

const intent = ({ CHILD }: IntentSources<AppState>) => ({
  PIN: CHILD.select(TaskItem).map((request) => request.taskId),
})

const App: Component<AppState, {}, {}, ActionsOf<typeof intent>> = ({ state }) => {
  const pinned = state.tasks.find((task) => task.id === state.pinnedId)
  return (
    <div className="app">
      <h1>Tasks</h1>
      <p className="pinned">{pinned ? `Pinned: ${pinned.title}` : 'Nothing pinned'}</p>
      <TaskCollection of={TaskItem} from="tasks" className="task-list" />
    </div>
  )
}

App.initialState = {
  pinnedId: null,
  tasks: [
    { id: 1, title: 'Buy milk', done: false },
    { id: 2, title: 'Walk the dog', done: false },
    { id: 3, title: 'Write report', done: true },
  ],
}

App.intent = intent

App.model = {
  PIN: (state, taskId) => ({ ...state, pinnedId: taskId }),
}

export default App
