import { Collection } from 'sygnal'
import TaskItem from './TaskItem.jsx'

function App({ state }) {
  return (
    <div className="app">
      <h1>Tasks</h1>
      <p className="pinned">Nothing pinned</p>
      <div className="task-list">
        <Collection of={TaskItem} from="tasks" />
      </div>
    </div>
  )
}

App.initialState = {
  tasks: [
    { id: 1, title: 'Buy milk', done: false },
    { id: 2, title: 'Walk the dog', done: false },
    { id: 3, title: 'Write report', done: true },
  ],
}

export default App
