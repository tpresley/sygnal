// PLAN-5 F-1 in a real browser (each engine): the `form` behavior with real keyboard input
// (typing, Tab, Enter submits), a field array in a Collection, an async email check through
// makeFetchDriver (an in-page fetch), focus on the first invalid field inside a Collection row
// after a failed submit, and server errors focusing their field.
import { run, Collection, form, makeFetchDriver } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Forms (PLAN-5 F-1)'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (cat, name, fn, ms) => run_(cat, name, async () => { try { await fn() } finally { clearStage() } }, ms)

const EMAIL = /^\S+@\S+\.\S+$/
const schema = {
  '~standard': {
    version: 1,
    vendor: 'browser-tests',
    validate(x) {
      const issues = []
      const need = (ok, message, ...path) => ok || issues.push({ message, path })
      need(EMAIL.test(x.email), 'Enter a valid email address', 'email')
      need(x.addresses.length, 'Add at least one address', 'addresses')
      x.addresses.forEach((a, i) => need(a.city.trim(), 'Enter a city', 'addresses', i, 'city'))
      return issues.length ? { issues } : { value: { ...x, email: x.email.trim().toLowerCase() } }
    },
  },
}

// error lines keep their height: a message appearing on blur (mousedown) must not move the
// button under the pointer before mouseup, or the click is lost (a real layout-shift hazard)
const LINE = { minHeight: '1.25em', margin: 0, lineHeight: '1.25em' }

function Address({ state, fields, uid }) {
  const city = fields[`addresses.${state.id}.city`]
  return (
    <div className="address" data-id={state.id}>
      <label for={uid('city')}>City</label>
      <input id={uid('city')} name={city.name} value={city.value} aria-invalid={city.invalid} aria-describedby={uid('city-error')} />
      <p id={uid('city-error')} className="error" style={LINE}>{city.error}</p>
      <button type="button" className="remove">Remove address</button>
    </div>
  )
}
Address.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
Address.model = { REMOVE: { PARENT: (state) => ({ field: 'addresses', id: state.id }) } }

