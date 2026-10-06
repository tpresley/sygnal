import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountApp, waitFor, click, typeInto, choose, blur, textOf, getByText, sleep } from './dom.js'

// Real timers. fetch is a fake server whose requests stay pending until the test answers
// them by index (0 = the first request sent). Fields are found by their accessible name,
// so the markup inside the form is the solution's own.

function jsonResponse(body, status = 200) {
  if (typeof Response === 'function') {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

const urlOf = (arg) => String(arg && typeof arg === 'object' && 'url' in arg ? arg.url : arg)
const pathOf = (arg) => new URL(urlOf(arg), 'http://localhost').pathname

function orderServer() {
  const requests = []
  const fn = vi.fn((input, init) => new Promise((resolve, reject) => {
    const fromInput = input && typeof input === 'object' ? input : {}
    const method = String(init?.method ?? fromInput.method ?? 'GET').toUpperCase()
    requests.push({ method, path: pathOf(input), body: init?.body, resolve, reject, settled: false })
  }))
  const settle = async (i, how) => {
    const request = requests[i]
    if (!request) throw new Error(`no request #${i}; sent: ${requests.map((r) => `${r.method} ${r.path}`).join(', ')}`)
    request.settled = true
    how(request)
    await sleep(150)
  }
  return {
    fn,
    count: () => requests.length,
    sent: () => requests.map((r) => `${r.method} ${r.path}`),
    jsonOf: (i) => JSON.parse(requests[i].body),
    reply: (i, status, body) => settle(i, (r) => r.resolve(jsonResponse(body, status))),
    networkError: (i) => settle(i, (r) => r.reject(new TypeError('Failed to fetch'))),
  }
}

let server
let submits = []
const recordSubmit = (e) => submits.push(e)

beforeEach(async () => {
  submits = []
  document.addEventListener('submit', recordSubmit, true)
  server = orderServer()
  vi.stubGlobal('fetch', server.fn)
  await mountApp()
})

afterEach(() => {
  document.removeEventListener('submit', recordSubmit, true)
  for (const e of submits) expect(e.defaultPrevented, 'a form submission was not prevented (page reload)').toBe(true)
  vi.unstubAllGlobals()
})

/** The accessible name: aria-labelledby, else aria-label, else the associated <label>s. */
function accessibleName(el) {
  const by = el.getAttribute('aria-labelledby')
  if (by) return by.trim().split(/\s+/).map((id) => textOf(document.getElementById(id) ?? document.createElement('i'))).join(' ').trim()
  const label = el.getAttribute('aria-label')
  if (label && label.trim()) return label.trim()
  return [...(el.labels ?? [])].map((l) => textOf(l)).join(' ').trim()
}

const form = () => document.querySelector('form.checkout')
const items = () => [...form().querySelectorAll('fieldset.item')]
const legendOf = (item) => textOf(item.querySelector('legend'))

/** The one input/select/textarea inside `root` whose accessible name starts with `label`. */
function field(label, root = form()) {
  const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
  const found = [...root.querySelectorAll('input, select, textarea')].filter((el) => re.test(accessibleName(el)))
  if (root === form()) {
    // top-level fields: not the ones inside items
    const outside = found.filter((el) => !el.closest('fieldset.item'))
    if (outside.length === 1) return outside[0]
  }
  if (found.length !== 1) throw new Error(`expected one field named "${label}", found ${found.length}`)
  return found[0]
}
const product = (i) => field('Product', items()[i])
const quantity = (i) => field('Quantity', items()[i])
const removeButton = (i) => getByText('button', 'Remove', items()[i])
const addItem = () => click(getByText('button', 'Add item'))
const placeButton = () => form().querySelector('button[type="submit"], input[type="submit"]') ?? getByText('button', /Plac/)
const placeOrder = () => click(placeButton())

/** The elements an element's aria-describedby points at (each id must resolve to exactly one element). */
function describedBy(el) {
  const ids = (el.getAttribute('aria-describedby') || '').trim().split(/\s+/).filter(Boolean)
  return ids.map((id) => {
    expect([...document.querySelectorAll('[id]')].filter((e) => e.id === id).length, `id "${id}" must exist once`).toBe(1)
    return document.getElementById(id)
  })
}

function expectValid(el) {
  expect(el.getAttribute('aria-invalid'), `${accessibleName(el)} is valid`).not.toBe('true')
  for (const d of describedBy(el)) expect(textOf(d), `${accessibleName(el)} shows no message`).toBe('')
}

function expectInvalid(el, message) {
  expect(el.getAttribute('aria-invalid'), `${accessibleName(el)} is invalid`).toBe('true')
  expect(describedBy(el).map(textOf)).toContain(message)
}

function expectUniqueIds() {
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
}

async function fillValid({ name = 'Ada Lovelace', email = 'ada@example.com', zip = '02139', promo } = {}) {
  await typeInto(field('Full name'), name)
  await typeInto(field('Email'), email)
  await typeInto(field('ZIP code'), zip)
  await choose(product(0), 'Notebook')
  await typeInto(quantity(0), '2')
  if (promo !== undefined) await typeInto(field('Promo code'), promo)
}

const alertText = () => [...document.querySelectorAll('[role="alert"]')].map(textOf).join(' ')

describe('30 checkout form: schema validation, a field array, server errors', () => {
  it('names every field, starts with one item, and adds items with unique ids', async () => {
    for (const label of ['Full name', 'Email', 'ZIP code', 'Promo code']) expect(field(label)).toBeTruthy()
    expect(items().length).toBe(1)
    expect(legendOf(items()[0])).toBe('Item 1')
    expect(product(0).tagName).toBe('SELECT')
    expect(product(0).value).toBe('')
    // (the placeholder's value="" isn't checked: Sygnal drops value="" on an <option>, README known issue 11)
    expect([...product(0).options].map(textOf)).toEqual(['Choose…', 'Notebook', 'Pen set', 'Backpack'])
    expect([...product(0).options].slice(1).map((o) => o.value)).toEqual(['Notebook', 'Pen set', 'Backpack'])
    expect(quantity(0).type).toBe('number')
    expect(quantity(0).value).toBe('1')
    expect(removeButton(0).disabled).toBe(true)
    expectUniqueIds()

    await choose(product(0), 'Backpack')
    await addItem()
    expect(items().map(legendOf)).toEqual(['Item 1', 'Item 2'])
    expect(product(0).value).toBe('Backpack')
    expect(product(1).value).toBe('')
    expect(quantity(1).value).toBe('1')
    expect(removeButton(0).disabled).toBe(false)
    expect(removeButton(1).disabled).toBe(false)
    expectUniqueIds()
    for (const el of [field('Full name'), field('Email'), field('ZIP code'), product(0), quantity(0), product(1), quantity(1), field('Promo code')]) expectValid(el)
  })

  it('shows a message when the user leaves an invalid field, then follows the typing', async () => {
    await typeInto(field('Email'), 'ada@')
    expectValid(field('Email'))
    await blur(field('Email'))
    expectInvalid(field('Email'), 'Enter a valid email address.')
    await typeInto(field('Email'), 'ada@example.com')
    expectValid(field('Email'))
    await typeInto(field('Email'), 'ada @example.com')
    expectInvalid(field('Email'), 'Enter a valid email address.')
    expectValid(field('Full name'))

    await typeInto(field('ZIP code'), '123')
    await blur(field('ZIP code'))
    expectInvalid(field('ZIP code'), 'Enter a 5-digit ZIP code.')
    await typeInto(field('ZIP code'), '1234a')
    expectInvalid(field('ZIP code'), 'Enter a 5-digit ZIP code.')
    await typeInto(field('ZIP code'), ' 02139 ')
    expectValid(field('ZIP code'))

    await typeInto(quantity(0), '0')
    await blur(quantity(0))
    expectInvalid(quantity(0), 'Enter a quantity from 1 to 10.')
    await typeInto(quantity(0), '2.5')
    expectInvalid(quantity(0), 'Enter a quantity from 1 to 10.')
    await typeInto(quantity(0), '10')
    expectValid(quantity(0))

    await typeInto(field('Promo code'), 'ab')
    await blur(field('Promo code'))
    expectInvalid(field('Promo code'), 'Promo codes are 4 to 12 letters or digits.')
    await typeInto(field('Promo code'), '')
    expectValid(field('Promo code'))
    expect(server.count()).toBe(0)
  })

  it('an invalid order shows every message, focuses the first invalid field and sends nothing', async () => {
    await typeInto(field('Email'), 'ada@example.com')
    await typeInto(field('Full name'), '   ')
    await placeOrder()
    expectInvalid(field('Full name'), 'Enter your name.')
    expectValid(field('Email'))
    expectInvalid(field('ZIP code'), 'Enter a 5-digit ZIP code.')
    expectInvalid(product(0), 'Choose a product.')
    expectValid(quantity(0))
    expectValid(field('Promo code'))
    await waitFor(() => expect(document.activeElement).toBe(field('Full name')))
    expect(server.count()).toBe(0)

    await typeInto(field('Full name'), 'Ada Lovelace')
    expectValid(field('Full name'))
    await typeInto(field('ZIP code'), '02139')
    await typeInto(field('Promo code'), 'no!')
    await placeOrder()
    expectInvalid(product(0), 'Choose a product.')
    expectInvalid(field('Promo code'), 'Promo codes are 4 to 12 letters or digits.')
    await waitFor(() => expect(document.activeElement).toBe(product(0)))
    expect(server.count()).toBe(0)
    expectUniqueIds()
  })

  it('removes items: the others keep their entries and messages, the legends renumber', async () => {
    await choose(product(0), 'Notebook')
    await typeInto(quantity(0), '2')
    await addItem()
    await typeInto(quantity(1), '0')
    await blur(quantity(1))
    await addItem()
    await choose(product(2), 'Backpack')
    await typeInto(quantity(2), '3')
    expect(items().map(legendOf)).toEqual(['Item 1', 'Item 2', 'Item 3'])
    expectInvalid(quantity(1), 'Enter a quantity from 1 to 10.')

    await click(removeButton(0))
    expect(items().map(legendOf)).toEqual(['Item 1', 'Item 2'])
    expect([product(0).value, quantity(0).value]).toEqual(['', '0'])
    expectInvalid(quantity(0), 'Enter a quantity from 1 to 10.')
    expect([product(1).value, quantity(1).value]).toEqual(['Backpack', '3'])
    expectValid(quantity(1))
    expectValid(product(1))
    expectUniqueIds()

    await click(removeButton(0))
    expect(items().map(legendOf)).toEqual(['Item 1'])
    expect([product(0).value, quantity(0).value]).toEqual(['Backpack', '3'])
    expectValid(quantity(0))
    expect(removeButton(0).disabled).toBe(true)
  })

  it('posts a valid order once, with the cleaned values, and confirms it', async () => {
    await fillValid({ name: '  Ada Lovelace ', email: ' ada@example.com ' })
    await addItem()
    await choose(product(1), 'Pen set')
    await placeOrder()
    expect(server.sent()).toEqual(['POST /api/orders'])
    expect(server.jsonOf(0)).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      zip: '02139',
      items: [{ product: 'Notebook', quantity: 2 }, { product: 'Pen set', quantity: 1 }],
      promo: '',
    })
    expect(textOf(placeButton())).toBe('Placing order…')
    expect(placeButton().disabled).toBe(true)

    form().requestSubmit()
    await sleep(100)
    await click(placeButton())
    expect(server.count()).toBe(1)

    await server.reply(0, 201, { id: 'A-1001' })
    await waitFor(() => expect(textOf(document.querySelector('.done'))).toBe('Order A-1001 placed.'))
    expect(alertText()).toBe('')
  })

  it('puts server errors on their fields, focuses the first one, and clears each on change', async () => {
    await fillValid({ promo: ' OLDCODE ' })
    await addItem()
    await choose(product(1), 'Backpack')
    await typeInto(quantity(1), '5')
    await placeOrder()
    expect(server.count()).toBe(1)
    expect(server.jsonOf(0).promo).toBe('OLDCODE')
    await server.reply(0, 422, {
      errors: [
        { path: ['promo'], message: 'This promo code has expired.' },
        { path: ['items', 1, 'quantity'], message: 'Only 3 left in stock.' },
      ],
    })
    await waitFor(() => expectInvalid(quantity(1), 'Only 3 left in stock.'))
    expectInvalid(field('Promo code'), 'This promo code has expired.')
    for (const el of [field('Full name'), field('Email'), field('ZIP code'), product(0), quantity(0), product(1)]) expectValid(el)
    await waitFor(() => expect(document.activeElement).toBe(quantity(1)))
    expect(placeButton().disabled).toBe(false)
    expect(textOf(document.querySelector('.done'))).toBe('')
    expect(alertText(), 'a refused order is not a failure').toBe('')

    await typeInto(quantity(1), '3')
    expectValid(quantity(1))
    expectInvalid(field('Promo code'), 'This promo code has expired.')
    await typeInto(field('Promo code'), 'NEWCODE')
    expectValid(field('Promo code'))

    await placeOrder()
    expect(server.count()).toBe(2)
    expect(server.jsonOf(1).items).toEqual([{ product: 'Notebook', quantity: 2 }, { product: 'Backpack', quantity: 3 }])
    expect(server.jsonOf(1).promo).toBe('NEWCODE')
  })

  it('any other failure shows an alert, keeps the values, and lets the user try again', async () => {
    await fillValid()
    await placeOrder()
    await server.reply(0, 500, { message: 'Internal Server Error' })
    await waitFor(() => expect(alertText()).toBe('Could not place the order. Try again.'))
    expect(placeButton().disabled).toBe(false)
    expect(textOf(placeButton())).toBe('Place order')
    expect(field('Full name').value).toBe('Ada Lovelace')
    expect([product(0).value, quantity(0).value]).toEqual(['Notebook', '2'])
    for (const el of [field('Full name'), field('Email'), field('ZIP code'), product(0), quantity(0), field('Promo code')]) expectValid(el)

    await placeOrder()
    expect(server.count()).toBe(2)
    expect(alertText()).toBe('')
    await server.networkError(1)
    await waitFor(() => expect(alertText()).toBe('Could not place the order. Try again.'))
    expect(placeButton().disabled).toBe(false)
  })
})
