import { Switchable } from 'sygnal'
import TaskList from './TaskList.jsx'
import TaskPage from './TaskPage.jsx'
import EditPage from './EditPage.jsx'

function App({ state }) {
  return (
    <div className="app">
      <nav>
        <button className="home">All tasks</button>
      </nav>
      <main>
        <Switchable of={{ list: TaskList, task: TaskPage, edit: EditPage }} current={state.page} />
      </main>
    </div>
  )
}

// page: 'list' | 'task' | 'edit'; the pages share this state
App.initialState = {
  page: 'list',
  taskId: null,
  draft: '',
  tasks: [
    { id: 1, title: 'Write the report' },
    { id: 2, title: 'Book the venue' },
    { id: 3, title: 'Send the invites' },
  ],
}

App.intent = ({ DOM }) => ({
  HOME: DOM.click('.home'),
})

App.model = {
  HOME: (state) => ({ ...state, page: 'list' }),
}

export default App
