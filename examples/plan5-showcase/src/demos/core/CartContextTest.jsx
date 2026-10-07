// renderComponent(C, { context }): the context a component's ancestors would give it, so a
// child can be tested alone (D214). Shown as code only: this file is a Vitest test.
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'

const translator = (lang) => (key) => ({ fr: { items: 'articles', checkout: 'Payer' } }[lang]?.[key] ?? key)

// in the app, an ancestor provides `t` through .context
function Cart({ state, context }) {
  return (
    <div>
      <p className="count">{state.items} {context.t('items')}</p>
      <button className="checkout">{context.t('checkout')}</button>
    </div>
  )
}
Cart.initialState = { items: 0 }

it('renders with the context its ancestors would give it', async () => {
  const t = renderComponent(Cart, { initialState: { items: 2 }, context: { t: translator('fr') } })
  await t.ready()
  expect(t.query('.count').textContent).toBe('2 articles')
  expect(t.query('.checkout').textContent).toBe('Payer')
  t.dispose()
})
