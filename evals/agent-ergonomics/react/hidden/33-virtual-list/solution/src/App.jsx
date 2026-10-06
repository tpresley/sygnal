import { useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CUSTOMERS } from './customers.js'

const ROW = 40
const ERROR = 'Enter a row from 1 to 10,000.'

function Row({ customer, current, onStar, style, index, count }) {
  return (
    <div
      className="row"
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={count}
      aria-current={current ? 'true' : undefined}
      style={style}
    >
      <span className="num">#{customer.id}</span> <span className="name">{customer.name}</span> <span className="city">{customer.city}</span>
      <button type="button" className="star" aria-label={`Star ${customer.name}`} aria-pressed={String(customer.starred)} onClick={() => onStar(customer.id)}>★</button>
    </div>
  )
}

export default function App() {
  const [customers, setCustomers] = useState(CUSTOMERS)
  const [goTo, setGoTo] = useState('')
  const [current, setCurrent] = useState(null)
  const [jumpError, setJumpError] = useState('')
  const listRef = useRef(null)
  const starred = customers.filter((c) => c.starred).length
  const star = (id) => setCustomers((list) => list.map((c) => (c.id === id ? { ...c, starred: !c.starred } : c)))

  const virtualizer = useVirtualizer({
    count: customers.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW,
    overscan: 5,
  })

  const jump = (e) => {
    e.preventDefault()
    const n = Number(goTo)
    if (!/^\d+$/.test(goTo.trim()) || n < 1 || n > customers.length) {
      setJumpError(ERROR)
      return
    }
    setJumpError('')
    setCurrent(n)
    virtualizer.scrollToIndex(n - 1, { align: 'start' })
  }

  return (
    <main className="customers-page">
      <h1>Customers</h1>
      <p className="summary">{customers.length.toLocaleString('en-US')} customers, {starred} starred</p>
      <form className="jump" noValidate onSubmit={jump}>
        <label htmlFor="go-to-row">Go to row</label>
        <input id="go-to-row" name="row" type="number" min="1" max={customers.length} value={goTo} onChange={(e) => setGoTo(e.target.value)} />
        <button type="submit">Go</button>
        <p className="jump-error" role="alert">{jumpError}</p>
      </form>
      <div ref={listRef} className="customers" role="list" aria-label="Customers" tabIndex={0}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const customer = customers[item.index]
            return (
              <Row
                key={customer.id}
                customer={customer}
                index={item.index}
                count={customers.length}
                current={customer.id === current}
                onStar={star}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW, transform: `translateY(${item.start}px)` }}
              />
            )
          })}
        </div>
      </div>
    </main>
  )
}
