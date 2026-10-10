import { useId, useState } from 'react'
import Item from './Item.jsx'

const SEED = [
  { id: 1, name: 'Tent', quantity: 1, packed: false },
  { id: 2, name: 'Socks', quantity: 4, packed: true },
  { id: 3, name: 'Headlamp', quantity: 1, packed: false },
]

const validQuantity = (q) => Number.isInteger(Number(q)) && Number(q) >= 1 && Number(q) <= 99

export default function App() {
  const [items, setItems] = useState(SEED)
  const [nextId, setNextId] = useState(4)
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const id = useId()
  const packed = items.filter((item) => item.packed).length

  function add(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !validQuantity(quantity)) return
    setItems((all) => [...all, { id: nextId, name: trimmed, quantity: Number(quantity), packed: false }])
    setNextId((n) => n + 1)
    setName('')
    setQuantity('1')
  }

  const toggle = (itemId) => setItems((all) => all.map((item) => (item.id === itemId ? { ...item, packed: !item.packed } : item)))
  const remove = (itemId) => setItems((all) => all.filter((item) => item.id !== itemId))

  return (
    <main className="packing">
      <header>
        <h1>Packing list</h1>
        <p className="summary">{`${packed} of ${items.length} packed`}</p>
      </header>
      <form className="add-item" onSubmit={add}>
        <label htmlFor={`${id}-name`}>Item</label>
        <input id={`${id}-name`} name="name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor={`${id}-quantity`}>Quantity</label>
        <input id={`${id}-quantity`} name="quantity" type="number" min="1" max="99" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <button type="submit">Add</button>
      </form>
      <ul className="items">
        {items.map((item) => (
          <Item key={item.id} item={item} onToggle={() => toggle(item.id)} onRemove={() => remove(item.id)} />
        ))}
      </ul>
    </main>
  )
}
