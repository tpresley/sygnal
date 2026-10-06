import { Collection } from 'sygnal'
import type { Component } from 'sygnal'
import TaskItem from './TaskItem'
import type { AppState } from './types'

const TaskCollection = Collection<{}, AppState>

const App: Component<AppState> = () => (
  <div className="app">
    <h1>Tasks</h1>
    <p className="pinned">Nothing pinned</p>
    <div className="task-list">
      <TaskCollection of={TaskItem} from="tasks" />
    </div>
  </div>
)

App.initialState = {
  tasks: [
    { id: 1, title: 'Buy milk', done: false },
    { id: 2, title: 'Walk the dog', done: false },
    { id: 3, title: 'Write report', done: true },
  ],
}

export default App
