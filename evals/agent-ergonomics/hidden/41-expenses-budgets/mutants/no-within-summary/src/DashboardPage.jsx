import { pendingCount, approvedTotal, hasBudgets, overBudget } from './expenses.js'
import { formatMoney } from './money.js'
import CategoryTotals from './CategoryTotals.jsx'
import RecentExpenses from './RecentExpenses.jsx'

const budgetSummary = (over) => (over.length ? `Over budget: ${over.join(', ')}` : 'All categories within budget.')

function DashboardPage({ state, context }) {
  const list = state.expenseList
  const expenses = list.data?.expenses
  const failed = list.status === 'error' && !list.refreshing
  return (
    <section className="dashboard">
      <h1>Dashboard</h1>
      {list.status === 'success' ? (
        <div className="summary">
          <p className="pending-count">{`Pending approval: ${pendingCount(expenses)}`}</p>
          <p className="approved-total">{`Approved total: ${formatMoney(approvedTotal(expenses), context.currency)}`}</p>
          <h2>By category</h2>
          <CategoryTotals expenses={expenses} />
          {overBudget(expenses, context.budgets).length > 0 && <p className="over-budget-summary">{budgetSummary(overBudget(expenses, context.budgets))}</p>}
          <h2>Recent expenses</h2>
          <RecentExpenses expenses={expenses} />
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

DashboardPage.resources = {
  expenseList: () => '/api/expenses',
}

DashboardPage.intent = ({ DOM }) => ({
  RETRY: DOM.click('.retry'),
})

DashboardPage.model = {
  RETRY: { HTTP: { refresh: 'expenseList' } },
}

export default DashboardPage
