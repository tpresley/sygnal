import { event, Collection } from 'sygnal'
import CartLine from './CartLine.jsx'
import Summary from './cart/Summary.jsx'
export default function Cart({ state, context }) {
  return (
    <section>
      <Collection of={CartLine} from="cart" />
      <p>Total in {context.currency}</p>
      <button className="checkout">Checkout</button>
      <Summary />
    </section>
  )
}
// PLAN-10 A-5: CHILD.select(CartLine) receives CartLine's PARENT sink
Cart.intent = ({ DOM, CHILD }) => ({
  CHECKOUT: DOM.click('.checkout'),
  LINE_QTY: CHILD.select(CartLine).map(id => id),
})
Cart.model = {
  CHECKOUT: { EVENTS: event('NAVIGATE', () => 'checkout') },
  LINE_QTY: (state) => state,
}
