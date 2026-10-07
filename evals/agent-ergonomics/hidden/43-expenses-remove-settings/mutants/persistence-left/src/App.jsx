import { Switchable, persist } from 'sygnal'
import { router } from './routes.js'
import { DEFAULT_FILTERS } from './expenses.js'
import NavBar from './NavBar.jsx'
import FlashMessage from './FlashMessage.jsx'
import DashboardPage from './DashboardPage.jsx'
import ExpensesPage from './ExpensesPage.jsx'
import NewExpensePage from './NewExpensePage.jsx'
import ExpenseDetailPage from './ExpenseDetailPage.jsx'
import NotFoundPage from './NotFoundPage.jsx'

const PAGES = {
  dashboard: DashboardPage,
  expenses: ExpensesPage,
  newExpense: NewExpensePage,
  expense: ExpenseDetailPage,
  notFound: NotFoundPage,
}

function App({ state }) {
  return (
    <div className="app">
      <NavBar />
      <FlashMessage />
      <main>
        <Switchable of={PAGES} current={state.route.name} instance={state.route.path} />
      </main>
    </div>
  )
}

App.route = 'ROUTE'

// The pages share this state. A page's passing state (the list filters, a failed save or
// update) starts over whenever the route changes.
App.initialState = {
  route: router.current(),
  filters: DEFAULT_FILTERS,
  flash: null,
  saveFailed: false,
  actionFailed: false,
  settings: { currency: 'USD', defaultCategory: '' },
}

App.context = {
  currency: (state) => state.settings.currency,
}

App.persist = persist({ key: 'expenses-settings', pick: ['settings'], format: 'plain' })

App.model = {
  ROUTE: (state, route) => ({ ...state, route, filters: DEFAULT_FILTERS, saveFailed: false, actionFailed: false }),
}

export default App
