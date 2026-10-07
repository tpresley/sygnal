import { categoryTotals } from './expenses.js'
import { formatMoney } from './money.js'

function CategoryTotals({ expenses, context }) {
  return (
    <table className="category-totals">
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {categoryTotals(expenses).map(({ category, total }) => (
          <tr>
            <th scope="row">{category}</th>
            <td className="total">{formatMoney(total, context.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default CategoryTotals
