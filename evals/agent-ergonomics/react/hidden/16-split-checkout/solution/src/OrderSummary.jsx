import { money } from './pricing.js'

export default function OrderSummary({ amounts, code, codeDraft, codeMessage, canPlace, onDraftChange, onApply, onPlace }) {
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
        <input name="code" placeholder="Discount code" value={codeDraft} onChange={(e) => onDraftChange(e.target.value)} />
        <button className="apply-code" onClick={onApply}>
          Apply
        </button>
      </div>
      {codeMessage && <p className="code-message">{codeMessage}</p>}
      <button className="place-order" disabled={!canPlace} onClick={onPlace}>
        Place order
      </button>
    </section>
  )
}
