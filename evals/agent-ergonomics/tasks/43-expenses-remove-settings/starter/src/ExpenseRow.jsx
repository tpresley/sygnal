import { formatMoney } from './money.js'
import { href } from './routes.js'
import StatusBadge from './StatusBadge.jsx'

// one expense of the list (a Collection item: its state is the expense)
function ExpenseRow({ state, context }) {
  return (
    <li className="expense">
      <a href={href('expense', { id: state.id })}>{state.description}</a>
      <span className="amount">{formatMoney(state.amount, context.currency)}</span>
      <span className="category">{state.category}</span>
      <span className="date">{state.date}</span>
      <StatusBadge status={state.status} />
    </li>
  )
}

export default ExpenseRow
