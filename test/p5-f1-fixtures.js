// PLAN-5 F-1: the signup-plus-address form of spike 0-S2, written both ways: SignupA with the
// `form` behavior (the canonical recipe, D193) and SignupB with the exported helpers (the
// escape hatch). Plus the same rules as a hand-written Standard Schema, zod and valibot.
import { z } from 'zod'
import * as v from 'valibot'
import { ABORT, Collection, form, checkForm, formErrors, setField, replyErrors, focusInvalid } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const EMAIL = /^\S+@\S+\.\S+$/

// a tiny hand-written Standard Schema (https://standardschema.dev): no validator dependency
export const signupSchema = {
  '~standard': {
    version: 1,
    vendor: 'p5-forms-test',
    validate(x) {
      const issues = []
      const need = (ok, message, ...path) => ok || issues.push({ message, path })
      need(x.name.trim(), 'Enter your name', 'name')
      need(EMAIL.test(x.email), 'Enter a valid email address', 'email')
      need(x.password.length >= 8, 'Use at least 8 characters', 'password')
      need(x.addresses.length, 'Add at least one address', 'addresses')
      x.addresses.forEach((a, i) => {
        need(a.street.trim(), 'Enter a street', 'addresses', i, 'street')
        need(a.city.trim(), 'Enter a city', 'addresses', i, 'city')
      })
      return issues.length ? { issues } : { value: { ...x, email: x.email.trim().toLowerCase() } }
    },
  },
}

const zAddress = z.object({ id: z.number(), street: z.string().trim().min(1, 'Enter a street'), city: z.string().trim().min(1, 'Enter a city') })
export const zodSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.string().regex(EMAIL, 'Enter a valid email address').transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8, 'Use at least 8 characters'),
  addresses: z.array(zAddress).min(1, 'Add at least one address'),
})

const vAddress = v.object({
  id: v.number(),
  street: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter a street')),
  city: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter a city')),
})
export const valibotSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter your name')),
  email: v.pipe(v.string(), v.regex(EMAIL, 'Enter a valid email address'), v.transform((s) => s.trim().toLowerCase())),
  password: v.pipe(v.string(), v.minLength(8, 'Use at least 8 characters')),
  addresses: v.pipe(v.array(vAddress), v.minLength(1, 'Add at least one address')),
})
// an async schema (validate returns a Promise): valibot's async pipeline
export const valibotAsyncSchema = v.pipeAsync(valibotSchema, v.checkAsync(async (x) => x.name !== 'Mallory', 'That name is not allowed'))

export const emptyValues = () => ({ name: '', email: '', password: '', addresses: [{ id: 1, street: '', city: '' }] })

// ── Shape A: the `form` behavior ──────────────────────────────────

const input = (uid, key, f, label, type) => [
  h('label', { for: uid(key) }, label),
  h('input', { id: uid(key), name: f.name, type, value: f.value, 'aria-invalid': f.invalid, 'aria-describedby': uid(key + '-error') }),
]

export function AddressA({ state, fields, uid }) {
  const street = fields[`addresses.${state.id}.street`], city = fields[`addresses.${state.id}.city`]
  return h('div', { className: 'address' },
    ...input(uid, 'street', street, 'Street'),
    h('p', { id: uid('street-error'), className: 'error' }, street.error),
    ...input(uid, 'city', city, 'City'),
    h('p', { id: uid('city-error'), className: 'error' }, city.error),
    h('button', { type: 'button', className: 'remove' }, 'Remove address'))
}
AddressA.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
AddressA.model = { REMOVE: { PARENT: (state) => ({ field: 'addresses', id: state.id }) } }