function Signup({ state, uid }) {
  const f = state.form.fields
  return (
    <form className="signup" noValidate>
      <label for={uid('email')}>Email</label>
      <input id={uid('email')} name="email" type="email" value={f.email.value} aria-invalid={f.email.invalid} aria-describedby={uid('email-error')} />
      <p id={uid('email-error')} className="email-error" style={LINE}>{f.email.pending ? 'Checking…' : f.email.error}</p>
      <fieldset>
        <legend>Addresses</legend>
        <Collection of={Address} from={{ get: (s) => s.form.values.addresses }} fields={f} />
        <button type="button" className="add-address">Add address</button>
      </fieldset>
      <p className="form-error" role="alert" style={LINE}>{state.form.error}</p>
      <button type="submit" className="submit" disabled={state.form.submitting}>Sign up</button>
      <p className="done">{state.done ? 'Welcome!' : ''}</p>
    </form>
  )
}
Signup.initialState = { done: false }
Signup.uses = {
  form: form(schema, {
    values: { email: '', addresses: [{ id: 1, city: '' }] },
    submit: 'SIGN_UP',
    check: { email: { request: (email) => ({ url: '/api/email-available', query: { email } }), error: (b) => !b.available && 'This email is already registered' } },
  }),
}
Signup.intent = ({ DOM, CHILD }) => ({
  'form.ADD': DOM.click('.add-address').mapTo({ field: 'addresses', value: { city: '' } }),
  'form.REMOVE': CHILD.select(Address),
})
Signup.model = {
  SIGN_UP: { HTTP: (state, values) => ({ url: '/api/signup', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
  'form.DONE': (state) => ({ ...state, done: true }),
}

// an in-page server: taken@example.com is taken; a signup in Atlantis is refused (422)
function makeServer() {
  const log = []
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch = async (url, init = {}) => {
    const u = new URL(url, location.href)
    log.push(u.pathname)
    await new Promise((r) => setTimeout(r, 20))
    if (u.pathname === '/api/email-available') return json(200, { available: u.searchParams.get('email') !== 'taken@example.com' })
    if (u.pathname === '/api/signup') {
      const body = JSON.parse(init.body)
      const bad = body.addresses.find((a) => a.city === 'Atlantis')
      return bad ? json(422, { errors: { [`addresses.${bad.id}.city`]: 'Unknown city' } }) : json(201, { id: 7 })
    }
    return json(404, {})
  }
  return { fetch, log }
}

async function start() {
  const { id, el } = mountOnScreen()
  const server = makeServer()
  const app = run(Signup, { HTTP: makeFetchDriver({ fetch: server.fetch }) }, { mountPoint: id })
  await waitFor(() => el.querySelector('.signup'))
  await wait(30)
  return { id, el, app, server }
}

// waitFor with what the page showed when it timed out
const until = (pred, ms, what) => waitFor(pred, ms).catch(() => { throw new Error(`waitFor timeout: ${what()}`) })
const field = (el, name) => el.querySelector(`[name="${name}"]`)
const errorOf = (el, name) => document.getElementById(field(el, name).getAttribute('aria-describedby')).textContent

export async function formTestsP5F1() {
  const show = (el, server) => () => `active=${document.activeElement?.name || document.activeElement?.tagName} log=${server.log} email=${errorOf(el, 'email')} rows=${[...el.querySelectorAll('.address')].map((r) => r.dataset.id + ':' + r.querySelector('input').value + ':' + r.querySelector('.error').textContent)} form=${el.querySelector('.form-error').textContent} disabled=${el.querySelector('.submit').disabled}`
  await runTest(CAT, 'typing + Tab validates on blur; Enter submits; the first invalid field (in a Collection row) gets focus', async () => {
    if (!hasPw()) return
    const { id, el, app, server } = await start()
    try {
      await window.__pw('type', `${id} [name="email"]`, 'nope')
      await window.__pw('press', `${id} [name="email"]`, 'Tab')
      await until(() => errorOf(el, 'email') === 'Enter a valid email address', 1500, show(el, server))
      assert(field(el, 'email').getAttribute('aria-invalid') === 'true', 'aria-invalid="true"')
      await window.__pw('fill', `${id} [name="email"]`, '')
      await window.__pw('type', `${id} [name="email"]`, 'Ada@Example.com')
      await until(() => errorOf(el, 'email') === '', 1500, show(el, server))
      await window.__pw('press', `${id} [name="email"]`, 'Enter')       // implicit submission
      await until(() => document.activeElement === field(el, 'addresses.1.city'), 2000, show(el, server))
      assert(errorOf(el, 'addresses.1.city') === 'Enter a city', `city error: ${errorOf(el, 'addresses.1.city')}`)
      assert(!server.log.includes('/api/signup'), 'nothing posted')
    } finally { app.dispose() }
  }, 15000)

  await runTest(CAT, 'field array, async check, queued submit, server error focused in a row, then saved', async () => {
    if (!hasPw()) return
    const { id, el, app, server } = await start()
    try {
      await window.__pw('type', `${id} [name="email"]`, 'taken@example.com')
      await window.__pw('press', `${id} [name="email"]`, 'Tab')
      await until(() => errorOf(el, 'email') === 'This email is already registered', 2000, show(el, server))
      await window.__pw('fill', `${id} [name="email"]`, 'ada@example.com')
      await window.__pw('click', `${id} .add-address`)
      await until(() => el.querySelectorAll('.address').length === 2, 1500, show(el, server))
      await window.__pw('type', `${id} [name="addresses.1.city"]`, 'Oslo')
      await window.__pw('type', `${id} [name="addresses.2.city"]`, 'Atlantis')
      await window.__pw('click', `${id} .submit`)                          // the email check runs first, then the post
      await until(() => server.log.includes('/api/signup'), 2000, show(el, server))
      assert(server.log.indexOf('/api/email-available', 1) < server.log.indexOf('/api/signup'), `order: ${server.log}`)
      await until(() => errorOf(el, 'addresses.2.city') === 'Unknown city', 2000, show(el, server))
      await until(() => document.activeElement === field(el, 'addresses.2.city'), 2000, show(el, server))
      await window.__pw('click', `${id} .address[data-id="1"] .remove`)    // row 2 keeps its error
      await until(() => el.querySelectorAll('.address').length === 1, 1500, show(el, server))
      assert(errorOf(el, 'addresses.2.city') === 'Unknown city', 'error stays with its row')
      await window.__pw('fill', `${id} [name="addresses.2.city"]`, 'Bergen')
      await until(() => errorOf(el, 'addresses.2.city') === '', 1500, show(el, server))
      await window.__pw('click', `${id} .submit`)
      await until(() => el.querySelector('.done').textContent === 'Welcome!', 2000, show(el, server))
      assert(!el.querySelector('.submit').disabled, 'submit enabled again')
    } finally { app.dispose() }
  }, 20000)
}
