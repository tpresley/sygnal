import { mostRecent } from './expenses.js'
import { formatMoney } from './money.js'
import { href } from './routes.js'

function RecentExpenses({ expenses }) {
  return (
    <ul className="recent-expenses">
      {mostRecent(expenses).map((expense) => (
        <li>
          <a href={href('expense', { id: expense.id })}>{expense.description}</a>
          <span className="amount">{formatMoney(expense.amount)}</span>
          <span className="date">{expense.date}</span>
        </li>
      ))}
    </ul>
  )
}

export default RecentExpenses
