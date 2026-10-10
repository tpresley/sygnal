// @vitest-environment jsdom
// PLAN-6 G-647 (form part): form.SET ({ values }) changes several fields at once, as if they were
// typed: one validation, `touched` by the `show` rule (as CHANGE), the fields' server errors,
// check results and running checks cleared, unknown names skipped (SYG230 in dev), the rest kept.
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { form } from '../src/extra/form.ts'

const schema = z.object({
  name: z.string().min(1, 'Enter a name'),
  email: z.string().email('Enter a valid email address'),
  phone: z.string(),
  addresses: z.array(z.object({ id: z.number(), city: z.string().min(1, 'Enter a city') })),
})
const start = { name: '', email: '', phone: '', addresses: [{ id: 1, city: '' }] }

function make(options = {}) {
  function Contact({ state }) {
    const f = state.form.fields
    return h('form', { className: 'contact' },
      h('input', { name: 'name', value: f.name.value }), h('span', { className: 'name-error' }, f.name.error),
      h('input', { name: 'email', value: f.email.value }), h('span', { className: 'email-error' }, f.email.error),
      h('input', { name: 'phone', value: f.phone.value }),
      h('input', { name: 'addresses.1.city', value: f['addresses.1.city'].value }))
  }
  Contact.uses = { form: form(schema, { form: '.contact', values: start, submit: 'SAVE', ...options }) }
  Contact.model = { SAVE: { HTTP: (s, values) => ({ url: '/api/contacts', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) } }
  return Contact
}

let t
afterEach(() => { t?.dispose(); t = null })

describe('G-647: form.SET', () => {
  it('sets several fields (paths too) in one validation, dirty, not touched (show: blur)', async () => {
    t = renderComponent(make())
    await t.ready()
    t.simulateEvent('[name="phone"]', 'input', { value: '555' })
    await t.settle()
    const before = t.actions.length
    t.simulateAction('form.SET', { values: { name: 'Dana', email: 'nope', 'addresses.1.city': 'Hilo' } })
    await t.settle()
    expect(t.state.form.values).toEqual({ name: 'Dana', email: 'nope', phone: '555', addresses: [{ id: 1, city: 'Hilo' }] })
    expect(t.actions.slice(before).map((a) => a.type)).toEqual(['form.SET'])
    expect(t.state.form.errors).toEqual({ email: 'Enter a valid email address' })
    expect(t.state.form.touched).toEqual({})
    expect(t.state.form.dirty).toBe(true)
    expect(t.state.form.fields.name).toMatchObject({ value: 'Dana', dirty: true, touched: false })
    // the error shows by the show rule: once the field is blurred, as for typed text
    expect(t.query('.email-error').textContent).toBe('')
    t.simulateEvent('[name="email"]', 'focusout')
    await t.settle()
    expect(t.query('.email-error').textContent).toBe('Enter a valid email address')
    // the DOM shows the values
    expect(t.query('[name="name"]').value).toBe('Dana')
  })

  it("show: 'input' marks the set fields touched", async () => {
    t = renderComponent(make({ show: 'input' }))
    await t.ready()
    t.simulateAction('form.SET', { values: { email: 'nope', phone: '1' } })
    await t.settle()
    expect(t.state.form.touched).toEqual({ email: true, phone: true })
    expect(t.state.form.fields.email.error).toBe('Enter a valid email address')
  })

  it("clears the set fields' server errors (and the form-level one); keeps the others'", async () => {
    t = renderComponent(make())
    await t.ready()
    t.simulateAction('form.ERRORS', { name: 'Taken', email: 'Unknown domain', '': 'Try again' })
    await t.settle()
    t.simulateAction('form.SET', { values: { email: 'dana@example.com' } })
    await t.settle()
    expect(t.state.form.server).toEqual({ name: 'Taken' })
  })

  it('unknown names are skipped; nothing known: no change', async () => {
    t = renderComponent(make())
    await t.ready()
    t.simulateAction('form.SET', { values: { name: 'Dana', fax: '123' } })
    await t.settle()
    expect(t.state.form.values).toEqual({ ...start, name: 'Dana' })
    const s = t.state.form
    t.simulateAction('form.SET', { values: { fax: '123' } })
    t.simulateAction('form.SET', {})
    await t.settle()
    expect(t.state.form).toBe(s)
  })

  it('a valid fill submits as typed values do', async () => {
    t = renderComponent(make())
    await t.ready()
    t.simulateAction('form.SET', { values: { name: 'Dana', email: 'dana@example.com', 'addresses.1.city': 'Hilo' } })
    await t.settle()
    expect(t.state.form.valid).toBe(true)
    t.simulateEvent('.contact', 'submit')
    await t.settle()
    expect(t.requests('HTTP')[0].json).toEqual({ name: 'Dana', email: 'dana@example.com', phone: '', addresses: [{ id: 1, city: 'Hilo' }] })
  })

  it("the AI fill recipe: the model's fields in one form.SET (nulls left out); saved only on submit", async () => {
    const Extracted = z.object({ name: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable() })
    const C = make()
    C.initialState = { reading: true }
    C.model = {
      ...C.model,
      BOOTSTRAP: { LLM: () => ({ messages: [{ role: 'user', content: 'sig' }], output: Extracted, ok: 'EXTRACTED', error: 'NOT_EXTRACTED' }) },
      EXTRACTED: {
        STATE: (state) => ({ ...state, reading: false }),
        EFFECT: (state, { value }, next) => {
          next('form.SET', { values: Object.fromEntries(Object.entries(value).filter(([, text]) => text !== null)) })
        },
      },
      NOT_EXTRACTED: (state) => ({ ...state, reading: false }),
    }
    t = renderComponent(C)
    await t.ready()
    t.simulateEvent('[name="phone"]', 'input', { value: '555 0100' })
    await t.settle()
    await t.respond('LLM', { name: 'Dana Whitfield', email: 'dana@northwind.example', phone: null })
    expect(t.state.form.values).toEqual({ name: 'Dana Whitfield', email: 'dana@northwind.example', phone: '555 0100', addresses: [{ id: 1, city: '' }] })
    expect(t.state.reading).toBe(false)
    expect(t.requests('HTTP')).toEqual([])
  })
})
