// Task 30's second Sygnal reference: the F-1 "helpers" shape (PLAN-5 P5-Q5 A/B, arm B), with the
// form's actions written by hand over formErrors / setField / checkForm / replyErrors / focusInvalid
// instead of the `form` behavior. verify.mjs checks it like the main solution (alt:helpers).
import { ABORT, Collection, checkForm, focusInvalid, formErrors, replyErrors, setField } from 'sygnal'
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

/** The message a field shows: a server error at once, a schema error once touched or submitted. */
const messages = (state) => {
  const errors = formErrors(orderSchema, state.values)
  const out = {}
  for (const name of Object.keys(errors)) if (state.submitted || state.touched[name]) out[name] = errors[name]
  return { ...out, ...state.server }
}

function Item({ state, shown, order, uid }) {
  const product = `items.${state.id}.product`
  const quantity = `items.${state.id}.quantity`
  return (
    <fieldset className="item">
      <legend>Item {order.indexOf(state.id) + 1}</legend>
      <div className="field">
        <label for={uid('product')}>Product</label>
        <select id={uid('product')} name={product} value={state.product} aria-invalid={String(!!shown[product])} aria-describedby={uid('product-error')}>
          <option value="">Choose…</option>
          {PRODUCTS.map((p) => <option value={p}>{p}</option>)}
        </select>
        <p id={uid('product-error')} className="error">{shown[product] ?? ''}</p>
      </div>
      <div className="field">
        <label for={uid('quantity')}>Quantity</label>
        <input id={uid('quantity')} name={quantity} type="number" min="1" max="10" value={state.quantity} aria-invalid={String(!!shown[quantity])} aria-describedby={uid('quantity-error')} />
        <p id={uid('quantity-error')} className="error">{shown[quantity] ?? ''}</p>
      </div>
      <button type="button" className="remove" disabled={order.length === 1}>Remove</button>
    </fieldset>
  )
}

Item.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
Item.model = { REMOVE: { PARENT: (state) => state.id } }

function App({ state, uid }) {
  const shown = messages(state)
  const text = (name, label, extra = {}) => (
    <div className="field">
      <label for={uid(name)}>{label}</label>
      <input id={uid(name)} name={name} value={state.values[name]} aria-invalid={String(!!shown[name])} aria-describedby={uid(`${name}-error`)} {...extra} />
      <p id={uid(`${name}-error`)} className="error">{shown[name] ?? ''}</p>
    </div>
  )
  return (
    <main className="checkout-page">
      <h1>Checkout</h1>
      <form className="checkout" noValidate>
        {text('name', 'Full name')}
        {text('email', 'Email', { type: 'email' })}
        {text('zip', 'ZIP code', { inputMode: 'numeric' })}
        <Collection of={Item} from={{ get: (s) => s.values.items }} shown={shown} order={state.values.items.map((i) => i.id)} />
        <button type="button" className="add-item">Add item</button>
        {text('promo', 'Promo code')}
        <p role="alert">{state.failed ? 'Could not place the order. Try again.' : ''}</p>
        <button type="submit" disabled={state.submitting}>{state.submitting ? 'Placing order…' : 'Place order'}</button>
      </form>
      <p className="done" role="status">{state.orderId ? `Order ${state.orderId} placed.` : ''}</p>
    </main>
  )
}

App.initialState = {
  values: { name: '', email: '', zip: '', items: [{ id: 1, product: '', quantity: '1' }], promo: '' },
  nextId: 2,
  touched: {},
  server: {},
  submitted: false,
  submitting: false,
  failed: false,
  orderId: null,
}

App.intent = ({ DOM, CHILD }) => {
  const form = DOM.select('.checkout')
  return {
    CHANGE: form.events('input').filter((e) => e.target.name).map((e) => ({ name: e.target.name, value: e.target.value })),
    BLUR: form.events('focusout').map((e) => e.target.name).filter(Boolean),
    SUBMIT: form.events('submit', { preventDefault: true }),
    ADD: DOM.click('.add-item'),
    REMOVE: CHILD.select(Item),
  }
}

const valid = (state) => Object.keys(formErrors(orderSchema, state.values)).length === 0

App.model = {
  CHANGE: (state, { name, value }) => {
    const { [name]: _cleared, ...server } = state.server
    return { ...state, values: setField(state.values, name, value), server }
  },
  BLUR: (state, name) => ({ ...state, touched: { ...state.touched, [name]: true } }),
  ADD: (state) => ({
    ...state,
    nextId: state.nextId + 1,
    values: { ...state.values, items: [...state.values.items, { id: state.nextId, product: '', quantity: '1' }] },
  }),
  REMOVE: (state, id) => ({ ...state, values: { ...state.values, items: state.values.items.filter((i) => i.id !== id) } }),
  SUBMIT: {
    STATE: (state) => (state.submitting ? ABORT : { ...state, submitted: true, failed: false, submitting: valid(state) }),
    ELEMENT: (state) => (state.submitting ? ABORT : focusInvalid(formErrors(orderSchema, state.values), '.checkout')),
    HTTP: (state) =>
      state.submitting || !valid(state)
        ? ABORT
        : { url: '/api/orders', method: 'POST', json: checkForm(orderSchema, state.values).value, ok: 'PLACED', error: 'REFUSED' },
  },
  PLACED: (state, order) => ({ ...state, submitting: false, orderId: order?.id ?? null }),
  REFUSED: {
    STATE: (state, reply) =>
      reply?.status === 422 ? { ...state, submitting: false, server: replyErrors(reply, state.values) } : { ...state, submitting: false, failed: true },
    ELEMENT: (state, reply) => (reply?.status === 422 ? focusInvalid(replyErrors(reply, state.values), '.checkout') : ABORT),
  },
}

export default App
