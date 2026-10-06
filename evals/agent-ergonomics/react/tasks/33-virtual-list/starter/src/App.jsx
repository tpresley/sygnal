import { useState } from 'react'
import { CUSTOMERS } from './customers.js'

function Row({ customer, onStar }) {
  return (
    <li className="row">
      <span className="num">#{customer.id}</span> <span className="name">{customer.name}</span> <span className="city">{customer.city}</span>
      <button type="button" className="star" aria-label={`Star ${customer.name}`} aria-pressed={String(customer.starred)} onClick={() => onStar(customer.id)}>★</button>
    </li>
  )
}

export default function App() {
  const [customers, setCustomers] = useState(CUSTOMERS)
  const starred = customers.filter((c) => c.starred).length
  const star = (id) => setCustomers((list) => list.map((c) => (c.id === id ? { ...c, starred: !c.starred } : c)))

  return (
    <main className="customers-page">
      <h1>Customers</h1>
      <p className="summary">{customers.length.toLocaleString('en-US')} customers, {starred} starred</p>
      <ul className="customers" aria-label="Customers">
        {customers.map((c) => (
          <Row key={c.id} customer={c} onStar={star} />
        ))}
      </ul>
    </main>
  )
}
