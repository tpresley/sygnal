import Card from './Card'
import type { ListData } from './types'

type ListProps = {
  list: ListData
  onToggle: (cardId: number) => void
  onDelete: (cardId: number) => void
  onMove: (cardId: number, offset: -1 | 1) => void
}

export default function List({ list, onToggle, onDelete, onMove }: ListProps) {
  return (
    <section className="list">
      <h2 className="list-title">
        {list.title} ({list.cards.length})
      </h2>
      {list.cards.length === 0 && <p className="empty">No cards</p>}
      <div className="cards">
        {list.cards.map((card) => (
          <Card
            key={card.id}
            card={card}
            onToggle={() => onToggle(card.id)}
            onDelete={() => onDelete(card.id)}
            onMove={(offset) => onMove(card.id, offset)}
          />
        ))}
      </div>
    </section>
  )
}
