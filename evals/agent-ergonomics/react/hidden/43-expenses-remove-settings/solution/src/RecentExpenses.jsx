import { Link } from 'react-router'
import { mostRecent } from './expenses.js'
import { formatMoney } from './money.js'

export default function RecentExpenses({ expenses }) {
  return (
    <ul className="recent-expenses">
      {mostRecent(expenses).map((expense) => (
        <li key={expense.id}>
          <Link to={`/expenses/${expense.id}`}>{expense.description}</Link>
          <span className="amount">{formatMoney(expense.amount)}</span>
          <span className="date">{expense.date}</span>
        </li>
      ))}
    </ul>
  )
}
