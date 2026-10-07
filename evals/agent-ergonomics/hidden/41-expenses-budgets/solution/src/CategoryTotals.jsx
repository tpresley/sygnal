import { categoryTotals, budgetFor, isOverBudget } from './expenses.js'
import { formatMoney } from './money.js'

function CategoryTotals({ expenses, context }) {
  const money = (amount) => formatMoney(amount, context.currency)
  return (
    <table className="category-totals">
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Total</th>
          <th scope="col">Budget</th>
        </tr>
      </thead>
      <tbody>
        {categoryTotals(expenses).map(({ category, total }) => {
          const budget = budgetFor(context.budgets, category)
          return (
            <tr className={isOverBudget(total, budget) ? 'over-budget' : ''}>
              <th scope="row">{category}</th>
              <td className="total">{money(total)}</td>
              <td className="budget">{budget === null ? 'No budget' : `${money(total)} of ${money(budget)}`}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default CategoryTotals
