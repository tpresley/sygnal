export default function Card({ card, onToggle, onDelete, onMove }) {
  return (
    <div className={card.done ? 'card done' : 'card'}>
      <input type="checkbox" className="toggle" checked={card.done} onChange={onToggle} />
      <span className="title">{card.title}</span>
      <button className="prev-list" onClick={() => onMove(-1)}>
        Previous list
      </button>
      <button className="next-list" onClick={() => onMove(1)}>
        Next list
      </button>
      <button className="delete" onClick={onDelete}>
        Delete
      </button>
    </div>
  )
}
