function CartLine({ state, context }) {
  const share = context.cartTotal > 0 ? Math.round((state.price * state.qty * 100) / context.cartTotal) : 0
  return (
    <div className="line">
      <span className="name">{state.name}</span>
      <span className="price">${state.price.toFixed(2)}</span>
      <button className="dec">-</button>
      <span className="qty">{state.qty}</span>
      <button className="inc">+</button>
      <span className="share">({share}%)</span>
    </div>
  )
}

CartLine.intent = ({ DOM }) => ({
  INC: DOM.click('.inc'),
  DEC: DOM.click('.dec'),
})

CartLine.model = {
  INC: (state) => ({ ...state, qty: state.qty + 1 }),
  DEC: (state) => ({ ...state, qty: Math.max(1, state.qty - 1) }),
}

export default CartLine
