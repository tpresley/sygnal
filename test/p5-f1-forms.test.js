// @vitest-environment jsdom
// PLAN-5 F-1: the signup-plus-address form of spike 0-S2 against both shapes (the `form`
// behavior and the helpers). Assertions read the DOM (error text through each field's
// aria-describedby), so one suite serves both state layouts. Mock DOM and `dom: 'real'`, strict,
// no diagnostics.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/index.js'
import { SignupA, SignupB } from './p5-f1-fixtures.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

const field = (name) => `[name="${name}"]`
/** the error text a field's aria-describedby points at ('' when empty; throws if the id isn't rendered) */
const errorOf = (name) => {
  const id = t.query(field(name)).getAttribute('aria-describedby')
  const el = t.query(`[id="${id}"]`)
  if (!el) throw new Error(`aria-describedby of ${name} points at nothing (${id})`)
  return el.textContent
}
const type = async (name, value) => { t.simulateEvent(field(name), 'input', { value }); await t.settle() }
const blur = async (name) => { t.simulateEvent(field(name), 'focusout'); await t.settle() }
const submit = async () => { t.simulateEvent('.signup', 'submit'); await t.settle() }
const fillValid = async () => {
  await type('name', 'Ada')
  await type('email', 'ada@example.com')
  await type('password', 'correct horse')
  await type('addresses.1.street', '1 Main St')
  await type('addresses.1.city', 'Springfield')
}
/** the field names the last ELEMENT command focuses (the first of them in DOM order) */
const focused = () => {
  const c = t.commands('ELEMENT').at(-1)
  return [...String(c?.focus?.within ?? '').matchAll(/\[name="([^"]+)"\]/g)].map((m) => m[1])
}

for (const [shape, C] of [['A (behavior)', SignupA], ['B (helpers)', SignupB]]) {
  describe(`shape ${shape}`, () => {
    it('validates on input, shows the error once the field is blurred, linked by aria-describedby', async () => {
      t = renderComponent(C, { strict: true })
      await t.ready()
      expect(errorOf('email')).toBe('')
      await type('email', 'nope')
      expect(errorOf('email')).toBe('')                      // validated, not shown yet
      await blur('email')
      expect(errorOf('email')).toBe('Enter a valid email address')
      expect(t.query(field('email')).getAttribute('aria-invalid')).toBe('true')
      expect(t.query(field('name')).getAttribute('aria-invalid')).toBe('false')
      await type('email', 'ok@example.com')                  // revalidated on input
      expect(errorOf('email')).toBe('')
      t.expectNoDiagnostics()
    })

    it('a failed submit shows every error, focuses the first invalid field and sends nothing', async () => {
      t = renderComponent(C, { strict: true })
      await t.ready()
      await type('name', 'Ada')
      await submit()
      expect(errorOf('email')).toBe('Enter a valid email address')
      expect(errorOf('password')).toBe('Use at least 8 characters')
      expect(errorOf('addresses.1.street')).toBe('Enter a street')
      expect(focused()).toEqual(['email', 'password', 'addresses.1.street', 'addresses.1.city'])
      expect(t.requests('HTTP')).toEqual([])
      t.expectNoDiagnostics()
    })

    it('field array: rows in a Collection; add, edit, remove; errors follow the row id', async () => {
      t = renderComponent(C, { strict: true })
      await t.ready()
      t.simulateEvent('.add-address', 'click')
      await t.settle()
      expect(t.queryAll('.address')).toHaveLength(2)
      await type('addresses.2.street', 'Elm St')
      await blur('addresses.2.city')
      expect(errorOf('addresses.2.city')).toBe('Enter a city')
      t.simulateEvent('.address:first-child .remove', 'click')    // remove row 1: row 2 keeps its state
      await t.settle()
      expect(t.queryAll('.address')).toHaveLength(1)
      expect(t.query(field('addresses.2.street')).value).toBe('Elm St')
      expect(errorOf('addresses.2.city')).toBe('Enter a city')
      t.simulateEvent('.remove', 'click')
      await t.settle()
      await submit()
      expect(errorOf('name')).toBe('Enter your name')
      expect(t.query('fieldset').textContent).toContain('Add at least one address')
      t.expectNoDiagnostics()
    })

    it('async validation through a reply action: email availability on blur', async () => {
      t = renderComponent(C, { strict: true })
      await t.ready()
      await type('email', 'taken@example.com')
      await blur('email')
      expect(t.requests('HTTP')).toMatchObject([{ url: '/api/email-available', query: { email: 'taken@example.com' } }])
      expect(errorOf('email')).toBe('Checking…')
      await t.respond('HTTP', { available: false })
      expect(errorOf('email')).toBe('This email is already registered')
      await type('email', 'free@example.com')
      expect(errorOf('email')).toBe('')
      await blur('email')
      await t.respond('HTTP', { available: true })
      expect(errorOf('email')).toBe('')
      t.expectNoDiagnostics()
    })

    it('a valid submit posts the schema output; server errors land on fields and focus the first', async () => {
      t = renderComponent(C, { strict: true })
      await t.ready()
      await fillValid()
      await blur('email')
      await t.respond('HTTP', { available: true })
      await submit()
      const post = t.requests('HTTP').at(-1)
      expect(post).toMatchObject({ url: '/api/signup', method: 'POST', json: { name: 'Ada', email: 'ada@example.com', addresses: [{ id: 1, street: '1 Main St', city: 'Springfield' }] } })
      expect(t.query('button[type="submit"]').disabled).toBe(true)
      t.simulateEvent('.signup', 'submit')                    // a submit while submitting does nothing
      await t.settle()
      expect(t.requests('HTTP').filter((r) => r.url === '/api/signup')).toHaveLength(1)
      await t.fail('HTTP', { status: 422, body: { errors: { password: 'Too common', 'addresses.1.city': 'Unknown city' } } })
      expect(errorOf('password')).toBe('Too common')
      expect(errorOf('addresses.1.city')).toBe('Unknown city')
      expect(focused()).toEqual(['password', 'addresses.1.city'])
      expect(t.query('button[type="submit"]').disabled).toBe(false)
      await type('password', 'correct horse battery')      // editing clears that server error
      expect(errorOf('password')).toBe('')
      expect(errorOf('addresses.1.city')).toBe('Unknown city')
      t.expectNoDiagnostics()
    })

    it('a successful submit', async () => {
      t = renderComponent(C, { strict: true })
      await t.ready()
      await fillValid()
      await blur('email')
      await t.respond('HTTP', { available: true })
      await submit()
      await t.respond('HTTP', { id: 7 })
      expect(t.query('.done').textContent).toBe('Welcome!')
      expect(t.query('button[type="submit"]').disabled).toBe(false)
      t.expectNoDiagnostics()
    })

    it('real DOM: a failed submit focuses the first invalid field, inside a Collection item', async () => {
      t = renderComponent(C, { dom: 'real', strict: true })
      await t.ready()
      await type('name', 'Ada')
      await type('email', 'ada@example.com')
      await blur('email')
      await t.respond('HTTP', { available: true })
      await type('password', 'correct horse')
      await type('addresses.1.street', '1 Main St')
      await submit()
      await new Promise((r) => setTimeout(r, 40))
      expect(document.activeElement).toBe(t.query(field('addresses.1.city')))
      expect(errorOf('addresses.1.city')).toBe('Enter a city')
      const el = t.query(field('addresses.1.city'))
      expect(document.getElementById(el.getAttribute('aria-describedby')).textContent).toBe('Enter a city')
      expect(document.querySelector(`label[for="${el.id}"]`).textContent).toBe('City')
      t.expectNoDiagnostics()
    })
  })
}
