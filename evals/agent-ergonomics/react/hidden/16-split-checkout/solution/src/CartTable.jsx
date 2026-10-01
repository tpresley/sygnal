import { money } from './pricing.js'

export default function CartTable({ lines, onInc, onDec, onRemove }) {
  return (
    <table className="cart">
      <thead>
        <tr>
          <th>Item</th>
          <th>Price</th>
          <th>Qty</th>
          <th>Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 ? (
          <tr className="empty-row">
            <td colSpan="5">Your cart is empty.</td>
          </tr>
        ) : (
          lines.map((line) => (
            <tr key={line.id} className="line" data-id={line.id}>
              <td className="item-name">{line.name}</td>
              <td className="item-price">{money(line.price)}</td>
              <td className="item-qty">
                <button className="dec" disabled={line.qty === 1} onClick={() => onDec(line.id)}>
                  −
                </button>
                <span className="count">{String(line.qty)}</span>
                <button className="inc" onClick={() => onInc(line.id)}>
                  +
                </button>
              </td>
              <td className="line-total">{money(line.price * line.qty)}</td>
              <td>
                <button className="remove-line" onClick={() => onRemove(line.id)}>
                  Remove
                </button>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
