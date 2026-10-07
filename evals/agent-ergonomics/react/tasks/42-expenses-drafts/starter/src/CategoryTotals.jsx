import { categoryTotals } from './expenses.js'
import { formatMoney } from './money.js'
import { useSettings } from './settings.jsx'

export default function CategoryTotals({ expenses }) {
  const { currency } = useSettings()
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
            <td className="total">{formatMoney(total, currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
