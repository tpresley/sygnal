import { useId, useState } from 'react'
import Card from './Card.jsx'
import { COLUMNS } from './columns.js'

const SEED = [
  { id: 1, title: 'Fix login bug', column: 'todo' },
  { id: 2, title: 'Plan the sprint', column: 'doing' },
  { id: 3, title: 'Old idea', column: 'todo' },
  { id: 4, title: 'Ship v2', column: 'done' },
  { id: 5, title: 'Design review', column: 'todo' },
]

export default function App() {
  const [cards, setCards] = useState(SEED)
  const [nextId, setNextId] = useState(6)
  const [title, setTitle] = useState('')
  const [column, setColumn] = useState('todo')
  const id = useId()

  function add(e) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    setCards((all) => [...all, { id: nextId, title: trimmed, column }])
    setNextId((n) => n + 1)
    setTitle('')
  }
  const move = (cardId, to) => setCards((all) => all.map((c) => (c.id === cardId ? { ...c, column: to } : c)))
  const remove = (cardId) => setCards((all) => all.filter((c) => c.id !== cardId))

  return (
    <main className="board-page">
      <header>
        <h1>Team board</h1>
        <p className="card-count">{`${cards.length} cards`}</p>
      </header>
      <form className="add-card" onSubmit={add}>
        <label htmlFor={`${id}-title`}>Title</label>
        <input id={`${id}-title`} name="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor={`${id}-column`}>Column</label>
        <select id={`${id}-column`} name="column" value={column} onChange={(e) => setColumn(e.target.value)}>
          {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button type="submit">Add card</button>
      </form>
      <div className="board">
        {COLUMNS.map((c) => (
          <section key={c.id} className="column" data-column={c.id}>
            <h2>{c.label}</h2>
            <ul className="cards">
              {cards.filter((card) => card.column === c.id).map((card) => (
                <Card key={card.id} card={card} onMove={(to) => move(card.id, to)} onRemove={() => remove(card.id)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  )
}
