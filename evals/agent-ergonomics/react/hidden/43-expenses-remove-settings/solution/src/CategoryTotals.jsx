import { categoryTotals } from './expenses.js'
import { formatMoney } from './money.js'

export default function CategoryTotals({ expenses }) {
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
          <tr key={category}>
            <th scope="row">{category}</th>
            <td className="total">{formatMoney(total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
