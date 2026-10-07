import { Collection } from 'sygnal'
import { visibleExpenses, countLabel } from './expenses.js'
import ExpenseFilters from './ExpenseFilters.jsx'
import ExpenseRow from './ExpenseRow.jsx'

// the rows the filters let through, in the chosen order
const shown = (state) => visibleExpenses(state.expenseList.data?.expenses ?? [], state.filters)

function ExpensesPage({ state }) {
  const list = state.expenseList
  const failed = list.status === 'error' && !list.refreshing
  return (
    <section className="expenses-page">
      <h1>Expenses</h1>
      <ExpenseFilters />
      {list.status === 'success' ? (
        <div className="results">
          <p className="count">{countLabel(shown(state).length)}</p>
          <ul className="expense-list">
            <Collection of={ExpenseRow} from={{ get: shown }} />
          </ul>
        </div>
      ) : failed ? (
        <div className="load-error">
          <p>Couldn't load expenses.</p>
          <button className="retry">Retry</button>
        </div>
      ) : (
        <p className="loading">Loading expenses…</p>
      )}
    </section>
  )
}

ExpensesPage.resources = {
  expenseList: () => '/api/expenses',
}

ExpensesPage.intent = ({ DOM }) => ({
  RETRY: DOM.click('.retry'),
})

ExpensesPage.model = {
  RETRY: { HTTP: { refresh: 'expenseList' } },
}

export default ExpensesPage
