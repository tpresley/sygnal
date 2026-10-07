import { useExpenses } from './api.js'
import { pendingCount, draftCount, approvedTotal } from './expenses.js'
import { formatMoney } from './money.js'
import { useSettings } from './settings.jsx'
import CategoryTotals from './CategoryTotals.jsx'
import RecentExpenses from './RecentExpenses.jsx'

export default function DashboardPage() {
  const list = useExpenses()
  const { currency } = useSettings()
  const expenses = list.data
  return (
    <section className="dashboard">
      <h1>Dashboard</h1>
      {list.status === 'success' ? (
        <div className="summary">
          <p className="pending-count">{`Pending approval: ${pendingCount(expenses)}`}</p>
          <p className="draft-count">{`Drafts: ${draftCount(expenses)}`}</p>
          <p className="approved-total">{`Approved total: ${formatMoney(approvedTotal(expenses), currency)}`}</p>
          <h2>By category</h2>
          <CategoryTotals expenses={expenses} />
          <h2>Recent expenses</h2>
          <RecentExpenses expenses={expenses} />
        </div>
      ) : list.status === 'error' ? (
        <div className="load-error">
          <p>Couldn't load expenses.</p>
          <button className="retry" onClick={list.reload}>
            Retry
          </button>
        </div>
      ) : (
        <p className="loading">Loading expenses…</p>
      )}
    </section>
  )
}
