import { event } from 'sygnal'
export default function Header({ context }) {
  return (
    <header>
      <button className="logo">Shop</button>
      <button className="cart-link">Cart ({context.cartCount})</button>
    </header>
  )
}
Header.intent = ({ DOM }) => ({
  HOME: DOM.click('.logo'),
  CART: DOM.click('.cart-link'),
  SEARCH: DOM.input('.search'),
})
Header.model = {
  HOME: { EVENTS: event('NAVIGATE', () => 'shop') },
  CART: { EVENTS: event('NAVIGATE', () => 'cart') },
  SEARCH: { EVENTS: event('SEARCH', (_, e) => e.target.value) },
}
