import { useState } from 'react'
import CartLine from './CartLine.jsx'

const initialLines = [
  { id: 1, name: 'Coffee beans', price: 12.5, qty: 2 },
  { id: 2, name: 'Mug', price: 8, qty: 1 },
  { id: 3, name: 'Filter papers', price: 4, qty: 1 },
]

export default function App() {
  const [lines, setLines] = useState(initialLines)

  const changeQty = (id, delta) =>
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, qty: Math.max(1, line.qty + delta) } : line))
    )

  return (
    <div className="cart">
      <h1>Your cart</h1>
      <div className="lines">
        {lines.map((line) => (
          <CartLine
            key={line.id}
            line={line}
            onInc={() => changeQty(line.id, 1)}
            onDec={() => changeQty(line.id, -1)}
          />
        ))}
      </div>
    </div>
  )
}
