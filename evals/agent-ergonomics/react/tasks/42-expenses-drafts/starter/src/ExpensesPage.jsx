import { useState } from 'react'
import { useExpenses } from './api.js'
import { DEFAULT_FILTERS, visibleExpenses, countLabel } from './expenses.js'
import ExpenseFilters from './ExpenseFilters.jsx'
import ExpenseRow from './ExpenseRow.jsx'

export default function ExpensesPage() {
  const list = useExpenses()
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const changeFilter = (name, value) => setFilters((old) => ({ ...old, [name]: value }))
  // the rows the filters let through, in the chosen order
  const shown = list.status === 'success' ? visibleExpenses(list.data, filters) : []
  return (
    <section className="expenses-page">
      <h1>Expenses</h1>
      <ExpenseFilters filters={filters} onChange={changeFilter} />
      {list.status === 'success' ? (
        <div className="results">
          <p className="count">{countLabel(shown.length)}</p>
          <ul className="expense-list">
            {shown.map((expense) => (
              <ExpenseRow key={expense.id} expense={expense} />
            ))}
          </ul>
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
