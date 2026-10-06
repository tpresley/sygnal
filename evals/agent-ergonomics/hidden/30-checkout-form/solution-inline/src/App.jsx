import { form } from 'sygnal'
import { z } from 'zod'

const PRODUCTS = ['Notebook', 'Pen set', 'Backpack']
const QUANTITY = 'Enter a quantity from 1 to 10.'

const orderSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.'),
  email: z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.'),
  zip: z.string().trim().regex(/^\d{5}$/, 'Enter a 5-digit ZIP code.'),
  items: z.array(
    z.object({
      product: z.string().min(1, 'Choose a product.'),
      quantity: z.string().trim().regex(/^\d+$/, QUANTITY).transform(Number).refine((n) => n >= 1 && n <= 10, QUANTITY),
    })
  ),
  promo: z.string().trim().refine((s) => s === '' || /^[A-Za-z0-9]{4,12}$/.test(s), 'Promo codes are 4 to 12 letters or digits.'),
})

function App({ state, uid }) {
  const f = state.form.fields
  return (
    <main className="checkout-page">
      <h1>Checkout</h1>
      <form className="checkout" noValidate>
        <div className="field">
          <label for={uid('name')}>Full name</label>
          <input id={uid('name')} name="name" value={f.name.value} aria-invalid={f.name.invalid} aria-describedby={uid('name-error')} />
          <p id={uid('name-error')} className="error">{f.name.error}</p>
        </div>
        <div className="field">
          <label for={uid('email')}>Email</label>
          <input id={uid('email')} name="email" type="email" value={f.email.value} aria-invalid={f.email.invalid} aria-describedby={uid('email-error')} />
          <p id={uid('email-error')} className="error">{f.email.error}</p>
        </div>
        <div className="field">
          <label for={uid('zip')}>ZIP code</label>
          <input id={uid('zip')} name="zip" inputMode="numeric" value={f.zip.value} aria-invalid={f.zip.invalid} aria-describedby={uid('zip-error')} />
          <p id={uid('zip-error')} className="error">{f.zip.error}</p>
        </div>
        {state.form.values.items.map((item, i, items) => {
          const product = f[`items.${item.id}.product`], quantity = f[`items.${item.id}.quantity`]
          return (
            <fieldset className="item">
              <legend>Item {i + 1}</legend>
              <div className="field">
                <label for={uid(`product-${item.id}`)}>Product</label>
                <select id={uid(`product-${item.id}`)} name={product.name} value={product.value} aria-invalid={product.invalid} aria-describedby={uid(`product-${item.id}-error`)}>
                  <option value="">Choose…</option>
                  {PRODUCTS.map((p) => <option value={p}>{p}</option>)}
                </select>
                <p id={uid(`product-${item.id}-error`)} className="error">{product.error}</p>
              </div>
              <div className="field">
                <label for={uid(`quantity-${item.id}`)}>Quantity</label>
                <input id={uid(`quantity-${item.id}`)} name={quantity.name} type="number" min="1" max="10" value={quantity.value} aria-invalid={quantity.invalid} aria-describedby={uid(`quantity-${item.id}-error`)} />
                <p id={uid(`quantity-${item.id}-error`)} className="error">{quantity.error}</p>
              </div>
              <button type="button" className="remove" data-id={item.id} disabled={items.length === 1}>Remove</button>
            </fieldset>
          )
        })}
        <button type="button" className="add-item">Add item</button>
        <div className="field">
          <label for={uid('promo')}>Promo code</label>
          <input id={uid('promo')} name="promo" value={f.promo.value} aria-invalid={f.promo.invalid} aria-describedby={uid('promo-error')} />
          <p id={uid('promo-error')} className="error">{f.promo.error}</p>
        </div>
        <p role="alert">{state.failed ? 'Could not place the order. Try again.' : ''}</p>
        <button type="submit" disabled={state.form.submitting}>{state.form.submitting ? 'Placing order…' : 'Place order'}</button>
      </form>
      <p className="done" role="status">{state.orderId ? `Order ${state.orderId} placed.` : ''}</p>
    </main>
  )
}

App.initialState = { failed: false, orderId: null }

App.uses = {
  form: form(orderSchema, {
    values: { name: '', email: '', zip: '', items: [{ id: 1, product: '', quantity: '1' }], promo: '' },
    submit: 'PLACE',
  }),
}

App.intent = ({ DOM }) => ({
  'form.ADD': DOM.click('.add-item').mapTo({ field: 'items', value: { product: '', quantity: '1' } }),
  'form.REMOVE': DOM.click('.remove').map((e) => ({ field: 'items', id: e.target.dataset.id })),
})

App.model = {
  'form.SUBMIT': (state) => ({ ...state, failed: false }),
  PLACE: { HTTP: (state, values) => ({ url: '/api/orders', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
  'form.DONE': (state, order) => ({ ...state, orderId: order?.id ?? null }),
  'form.ERRORS': (state, reply) => ({ ...state, failed: reply?.status !== 422 }),
}

export default App
