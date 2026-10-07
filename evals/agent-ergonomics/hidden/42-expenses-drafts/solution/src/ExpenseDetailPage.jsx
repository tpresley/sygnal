import { event, xs } from 'sygnal'
import { formatMoney } from './money.js'
import { href } from './routes.js'
import StatusBadge from './StatusBadge.jsx'

function ExpenseDetailPage({ state, context }) {
  const { status, data: expense, error } = state.expense
  if (status === 'error' && error?.status === 404) {
    return (
      <section className="expense-detail">
        <h1>Expense not found.</h1>
        <a href={href('expenses')}>Back to expenses</a>
      </section>
    )
  }
  if (status === 'error') {
    return (
      <section className="expense-detail">
        <h1>Couldn't load the expense.</h1>
        <a href={href('expenses')}>Back to expenses</a>
      </section>
    )
  }
  if (!expense) {
    return (
      <section className="expense-detail">
        <p className="loading">Loading…</p>
      </section>
    )
  }
  const pending = expense.status === 'pending'
  const draft = expense.status === 'draft'
  // only drafts and rejected expenses can be deleted
  const deletable = draft || expense.status === 'rejected'
  return (
    <section className="expense-detail">
      <h1>{expense.description}</h1>
      <dl className="expense-fields">
        <dt>Amount</dt>
        <dd className="amount">{formatMoney(expense.amount, context.currency)}</dd>
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
        {pending && <button className="approve">Approve</button>}
        {pending && <button className="reject">Reject</button>}
        {draft && <button className="submit">Submit for approval</button>}
        {deletable && <button className="delete">Delete</button>}
      </div>
      <p className="action-error" role="alert">{state.actionFailed ? "Couldn't update the expense." : ''}</p>
      <a href={href('expenses')}>Back to expenses</a>
    </section>
  )
}

ExpenseDetailPage.resources = {
  expense: (state) => state.route.name === 'expense' && `/api/expenses/${state.route.params.id}`,
}

ExpenseDetailPage.intent = ({ DOM }) => ({
  DECIDE: xs.merge(
    DOM.click('.approve').mapTo('approved'),
    DOM.click('.reject').mapTo('rejected'),
    DOM.click('.submit').mapTo('pending')
  ),
  DELETE: DOM.click('.delete'),
})

const DECIDED_MESSAGES = { pending: 'Submitted for approval', approved: 'Expense approved', rejected: 'Expense rejected' }

const url = (state) => `/api/expenses/${state.expense.data.id}`

ExpenseDetailPage.model = {
  // PUT the new status (pending: submitted for approval, approved or rejected); the reply replaces the shown expense at once
  DECIDE: {
    STATE: (state) => ({ ...state, actionFailed: false }),
    HTTP: (state, status) => ({ url: url(state), method: 'PUT', json: { status }, updates: 'expense', ok: 'DECIDED', error: 'FAILED' }),
  },
  DECIDED: {
    EVENTS: event('FLASH', (state, expense) => DECIDED_MESSAGES[expense.status]),
  },
  DELETE: {
    STATE: (state) => ({ ...state, actionFailed: false }),
    HTTP: (state) => ({ url: url(state), method: 'DELETE', ok: 'DELETED', error: 'FAILED' }),
  },
  DELETED: {
    ROUTER: () => ({ to: 'expenses' }),
    EVENTS: event('FLASH', 'Expense deleted'),
  },
  FAILED: (state) => ({ ...state, actionFailed: true }),
}

export default ExpenseDetailPage
