import { Switchable } from 'sygnal'
import { router, href, taskOf } from './routes.js'
import TaskList from './TaskList.jsx'
import TaskPage from './TaskPage.jsx'
import EditPage from './EditPage.jsx'
import NotFound from './NotFound.jsx'

// a task route whose task doesn't exist is the not-found page
const pageOf = (state) => (state.route.name === 'task' || state.route.name === 'edit') && !taskOf(state) ? 'notFound' : state.route.name

const TITLES = {
  list: () => 'Tasks',
  task: (state) => `${taskOf(state).title} · Tasks`,
  edit: (state) => `Edit ${taskOf(state).title} · Tasks`,
  notFound: () => 'Not found · Tasks',
}

function App({ state }) {
  return (
    <div className="app">
      <nav>
        <a href={href('list')}>All tasks</a>
      </nav>
      <main>
        <Switchable
          of={{ list: TaskList, task: TaskPage, edit: EditPage, notFound: NotFound }}
          current={pageOf(state)}
          instance={state.route.path}
        />
      </main>
    </div>
  )
}

App.route = 'ROUTE'

// draft: the edit form's text (null: the saved title); leaving: the blocked navigation
App.initialState = {
  route: router.current(),
  draft: null,
  leaving: null,
  tasks: [
    { id: 1, title: 'Write the report' },
    { id: 2, title: 'Book the venue' },
    { id: 3, title: 'Send the invites' },
  ],
}

const FIRST_TITLE = 'Tasks'
App.head = () => ({ title: FIRST_TITLE }) // mutant: the title never follows the route

App.model = {
  ROUTE: (state, route) => ({ ...state, route, draft: null, leaving: null }),
}

export default App
