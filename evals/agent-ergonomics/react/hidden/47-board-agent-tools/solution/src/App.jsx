import { useEffect, useId, useRef, useState } from 'react'
import Card from './Card.jsx'
import { COLUMNS } from './columns.js'
import { boardTools, exposeTools } from './agentTools.js'

const SEED = [
  { id: 1, title: 'Fix login bug', column: 'todo' },
  { id: 2, title: 'Plan the sprint', column: 'doing' },
  { id: 3, title: 'Old idea', column: 'todo' },
  { id: 4, title: 'Ship v2', column: 'done' },
  { id: 5, title: 'Design review', column: 'todo' },
]

export default function App() {
  const [cards, setCards] = useState(SEED)
  const [title, setTitle] = useState('')
  const [column, setColumn] = useState('todo')
  const [asking, setAsking] = useState(null) // { card, resolve }
  const id = useId()
  const dialogRef = useRef(null)
  // the tools run outside render: they read and change the board through refs
  const cardsRef = useRef(cards)
  const nextIdRef = useRef(6)
  cardsRef.current = cards

  const update = (next) => {
    cardsRef.current = next
    setCards(next)
  }
  const board = {
    cards: () => cardsRef.current.map(({ id: cardId, title: t, column: c }) => ({ id: cardId, title: t, column: c })),
    add: (t, c) => {
      const card = { id: nextIdRef.current++, title: t, column: c }
      update([...cardsRef.current, card])
      return card
    },
    move: (cardId, to) => update(cardsRef.current.map((c) => (c.id === cardId ? { ...c, column: to } : c))),
    remove: (cardId) => update(cardsRef.current.filter((c) => c.id !== cardId)),
    confirm: (card) => new Promise((resolve) => setAsking({ card, resolve })),
  }
  const boardRef = useRef(board)
  boardRef.current = board

  useEffect(() => {
    // the tools call through boardRef, so they always see the current board
    const live = {
      cards: () => boardRef.current.cards(),
      add: (...a) => boardRef.current.add(...a),
      move: (...a) => boardRef.current.move(...a),
      remove: (...a) => boardRef.current.remove(...a),
      confirm: (...a) => boardRef.current.confirm(...a),
    }
    return exposeTools(boardTools(live))
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (asking && dialog && !dialog.open) dialog.showModal()
  }, [asking])

  function answer(allowed) {
    asking?.resolve(allowed)
    setAsking(null)
    dialogRef.current?.close()
  }

  function add(e) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    board.add(trimmed, column)
    setTitle('')
  }

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
                <Card key={card.id} card={card} onMove={(to) => board.move(card.id, to)} onRemove={() => board.remove(card.id)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <dialog ref={dialogRef} aria-labelledby={`${id}-confirm`} onCancel={(e) => { e.preventDefault(); answer(false) }}>
        <p id={`${id}-confirm`}>{asking ? `An AI agent wants to remove the card "${asking.card.title}".` : ''}</p>
        <button type="button" onClick={() => answer(false)}>Deny</button>
        <button type="button" onClick={() => answer(true)}>Allow</button>
      </dialog>
    </main>
  )
}
