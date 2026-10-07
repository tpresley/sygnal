import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, useExpense } from './api.js'
import { formatMoney } from './money.js'
import { useFlash } from './flash.jsx'
import { useSettings } from './settings.jsx'
import StatusBadge from './StatusBadge.jsx'

export default function ExpenseDetailPage() {
  const { id } = useParams()
  const loaded = useExpense(id)
  const { currency } = useSettings()
  const { showFlash } = useFlash()
  const navigate = useNavigate()
  const [actionFailed, setActionFailed] = useState(false)

  // PUT the new status (approved or rejected); the reply replaces the shown expense
  async function decide(status) {
    setActionFailed(false)
    try {
      const updated = await api.setStatus(id, status)
      loaded.setData(updated)
      showFlash(updated.status === 'approved' ? 'Expense approved' : 'Expense rejected')
    } catch {
      setActionFailed(true)
    }
  }

  async function remove() {
    setActionFailed(false)
    try {
      await api.remove(id)
      showFlash('Expense deleted')
      navigate('/expenses')
    } catch {
      setActionFailed(true)
    }
  }

  if (loaded.status === 'error') {
    return (
      <section className="expense-detail">
        <h1>{loaded.error.status === 404 ? 'Expense not found.' : "Couldn't load the expense."}</h1>
        <Link to="/expenses">Back to expenses</Link>
      </section>
    )
  }
  if (loaded.status === 'loading') {
    return (
      <section className="expense-detail">
        <p className="loading">Loading…</p>
      </section>
    )
  }
  const expense = loaded.data
  const pending = expense.status === 'pending'
  return (
    <section className="expense-detail">
      <h1>{expense.description}</h1>
      <dl className="expense-fields">
        <dt>Amount</dt>
        <dd className="amount">{formatMoney(expense.amount, currency)}</dd>
        <dt>Category</dt>
        <dd className="category">{expense.category}</dd>
        <dt>Date</dt>
        <dd className="date">{expense.date}</dd>
        <dt>Status</dt>
        <dd>
          <StatusBadge status={expense.status} />
        </dd>
      </dl>
      <div className="actions">
        {pending && (
          <button className="approve" onClick={() => decide('approved')}>
            Approve
          </button>
        )}
        {pending && (
          <button className="reject" onClick={() => decide('rejected')}>
            Reject
          </button>
        )}
        <button className="delete" onClick={remove}>
          Delete
        </button>
      </div>
      <p className="action-error" role="alert">
        {actionFailed ? "Couldn't update the expense." : ''}
      </p>
      <Link to="/expenses">Back to expenses</Link>
    </section>
  )
}
