import type { CardData } from './types'

type CardProps = {
  card: CardData
  onToggle: () => void
  onDelete: () => void
}

export default function Card({ card, onToggle, onDelete }: CardProps) {
  return (
    <div className={card.done ? 'card done' : 'card'}>
      <input type="checkbox" className="toggle" checked={card.done} onChange={onToggle} />
      <span className="title">{card.title}</span>
      <button className="delete" onClick={onDelete}>
        Delete
      </button>
    </div>
  )
}
