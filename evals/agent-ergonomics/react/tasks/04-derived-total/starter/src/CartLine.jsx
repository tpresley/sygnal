export default function CartLine({ line, onInc, onDec }) {
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
    </div>
  )
}
