import { run, form, makeFetchDriver } from 'sygnal'
import { z } from 'zod'
import { fakeFetch } from '../../shared/fakeServer.js'

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  addresses: z.array(z.object({ city: z.string().trim().min(1, 'Enter a city') })).min(1, 'Add at least one address'),
})

export function Signup({ state, uid }) {
  const f = state.form.fields
  const rows = state.form.values.addresses
  return (
    <form className="signup" noValidate>
      <label for={uid('name')}>Name</label>
      <input id={uid('name')} name="name" value={f.name.value} aria-invalid={f.name.invalid} aria-describedby={uid('name-error')} />
      <p className="error" id={uid('name-error')}>{f.name.error}</p>

      <label for={uid('email')}>Email</label>
      <input id={uid('email')} name="email" type="email" value={f.email.value} aria-invalid={f.email.invalid} aria-describedby={uid('email-error')} />
      <p className="error" id={uid('email-error')}>{f.email.error}</p>

      {rows.map((row, i) => {
        const city = f[`addresses.${row.id}.city`]
        return (
          <fieldset className="address">
            <legend>Address {i + 1}</legend>
            <label for={uid(`city-${row.id}`)}>City</label>
            <input id={uid(`city-${row.id}`)} name={city.name} value={city.value} aria-invalid={city.invalid} aria-describedby={uid(`city-${row.id}-error`)} />
            <button type="button" className="remove" data-id={row.id} disabled={rows.length === 1}>Remove</button>
            <p className="error" id={uid(`city-${row.id}-error`)}>{city.error}</p>
          </fieldset>
        )
      })}
      <p className="error">{f.addresses.error}</p>
      <div className="row"><button type="button" className="add">Add address</button></div>

      <p className="error" role="alert">{state.form.error}</p>
      <div className="row">
        <button type="submit" disabled={state.form.submitting}>{state.form.submitting ? 'Signing up…' : 'Sign up'}</button>
      </div>
      <p className="done ok">{state.accountId ? `Account ${state.accountId} created.` : ''}</p>
    </form>
  )
}

Signup.initialState = { accountId: null }

Signup.uses = {
  form: form(signupSchema, { values: { name: '', email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP' }),
}

// no intent per field: the form matches fields by name. Only the row buttons are wired.
Signup.intent = ({ DOM }) => ({
  'form.ADD': DOM.click('.add').mapTo({ field: 'addresses', value: { city: '' } }),
  'form.REMOVE': DOM.click('.remove').map((e) => ({ field: 'addresses', id: e.target.dataset.id })),
})

Signup.model = {
  SIGN_UP: { HTTP: (state, values) => ({ url: '/api/signup', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
  'form.DONE': (state, account) => ({ ...state, accountId: account.id }),
}

export const start = (mountPoint, uid) => run(Signup, { HTTP: makeFetchDriver({ fetch: fakeFetch }) }, { mountPoint, uid })
