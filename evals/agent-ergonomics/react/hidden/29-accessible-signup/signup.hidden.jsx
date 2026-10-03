import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mountApp, waitFor, click, typeInto, textOf, getByText, sleep } from './dom.js'

// jsdom has no showModal()/close(). Install them like a browser: showModal() sets `open`
// (InvalidStateError on a disconnected or already non-modally open dialog) and focuses the
// first focusable element inside; close() removes `open`, then fires a non-bubbling `close`
// event as a separate task. escapeDialog() is the browser's Escape: `cancel`, then close().
const modalDialogs = new WeakSet()
beforeAll(() => {
  const proto = HTMLDialogElement.prototype
  if (typeof proto.showModal === 'function' && !proto.showModal.__ergoPolyfill) return
  const showModal = function showModal() {
    if (!this.isConnected) throw new DOMException('The dialog is not connected.', 'InvalidStateError')
    if (this.open) {
      if (modalDialogs.has(this)) return
      throw new DOMException('The dialog is already open as a non-modal dialog.', 'InvalidStateError')
    }
    this.setAttribute('open', '')
    modalDialogs.add(this)
    const target = this.querySelector('[autofocus]') || this.querySelector('button, input, select, textarea, a[href], [tabindex]')
    target?.focus()
  }
  showModal.__ergoPolyfill = true
  proto.showModal = showModal
  proto.show = function show() {
    if (!this.open) this.setAttribute('open', '')
  }
  proto.close = function close(returnValue) {
    if (!this.open) return
    this.removeAttribute('open')
    modalDialogs.delete(this)
    if (returnValue !== undefined) this.returnValue = String(returnValue)
    setTimeout(() => this.dispatchEvent(new Event('close')), 0)
  }
  if (!('returnValue' in proto)) {
    Object.defineProperty(proto, 'returnValue', {
      configurable: true,
      get() {
        return this.__returnValue ?? ''
      },
      set(v) {
        this.__returnValue = String(v)
      },
    })
  }
})

async function escapeDialog(dialog) {
  const cancel = new Event('cancel', { cancelable: true })
  dialog.dispatchEvent(cancel)
  if (!cancel.defaultPrevented) dialog.close()
  await sleep(100)
}

// Every submit event seen on the page; none may keep its default action (a page reload).
let submits = []
const recordSubmit = (e) => submits.push(e)

beforeEach(async () => {
  submits = []
  document.addEventListener('submit', recordSubmit, true)
  await mountApp()
})

afterEach(() => {
  document.removeEventListener('submit', recordSubmit, true)
})

const q = (sel) => document.querySelector(sel)
const signup = (name) => q(`form.signup [name="${name}"]`)
const newsletterEmail = () => q('form.newsletter [name="email"]')
const dialog = () => q('dialog.confirm')
const createAccount = () => click(getByText('form.signup button', 'Create account'))
const subscribe = () => click(getByText('form.newsletter button', 'Subscribe'))

/** The accessible name: aria-labelledby, else aria-label, else the associated <label>s. */
function accessibleName(el) {
  const by = el.getAttribute('aria-labelledby')
  if (by) return by.trim().split(/\s+/).map((id) => textOf(document.getElementById(id) ?? document.createElement('i'))).join(' ').trim()
  const label = el.getAttribute('aria-label')
  if (label && label.trim()) return label.trim()
  return [...(el.labels ?? [])].map((l) => textOf(l)).join(' ').trim()
}

/** The elements an element's aria-describedby points at (each id must resolve to exactly one element). */
function describedBy(el) {
  const ids = (el.getAttribute('aria-describedby') || '').trim().split(/\s+/).filter(Boolean)
  return ids.map((id) => {
    expect([...document.querySelectorAll('[id]')].filter((e) => e.id === id).length, `id "${id}" must exist once`).toBe(1)
    return document.getElementById(id)
  })
}
const describedTexts = (el) => describedBy(el).map(textOf)

/** The error message shown for a field: a p.error inside its .field (or null). */
function messageOf(field) {
  const box = field.closest('.field')
  const errors = [...box.querySelectorAll('p.error')].filter((p) => textOf(p) !== '')
  expect(errors.length).toBeLessThanOrEqual(1)
  return errors[0] ?? null
}

function expectValid(field) {
  expect(messageOf(field)).toBeNull()
  expect(field.getAttribute('aria-invalid')).not.toBe('true')
  for (const el of describedBy(field)) expect(el.classList.contains('error')).toBe(false)
}

function expectInvalid(field, message) {
  const msg = messageOf(field)
  expect(msg, `a message for ${field.name}`).not.toBeNull()
  expect(textOf(msg)).toBe(message)
  expect(field.getAttribute('aria-invalid')).toBe('true')
  expect(describedBy(field)).toContain(msg)
}

function expectUniqueIds() {
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
}

function expectNoReload() {
  for (const e of submits) expect(e.defaultPrevented, 'a form submission was not prevented').toBe(true)
}

async function fillSignup({ name = 'Ada Lovelace', email = 'ada@example.com', password = 'analytical' } = {}) {
  await typeInto(signup('name'), name)
  await typeInto(signup('email'), email)
  await typeInto(signup('password'), password)
}

const dialogOpen = () => !!dialog()?.open
const dialogModal = () => !!dialog() && modalDialogs.has(dialog())

