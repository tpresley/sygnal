import { event, Collection } from 'sygnal'
import CartLine from './CartLine.jsx'
export default function Cart({ state, context }) {
  return (
    <section>
      <Collection of={CartLine} from="cart" />
      <p>Total in {context.currency}</p>
      <button className="checkout">Checkout</button>
    </section>
  )
}
Cart.intent = ({ DOM }) => ({ CHECKOUT: DOM.click('.checkout') })
Cart.model = { CHECKOUT: { EVENTS: event('NAVIGATE', () => 'checkout') } }
