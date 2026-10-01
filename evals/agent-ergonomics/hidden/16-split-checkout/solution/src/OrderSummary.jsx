import { xs } from 'sygnal'
import { money } from './pricing.js'

// Props: amounts ({ subtotal, shippingCost, giftCost, discount, total }),
// code (the applied code or null), codeDraft, codeMessage, canPlace.
// Reports { type: 'draft', value } | { type: 'apply' } | { type: 'place' } to the parent.
function OrderSummary({ amounts, code, codeDraft, codeMessage, canPlace }) {
  return (
    <section className="summary">
      <h2>Order summary</h2>
      <dl className="amounts">
        <dt>Subtotal</dt>
        <dd className="subtotal">{money(amounts.subtotal)}</dd>
        <dt>Shipping</dt>
        <dd className="shipping-cost">{amounts.shippingCost === 0 ? 'Free' : money(amounts.shippingCost)}</dd>
        {amounts.giftCost > 0 && <dt>Gift wrap</dt>}
        {amounts.giftCost > 0 && <dd className="gift-cost">{money(amounts.giftCost)}</dd>}
        {amounts.discount > 0 && <dt>{`Discount (${code})`}</dt>}
        {amounts.discount > 0 && <dd className="discount">{`−${money(amounts.discount)}`}</dd>}
        <dt>Total</dt>
        <dd className="total">{money(amounts.total)}</dd>
      </dl>
      <div className="code">
        <input name="code" placeholder="Discount code" value={codeDraft} />
        <button className="apply-code">Apply</button>
      </div>
      {codeMessage && <p className="code-message">{codeMessage}</p>}
      <button className="place-order" disabled={!canPlace}>
        Place order
      </button>
    </section>
  )
}

OrderSummary.intent = ({ DOM }) => ({
  SUMMARY_ACTION: xs.merge(
    DOM.input('input[name="code"]').value((value) => ({ type: 'draft', value })),
    DOM.click('.apply-code').mapTo({ type: 'apply' }),
    DOM.click('.place-order').mapTo({ type: 'place' })
  ),
})

OrderSummary.model = {
  SUMMARY_ACTION: { PARENT: true },
}

export default OrderSummary
