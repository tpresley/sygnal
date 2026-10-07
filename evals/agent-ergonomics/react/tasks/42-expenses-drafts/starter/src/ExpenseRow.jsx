import { Link } from 'react-router'
import { formatMoney } from './money.js'
import { useSettings } from './settings.jsx'
import StatusBadge from './StatusBadge.jsx'

// one expense of the list
export default function ExpenseRow({ expense }) {
  const { currency } = useSettings()
  return (
    <li className="expense">
      <Link to={`/expenses/${expense.id}`}>{expense.description}</Link>
      <span className="amount">{formatMoney(expense.amount, currency)}</span>
      <span className="category">{expense.category}</span>
      <span className="date">{expense.date}</span>
      <StatusBadge status={expense.status} />
    </li>
  )
}
