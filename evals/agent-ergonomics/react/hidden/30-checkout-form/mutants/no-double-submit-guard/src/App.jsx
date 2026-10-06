import { useRef, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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

const errorAt = (errors, name) => name.split('.').reduce((e, k) => e?.[k], errors)

function Field({ id, label, name, register, errors, ...rest }) {
  const error = errorAt(errors, name)?.message
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={error ? 'true' : 'false'} aria-describedby={`${id}-error`} {...register(name)} {...rest} />
      <p id={`${id}-error`} className="error">{error ?? ''}</p>
    </div>
  )
}

export default function App() {
  const { register, control, handleSubmit, setError, setFocus, getValues, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(orderSchema),
    mode: 'onTouched',
    // focus the first invalid field in form order ourselves (RHF's own order follows registration)
    shouldFocusError: false,
    defaultValues: { name: '', email: '', zip: '', items: [{ product: '', quantity: '1' }], promo: '' },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const [failed, setFailed] = useState(false)
  const [orderId, setOrderId] = useState(null)
  const pending = useRef(false)

  const fieldOrder = () => ['name', 'email', 'zip', ...getValues('items').flatMap((_, i) => [`items.${i}.product`, `items.${i}.quantity`]), 'promo']

  const focusFirst = (errs) => {
    const first = fieldOrder().find((n) => errorAt(errs, n))
    if (first) setFocus(first)
  }

  const place = async (values) => {
    pending.current = true
    setFailed(false)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        setOrderId(body?.id ?? null)
      } else if (res.status === 422 && Array.isArray(body?.errors)) {
        const names = body.errors.map((issue) => {
          const name = issue.path.join('.')
          setError(name, { type: 'server', message: issue.message })
          return name
        })
        const first = fieldOrder().find((n) => names.includes(n))
        if (first) setTimeout(() => setFocus(first), 0)
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    } finally {
      pending.current = false
    }
  }

  const submitting = isSubmitting

  return (
    <main className="checkout-page">
      <h1>Checkout</h1>
      <form className="checkout" noValidate onSubmit={(e) => {
        setFailed(false)
        return handleSubmit(place, focusFirst)(e)
      }}>
        <Field id="name" label="Full name" name="name" register={register} errors={errors} />
        <Field id="email" label="Email" name="email" type="email" register={register} errors={errors} />
        <Field id="zip" label="ZIP code" name="zip" inputMode="numeric" register={register} errors={errors} />

        {fields.map((item, index) => {
          const productError = errors.items?.[index]?.product?.message
          const quantityError = errors.items?.[index]?.quantity?.message
          const id = `item-${item.id}`
          return (
            <fieldset className="item" key={item.id}>
              <legend>Item {index + 1}</legend>
              <div className="field">
                <label htmlFor={`${id}-product`}>Product</label>
                <select id={`${id}-product`} aria-invalid={productError ? 'true' : 'false'} aria-describedby={`${id}-product-error`} {...register(`items.${index}.product`)}>
                  <option value="">Choose…</option>
                  {PRODUCTS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <p id={`${id}-product-error`} className="error">{productError ?? ''}</p>
              </div>
              <div className="field">
                <label htmlFor={`${id}-quantity`}>Quantity</label>
                <input id={`${id}-quantity`} type="number" min="1" max="10" aria-invalid={quantityError ? 'true' : 'false'} aria-describedby={`${id}-quantity-error`} {...register(`items.${index}.quantity`)} />
                <p id={`${id}-quantity-error`} className="error">{quantityError ?? ''}</p>
              </div>
              <button type="button" className="remove" disabled={fields.length === 1} onClick={() => remove(index)}>Remove</button>
            </fieldset>
          )
        })}
        <button type="button" className="add-item" onClick={() => append({ product: '', quantity: '1' }, { shouldFocus: false })}>Add item</button>

        <Field id="promo" label="Promo code" name="promo" register={register} errors={errors} />
        <p role="alert">{failed ? 'Could not place the order. Try again.' : ''}</p>
        <button type="submit" disabled={submitting}>{submitting ? 'Placing order…' : 'Place order'}</button>
      </form>
      <p className="done" role="status">{orderId ? `Order ${orderId} placed.` : ''}</p>
    </main>
  )
}
