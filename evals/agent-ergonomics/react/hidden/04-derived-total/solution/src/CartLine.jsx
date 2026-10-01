export default function CartLine({ line, total, onInc, onDec }) {
  const share = total > 0 ? Math.round((line.price * line.qty * 100) / total) : 0
  return (
    <div className="line">
      <span className="name">{line.name}</span>
      <span className="price">${line.price.toFixed(2)}</span>
      <button className="dec" onClick={onDec}>
        -
      </button>
      <span className="qty">{line.qty}</span>
      <button className="inc" onClick={onInc}>
        +
      </button>
      <span className="share">({share}%)</span>
    </div>
  )
}