describe('29 accessible signup: labels, described errors, focus, native modal dialog', () => {
  it('labels every field, keeps ids unique, and shows no message before the first submit', async () => {
    expect(accessibleName(signup('name'))).toMatch(/^Name\b/)
    expect(accessibleName(signup('email'))).toMatch(/^Email\b/)
    expect(accessibleName(signup('password'))).toMatch(/^Password\b/)
    expect(accessibleName(newsletterEmail())).toMatch(/^Email\b/)
    expectUniqueIds()

    await typeInto(signup('email'), 'not an email')
    await typeInto(signup('password'), 'short')
    for (const f of [signup('name'), signup('email'), signup('password'), newsletterEmail()]) expectValid(f)
    expect(document.activeElement).toBe(signup('password'))
  })

  it('the password hint always describes the password field', async () => {
    expect(describedTexts(signup('password'))).toContain('At least 8 characters.')
    await createAccount()
    expect(describedTexts(signup('password'))).toEqual(expect.arrayContaining(['At least 8 characters.', 'Use at least 8 characters.']))
    await typeInto(signup('password'), 'long enough')
    expect(describedTexts(signup('password'))).toEqual(['At least 8 characters.'])
    expectValid(signup('password'))
  })

  it('an empty form shows each message, wired to its field, and focuses Name without reloading', async () => {
    await createAccount()
    expectInvalid(signup('name'), 'Enter your name.')
    expectInvalid(signup('email'), 'Enter a valid email address.')
    expectInvalid(signup('password'), 'Use at least 8 characters.')
    expect(document.activeElement).toBe(signup('name'))
    expect(dialogOpen()).toBe(false)
    expectValid(newsletterEmail())
    expectUniqueIds()
    expectNoReload()
  })

  it('focuses the first invalid field in form order, and typing never moves focus', async () => {
    await fillSignup({ email: 'ada@example', password: 'short' })
    await createAccount()
    expectValid(signup('name'))
    expectInvalid(signup('email'), 'Enter a valid email address.')
    expectInvalid(signup('password'), 'Use at least 8 characters.')
    await waitFor(() => expect(document.activeElement).toBe(signup('email')))

    await typeInto(signup('email'), 'ada@example.com')
    expectValid(signup('email'))
    expect(document.activeElement).toBe(signup('email'))
    await createAccount()
    await waitFor(() => expect(document.activeElement).toBe(signup('password')))
    expect(dialogOpen()).toBe(false)
    expectNoReload()
  })

  it('after the first submit, messages follow the typing in both directions', async () => {
    await fillSignup({ name: '', email: 'ada@example.com', password: 'analytical' })
    await createAccount()
    expectInvalid(signup('name'), 'Enter your name.')
    expectValid(signup('email'))

    await typeInto(signup('name'), 'Ada')
    expectValid(signup('name'))
    await typeInto(signup('email'), 'ada @example.com')
    expectInvalid(signup('email'), 'Enter a valid email address.')
    await typeInto(signup('name'), '   ')
    expectInvalid(signup('name'), 'Enter your name.')
    expect(document.activeElement).toBe(signup('name'))
    expectUniqueIds()
  })

  it('a valid form opens the confirmation as a modal dialog; Cancel closes it', async () => {
    await fillSignup()
    await createAccount()
    await waitFor(() => expect(dialogOpen()).toBe(true))
    expect(dialogModal()).toBe(true)
    expect(textOf(dialog())).toContain('Create the account for ada@example.com?')
    for (const f of [signup('name'), signup('email'), signup('password')]) expectValid(f)

    await click(getByText('dialog.confirm button', 'Cancel'))
    await waitFor(() => expect(dialogOpen()).toBe(false))
    expect(textOf(q('.done'))).toBe('')

    await typeInto(signup('email'), 'lovelace@example.org')
    await createAccount()
    await waitFor(() => expect(dialogModal()).toBe(true))
    expect(textOf(dialog())).toContain('Create the account for lovelace@example.org?')
    expectNoReload()
  })

  it('Escape closes the dialog and the page keeps working; Confirm creates the account', async () => {
    await fillSignup()
    await createAccount()
    await waitFor(() => expect(dialogModal()).toBe(true))
    await escapeDialog(dialog())
    expect(dialogOpen()).toBe(false)

    await createAccount()
    await waitFor(() => expect(dialogModal()).toBe(true))
    await click(getByText('dialog.confirm button', 'Confirm'))
    await waitFor(() => expect(dialogOpen()).toBe(false))
    await waitFor(() => expect(textOf(q('.done'))).toBe('Account created for Ada Lovelace.'))
    expectNoReload()
  })

  it('the newsletter form validates its own email, apart from the signup form', async () => {
    await subscribe()
    expectInvalid(newsletterEmail(), 'Enter a valid email address.')
    await waitFor(() => expect(document.activeElement).toBe(newsletterEmail()))
    for (const f of [signup('name'), signup('email'), signup('password')]) expectValid(f)

    await typeInto(signup('email'), 'nope')
    await createAccount()
    expectInvalid(signup('email'), 'Enter a valid email address.')
    expectInvalid(newsletterEmail(), 'Enter a valid email address.')
    expect(messageOf(signup('email'))).not.toBe(messageOf(newsletterEmail()))
    expectUniqueIds()

    await typeInto(newsletterEmail(), 'ada@example.com')
    expectValid(newsletterEmail())
    expectInvalid(signup('email'), 'Enter a valid email address.')
    await subscribe()
    await waitFor(() => expect(textOf(q('.subscribed'))).toBe('Subscribed ada@example.com.'))
    expect(dialogOpen()).toBe(false)
    expectInvalid(signup('email'), 'Enter a valid email address.')
    expectNoReload()
  })
})
