import { useState } from 'react'
import { money, SHIPPING_COST, FREE_SHIPPING_FROM, GIFT_WRAP_COST, shippingErrors } from './pricing.js'

// MUTANT: the form keeps its own "show errors" flag and ignores the errors
// Checkout passes, so "Place order" (in another part) can't make them appear.
export default function ShippingForm({ shipping, onChange }) {
  const [touched] = useState(false)
  const errors = touched ? shippingErrors(shipping) : {}
  return (
    <fieldset className="shipping">
      <legend>Shipping</legend>
      <label className="field">
        <span>Full name</span>
        <input name="fullName" value={shipping.fullName} onChange={(e) => onChange('fullName', e.target.value)} />
      </label>
      {errors.fullName && <p className="error">{errors.fullName}</p>}
      <label className="field">
        <span>Street address</span>
        <input name="street" value={shipping.street} onChange={(e) => onChange('street', e.target.value)} />
      </label>
      {errors.street && <p className="error">{errors.street}</p>}
      <label className="field">
        <span>City</span>
        <input name="city" value={shipping.city} onChange={(e) => onChange('city', e.target.value)} />
      </label>
      {errors.city && <p className="error">{errors.city}</p>}
      <div className="methods">
        <label>
          <input
            type="radio"
            name="method"
            value="standard"
            checked={shipping.method === 'standard'}
            onChange={(e) => onChange('method', e.target.value)}
          />
          {` Standard (${money(SHIPPING_COST.standard)}, free from ${money(FREE_SHIPPING_FROM)})`}
        </label>
        <label>
          <input
            type="radio"
            name="method"
            value="express"
            checked={shipping.method === 'express'}
            onChange={(e) => onChange('method', e.target.value)}
          />
          {` Express (${money(SHIPPING_COST.express)})`}
        </label>
      </div>
      <label className="gift">
        <input
          type="checkbox"
          name="giftWrap"
          checked={shipping.giftWrap}
          onChange={(e) => onChange('giftWrap', e.target.checked)}
        />
        {` Gift wrap (+${money(GIFT_WRAP_COST)})`}
      </label>
    </fieldset>
  )
}
