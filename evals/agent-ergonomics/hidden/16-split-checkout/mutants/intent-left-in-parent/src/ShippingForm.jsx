// MUTANT: markup moved into the part, but its events are still selected in Checkout.
import { money, SHIPPING_COST, FREE_SHIPPING_FROM, GIFT_WRAP_COST } from './pricing.js'

// Props: shipping (the field values), errors (the messages to show).
// Reports { field, value } to the parent for every edit.
function ShippingForm({ shipping, errors }) {
  return (
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
  )
}




export default ShippingForm
