// The dashboard's parts: components the model may place on the page (see catalog.js).
import { METRICS } from './data.js'

export function Kpi({ metric }) {
  const m = METRICS[metric]
  return (
    <section className="kpi">
      <h2>{m.label}</h2>
      <p className="value">{m.value}</p>
    </section>
  )
}

const STATUS_TITLE = { any: 'Recent orders', paid: 'Paid orders', pending: 'Pending orders', refunded: 'Refunded orders' }

// no `state` in its catalog entry: it sees the app's state
export function OrdersTable({ state, status }) {
  const rows = state.orders.filter((o) => status === 'any' || o.status === status)
  return (
    <section className="orders">
      <h2>{STATUS_TITLE[status]}</h2>
      <table>
        <tbody>
          {rows.map((o) => (
            <tr>
              <td>{o.id}</td>
              <td>{o.customer}</td>
              <td>${o.amount}</td>
              <td>{o.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
