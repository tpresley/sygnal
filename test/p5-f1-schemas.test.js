// @vitest-environment jsdom
// PLAN-5 F-1: any Standard Schema (hand-written, zod, valibot sync and async) through the
// helpers and the `form` behavior; the behavior's queued submit, async schema, options and
// calculated fields.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, form, formErrors, checkForm, setField, getField, fieldName, fieldNames, replyErrors, focusInvalid, ABORT } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { SignupA, signupWith, signupSchema, zodSchema, valibotSchema, valibotAsyncSchema, emailCheck } from './p5-f1-fixtures.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

const empty = { name: '', email: '', password: '', addresses: [{ id: 1, street: '', city: '' }] }
const partial = { name: 'Ada', email: 'x', password: 'correct horse', addresses: [{ id: 4, street: 'Elm', city: '' }, { id: 9, street: '', city: 'Paris' }] }
const valid = { name: 'Ada', email: 'Ada@Example.com', password: 'correct horse', addresses: [{ id: 1, street: '1 Main St', city: 'Springfield' }] }

const type = async (name, value) => { t.simulateEvent(`[name="${name}"]`, 'input', { value }); await t.settle() }
const blur = async (name) => { t.simulateEvent(`[name="${name}"]`, 'focusout'); await t.settle() }
const submit = async () => { t.simulateEvent('.signup', 'submit'); await t.settle() }
const fill = async (x) => {
  for (const k of ['name', 'email', 'password']) await type(k, x[k])
  await type('addresses.1.street', x.addresses[0].street)
  await type('addresses.1.city', x.addresses[0].city)
}
const focused = () => [...String(t.commands('ELEMENT').at(-1)?.focus?.within ?? '').matchAll(/\[name="([^"]+)"\]/g)].map((m) => m[1])

describe('helpers over any Standard Schema', () => {
  for (const [lib, schema] of [['hand-written', signupSchema], ['zod', zodSchema], ['valibot', valibotSchema]]) {
    it(`${lib}: errors by field name (rows by id), the transformed output when valid`, () => {
      expect(formErrors(schema, empty)).toEqual({
        name: 'Enter your name', email: 'Enter a valid email address', password: 'Use at least 8 characters',
        'addresses.1.street': 'Enter a street', 'addresses.1.city': 'Enter a city',
      })
      expect(formErrors(schema, partial)).toEqual({ email: 'Enter a valid email address', 'addresses.4.city': 'Enter a city', 'addresses.9.street': 'Enter a street' })
      expect(formErrors(schema, { ...valid, addresses: [] })).toEqual({ addresses: 'Add at least one address' })
      expect(checkForm(schema, valid)).toEqual({ errors: {}, value: { ...valid, email: 'ada@example.com' } })
    })
  }
  it('an async schema returns a Promise', async () => {
    expect(await formErrors(valibotAsyncSchema, { ...valid, name: 'Mallory' })).toEqual({ '': 'That name is not allowed' })
  })
  it('a non-Standard-Schema object throws a TypeError (with the dev entry: SYG231, p5-f1-diagnostics)', () => {
    expect(() => formErrors({ parse() {} }, empty)).toThrow(TypeError)
    expect(() => form({ parse() {} }, { values: empty, submit: 'X' })).toThrow(TypeError)
  })
  it('names: setField / getField by row id, fieldName, fieldNames, replyErrors', () => {
    const v2 = setField(partial, 'addresses.9.street', 'Oak')
    expect(v2.addresses[1].street).toBe('Oak')
    expect(partial.addresses[1].street).toBe('')                 // immutable
    expect(v2.addresses[0]).toBe(partial.addresses[0])          // structural sharing
    expect(getField(v2, 'addresses.9.street')).toBe('Oak')
    expect(setField(partial, 'addresses.77.street', 'x')).toBe(partial)   // unknown row: unchanged
    expect(setField(partial, 'name', 'Ada')).toBe(partial)                // same value: unchanged
    expect(setField({ tags: ['a', 'b'] }, 'tags.1', 'c')).toEqual({ tags: ['a', 'c'] })   // plain array: by index
    expect(fieldName(partial, ['addresses', 1, { key: 'city' }])).toBe('addresses.9.city')
    expect(fieldNames(empty)).toEqual(['name', 'email', 'password', 'addresses', 'addresses.1.street', 'addresses.1.city'])
    expect(replyErrors({ status: 422, body: { errors: { email: ['Taken', 'x'] } } })).toEqual({ email: 'Taken' })
    expect(replyErrors({ status: 422, body: { errors: [{ path: ['addresses', 1, 'city'], message: 'Bad' }] } }, partial)).toEqual({ 'addresses.9.city': 'Bad' })
    expect(replyErrors({ status: 500, body: 'oops' })).toEqual({ '': 'Request failed (500)' })
    expect(replyErrors({ email: 'Taken' })).toEqual({ email: 'Taken' })
  })
  it('focusInvalid: a focusWithin command over the named fields, ABORT when none', () => {
    expect(focusInvalid({ email: 'Bad', name: '', '': 'Form' }).focus.within).toBe('[name="email"]')
    expect(focusInvalid(['a.1.b', 'c']).focus.within).toBe('[name="a.1.b"],[name="c"]')
    expect(focusInvalid({})).toBe(ABORT)
    expect(focusInvalid([''])).toBe(ABORT)
  })
})

describe('the form behavior with other validators', () => {
  for (const [lib, schema] of [['zod', zodSchema], ['valibot', valibotSchema], ['valibot async', valibotAsyncSchema]]) {
    it(`${lib}: invalid submit shows errors; valid submit posts the schema output`, async () => {
      t = renderComponent(signupWith(schema), { strict: true })
      await t.ready()
      await submit()
      expect(t.state.form.fields.email.error).toBe('Enter a valid email address')
      expect(t.state.form.fields['addresses.1.city'].error).toBe('Enter a city')
      expect(focused()[0]).toBe('name')
      await fill(valid)
      await submit()
      expect(t.requests('HTTP').at(-1).json).toEqual({ ...valid, email: 'ada@example.com' })
      t.expectNoDiagnostics()
    })
  }
  it('valibot async: a form-level issue shows as state.form.error; nothing is sent', async () => {
    t = renderComponent(signupWith(valibotAsyncSchema), { strict: true })
    await t.ready()
    await fill({ ...valid, name: 'Mallory' })
    await submit()
    expect(t.query('.form-error').textContent).toBe('That name is not allowed')
    expect(t.state.form.validating).toBe(false)
    expect(t.requests('HTTP')).toEqual([])
  })
  it('async schema: edits are validated too (errors follow the newest values)', async () => {
    t = renderComponent(signupWith(valibotAsyncSchema, { show: 'input' }), { strict: true })
    await t.ready()
    expect(t.state.form.validating).toBe(false)
    await type('email', 'nope')
    await t.waitForState((s) => !s.form.validating && s.form.errors.email)
    expect(t.state.form.fields.email.error).toBe('Enter a valid email address')
    await type('email', 'ada@example.com')
    await t.waitForState((s) => !s.form.validating && !s.form.errors.email)
    expect(t.state.form.fields.email.error).toBe('')
  })
})

describe('the form behavior: checks and submits', () => {
  it('a submit during the async check is queued and sent once the check passes', async () => {
    t = renderComponent(SignupA, { strict: true })
    await t.ready()
    await fill(valid)
    await submit()                    // email never blurred: the submit starts the check
    expect(t.requests('HTTP').map((r) => r.url)).toEqual(['/api/email-available'])
    expect(t.state.form.queued).toBe(true)
    expect(t.state.form.fields.email.pending).toBe(true)
    await t.respond('HTTP', { available: true })
    await t.settle()
    expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/signup', json: { email: 'ada@example.com' } })
    expect(t.state.form).toMatchObject({ queued: false, submitting: true, pending: {} })
    t.expectNoDiagnostics()
  })
  it('a taken email stops the queued submit and focuses the email field', async () => {
    t = renderComponent(SignupA, { strict: true })
    await t.ready()
    await fill(valid)
    await submit()
    await t.respond('HTTP', { available: false })
    await t.settle()
    expect(t.requests('HTTP').filter((r) => r.url === '/api/signup')).toEqual([])
    expect(t.state.form.fields.email.error).toBe('This email is already registered')
    expect(focused()).toEqual(['email'])
    expect(t.state.form.queued).toBe(false)
  })
  it('a failed check does not block: the queued submit goes on', async () => {
    t = renderComponent(SignupA, { strict: true })
    await t.ready()
    await fill(valid)
    await submit()
    await t.fail('HTTP', { status: 503, body: 'down' })
    await t.settle()
    expect(t.requests('HTTP').at(-1).url).toBe('/api/signup')
  })
  it('a second submit while one is queued is dropped; an edit cancels the queued submit', async () => {
    t = renderComponent(SignupA, { strict: true })
    await t.ready()
    await fill(valid)
    await submit()
    await submit()
    expect(t.state.form.submitCount).toBe(1)
    await type('name', 'Grace')
    expect(t.state.form.queued).toBe(false)
    expect(t.state.form.pending).toEqual({ email: 'Ada@Example.com' })   // another field: its check goes on
    await t.respond('HTTP', { available: true })
    await t.settle()
    expect(t.requests('HTTP').filter((r) => r.url === '/api/signup')).toEqual([])
    expect(t.state.form.remote).toEqual({ email: '' })
  })
  it('editing the checked field drops its check: the late reply is ignored', async () => {
    t = renderComponent(SignupA, { strict: true })
    await t.ready()
    await type('email', 'ada@example.com')
    await blur('email')
    await type('email', 'bob@example.com')
    expect(t.state.form.pending).toEqual({})
    await t.respond('HTTP', { available: false })
    await t.settle()
    expect(t.state.form.fields.email.error).toBe('')
  })
  it('a check request is sent once per value; its reply action is namespaced, latest', async () => {
    t = renderComponent(SignupA, { strict: true })
    await t.ready()
    await type('email', 'ada@example.com')
    await blur('email')
    expect(t.requests('HTTP').at(-1)).toMatchObject({ ok: 'form.CHECKED_email', error: 'form.CHECKED_email', latest: true })
    await t.respond('HTTP', { available: true })
    await blur('email')
    expect(t.requests('HTTP')).toHaveLength(1)
  })
  it('two checked fields run one after the other before a queued submit', async () => {
    const C = signupWith(signupSchema, { check: { email: emailCheck, name: { request: (name) => ({ url: '/api/name', query: { name } }), error: (b) => b.bad && 'Pick another name' } } })
    t = renderComponent(C, { strict: true })
    await t.ready()
    await fill(valid)
    await submit()
    expect(t.requests('HTTP').map((r) => r.url)).toEqual(['/api/email-available'])
    await t.respond('HTTP', { available: true })
    await t.settle()
    expect(t.requests('HTTP').map((r) => r.url)).toEqual(['/api/email-available', '/api/name'])
    expect(t.state.form.queued).toBe(true)
    await t.respond('HTTP', { bad: false })
    await t.settle()
    expect(t.requests('HTTP').at(-1).url).toBe('/api/signup')
  })
  it('t.actions shows the behavior actions by name', async () => {
    t = renderComponent(SignupA)
    await t.ready()
    await type('name', 'A')
    expect(t.actions.map((a) => a.type)).toContain('form.CHANGE')
    expect(t.actions.find((a) => a.type === 'form.CHANGE').cause).toBe('behavior')
  })
})

describe('the form behavior: options and calculated fields', () => {
  it('show: "input" shows errors while typing; "submit" only after a submit', async () => {
    t = renderComponent(signupWith(signupSchema, { show: 'input' }), { strict: true })
    await t.ready()
    await type('email', 'x')
    expect(t.state.form.fields.email).toMatchObject({ error: 'Enter a valid email address', invalid: true, touched: true })
    t.dispose()
    t = renderComponent(signupWith(signupSchema, { show: 'submit' }), { strict: true })
    await t.ready()
    await type('email', 'x')
    await blur('email')
    expect(t.state.form.fields.email.error).toBe('')
    await submit()
    expect(t.state.form.fields.email.error).toBe('Enter a valid email address')
  })
  it('dirty, valid, DONE and RESET', async () => {
    t = renderComponent(signupWith(signupSchema), { strict: true })
    await t.ready()
    expect(t.state.form).toMatchObject({ dirty: false, valid: false, submitCount: 0 })
    await type('name', 'Ada')
    expect(t.state.form.dirty).toBe(true)
    expect(t.state.form.fields.name.dirty).toBe(true)
    expect(t.state.form.fields.email.dirty).toBe(false)
    await fill(valid)
    expect(t.state.form.valid).toBe(true)
    await submit()
    t.simulateAction('form.DONE', { id: 1 })
    await t.settle()
    expect(t.state.form).toMatchObject({ submitting: false, submitted: true, dirty: false })
    t.simulateAction('form.RESET', empty)
    await t.settle()
    expect(t.state.form).toMatchObject({ values: empty, initial: empty, submitCount: 0, submitted: false, dirty: false })
    expect(t.query('[name="name"]').value).toBe('')
  })
  it('a checkbox field takes its checked state; the form selector option', async () => {
    const schema = { '~standard': { version: 1, vendor: 't', validate: (x) => (x.terms ? { value: x } : { issues: [{ message: 'Accept the terms', path: ['terms'] }] }) } }
    function Terms({ state }) {
      const f = state.form.fields.terms
      return h('div', null, h('form', { className: 'terms' },
        h('label', null, h('input', { type: 'checkbox', name: 'terms', checked: f.value }), ' I accept'),
        h('button', { type: 'submit' }, 'Go')))
    }
    Terms.uses = { form: form(schema, { values: { terms: false }, submit: 'GO', form: '.terms' }) }
    Terms.model = { GO: { EVENTS: (s, x) => ({ type: 'went', data: x }) } }
    t = renderComponent(Terms, { strict: true })
    await t.ready()
    t.simulateEvent('[name="terms"]', 'input', { checked: true })
    await t.settle()
    expect(t.state.form.values.terms).toBe(true)
    t.simulateEvent('.terms', 'submit')
    await t.settle()
    expect(t.emitted.at(-1)).toMatchObject({ type: 'went', data: { terms: true } })
  })
  it('the uses key names the actions and the slice', async () => {
    const C = (props) => h('form', { className: 'signup' }, h('input', { name: 'name', value: props.state.profile.fields.name.value }))
    C.uses = { profile: form(signupSchema, { values: empty, submit: 'SAVE' }) }
    C.model = { SAVE: { EVENTS: (s, x) => ({ type: 'saved', data: x }) } }
    t = renderComponent(C)
    await t.ready()
    await type('name', 'Ada')
    expect(t.state.profile.values.name).toBe('Ada')
    expect(t.actions.map((a) => a.type)).toContain('profile.CHANGE')
  })
})
