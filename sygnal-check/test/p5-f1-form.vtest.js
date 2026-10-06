/**
 * PLAN-5 F-1: sygnal-check and the first-party `form` behavior (FIRST_PARTY.form in
 * src/model/behaviors.js): options are form()'s second argument (SYG127 typos), fields inside
 * the form element (and inside its Collection items) are listened to (SYG111), the host's
 * `submit` action is triggered by the behavior (SYG102), host entries for form actions are
 * accepted (open model), and the canonical signup recipe is clean under --strict and a11y.
 * Field arrays (D233): the canonical form renders the rows inline in the form's own view with
 * form.ADD / form.REMOVE from the host's intent; rows as Collection components (for rows that
 * need their own component, guide/forms-reference "Rows as components") stay clean, unflagged.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-p5-f1-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp, ...opts })
}
const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()

const SCHEMA = `export const signupSchema = { '~standard': { version: 1, vendor: 'app', validate: (value) => ({ value }) } }
`

// the canonical recipe (docs guide/forms): field array rows inline, form.ADD / form.REMOVE (D233)
const SIGNUP = (opts = "values: { name: '', email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP'", extra = '') => `import { form } from 'sygnal'
import { signupSchema } from './schema.js'

export function Signup({ state, uid }) {
  const f = state.form.fields
  const rows = state.form.values.addresses
  return (
    <form className="signup" noValidate>
      <label for={uid('name')}>Name</label>
      <input id={uid('name')} name="name" value={f.name.value} aria-invalid={f.name.invalid} aria-describedby={uid('name-error')} />
      <p id={uid('name-error')}>{f.name.error}</p>
      <label for={uid('email')}>Email</label>
      <input id={uid('email')} name="email" type="email" value={f.email.value} aria-invalid={f.email.invalid} aria-describedby={uid('email-error')} />
      <p id={uid('email-error')}>{f.email.error}</p>
      {rows.map((row, i) => {
        const city = f[\`addresses.\${row.id}.city\`]
        return (
          <fieldset className="address">
            <legend>Address {i + 1}</legend>
            <label for={uid(\`city-\${row.id}\`)}>City</label>
            <input id={uid(\`city-\${row.id}\`)} name={city.name} value={city.value} aria-invalid={city.invalid} aria-describedby={uid(\`city-\${row.id}-error\`)} />
            <p id={uid(\`city-\${row.id}-error\`)}>{city.error}</p>
            <button type="button" className="remove" data-id={row.id} disabled={rows.length === 1}>Remove</button>
          </fieldset>
        )
      })}
      <p>{f.addresses.error}</p>
      <button type="button" className="add">Add address</button>
      <p role="alert">{state.form.error}</p>
      <button type="submit" disabled={state.form.submitting}>Sign up</button>
    </form>
  )
}
Signup.uses = { form: form(signupSchema, { ${opts} }) }
Signup.intent = ({ DOM }) => ({
  'form.ADD': DOM.click('.add').mapTo({ field: 'addresses', value: { city: '' } }),
  'form.REMOVE': DOM.click('.remove').map((e) => ({ field: 'addresses', id: e.target.dataset.id })),
})
Signup.model = {
  SIGN_UP: { HTTP: (state, values) => ({ url: '/api/signup', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
${extra}}
`

// rows as components (docs guide/forms-reference "Rows as components"): for rows that need their
// own component; documented, not flagged (D233)
const SIGNUP_ROW_COMPONENTS = `import { Collection, form } from 'sygnal'
import { signupSchema } from './schema.js'

function Address({ state, fields, uid }) {
  const city = fields[\`addresses.\${state.id}.city\`]
  return (
    <div className="address">
      <label for={uid('city')}>City</label>
      <input id={uid('city')} name={city.name} value={city.value} aria-invalid={city.invalid} aria-describedby={uid('city-error')} />
      <p id={uid('city-error')}>{city.error}</p>
      <button type="button" className="remove">Remove</button>
    </div>
  )
}
Address.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
Address.model = { REMOVE: { PARENT: (state) => ({ field: 'addresses', id: state.id }) } }

export function Signup({ state, uid }) {
  const f = state.form.fields
  return (
    <form className="signup" noValidate>
      <label for={uid('email')}>Email</label>
      <input id={uid('email')} name="email" type="email" value={f.email.value} aria-invalid={f.email.invalid} aria-describedby={uid('email-error')} />
      <p id={uid('email-error')}>{f.email.error}</p>
      <Collection of={Address} from={{ get: (s) => s.form.values.addresses }} fields={f} />
      <button type="button" className="add">Add address</button>
      <button type="submit" disabled={state.form.submitting}>Sign up</button>
    </form>
  )
}
Signup.uses = { form: form(signupSchema, { values: { email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP' }) }
Signup.intent = ({ DOM, CHILD }) => ({
  'form.ADD': DOM.click('.add').mapTo({ field: 'addresses', value: { city: '' } }),
  'form.REMOVE': CHILD.select(Address),
})
Signup.model = {
  SIGN_UP: { HTTP: (state, values) => ({ url: '/api/signup', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
}
`

describe('F-1: the form behavior in sygnal-check', () => {
  it('the canonical recipe has no findings (strict, a11y)', () => {
    expect(check({ 'schema.js': SCHEMA, 'Signup.jsx': SIGNUP() }, { strict: true })).toEqual([])
  })

  it('rows as Collection components (rows that need their own component) are clean too, not flagged (D233)', () => {
    expect(check({ 'schema.js': SCHEMA, 'Signup.jsx': SIGNUP_ROW_COMPONENTS }, { strict: true })).toEqual([])
  })

  it('rows as Collection components without the behavior: the fields inside the items are uncontrolled (SYG111)', () => {
    const src = SIGNUP_ROW_COMPONENTS.replace("Signup.uses = { form: form(signupSchema, { values: { email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP' }) }", "Signup.initialState = { form: { fields: {}, submitting: false, values: { addresses: [] } } }")
    const d = check({ 'schema.js': SCHEMA, 'Signup.jsx': src }).filter(x => x.code === 'SYG111')
    // with the behavior (the test above) the item's field is listened to: it is the behavior that does it
    expect(d.some(x => x.message.includes("Address's intent has no input/change listener"))).toBe(true)
  })

  it('host entries for form actions (form.DONE) are accepted', () => {
    expect(check({ 'schema.js': SCHEMA, 'Signup.jsx': SIGNUP(undefined, "  'form.DONE': (state) => state,\n") }, { strict: true })).toEqual([])
  })

  it('an option typo is SYG127 (options are the second argument)', () => {
    const d = check({ 'schema.js': SCHEMA, 'Signup.jsx': SIGNUP("values: { name: '', email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP', shwo: 'input'") })
    expect(codes(d)).toEqual(['SYG127 error'])
    expect(d[0].message).toContain("'shwo'")
  })

  it('without the form behavior, the same inputs are uncontrolled (SYG111): the behavior is what listens', () => {
    const src = SIGNUP().replace("Signup.uses = { form: form(signupSchema, { values: { name: '', email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP' }) }", "Signup.initialState = { form: { fields: {}, error: '', submitting: false, values: { addresses: [] } } }")
    const d = check({ 'schema.js': SCHEMA, 'Signup.jsx': src }).filter(x => x.code === 'SYG111')
    expect(d.length).toBeGreaterThan(0)
  })

  it('a form option selects the form element: fields outside it are not listened to', () => {
    const src = SIGNUP("values: { name: '', email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP', form: '.other'")
    const d = check({ 'schema.js': SCHEMA, 'Signup.jsx': src }).filter(x => x.code === 'SYG111')
    expect(d.length).toBeGreaterThan(0)
  })

  it('the submit action counts as triggered; a model entry nobody triggers still is SYG102', () => {
    const d = check({ 'schema.js': SCHEMA, 'Signup.jsx': SIGNUP(undefined, "  NEVER: (state) => state,\n") })
    expect(d.map(x => x.code)).toEqual(['SYG102'])
    expect(d[0].message).toContain('NEVER')
  })
})
