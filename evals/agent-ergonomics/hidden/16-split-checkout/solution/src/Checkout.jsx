import { ABORT } from 'sygnal'
import CartTable from './CartTable.jsx'
import ShippingForm from './ShippingForm.jsx'
import OrderSummary from './OrderSummary.jsx'
import { CODES, money, amountsOf, itemCountOf, shippingErrors } from './pricing.js'

// The parts are presentational: Checkout passes each one what it shows, and
// each one reports what the user did through PARENT (read here with CHILD.select).
function Checkout({ state }) {
  if (state.placed) {
    return (
      <div className="checkout">
        <h1>Checkout</h1>
        <p className="confirmation">{state.confirmation}</p>
      </div>
    )
  }

  return (
    <div className="checkout">
      <h1>Checkout</h1>
      <div className="checkout-body">
        <CartTable lines={state.lines} />
        <ShippingForm shipping={state.shipping} errors={state.submitted ? shippingErrors(state.shipping) : {}} />
        <OrderSummary
          amounts={amountsOf(state)}
          code={state.discount.applied}
          codeDraft={state.discount.draft}
          codeMessage={state.discount.message}
          canPlace={state.lines.length > 0}
        />
      </div>
    </div>
  )
}

Checkout.initialState = {
  lines: [
    { id: 1, name: 'Notebook', price: 1200, qty: 1 },
    { id: 2, name: 'Fountain pen', price: 2450, qty: 1 },
    { id: 3, name: 'Ink cartridges (5)', price: 650, qty: 2 },
  ],
  shipping: { fullName: '', street: '', city: '', method: 'standard', giftWrap: false },
  discount: { draft: '', applied: null, message: '' },
  submitted: false,
  placed: false,
  confirmation: '',
}

Checkout.intent = ({ CHILD }) => ({
  CART: CHILD.select(CartTable),
  SHIPPING: CHILD.select(ShippingForm),
  SUMMARY: CHILD.select(OrderSummary),
})

const updateLine = (state, id, update) => ({
  ...state,
  lines: state.lines.map((line) => (line.id === id ? update(line) : line)),
})

function applyCode(state) {
  const code = state.discount.draft.trim().toUpperCase()
  if (!code) return ABORT
  if (!CODES[code]) return { ...state, discount: { ...state.discount, applied: null, message: 'Unknown code.' } }
  return { ...state, discount: { draft: '', applied: code, message: `Code ${code} applied.` } }
}

function placeOrder(state) {
  if (state.lines.length === 0) return ABORT
  if (Object.keys(shippingErrors(state.shipping)).length > 0) return { ...state, submitted: true }
  const { total } = amountsOf(state)
  const { fullName, street, city } = state.shipping
  const items = itemCountOf(state.lines)
  return {
    ...state,
    submitted: true,
    placed: true,
    confirmation: `Thanks, ${fullName.trim()}! Your order of ${items} items (${money(total)}) is on its way to ${street.trim()}, ${city.trim()}.`,
  }
}

Checkout.model = {
  CART: (state, { type, id }) => {
    if (type === 'inc') return updateLine(state, id, (line) => ({ ...line, qty: line.qty + 1 }))
    if (type === 'dec') {
      const line = state.lines.find((l) => l.id === id)
      if (!line || line.qty === 1) return ABORT
      return updateLine(state, id, (l) => ({ ...l, qty: l.qty - 1 }))
    }
    return { ...state, lines: state.lines.filter((line) => line.id !== id) }
  },
  SHIPPING: (state, { field, value }) => ({ ...state, shipping: { ...state.shipping, [field]: value } }),
  SUMMARY: (state, action) => {
    if (action.type === 'draft') return { ...state, discount: { ...state.discount, draft: action.value } }
    if (action.type === 'apply') return applyCode(state)
    return placeOrder(state)
  },
}

export default Checkout
