import { Link } from 'react-router'
import { mostRecent } from './expenses.js'
import { formatMoney } from './money.js'
import { useSettings } from './settings.jsx'

export default function RecentExpenses({ expenses }) {
  const { currency } = useSettings()
  return (
    <ul className="recent-expenses">
      {mostRecent(expenses).map((expense) => (
        <li key={expense.id}>
          <Link to={`/expenses/${expense.id}`}>{expense.description}</Link>
          <span className="amount">{formatMoney(expense.amount, currency)}</span>
          <span className="date">{expense.date}</span>
        </li>
      ))}
    </ul>
  )
}
