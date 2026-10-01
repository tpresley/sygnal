import { Collection } from 'sygnal'
import CartLine from './CartLine.jsx'

const cartTotal = (lines) => lines.reduce((sum, line) => sum + line.price * line.qty, 0)

function App({ state }) {
  return (
    <div className="cart">
      <h1>Your cart</h1>
      <Collection of={CartLine} from="lines" className="lines" />
      <p className="total">Total: ${cartTotal(state.lines).toFixed(2)}</p>
    </div>
  )
}

App.initialState = {
  lines: [
    { id: 1, name: 'Coffee beans', price: 12.5, qty: 2 },
    { id: 2, name: 'Mug', price: 8, qty: 1 },
    { id: 3, name: 'Filter papers', price: 4, qty: 1 },
  ],
}

App.context = {
  cartTotal: (state) => cartTotal(state.lines),
}

export default App
