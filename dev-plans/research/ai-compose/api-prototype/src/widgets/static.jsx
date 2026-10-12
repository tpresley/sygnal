// The read-only parts: each shows the app's own data (src/parts.js). No props from the model.
import { KPIS, REVENUE, MONTHS, ORDERS, TICKETS, WEATHER } from '../parts.js'

export function Kpi({ metric }) {
  const k = KPIS[metric]
  return (
    <div className="kpi">
      <span className="kpi-value">{k.value}</span>
      <span className={`kpi-delta ${k.trend}`}>{k.delta}</span>
    </div>
  )
}

export function RevenueChart() {
  const w = 480
  const h = 140
  const min = Math.min(...REVENUE) - 2
  const max = Math.max(...REVENUE) + 2
  const x = (i) => (i / (REVENUE.length - 1)) * (w - 20) + 10
  const y = (v) => h - 20 - ((v - min) / (max - min)) * (h - 30)
  const points = REVENUE.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Monthly revenue, last 12 months">
      <polyline points={points} fill="none" stroke="currentColor" stroke-width="2.5" />
      {REVENUE.map((v, i) => <circle cx={x(i)} cy={y(v)} r="3" />)}
      {MONTHS.map((m, i) => <text x={x(i)} y={h - 4} text-anchor="middle">{m}</text>)}
    </svg>
  )
}

export function OrdersTable() {
  return (
    <table className="orders">
      <thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>
        {ORDERS.map((o) => (
          <tr><td>{o.id}</td><td>{o.customer}</td><td>{o.amount}</td><td><span className={`order-status ${o.status}`}>{o.status}</span></td></tr>
        ))}
      </tbody>
    </table>
  )
}

export function TicketList() {
  return (
    <ul className="tickets">
      {TICKETS.map((t) => (
        <li><span className={`priority ${t.priority}`}>{t.priority}</span> #{t.id} {t.subject}</li>
      ))}
    </ul>
  )
}

export function Weather() {
  return (
    <div className="weather">
      <span className="weather-now">{WEATHER.now}</span>
      <span>{WEATHER.city}: {WEATHER.summary}</span>
      <span className="muted">High {WEATHER.high} · Low {WEATHER.low}</span>
    </div>
  )
}
