import { Link } from 'react-router'
import { formatMoney } from './money.js'
import StatusBadge from './StatusBadge.jsx'

// one expense of the list
export default function ExpenseRow({ expense }) {
  return (
    <li className="expense">
      <Link to={`/expenses/${expense.id}`}>{expense.description}</Link>
      <span className="amount">{formatMoney(expense.amount)}</span>
      <span className="category">{expense.category}</span>
      <span className="date">{expense.date}</span>
      <StatusBadge status={expense.status} />
    </li>
  )
}
