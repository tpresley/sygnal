// Cart.jsx
const PRICE = 4.5

export function Cart({ state, context }) {
  const { t } = context
  return (
    <section>
      <h2>{t('cart.title')}</h2>
      <p className="count">{t('cart.items', { count: state.items })}</p>
      <p className="total">{t('cart.total', { total: state.items * PRICE })}</p>
      <button className="add">{t('cart.add')}</button>
    </section>
  )
}

Cart.intent = ({ DOM }) => ({
  ADD: DOM.click('.add'),
})

Cart.model = {
  ADD: (state) => ({ ...state, items: state.items + 1 }),
}
