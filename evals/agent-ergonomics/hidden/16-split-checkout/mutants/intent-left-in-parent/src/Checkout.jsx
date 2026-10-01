import { ABORT } from 'sygnal'
import CartTable from './CartTable.jsx'
import ShippingForm from './ShippingForm.jsx'
import OrderSummary from './OrderSummary.jsx'
import { amountsOf } from './pricing.js'

// ---------------------------------------------------------------------------
// Pricing helpers (all amounts are in cents)
// ---------------------------------------------------------------------------

const FREE_SHIPPING_FROM = 5000
const SHIPPING_COST = { standard: 500, express: 1500 }
const GIFT_WRAP_COST = 300
const CODES = { SAVE10: 0.1, WELCOME5: 0.05 }

export const money = (cents) => `$${(cents / 100).toFixed(2)}`

const subtotalOf = (lines) => lines.reduce((sum, line) => sum + line.price * line.qty, 0)
const itemCountOf = (lines) => lines.reduce((sum, line) => sum + line.qty, 0)

function shippingCostOf(method, subtotal) {
  if (method === 'standard' && subtotal >= FREE_SHIPPING_FROM) return 0
  return SHIPPING_COST[method]
}

function discountOf(code, subtotal) {
  return code ? Math.round(subtotal * CODES[code]) : 0
}

function shippingErrors(shipping) {
  const errors = {}
  if (!shipping.fullName.trim()) errors.fullName = 'Please enter your name.'
  if (!shipping.street.trim()) errors.street = 'Please enter your street address.'
  if (!shipping.city.trim()) errors.city = 'Please enter your city.'
  return errors
}

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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

Checkout.intent = ({ DOM }) => ({
  // cart
  INC: DOM.click('.inc').data('id', Number),
  DEC: DOM.click('.dec').data('id', Number),
  REMOVE_LINE: DOM.click('.remove-line').data('id', Number),
  // shipping
  SET_FULL_NAME: DOM.input('input[name="fullName"]').value(),
  SET_STREET: DOM.input('input[name="street"]').value(),
  SET_CITY: DOM.input('input[name="city"]').value(),
  SET_METHOD: DOM.change('input[name="method"]').value(),
  SET_GIFT_WRAP: DOM.change('input[name="giftWrap"]').checked(),
  // summary
  SET_CODE_DRAFT: DOM.input('input[name="code"]').value(),
  APPLY_CODE: DOM.click('.apply-code'),
  PLACE_ORDER: DOM.click('.place-order'),
})

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const updateLine = (state, id, update) => ({
  ...state,
  lines: state.lines.map((line) => (line.id === id ? update(line) : line)),
})

const setShipping = (field) => (state, value) => ({ ...state, shipping: { ...state.shipping, [field]: value } })

Checkout.model = {
  INC: (state, id) => updateLine(state, id, (line) => ({ ...line, qty: line.qty + 1 })),
  DEC: (state, id) => {
    const line = state.lines.find((l) => l.id === id)
    if (!line || line.qty === 1) return ABORT
    return updateLine(state, id, (l) => ({ ...l, qty: l.qty - 1 }))
  },
  REMOVE_LINE: (state, id) => ({ ...state, lines: state.lines.filter((line) => line.id !== id) }),

  SET_FULL_NAME: setShipping('fullName'),
  SET_STREET: setShipping('street'),
  SET_CITY: setShipping('city'),
  SET_METHOD: setShipping('method'),
  SET_GIFT_WRAP: setShipping('giftWrap'),

  SET_CODE_DRAFT: (state, draft) => ({ ...state, discount: { ...state.discount, draft } }),
  APPLY_CODE: (state) => {
    const code = state.discount.draft.trim().toUpperCase()
    if (!code) return ABORT
    if (!CODES[code]) return { ...state, discount: { ...state.discount, applied: null, message: 'Unknown code.' } }
    return { ...state, discount: { draft: '', applied: code, message: `Code ${code} applied.` } }
  },
  PLACE_ORDER: (state) => {
    if (state.lines.length === 0) return ABORT
    const errors = shippingErrors(state.shipping)
    if (Object.keys(errors).length > 0) return { ...state, submitted: true }
    const subtotal = subtotalOf(state.lines)
    const total =
      subtotal -
      discountOf(state.discount.applied, subtotal) +
      shippingCostOf(state.shipping.method, subtotal) +
      (state.shipping.giftWrap ? GIFT_WRAP_COST : 0)
    const { fullName, street, city } = state.shipping
    const items = itemCountOf(state.lines)
    return {
      ...state,
      submitted: true,
      placed: true,
      confirmation: `Thanks, ${fullName.trim()}! Your order of ${items} items (${money(total)}) is on its way to ${street.trim()}, ${city.trim()}.`,
    }
  },
}

export default Checkout
