import { Collection } from 'sygnal'
import CartLine from './CartLine.jsx'

function App() {
  return (
    <div className="cart">
      <h1>Your cart</h1>
      <div className="lines">
        <Collection of={CartLine} from="lines" />
      </div>
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

export default App
