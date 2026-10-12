// The read-only parts: each shows the app's own data (src/data.js). Their only inputs are the
// catalog's params, which a model picks from a fixed list (src/catalog.js).
import { KPIS, REVENUE, MONTHS, DAILY, ORDERS, TICKETS, WEATHER, TITLES } from '../data.js'
import { card } from './card.jsx'

export function Kpi({ metric }) {
  const k = KPIS[metric]
  return (
    card(metric, TITLES[metric],
      <div className="kpi">
        <span className="kpi-value">{k.value}</span>
        <span className={`kpi-delta ${k.trend}`}>{k.delta}</span>
      </div>
    )
  )
}

const RANGES = {
  month: { title: 'last 30 days', values: DAILY, labels: DAILY.map((_, i) => (i % 5 === 0 ? `${30 - i}d` : '')) },
  quarter: { title: 'last 3 months', values: REVENUE.slice(-3), labels: MONTHS.slice(-3) },
  year: { title: 'last 12 months', values: REVENUE, labels: MONTHS },
}

export function RevenueChart({ range }) {
  const { title, values, labels } = RANGES[range] || RANGES.year
  const w = 480
  const h = 140
  const min = Math.min(...values) * 0.95
  const max = Math.max(...values) * 1.05
  const x = (i) => (i / (values.length - 1)) * (w - 40) + 20
  const y = (v) => h - 20 - ((v - min) / (max - min)) * (h - 30)
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    card('revenueChart', `${TITLES.revenueChart}, ${title}`,
      <svg className="chart" data-range={range} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Revenue, ${title}`}>
        <polyline points={points} fill="none" stroke="currentColor" stroke-width="2.5" />
        {values.map((v, i) => <circle cx={x(i)} cy={y(v)} r="3" />)}
        {labels.map((m, i) => <text x={x(i)} y={h - 4} text-anchor="middle">{m}</text>)}
      </svg>
    )
  )
}

export function OrdersTable({ status, limit }) {
  const rows = ORDERS.filter((o) => status === 'any' || o.status === status).slice(0, limit)
  return (
    card('orders', status === 'any' ? TITLES.orders : `${TITLES.orders}: ${status}`,
      <table className="orders" data-status={status} data-limit={String(limit)}>
        <thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr><td>{o.id}</td><td>{o.customer}</td><td>{o.amount}</td><td><span className={`order-status ${o.status}`}>{o.status}</span></td></tr>
          ))}
        </tbody>
      </table>
    )
  )
}

export function TicketList({ priority }) {
  const rows = TICKETS.filter((t) => priority === 'any' || t.priority === priority)
  return (
    card('tickets', priority === 'high' ? 'Urgent tickets' : TITLES.tickets,
      <ul className="tickets" data-priority={priority}>
        {rows.map((t) => (
          <li><span className={`priority ${t.priority}`}>{t.priority}</span> #{t.id} {t.subject}</li>
        ))}
      </ul>
    )
  )
}

export function Weather() {
  return (
    card('weather', TITLES.weather,
      <div className="weather">
        <span className="weather-now">{WEATHER.now}</span>
        <span>{WEATHER.city}: {WEATHER.summary}</span>
        <span className="muted">High {WEATHER.high} · Low {WEATHER.low}</span>
      </div>
    )
  )
}
