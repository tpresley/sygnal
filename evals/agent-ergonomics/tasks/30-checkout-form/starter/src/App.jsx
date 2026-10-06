const PRODUCTS = ['Notebook', 'Pen set', 'Backpack']

function App({ state }) {
  return (
    <main className="checkout-page">
      <h1>Checkout</h1>
      <form className="checkout" noValidate>
        <div className="field">
          <label for="name">Full name</label>
          <input id="name" name="name" value={state.name} />
        </div>
        <div className="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" value={state.email} />
        </div>
        <div className="field">
          <label for="zip">ZIP code</label>
          <input id="zip" name="zip" inputMode="numeric" value={state.zip} />
        </div>

        <fieldset className="item">
          <legend>Item 1</legend>
          <div className="field">
            <label for="product">Product</label>
            <select id="product" name="product" value={state.product}>
              <option value="">Choose…</option>
              {PRODUCTS.map((p) => <option value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field">
            <label for="quantity">Quantity</label>
            <input id="quantity" name="quantity" type="number" min="1" max="10" value={state.quantity} />
          </div>
          <button type="button" className="remove" disabled>Remove</button>
        </fieldset>
        <button type="button" className="add-item">Add item</button>

        <div className="field">
          <label for="promo">Promo code</label>
          <input id="promo" name="promo" value={state.promo} />
        </div>
        <button type="submit">Place order</button>
      </form>
      <p className="done"></p>
    </main>
  )
}

App.initialState = {
  name: '',
  email: '',
  zip: '',
  product: '',
  quantity: '1',
  promo: '',
}

App.intent = ({ DOM }) => ({
  CHANGE: DOM.input('.checkout').map((e) => ({ name: e.target.name, value: e.target.value })),
})

App.model = {
  CHANGE: (state, { name, value }) => ({ ...state, [name]: value }),
}

export default App
