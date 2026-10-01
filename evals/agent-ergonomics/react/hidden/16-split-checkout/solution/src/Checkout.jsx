import { useState } from 'react'
import CartTable from './CartTable.jsx'
import ShippingForm from './ShippingForm.jsx'
import OrderSummary from './OrderSummary.jsx'
import { CODES, money, amountsOf, itemCountOf, shippingErrors } from './pricing.js'

const INITIAL_LINES = [
  { id: 1, name: 'Notebook', price: 1200, qty: 1 },
  { id: 2, name: 'Fountain pen', price: 2450, qty: 1 },
  { id: 3, name: 'Ink cartridges (5)', price: 650, qty: 2 },
]

const INITIAL_SHIPPING = { fullName: '', street: '', city: '', method: 'standard', giftWrap: false }

export default function Checkout() {
  const [lines, setLines] = useState(INITIAL_LINES)
  const [shipping, setShipping] = useState(INITIAL_SHIPPING)
  const [discount, setDiscount] = useState({ draft: '', applied: null, message: '' })
  const [submitted, setSubmitted] = useState(false)
  const [confirmation, setConfirmation] = useState(null)

  const amounts = amountsOf({ lines, shipping, discount })

  const updateLine = (id, update) => setLines((current) => current.map((line) => (line.id === id ? update(line) : line)))

  const applyCode = () => {
    const code = discount.draft.trim().toUpperCase()
    if (!code) return
    if (!CODES[code]) setDiscount({ ...discount, applied: null, message: 'Unknown code.' })
    else setDiscount({ draft: '', applied: code, message: `Code ${code} applied.` })
  }

  const placeOrder = () => {
    if (lines.length === 0) return
    setSubmitted(true)
    if (Object.keys(shippingErrors(shipping)).length > 0) return
    const { fullName, street, city } = shipping
    setConfirmation(
      `Thanks, ${fullName.trim()}! Your order of ${itemCountOf(lines)} items (${money(amounts.total)}) is on its way to ${street.trim()}, ${city.trim()}.`
    )
  }

  if (confirmation) {
    return (
      <div className="checkout">
        <h1>Checkout</h1>
        <p className="confirmation">{confirmation}</p>
      </div>
    )
  }

  return (
    <div className="checkout">
      <h1>Checkout</h1>
      <div className="checkout-body">
        <CartTable
          lines={lines}
          onInc={(id) => updateLine(id, (line) => ({ ...line, qty: line.qty + 1 }))}
          onDec={(id) => updateLine(id, (line) => (line.qty === 1 ? line : { ...line, qty: line.qty - 1 }))}
          onRemove={(id) => setLines((current) => current.filter((line) => line.id !== id))}
        />
        <ShippingForm
          shipping={shipping}
          errors={submitted ? shippingErrors(shipping) : {}}
          onChange={(field, value) => setShipping((current) => ({ ...current, [field]: value }))}
        />
        <OrderSummary
          amounts={amounts}
          code={discount.applied}
          codeDraft={discount.draft}
          codeMessage={discount.message}
          canPlace={lines.length > 0}
          onDraftChange={(draft) => setDiscount((current) => ({ ...current, draft }))}
          onApply={applyCode}
          onPlace={placeOrder}
        />
      </div>
    </div>
  )
}
