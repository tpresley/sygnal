import { useState } from 'react'

const PRODUCTS = ['Notebook', 'Pen set', 'Backpack']

export default function App() {
  const [values, setValues] = useState({ name: '', email: '', zip: '', product: '', quantity: '1', promo: '' })
  const change = (e) => setValues({ ...values, [e.target.name]: e.target.value })

  return (
    <main className="checkout-page">
      <h1>Checkout</h1>
      <form className="checkout" noValidate>
        <div className="field">
          <label htmlFor="name">Full name</label>
          <input id="name" name="name" value={values.name} onChange={change} />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" value={values.email} onChange={change} />
        </div>
        <div className="field">
          <label htmlFor="zip">ZIP code</label>
          <input id="zip" name="zip" inputMode="numeric" value={values.zip} onChange={change} />
        </div>

        <fieldset className="item">
          <legend>Item 1</legend>
          <div className="field">
            <label htmlFor="product">Product</label>
            <select id="product" name="product" value={values.product} onChange={change}>
              <option value="">Choose…</option>
              {PRODUCTS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="quantity">Quantity</label>
            <input id="quantity" name="quantity" type="number" min="1" max="10" value={values.quantity} onChange={change} />
          </div>
          <button type="button" className="remove" disabled>Remove</button>
        </fieldset>
        <button type="button" className="add-item">Add item</button>

        <div className="field">
          <label htmlFor="promo">Promo code</label>
          <input id="promo" name="promo" value={values.promo} onChange={change} />
        </div>
        <button type="submit">Place order</button>
      </form>
      <p className="done"></p>
    </main>
  )
}
