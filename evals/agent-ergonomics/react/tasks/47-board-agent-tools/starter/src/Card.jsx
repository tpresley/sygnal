import { COLUMNS } from './columns.js'

export default function Card({ card, onMove, onRemove }) {
  return (
    <li className="card">
      <span className="title">{card.title}</span>
      <select className="move" aria-label={`Move ${card.title}`} value={card.column} onChange={(e) => onMove(e.target.value)}>
        {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <button type="button" className="remove" aria-label={`Remove ${card.title}`} onClick={onRemove}>Remove</button>
    </li>
  )
}
