export default function Item({ item, onToggle, onRemove }) {
  return (
    <li className="item">
      <label>
        <input type="checkbox" className="packed" checked={item.packed} onChange={onToggle} /> {item.name}
      </label>
      <span className="quantity">{`×${item.quantity}`}</span>
      <button type="button" className="remove" aria-label={`Remove ${item.name}`} onClick={onRemove}>Remove</button>
    </li>
  )
}
