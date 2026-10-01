// Pricing helpers (all amounts are in cents), shared by Checkout and its parts.

export const FREE_SHIPPING_FROM = 5000
export const SHIPPING_COST = { standard: 500, express: 1500 }
export const GIFT_WRAP_COST = 300
export const CODES = { SAVE10: 0.1, WELCOME5: 0.05 }

export const money = (cents) => `$${(cents / 100).toFixed(2)}`

export const subtotalOf = (lines) => lines.reduce((sum, line) => sum + line.price * line.qty, 0)
export const itemCountOf = (lines) => lines.reduce((sum, line) => sum + line.qty, 0)

export function shippingCostOf(method, subtotal) {
  if (method === 'standard' && subtotal >= FREE_SHIPPING_FROM) return 0
  return SHIPPING_COST[method]
}

export function discountOf(code, subtotal) {
  return code ? Math.round(subtotal * CODES[code]) : 0
}

export function shippingErrors(shipping) {
  const errors = {}
  if (!shipping.fullName.trim()) errors.fullName = 'Please enter your name.'
  if (!shipping.street.trim()) errors.street = 'Please enter your street address.'
  if (!shipping.city.trim()) errors.city = 'Please enter your city.'
  return errors
}

/** Every amount the summary shows, from the checkout state. */
export function amountsOf(state) {
  const subtotal = subtotalOf(state.lines)
  const shippingCost = shippingCostOf(state.shipping.method, subtotal)
  const discount = discountOf(state.discount.applied, subtotal)
  const giftCost = state.shipping.giftWrap ? GIFT_WRAP_COST : 0
  return { subtotal, shippingCost, discount, giftCost, total: subtotal - discount + shippingCost + giftCost }
}