export function SignupA({ state, uid }) {
  const { fields: f, submitting, error } = state.form
  return h('form', { className: 'signup', noValidate: true },
    ...input(uid, 'name', f.name, 'Name'),
    h('p', { id: uid('name-error'), className: 'error' }, f.name.error),
    ...input(uid, 'email', f.email, 'Email', 'email'),
    h('p', { id: uid('email-error'), className: 'error' }, f.email.pending ? 'Checking…' : f.email.error),
    ...input(uid, 'password', f.password, 'Password', 'password'),
    h('p', { id: uid('password-error'), className: 'error' }, f.password.error),
    h('fieldset', { 'aria-describedby': uid('addresses-error') },
      h('legend', null, 'Addresses'),
      h(Collection, { of: AddressA, from: { get: (s) => s.form.values.addresses }, fields: f, className: 'addresses' }),
      h('p', { id: uid('addresses-error'), className: 'error' }, f.addresses.error),
      h('button', { type: 'button', className: 'add-address' }, 'Add address')),
    h('p', { className: 'form-error', role: 'alert' }, error),
    h('button', { type: 'submit', disabled: submitting }, submitting ? 'Signing up…' : 'Sign up'),
    h('p', { className: 'done', role: 'status' }, state.done ? 'Welcome!' : ''))
}
SignupA.initialState = { done: false }
export const emailCheck = {
  request: (email) => ({ url: '/api/email-available', query: { email } }),
  error: (body) => !body.available && 'This email is already registered',
}
SignupA.uses = { form: form(signupSchema, { values: emptyValues(), submit: 'SIGN_UP', check: { email: emailCheck } }) }
SignupA.intent = ({ DOM, CHILD }) => ({
  'form.ADD': DOM.click('.add-address').mapTo({ field: 'addresses', value: { street: '', city: '' } }),
  'form.REMOVE': CHILD.select(AddressA),
})
SignupA.model = {
  SIGN_UP: { HTTP: (state, values) => ({ url: '/api/signup', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
  'form.DONE': (state) => ({ ...state, done: true }),
}

/** SignupA's view, intent and model with another schema / options */
export const signupWith = (schema, options = {}) => {
  const C = (props) => SignupA(props)
  C.initialState = SignupA.initialState
  C.intent = SignupA.intent
  C.model = SignupA.model
  C.uses = { form: form(schema, { values: emptyValues(), submit: 'SIGN_UP', ...options }) }
  return C
}

// ── Shape B: plain model actions + the helpers ───────────────────

const shown = (state, name) => state.server[name] || (name === 'email' && state.emailTaken) ||
  ((state.touched[name] || state.submitCount > 0) && state.errors[name]) || ''

export function AddressB({ state, errorOf, uid }) {
  const street = `addresses.${state.id}.street`, city = `addresses.${state.id}.city`
  const fld = (n, value) => ({ name: n, value, invalid: !!errorOf(n) })
  return h('div', { className: 'address' },
    ...input(uid, 'street', fld(street, state.street), 'Street'),
    h('p', { id: uid('street-error'), className: 'error' }, errorOf(street)),
    ...input(uid, 'city', fld(city, state.city), 'City'),
    h('p', { id: uid('city-error'), className: 'error' }, errorOf(city)),
    h('button', { type: 'button', className: 'remove' }, 'Remove address'))
}
AddressB.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
AddressB.model = { REMOVE: { PARENT: (state) => ({ id: state.id }) } }

export function SignupB({ state, uid }) {
  const v = state.values, err = (name) => shown(state, name), fld = (n) => ({ name: n, value: v[n], invalid: !!err(n) })
  return h('form', { className: 'signup', noValidate: true },
    ...input(uid, 'name', fld('name'), 'Name'),
    h('p', { id: uid('name-error'), className: 'error' }, err('name')),
    ...input(uid, 'email', fld('email'), 'Email', 'email'),
    h('p', { id: uid('email-error'), className: 'error' }, state.checking ? 'Checking…' : err('email')),
    ...input(uid, 'password', fld('password'), 'Password', 'password'),
    h('p', { id: uid('password-error'), className: 'error' }, err('password')),
    h('fieldset', { 'aria-describedby': uid('addresses-error') },
      h('legend', null, 'Addresses'),
      h(Collection, { of: AddressB, from: { get: (s) => s.values.addresses }, errorOf: err, className: 'addresses' }),
      h('p', { id: uid('addresses-error'), className: 'error' }, err('addresses')),
      h('button', { type: 'button', className: 'add-address' }, 'Add address')),
    h('p', { className: 'form-error', role: 'alert' }, state.server['']),
    h('button', { type: 'submit', disabled: state.submitting }, state.submitting ? 'Signing up…' : 'Sign up'),
    h('p', { className: 'done', role: 'status' }, state.done ? 'Welcome!' : ''))
}

const startValues = emptyValues()
SignupB.initialState = {
  values: startValues, errors: formErrors(signupSchema, startValues), touched: {}, server: {}, submitCount: 0, submitting: false,
  checking: null, checkedEmail: null, emailTaken: '', done: false,
}
const withValues = (state, values) => ({ ...state, values, errors: formErrors(signupSchema, values) })
const needsCheck = (state) => !state.errors.email && state.values.email !== state.checkedEmail && state.values.email !== state.checking
const blocked = (state, errors) => Object.keys(errors).length > 0 || !!state.emailTaken || !!state.checking

SignupB.intent = ({ DOM, CHILD }) => ({
  CHANGE: DOM.select('.signup').events('input').map((e) => ({ name: e.target.name, value: e.target.value })),
  BLUR: DOM.select('.signup').events('focusout').map((e) => e.target.name),
  SUBMIT: DOM.select('.signup').events('submit', { preventDefault: true }),
  ADD_ADDRESS: DOM.click('.add-address'),
  REMOVE_ADDRESS: CHILD.select(AddressB),
})
SignupB.model = {
  CHANGE: (state, { name, value }) => ({
    ...withValues(state, setField(state.values, name, value)),
    server: { ...state.server, [name]: '', '': '' },
    emailTaken: name === 'email' ? '' : state.emailTaken,
  }),
  BLUR: {
    STATE: (state, name) => (name ? { ...state, touched: { ...state.touched, [name]: true }, checking: name === 'email' && needsCheck(state) ? state.values.email : state.checking } : ABORT),
    HTTP: (state, name) => (name === 'email' && needsCheck(state)
      ? { url: '/api/email-available', query: { email: state.values.email }, ok: 'EMAIL_CHECKED', error: 'EMAIL_CHECK_FAILED', latest: true }
      : ABORT),
  },
  EMAIL_CHECKED: (state, body) => ({ ...state, checking: null, checkedEmail: state.checking, emailTaken: body.available ? '' : 'This email is already registered' }),
  EMAIL_CHECK_FAILED: (state) => ({ ...state, checking: null }),
  SUBMIT: {
    STATE: (state) => (state.submitting ? ABORT : { ...state, submitCount: state.submitCount + 1, submitting: !blocked(state, state.errors) }),
    ELEMENT: (state) => (state.submitting ? ABORT : focusInvalid({ ...state.errors, email: state.errors.email || state.emailTaken })),
    HTTP: (state) => (state.submitting || blocked(state, state.errors) ? ABORT
      : { url: '/api/signup', method: 'POST', json: checkForm(signupSchema, state.values).value, ok: 'SIGNED_UP', error: 'SIGNUP_FAILED' }),
  },
  SIGNED_UP: (state) => ({ ...state, submitting: false, done: true }),
  SIGNUP_FAILED: {
    STATE: (state, reply) => ({ ...state, submitting: false, server: replyErrors(reply) }),
    ELEMENT: (state, reply) => focusInvalid(replyErrors(reply)),
  },
  ADD_ADDRESS: (state) => {
    const rows = state.values.addresses, id = Math.max(0, ...rows.map((r) => r.id)) + 1
    return withValues(state, { ...state.values, addresses: [...rows, { id, street: '', city: '' }] })
  },
  REMOVE_ADDRESS: (state, { id }) => withValues(state, { ...state.values, addresses: state.values.addresses.filter((r) => r.id !== id) }),
}
