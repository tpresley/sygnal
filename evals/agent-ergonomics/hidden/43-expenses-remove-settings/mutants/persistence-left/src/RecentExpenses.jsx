import { mostRecent } from './expenses.js'
import { formatMoney } from './money.js'
import { href } from './routes.js'

function RecentExpenses({ expenses, context }) {
  return (
    <ul className="recent-expenses">
      {mostRecent(expenses).map((expense) => (
        <li>
          <a href={href('expense', { id: expense.id })}>{expense.description}</a>
          <span className="amount">{formatMoney(expense.amount, context.currency)}</span>
          <span className="date">{expense.date}</span>
        </li>
      ))}
    </ul>
  )
}

export default RecentExpenses
