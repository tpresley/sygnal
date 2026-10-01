export default function Card({ card, onToggle, onDelete }) {
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
