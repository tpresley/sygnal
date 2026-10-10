import { ABORT, Collection } from 'sygnal'
import Item from './Item.jsx'

function App({ state, uid }) {
  const packed = state.items.filter((item) => item.packed).length
  return (
    <main className="packing">
      <header>
        <h1>Packing list</h1>
        <p className="summary">{`${packed} of ${state.items.length} packed`}</p>
      </header>
      <form className="add-item">
        <label for={uid('name')}>Item</label>
        <input id={uid('name')} name="name" value={state.name} />
        <label for={uid('quantity')}>Quantity</label>
        <input id={uid('quantity')} name="quantity" type="number" min="1" max="99" value={state.quantity} />
        <button type="submit">Add</button>
      </form>
      <ul className="items">
        <Collection of={Item} from="items" />
      </ul>
    </main>
  )
}

App.initialState = {
  items: [
    { id: 1, name: 'Tent', quantity: 1, packed: false },
    { id: 2, name: 'Socks', quantity: 4, packed: true },
    { id: 3, name: 'Headlamp', quantity: 1, packed: false },
  ],
  nextId: 4,
  name: '',
  quantity: '1',
}

App.intent = ({ DOM }) => ({
  NAME: DOM.input('[name="name"]').value(),
  QUANTITY: DOM.input('[name="quantity"]').value(),
  ADD: DOM.select('.add-item').events('submit', { preventDefault: true }),
})

const validQuantity = (q) => Number.isInteger(Number(q)) && Number(q) >= 1 && Number(q) <= 99

App.model = {
  NAME: (state, name) => ({ ...state, name }),
  QUANTITY: (state, quantity) => ({ ...state, quantity }),
  ADD: (state) => {
    const name = state.name.trim()
    if (!name || !validQuantity(state.quantity)) return ABORT
    return {
      ...state,
      items: [...state.items, { id: state.nextId, name, quantity: Number(state.quantity), packed: false }],
      nextId: state.nextId + 1,
      name: '',
      quantity: '1',
    }
  },
}

export default App
