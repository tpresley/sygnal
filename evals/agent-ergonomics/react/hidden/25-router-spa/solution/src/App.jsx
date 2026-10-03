import { useEffect, useState } from 'react'
import { createBrowserRouter, Link, Outlet, RouterProvider } from 'react-router'
import TaskList from './TaskList.jsx'
import TaskPage from './TaskPage.jsx'
import EditPage from './EditPage.jsx'
import NotFound from './NotFound.jsx'
import { TasksContext } from './tasks.js'

const TASKS = [
  { id: 1, title: 'Write the report' },
  { id: 2, title: 'Book the venue' },
  { id: 3, title: 'Send the invites' },
]

function Layout() {
  return (
    <div className="app">
      <nav>
        <Link to="/">All tasks</Link>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}

const routes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <TaskList /> },
      { path: '/tasks/:id', element: <TaskPage /> },
      { path: '/tasks/:id/edit', element: <EditPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

export default function App() {
  const [tasks, setTasks] = useState(TASKS)
  // one router per app, reading the URL when the app starts
  const [router] = useState(() => createBrowserRouter(routes))
  useEffect(() => () => router.dispose(), [router])

  const saveTitle = (id, title) => setTasks((all) => all.map((t) => (t.id === id ? { ...t, title } : t)))

  return (
    <TasksContext.Provider value={{ tasks, saveTitle }}>
      <RouterProvider router={router} />
    </TasksContext.Provider>
  )
}
