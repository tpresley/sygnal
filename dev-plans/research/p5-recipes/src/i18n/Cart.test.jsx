// Cart.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Cart } from './Cart.jsx'
import { translator } from './i18n.js'

// a test root that gives Cart the context the app would
function InFrench() {
  return <Cart state="cart" />
}
InFrench.initialState = { cart: { items: 1 } }
InFrench.context = { t: () => translator('fr') }

test('the cart in French', async () => {
  const t = renderComponent(InFrench)
  await t.ready()
  expect(t.query('.count').textContent).toBe('1 article')
  t.simulateEvent('.add', 'click')
  await t.next((state) => state.cart.items === 2)
  expect(t.query('.count').textContent).toBe('2 articles')
  t.dispose()
})
