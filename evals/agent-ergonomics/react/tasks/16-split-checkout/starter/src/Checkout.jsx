import { useState } from 'react'

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

const INITIAL_LINES = [
  { id: 1, name: 'Notebook', price: 1200, qty: 1 },
  { id: 2, name: 'Fountain pen', price: 2450, qty: 1 },
  { id: 3, name: 'Ink cartridges (5)', price: 650, qty: 2 },
]

const INITIAL_SHIPPING = { fullName: '', street: '', city: '', method: 'standard', giftWrap: false }

export default function Checkout() {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [lines, setLines] = useState(INITIAL_LINES)
  const [shipping, setShipping] = useState(INITIAL_SHIPPING)
  const [discount, setDiscount] = useState({ draft: '', applied: null, message: '' })
  const [submitted, setSubmitted] = useState(false)
  const [confirmation, setConfirmation] = useState(null)

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------
  const subtotal = subtotalOf(lines)
  const shippingCost = shippingCostOf(shipping.method, subtotal)
  const discountAmount = discountOf(discount.applied, subtotal)
  const giftCost = shipping.giftWrap ? GIFT_WRAP_COST : 0
  const total = subtotal - discountAmount + shippingCost + giftCost
  const errors = submitted ? shippingErrors(shipping) : {}

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  const updateLine = (id, update) => setLines((current) => current.map((line) => (line.id === id ? update(line) : line)))
  const inc = (id) => updateLine(id, (line) => ({ ...line, qty: line.qty + 1 }))
  const dec = (id) => updateLine(id, (line) => (line.qty === 1 ? line : { ...line, qty: line.qty - 1 }))
  const removeLine = (id) => setLines((current) => current.filter((line) => line.id !== id))

  const setShippingField = (field) => (value) => setShipping((current) => ({ ...current, [field]: value }))

  const applyCode = () => {
    const code = discount.draft.trim().toUpperCase()
    if (!code) return
    if (!CODES[code]) setDiscount({ ...discount, applied: null, message: 'Unknown code.' })
    else setDiscount({ draft: '', applied: code, message: `Code ${code} applied.` })
  }

  const placeOrder = () => {
    if (lines.length === 0) return
    setSubmitted(true)
    if (Object.keys(shippingErrors(shipping)).length > 0) return
    const { fullName, street, city } = shipping
    const items = itemCountOf(lines)
    setConfirmation(
      `Thanks, ${fullName.trim()}! Your order of ${items} items (${money(total)}) is on its way to ${street.trim()}, ${city.trim()}.`
    )
  }

  // -------------------------------------------------------------------------
  // View
  // -------------------------------------------------------------------------
  if (confirmation) {
    return (
      <div className="checkout">
        <h1>Checkout</h1>
        <p className="confirmation">{confirmation}</p>
      </div>
    )
  }

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
                <tr key={line.id} className="line" data-id={line.id}>
                  <td className="item-name">{line.name}</td>
                  <td className="item-price">{money(line.price)}</td>
                  <td className="item-qty">
                    <button className="dec" disabled={line.qty === 1} onClick={() => dec(line.id)}>
                      −
                    </button>
                    <span className="count">{String(line.qty)}</span>
                    <button className="inc" onClick={() => inc(line.id)}>
                      +
                    </button>
                  </td>
                  <td className="line-total">{money(line.price * line.qty)}</td>
                  <td>
                    <button className="remove-line" onClick={() => removeLine(line.id)}>
                      Remove
                    </button>
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
            <input name="fullName" value={shipping.fullName} onChange={(e) => setShippingField('fullName')(e.target.value)} />
          </label>
          {errors.fullName && <p className="error">{errors.fullName}</p>}
          <label className="field">
            <span>Street address</span>
            <input name="street" value={shipping.street} onChange={(e) => setShippingField('street')(e.target.value)} />
          </label>
          {errors.street && <p className="error">{errors.street}</p>}
          <label className="field">
            <span>City</span>
            <input name="city" value={shipping.city} onChange={(e) => setShippingField('city')(e.target.value)} />
          </label>
          {errors.city && <p className="error">{errors.city}</p>}
          <div className="methods">
            <label>
              <input
                type="radio"
                name="method"
                value="standard"
                checked={shipping.method === 'standard'}
                onChange={(e) => setShippingField('method')(e.target.value)}
              />
              {` Standard (${money(SHIPPING_COST.standard)}, free from ${money(FREE_SHIPPING_FROM)})`}
            </label>
            <label>
              <input
                type="radio"
                name="method"
                value="express"
                checked={shipping.method === 'express'}
                onChange={(e) => setShippingField('method')(e.target.value)}
              />
              {` Express (${money(SHIPPING_COST.express)})`}
            </label>
          </div>
          <label className="gift">
            <input
              type="checkbox"
              name="giftWrap"
              checked={shipping.giftWrap}
              onChange={(e) => setShippingField('giftWrap')(e.target.checked)}
            />
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
            <input
              name="code"
              placeholder="Discount code"
              value={discount.draft}
              onChange={(e) => setDiscount({ ...discount, draft: e.target.value })}
            />
            <button className="apply-code" onClick={applyCode}>
              Apply
            </button>
          </div>
          {discount.message && <p className="code-message">{discount.message}</p>}
          <button className="place-order" disabled={lines.length === 0} onClick={placeOrder}>
            Place order
          </button>
        </section>
      </div>
    </div>
  )
}
