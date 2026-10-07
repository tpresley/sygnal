import { useEffect, useState } from 'react'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router'
import { FlashProvider } from './flash.jsx'
import NavBar from './NavBar.jsx'
import FlashMessage from './FlashMessage.jsx'
import DashboardPage from './DashboardPage.jsx'
import ExpensesPage from './ExpensesPage.jsx'
import NewExpensePage from './NewExpensePage.jsx'
import ExpenseDetailPage from './ExpenseDetailPage.jsx'
import NotFoundPage from './NotFoundPage.jsx'

function Layout() {
  return (
    <div className="app">
      <NavBar />
      <FlashMessage />
      <main>
        <Outlet />
      </main>
    </div>
  )
}

export const routes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/expenses', element: <ExpensesPage /> },
      { path: '/expenses/new', element: <NewExpensePage /> },
      { path: '/expenses/:id', element: <ExpenseDetailPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

/** The app-wide state the pages share (the tests wrap a memory router in it). */
export function AppProviders({ children }) {
  return <FlashProvider>{children}</FlashProvider>
}

export default function App() {
  // one router per app, reading the URL when the app starts
  const [router] = useState(() => createBrowserRouter(routes))
  useEffect(() => () => router.dispose(), [router])
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
