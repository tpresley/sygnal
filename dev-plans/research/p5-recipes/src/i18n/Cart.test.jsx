// Cart.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Cart } from './Cart.jsx'
import { translator } from './i18n.js'

test('the cart in French', async () => {
  // the state and the context the app would give it
  const t = renderComponent(Cart, { initialState: { items: 1 }, context: { t: translator('fr') } })
  await t.ready()
  expect(t.query('.count').textContent).toBe('1 article')
  t.simulateEvent('.add', 'click')
  await t.next((state) => state.items === 2)
  expect(t.query('.count').textContent).toBe('2 articles')
  t.dispose()
})
