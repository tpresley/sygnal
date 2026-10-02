import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mountApp, waitFor, textOf, click, typeInto, setChecked, sleep, bodyText, stripComments } from './dom.js'

// ---------------------------------------------------------------------------
// Source layout checks (the hidden suite runs with cwd = the app root)
// ---------------------------------------------------------------------------

const src = (file) => path.resolve(process.cwd(), 'src', file)
const read = (file) => fs.readFileSync(src(file), 'utf8')
// Source minus comments: a comment mentioning "Place order" doesn't render it (G-124).
const code = (file) => stripComments(read(file))
const PARTS = ['CartTable', 'ShippingForm', 'OrderSummary']
const importsOf = (code) => [...code.matchAll(/from\s+['"]\.\/([A-Za-z]+)(\.jsx?)?['"]/g)].map((m) => m[1])

// ---------------------------------------------------------------------------
// Markup normalizer: tag + sorted attributes (minus value/checked/disabled,
// whose live state is read from the DOM properties instead), merged and
// whitespace-collapsed text. Both arms render the same normalized markup.
// ---------------------------------------------------------------------------

function normalize(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const tag = node.tagName.toLowerCase()
  const skip = new Set(['value', 'checked', 'disabled', 'selected'])
  const attrs = [...node.attributes]
    .filter((a) => !skip.has(a.name))
    .map((a) => `${a.name}="${a.value.replace(/\s+/g, ' ').trim()}"`)
    .sort()
  if (tag === 'input') {
    if (node.type === 'checkbox' || node.type === 'radio') attrs.push(`:checked=${node.checked}`)
    attrs.push(`:value="${node.value}"`)
  }
  if (tag === 'button' || tag === 'input') attrs.push(`:disabled=${node.disabled}`)
  let inner = ''
  let text = ''
  const flush = () => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (t) inner += t
    text = ''
  }
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue
    else if (child.nodeType === Node.ELEMENT_NODE) {
      flush()
      inner += normalize(child)
    }
  }
  flush()
  return `<${[tag, ...attrs].join(' ')}>${inner}</${tag}>`
}

const markup = () => normalize(document.querySelector('.checkout'))

// ---------------------------------------------------------------------------
// Interaction helpers
// ---------------------------------------------------------------------------

const lineRow = (name) => {
  const row = [...document.querySelectorAll('tr.line')].find((tr) => textOf(tr.querySelector('.item-name')) === name)
  if (!row) throw new Error(`No cart line "${name}" in: ${bodyText()}`)
  return row
}
const field = (name) => document.querySelector(`input[name="${name}"]`)
const radio = (value) => document.querySelector(`input[name="method"][value="${value}"]`)
const amount = (cls) => textOf(document.querySelector(`.summary .${cls}`))
const errors = () => [...document.querySelectorAll('.shipping .error')].map((p) => textOf(p))

async function editEverything() {
  await click(lineRow('Notebook').querySelector('.inc'))
  await waitFor(() => expect(amount('subtotal')).toBe('$61.50'))
  await typeInto(field('fullName'), 'Ada Lovelace')
  await setChecked(radio('express'), true)
  await waitFor(() => expect(amount('shipping-cost')).toBe('$15.00'))
  await setChecked(field('giftWrap'), true)
  await waitFor(() => expect(document.querySelector('.summary .gift-cost')).not.toBeNull())
  await typeInto(field('code'), 'save10')
  await click(document.querySelector('.apply-code'))
  await waitFor(() => expect(document.querySelector('.code-message')).not.toBeNull())
}

async function placeOrder() {
  await click(document.querySelector('.place-order'))
}

// ---------------------------------------------------------------------------
// Expected normalized markup, captured from the original single-component app
// ---------------------------------------------------------------------------

const EXPECTED = {
  initial:
    "<div class=\"checkout\"><h1>Checkout</h1><div class=\"checkout-body\"><table class=\"cart\"><thead><tr><th>Item</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr></thead><tbody><tr class=\"line\" data-id=\"1\"><td class=\"item-name\">Notebook</td><td class=\"item-price\">$12.00</td><td class=\"item-qty\"><button class=\"dec\" :disabled=true>−</button><span class=\"count\">1</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$12.00</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr><tr class=\"line\" data-id=\"2\"><td class=\"item-name\">Fountain pen</td><td class=\"item-price\">$24.50</td><td class=\"item-qty\"><button class=\"dec\" :disabled=true>−</button><span class=\"count\">1</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$24.50</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr><tr class=\"line\" data-id=\"3\"><td class=\"item-name\">Ink cartridges (5)</td><td class=\"item-price\">$6.50</td><td class=\"item-qty\"><button class=\"dec\" :disabled=false>−</button><span class=\"count\">2</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$13.00</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr></tbody></table><fieldset class=\"shipping\"><legend>Shipping</legend><label class=\"field\"><span>Full name</span><input name=\"fullName\" :value=\"\" :disabled=false></input></label><label class=\"field\"><span>Street address</span><input name=\"street\" :value=\"\" :disabled=false></input></label><label class=\"field\"><span>City</span><input name=\"city\" :value=\"\" :disabled=false></input></label><div class=\"methods\"><label><input name=\"method\" type=\"radio\" :checked=true :value=\"standard\" :disabled=false></input>Standard ($5.00, free from $50.00)</label><label><input name=\"method\" type=\"radio\" :checked=false :value=\"express\" :disabled=false></input>Express ($15.00)</label></div><label class=\"gift\"><input name=\"giftWrap\" type=\"checkbox\" :checked=false :value=\"on\" :disabled=false></input>Gift wrap (+$3.00)</label></fieldset><section class=\"summary\"><h2>Order summary</h2><dl class=\"amounts\"><dt>Subtotal</dt><dd class=\"subtotal\">$49.50</dd><dt>Shipping</dt><dd class=\"shipping-cost\">$5.00</dd><dt>Total</dt><dd class=\"total\">$54.50</dd></dl><div class=\"code\"><input name=\"code\" placeholder=\"Discount code\" :value=\"\" :disabled=false></input><button class=\"apply-code\" :disabled=false>Apply</button></div><button class=\"place-order\" :disabled=false>Place order</button></section></div></div>",
  edited:
    "<div class=\"checkout\"><h1>Checkout</h1><div class=\"checkout-body\"><table class=\"cart\"><thead><tr><th>Item</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr></thead><tbody><tr class=\"line\" data-id=\"1\"><td class=\"item-name\">Notebook</td><td class=\"item-price\">$12.00</td><td class=\"item-qty\"><button class=\"dec\" :disabled=false>−</button><span class=\"count\">2</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$24.00</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr><tr class=\"line\" data-id=\"2\"><td class=\"item-name\">Fountain pen</td><td class=\"item-price\">$24.50</td><td class=\"item-qty\"><button class=\"dec\" :disabled=true>−</button><span class=\"count\">1</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$24.50</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr><tr class=\"line\" data-id=\"3\"><td class=\"item-name\">Ink cartridges (5)</td><td class=\"item-price\">$6.50</td><td class=\"item-qty\"><button class=\"dec\" :disabled=false>−</button><span class=\"count\">2</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$13.00</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr></tbody></table><fieldset class=\"shipping\"><legend>Shipping</legend><label class=\"field\"><span>Full name</span><input name=\"fullName\" :value=\"Ada Lovelace\" :disabled=false></input></label><label class=\"field\"><span>Street address</span><input name=\"street\" :value=\"\" :disabled=false></input></label><label class=\"field\"><span>City</span><input name=\"city\" :value=\"\" :disabled=false></input></label><div class=\"methods\"><label><input name=\"method\" type=\"radio\" :checked=false :value=\"standard\" :disabled=false></input>Standard ($5.00, free from $50.00)</label><label><input name=\"method\" type=\"radio\" :checked=true :value=\"express\" :disabled=false></input>Express ($15.00)</label></div><label class=\"gift\"><input name=\"giftWrap\" type=\"checkbox\" :checked=true :value=\"on\" :disabled=false></input>Gift wrap (+$3.00)</label></fieldset><section class=\"summary\"><h2>Order summary</h2><dl class=\"amounts\"><dt>Subtotal</dt><dd class=\"subtotal\">$61.50</dd><dt>Shipping</dt><dd class=\"shipping-cost\">$15.00</dd><dt>Gift wrap</dt><dd class=\"gift-cost\">$3.00</dd><dt>Discount (SAVE10)</dt><dd class=\"discount\">−$6.15</dd><dt>Total</dt><dd class=\"total\">$73.35</dd></dl><div class=\"code\"><input name=\"code\" placeholder=\"Discount code\" :value=\"\" :disabled=false></input><button class=\"apply-code\" :disabled=false>Apply</button></div><p class=\"code-message\">Code SAVE10 applied.</p><button class=\"place-order\" :disabled=false>Place order</button></section></div></div>",
  emptied:
    "<div class=\"checkout\"><h1>Checkout</h1><div class=\"checkout-body\"><table class=\"cart\"><thead><tr><th>Item</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr></thead><tbody><tr class=\"empty-row\"><td colspan=\"5\">Your cart is empty.</td></tr></tbody></table><fieldset class=\"shipping\"><legend>Shipping</legend><label class=\"field\"><span>Full name</span><input name=\"fullName\" :value=\"\" :disabled=false></input></label><label class=\"field\"><span>Street address</span><input name=\"street\" :value=\"\" :disabled=false></input></label><label class=\"field\"><span>City</span><input name=\"city\" :value=\"\" :disabled=false></input></label><div class=\"methods\"><label><input name=\"method\" type=\"radio\" :checked=true :value=\"standard\" :disabled=false></input>Standard ($5.00, free from $50.00)</label><label><input name=\"method\" type=\"radio\" :checked=false :value=\"express\" :disabled=false></input>Express ($15.00)</label></div><label class=\"gift\"><input name=\"giftWrap\" type=\"checkbox\" :checked=false :value=\"on\" :disabled=false></input>Gift wrap (+$3.00)</label></fieldset><section class=\"summary\"><h2>Order summary</h2><dl class=\"amounts\"><dt>Subtotal</dt><dd class=\"subtotal\">$0.00</dd><dt>Shipping</dt><dd class=\"shipping-cost\">$5.00</dd><dt>Total</dt><dd class=\"total\">$5.00</dd></dl><div class=\"code\"><input name=\"code\" placeholder=\"Discount code\" :value=\"\" :disabled=false></input><button class=\"apply-code\" :disabled=false>Apply</button></div><button class=\"place-order\" :disabled=true>Place order</button></section></div></div>",
  errors:
    "<div class=\"checkout\"><h1>Checkout</h1><div class=\"checkout-body\"><table class=\"cart\"><thead><tr><th>Item</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr></thead><tbody><tr class=\"line\" data-id=\"1\"><td class=\"item-name\">Notebook</td><td class=\"item-price\">$12.00</td><td class=\"item-qty\"><button class=\"dec\" :disabled=false>−</button><span class=\"count\">2</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$24.00</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr><tr class=\"line\" data-id=\"2\"><td class=\"item-name\">Fountain pen</td><td class=\"item-price\">$24.50</td><td class=\"item-qty\"><button class=\"dec\" :disabled=true>−</button><span class=\"count\">1</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$24.50</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr><tr class=\"line\" data-id=\"3\"><td class=\"item-name\">Ink cartridges (5)</td><td class=\"item-price\">$6.50</td><td class=\"item-qty\"><button class=\"dec\" :disabled=false>−</button><span class=\"count\">2</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$13.00</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr></tbody></table><fieldset class=\"shipping\"><legend>Shipping</legend><label class=\"field\"><span>Full name</span><input name=\"fullName\" :value=\"Ada Lovelace\" :disabled=false></input></label><label class=\"field\"><span>Street address</span><input name=\"street\" :value=\"\" :disabled=false></input></label><p class=\"error\">Please enter your street address.</p><label class=\"field\"><span>City</span><input name=\"city\" :value=\"\" :disabled=false></input></label><p class=\"error\">Please enter your city.</p><div class=\"methods\"><label><input name=\"method\" type=\"radio\" :checked=false :value=\"standard\" :disabled=false></input>Standard ($5.00, free from $50.00)</label><label><input name=\"method\" type=\"radio\" :checked=true :value=\"express\" :disabled=false></input>Express ($15.00)</label></div><label class=\"gift\"><input name=\"giftWrap\" type=\"checkbox\" :checked=true :value=\"on\" :disabled=false></input>Gift wrap (+$3.00)</label></fieldset><section class=\"summary\"><h2>Order summary</h2><dl class=\"amounts\"><dt>Subtotal</dt><dd class=\"subtotal\">$61.50</dd><dt>Shipping</dt><dd class=\"shipping-cost\">$15.00</dd><dt>Gift wrap</dt><dd class=\"gift-cost\">$3.00</dd><dt>Total</dt><dd class=\"total\">$79.50</dd></dl><div class=\"code\"><input name=\"code\" placeholder=\"Discount code\" :value=\"nope\" :disabled=false></input><button class=\"apply-code\" :disabled=false>Apply</button></div><p class=\"code-message\">Unknown code.</p><button class=\"place-order\" :disabled=false>Place order</button></section></div></div>",
  liveErrors:
    "<div class=\"checkout\"><h1>Checkout</h1><div class=\"checkout-body\"><table class=\"cart\"><thead><tr><th>Item</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr></thead><tbody><tr class=\"line\" data-id=\"1\"><td class=\"item-name\">Notebook</td><td class=\"item-price\">$12.00</td><td class=\"item-qty\"><button class=\"dec\" :disabled=false>−</button><span class=\"count\">2</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$24.00</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr><tr class=\"line\" data-id=\"2\"><td class=\"item-name\">Fountain pen</td><td class=\"item-price\">$24.50</td><td class=\"item-qty\"><button class=\"dec\" :disabled=true>−</button><span class=\"count\">1</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$24.50</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr><tr class=\"line\" data-id=\"3\"><td class=\"item-name\">Ink cartridges (5)</td><td class=\"item-price\">$6.50</td><td class=\"item-qty\"><button class=\"dec\" :disabled=false>−</button><span class=\"count\">2</span><button class=\"inc\" :disabled=false>+</button></td><td class=\"line-total\">$13.00</td><td><button class=\"remove-line\" :disabled=false>Remove</button></td></tr></tbody></table><fieldset class=\"shipping\"><legend>Shipping</legend><label class=\"field\"><span>Full name</span><input name=\"fullName\" :value=\"  \" :disabled=false></input></label><p class=\"error\">Please enter your name.</p><label class=\"field\"><span>Street address</span><input name=\"street\" :value=\"12 Analytical Row\" :disabled=false></input></label><label class=\"field\"><span>City</span><input name=\"city\" :value=\"\" :disabled=false></input></label><p class=\"error\">Please enter your city.</p><div class=\"methods\"><label><input name=\"method\" type=\"radio\" :checked=false :value=\"standard\" :disabled=false></input>Standard ($5.00, free from $50.00)</label><label><input name=\"method\" type=\"radio\" :checked=true :value=\"express\" :disabled=false></input>Express ($15.00)</label></div><label class=\"gift\"><input name=\"giftWrap\" type=\"checkbox\" :checked=true :value=\"on\" :disabled=false></input>Gift wrap (+$3.00)</label></fieldset><section class=\"summary\"><h2>Order summary</h2><dl class=\"amounts\"><dt>Subtotal</dt><dd class=\"subtotal\">$61.50</dd><dt>Shipping</dt><dd class=\"shipping-cost\">$15.00</dd><dt>Gift wrap</dt><dd class=\"gift-cost\">$3.00</dd><dt>Total</dt><dd class=\"total\">$79.50</dd></dl><div class=\"code\"><input name=\"code\" placeholder=\"Discount code\" :value=\"nope\" :disabled=false></input><button class=\"apply-code\" :disabled=false>Apply</button></div><p class=\"code-message\">Unknown code.</p><button class=\"place-order\" :disabled=false>Place order</button></section></div></div>",
  confirmed:
    "<div class=\"checkout\"><h1>Checkout</h1><p class=\"confirmation\">Thanks, Ada Lovelace! Your order of 5 items ($73.35) is on its way to 12 Analytical Row, London.</p></div>",
}

describe('16 refactor: split Checkout into CartTable, ShippingForm and OrderSummary', () => {
  it('has the three new components, each in its own file with a default export', async () => {
    for (const part of PARTS) {
      expect(fs.existsSync(src(`${part}.jsx`)), `src/${part}.jsx exists`).toBe(true)
      const mod = await import(/* @vite-ignore */ src(`${part}.jsx`))
      expect(typeof mod.default, `${part} default export`).toBe('function')
    }
  })

  it('Checkout.jsx composes the parts and no longer renders their markup; the parts do not import each other', () => {
    const checkout = code('Checkout.jsx')
    for (const part of PARTS) {
      expect(importsOf(checkout), `Checkout.jsx imports ${part}`).toContain(part)
      expect(checkout).toMatch(new RegExp(`<${part}\\b`))
    }
    expect(checkout).not.toMatch(/<table\b/)
    expect(checkout).not.toMatch(/<fieldset\b/)
    expect(checkout).not.toContain('Place order')
    expect(checkout).not.toMatch(/<dl\b/)
    expect(code('CartTable.jsx')).toMatch(/<table\b/)
    expect(code('ShippingForm.jsx')).toMatch(/<fieldset\b/)
    expect(code('OrderSummary.jsx')).toContain('Place order')
    for (const part of PARTS) {
      const others = PARTS.filter((p) => p !== part)
      for (const other of others) expect(importsOf(code(`${part}.jsx`)), `${part} imports ${other}`).not.toContain(other)
    }
  })

  it('renders exactly the original markup, before and after editing everything', async () => {
    await mountApp()
    expect(markup()).toBe(EXPECTED.initial)
    await editEverything()
    await sleep(100)
    expect(markup()).toBe(EXPECTED.edited)
  })

  it('cart: quantities, line totals, removing lines, and the empty cart', async () => {
    await mountApp()
    expect(amount('subtotal')).toBe('$49.50')
    expect(amount('shipping-cost')).toBe('$5.00')
    expect(amount('total')).toBe('$54.50')
    expect(lineRow('Notebook').querySelector('.dec').disabled).toBe(true)

    await click(lineRow('Ink cartridges (5)').querySelector('.dec'))
    await waitFor(() => expect(textOf(lineRow('Ink cartridges (5)').querySelector('.line-total'))).toBe('$6.50'))
    expect(lineRow('Ink cartridges (5)').querySelector('.dec').disabled).toBe(true)
    await waitFor(() => expect(amount('subtotal')).toBe('$43.00'))

    await click(lineRow('Fountain pen').querySelector('.inc'))
    await click(lineRow('Fountain pen').querySelector('.inc'))
    await waitFor(() => expect(textOf(lineRow('Fountain pen').querySelector('.count'))).toBe('3'))
    await waitFor(() => expect(amount('subtotal')).toBe('$92.00'))
    expect(amount('shipping-cost')).toBe('Free')
    expect(amount('total')).toBe('$92.00')

    for (const name of ['Notebook', 'Fountain pen', 'Ink cartridges (5)']) {
      await click(lineRow(name).querySelector('.remove-line'))
    }
    await waitFor(() => expect(document.querySelectorAll('tr.line')).toHaveLength(0))
    expect(bodyText()).toContain('Your cart is empty.')
    expect(amount('subtotal')).toBe('$0.00')
    expect(document.querySelector('.place-order').disabled).toBe(true)
    await sleep(50)
    expect(markup()).toBe(EXPECTED.emptied)
  })

  it('summary: shipping method, gift wrap and discount codes', async () => {
    await mountApp()
    await editEverything()
    expect(amount('subtotal')).toBe('$61.50')
    expect(amount('shipping-cost')).toBe('$15.00')
    expect(amount('gift-cost')).toBe('$3.00')
    expect(amount('discount')).toBe('−$6.15')
    expect(amount('total')).toBe('$73.35')
    expect(textOf(document.querySelector('.code-message'))).toBe('Code SAVE10 applied.')
    expect(field('code').value).toBe('')

    await setChecked(radio('standard'), true)
    await waitFor(() => expect(amount('shipping-cost')).toBe('Free'))
    expect(radio('express').checked).toBe(false)
    await setChecked(field('giftWrap'), false)
    await waitFor(() => expect(document.querySelector('.summary .gift-cost')).toBeNull())
    await waitFor(() => expect(amount('total')).toBe('$55.35'))

    await typeInto(field('code'), 'nope')
    await click(document.querySelector('.apply-code'))
    await waitFor(() => expect(textOf(document.querySelector('.code-message'))).toBe('Unknown code.'))
    expect(document.querySelector('.summary .discount')).toBeNull()
    expect(field('code').value).toBe('nope')
    expect(amount('total')).toBe('$61.50')
  })

  it('"Place order" shows the shipping errors, which then follow the fields; markup matches', async () => {
    await mountApp()
    await sleep(50)
    expect(errors()).toEqual([])
    await editEverything()
    await placeOrder()
    await waitFor(() => expect(errors()).toEqual(['Please enter your street address.', 'Please enter your city.']))
    expect(document.querySelector('.confirmation')).toBeNull()
    await typeInto(field('code'), 'nope')
    await click(document.querySelector('.apply-code'))
    await waitFor(() => expect(textOf(document.querySelector('.code-message'))).toBe('Unknown code.'))
    await sleep(50)
    expect(markup()).toBe(EXPECTED.errors)

    await typeInto(field('street'), '12 Analytical Row')
    await waitFor(() => expect(errors()).toEqual(['Please enter your city.']))
    await typeInto(field('fullName'), '  ')
    await waitFor(() => expect(errors()).toEqual(['Please enter your name.', 'Please enter your city.']))
    await sleep(50)
    expect(markup()).toBe(EXPECTED.liveErrors)
  })

  it('a valid order replaces the page with the confirmation', async () => {
    await mountApp()
    await editEverything()
    await typeInto(field('street'), '12 Analytical Row')
    await typeInto(field('city'), 'London')
    await placeOrder()
    await waitFor(() => expect(document.querySelector('.confirmation')).not.toBeNull())
    expect(textOf(document.querySelector('.confirmation'))).toBe(
      'Thanks, Ada Lovelace! Your order of 5 items ($73.35) is on its way to 12 Analytical Row, London.'
    )
    expect(document.querySelector('table')).toBeNull()
    expect(markup()).toBe(EXPECTED.confirmed)
  })
})
