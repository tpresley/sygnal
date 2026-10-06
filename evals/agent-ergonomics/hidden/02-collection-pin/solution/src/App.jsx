import { Collection } from 'sygnal'
import TaskItem from './TaskItem.jsx'

function App({ state }) {
  const pinned = state.tasks.find((task) => task.id === state.pinnedId)
  return (
    <div className="app">
      <h1>Tasks</h1>
      <p className="pinned">{pinned ? `Pinned: ${pinned.title}` : 'Nothing pinned'}</p>
      <div className="task-list">
        <Collection of={TaskItem} from="tasks" />
      </div>
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

App.intent = ({ CHILD }) => ({
  PIN: CHILD.select(TaskItem).filter((msg) => msg.type === 'PIN'),
})

App.model = {
  PIN: (state, msg) => ({ ...state, pinnedId: msg.id }),
}

export default App
