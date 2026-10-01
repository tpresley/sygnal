import { ABORT } from 'sygnal'

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

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function Checkout({ state }) {
  const { lines, shipping, discount } = state

  if (state.placed) {
    return (
      <div className="checkout">
        <h1>Checkout</h1>
        <p className="confirmation">{state.confirmation}</p>
      </div>
    )
  }

  const subtotal = subtotalOf(lines)
  const shippingCost = shippingCostOf(shipping.method, subtotal)
  const discountAmount = discountOf(discount.applied, subtotal)
  const giftCost = shipping.giftWrap ? GIFT_WRAP_COST : 0
  const total = subtotal - discountAmount + shippingCost + giftCost
  const errors = state.submitted ? shippingErrors(shipping) : {}

  return (
    <div className="checkout">
      <h1>Checkout</h1>
      <div className="checkout-body">
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
                <tr className="line" data={{ id: line.id }}>
                  <td className="item-name">{line.name}</td>
                  <td className="item-price">{money(line.price)}</td>
                  <td className="item-qty">
                    <button className="dec" disabled={line.qty === 1}>
                      −
                    </button>
                    <span className="count">{String(line.qty)}</span>
                    <button className="inc">+</button>
                  </td>
                  <td className="line-total">{money(line.price * line.qty)}</td>
                  <td>
                    <button className="remove-line">Remove</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <fieldset className="shipping">
          <legend>Shipping</legend>
          <label className="field">
            <span>Full name</span>
            <input name="fullName" value={shipping.fullName} />
          </label>
          {errors.fullName && <p className="error">{errors.fullName}</p>}
          <label className="field">
            <span>Street address</span>
            <input name="street" value={shipping.street} />
          </label>
          {errors.street && <p className="error">{errors.street}</p>}
          <label className="field">
            <span>City</span>
            <input name="city" value={shipping.city} />
          </label>
          {errors.city && <p className="error">{errors.city}</p>}
          <div className="methods">
            <label>
              <input type="radio" name="method" value="standard" checked={shipping.method === 'standard'} />
              {` Standard (${money(SHIPPING_COST.standard)}, free from ${money(FREE_SHIPPING_FROM)})`}
            </label>
            <label>
              <input type="radio" name="method" value="express" checked={shipping.method === 'express'} />
              {` Express (${money(SHIPPING_COST.express)})`}
            </label>
          </div>
          <label className="gift">
            <input type="checkbox" name="giftWrap" checked={shipping.giftWrap} />
            {` Gift wrap (+${money(GIFT_WRAP_COST)})`}
          </label>
        </fieldset>

        <section className="summary">
          <h2>Order summary</h2>
          <dl className="amounts">
            <dt>Subtotal</dt>
            <dd className="subtotal">{money(subtotal)}</dd>
            <dt>Shipping</dt>
            <dd className="shipping-cost">{shippingCost === 0 ? 'Free' : money(shippingCost)}</dd>
            {giftCost > 0 && <dt>Gift wrap</dt>}
            {giftCost > 0 && <dd className="gift-cost">{money(giftCost)}</dd>}
            {discountAmount > 0 && <dt>{`Discount (${discount.applied})`}</dt>}
            {discountAmount > 0 && <dd className="discount">{`−${money(discountAmount)}`}</dd>}
            <dt>Total</dt>
            <dd className="total">{money(total)}</dd>
          </dl>
          <div className="code">
            <input name="code" placeholder="Discount code" value={discount.draft} />
            <button className="apply-code">Apply</button>
          </div>
          {discount.message && <p className="code-message">{discount.message}</p>}
          <button className="place-order" disabled={lines.length === 0}>
            Place order
          </button>
        </section>
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
