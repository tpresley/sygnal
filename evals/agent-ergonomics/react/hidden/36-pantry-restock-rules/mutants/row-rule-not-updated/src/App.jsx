import { useMemo, useState } from 'react'

// A pantry stock list: quantities, a minimum per item ("low" at or below it), an add bar
// (button or Enter), Remove with Undo, All / Low stock tabs and a sort order.

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  urgency: (a, b) => a.qty - a.min - (b.qty - b.min) || a.name.localeCompare(b.name),
}

export const isLow = (item) => item.qty <= item.min

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

const INITIAL_ITEMS = [
  { id: 1, name: 'Rice', qty: 4, min: 2 },
  { id: 2, name: 'Olive oil', qty: 1, min: 1 },
  { id: 3, name: 'Pasta', qty: 0, min: 2 },
  { id: 4, name: 'Canned tomatoes', qty: 6, min: 3 },
  { id: 5, name: 'Coffee', qty: 1, min: 2 },
  { id: 6, name: 'Black beans', qty: 3, min: 3 },
]

function ItemRow({ item, onUseOne, onAddOne, onRemove }) {
  return (
    <li className={item.qty < item.min ? 'item low' : 'item'} data-id={item.id}>
      <span className="name">{item.name}</span>
      <span className="qty">{item.qty}</span>
      <span className="min">min {item.min}</span>
      <button className="dec" aria-label={`Use one ${item.name}`} disabled={item.qty === 0} onClick={onUseOne}>
        −
      </button>
      <button className="inc" aria-label={`Add one ${item.name}`} onClick={onAddOne}>
        +
      </button>
      <button className="remove" onClick={onRemove}>
        Remove
      </button>
    </li>
  )
}

export default function App() {
  const [items, setItems] = useState(INITIAL_ITEMS)
  const [nextId, setNextId] = useState(7)
  const [draft, setDraft] = useState('')
  const [listMode, setListMode] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [lastRemoved, setLastRemoved] = useState(null)

  const lowCount = items.filter(isLow).length
  const visible = useMemo(
    () => items.filter((item) => listMode === 'all' || isLow(item)).sort(SORTS[sortBy]),
    [items, listMode, sortBy]
  )

  const add = () => {
    const name = draft.trim()
    if (!name) return
    const existing = items.find((item) => sameName(item.name, name))
    if (existing) {
      changeQty(existing.id, 1)
      setDraft('')
      return
    }
    setItems([...items, { id: nextId, name, qty: 1, min: 1 }])
    setNextId(nextId + 1)
    setDraft('')
  }

  const changeQty = (id, delta) =>
    setItems((all) => all.map((item) => (item.id === id ? { ...item, qty: Math.max(0, item.qty + delta) } : item)))

  const remove = (id) => {
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) return
    setItems(items.filter((item) => item.id !== id))
    setLastRemoved({ item: items[index], index })
  }

  const undo = () => {
    if (!lastRemoved) return
    const { item, index } = lastRemoved
    const next = [...items]
    next.splice(Math.min(index, next.length), 0, item)
    setItems(next)
    setLastRemoved(null)
  }

  return (
    <div className="pantry">
      <h1>Pantry</h1>
      <p className="summary">{`${plural(items.length, 'item')} · ${lowCount} low`}</p>

      <div className="add-bar">
        <input
          className="new-item"
          name="new-item"
          aria-label="New item"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button className="add" onClick={add}>
          Add
        </button>
      </div>
      {lastRemoved ? (
        <p className="notice">
          {`Removed ${lastRemoved.item.name}.`}{' '}
          <button className="undo" onClick={undo}>
            Undo
          </button>
        </p>
      ) : null}

      <div className="toolbar">
        <div className="list-tabs">
          <button className={listMode === 'all' ? 'tab-all active' : 'tab-all'} onClick={() => setListMode('all')}>
            All
          </button>
          <button className={listMode === 'low' ? 'tab-low active' : 'tab-low'} onClick={() => setListMode('low')}>
            Low stock
          </button>
        </div>
        <label>
          Sort by{' '}
          <select className="sort" name="sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="name">Name</option>
            <option value="urgency">Most urgent</option>
          </select>
        </label>
      </div>

      {visible.length > 0 ? (
        <ul className="items">
          {visible.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onUseOne={() => changeQty(item.id, -1)}
              onAddOne={() => changeQty(item.id, 1)}
              onRemove={() => remove(item.id)}
            />
          ))}
        </ul>
      ) : (
        <p className="empty">Nothing here.</p>
      )}
    </div>
  )
}
