import Card from './Card.jsx'

export default function List({ list, onToggle, onDelete, onMove }) {
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
