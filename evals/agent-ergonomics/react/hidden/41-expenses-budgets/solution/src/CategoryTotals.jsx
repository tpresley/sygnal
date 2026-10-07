import { categoryTotals, budgetFor, isOverBudget } from './expenses.js'
import { formatMoney } from './money.js'
import { useSettings } from './settings.jsx'

export default function CategoryTotals({ expenses }) {
  const { currency, budgets } = useSettings()
  const money = (amount) => formatMoney(amount, currency)
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
          const budget = budgetFor(budgets, category)
          return (
            <tr key={category} className={isOverBudget(total, budget) ? 'over-budget' : ''}>
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
