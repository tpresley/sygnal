function CalculatedTest({ state }) {
  return (
    <div>
      <h2>Calculated Fields Test</h2>
      <div>
        <p>Price: ${state.price} | Quantity: {state.quantity}</p>
        <p>Subtotal (deps: price, quantity): ${state.subtotal}</p>
        <p>Tax (deps: subtotal): ${state.tax}</p>
        <p>Total (deps: subtotal, tax): ${state.total}</p>
        <p>Label (no deps): {state.label}</p>
        <button className="inc-price">Price +1</button>
        <button className="inc-qty">Qty +1</button>
      </div>
    </div>
  )
}

CalculatedTest.initialState = {
  price: 10,
  quantity: 2,
}

CalculatedTest.intent = ({ DOM }) => ({
  INC_PRICE: DOM.select('.inc-price').events('click'),
  INC_QTY:   DOM.select('.inc-qty').events('click'),
})

CalculatedTest.model = {
  INC_PRICE: (state) => ({ ...state, price: state.price + 1 }),
  INC_QTY:   (state) => ({ ...state, quantity: state.quantity + 1 }),
}

// Test calculated fields:
// - subtotal: uses deps array, depends on base state keys
// - tax: uses deps array, depends on another calculated field (subtotal)
// - total: uses deps array, depends on two calculated fields (subtotal, tax)
// - label: plain function (no deps), always recalculates
CalculatedTest.calculated = {
  subtotal: [['price', 'quantity'], (state) => {
    console.log('  [calc] subtotal recalculated')
    return state.price * state.quantity
  }],
  tax: [['subtotal'], (state) => {
    console.log('  [calc] tax recalculated')
    return Math.round(state.subtotal * 0.08 * 100) / 100
  }],
  total: [['subtotal', 'tax'], (state) => {
    console.log('  [calc] total recalculated')
    return state.subtotal + state.tax
  }],
  label: (state) => {
    console.log('  [calc] label recalculated (always)')
    return `${state.quantity}x @ $${state.price}`
  },
}

export default CalculatedTest
