import { event } from 'sygnal'
import Summary from './checkout/Summary.jsx'
export default function Checkout({ state, context }) {
  return (
    <form className="checkout-form">
      <input className="email" />
      <button className="pay">Pay</button>
      <button className="back">Back</button>
      <Summary />
    </form>
  )
}
Checkout.initialState = { email: '', paying: false }
Checkout.intent = ({ DOM }) => ({
  EMAIL: DOM.input('.email'),
  PAY: DOM.click('.pay'),
  BACK: DOM.click('.back'),
})
Checkout.model = {
  EMAIL: (state, e) => ({ ...state, email: e.target.value }),
  PAY: { STATE: state => ({ ...state, paying: true }), HTTP: state => ({ url: '/api/pay', method: 'POST', send: { email: state.email } }) },
  BACK: { EVENTS: event('NAVIGATE', () => 'cart') },
  PAID: { EVENTS: event('NAVIGATE', () => 'shop') },
}
Checkout.agent = {
  name: 'checkout',
  description: 'Fill and submit the checkout form',
  actions: { EMAIL: { input: { type: 'string' } }, PAY: { consequential: true } },
}
