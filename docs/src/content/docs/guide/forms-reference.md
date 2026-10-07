---
title: Forms Reference
description: The form behavior in detail — the slice and actions, any Standard Schema, async checks, two forms, rows as components, resetting, the helpers, diagnostics and processForm()
---

The details of the [`form` behavior](/guide/forms/). Start with the recipe on [Forms](/guide/forms/): it covers validation, the submit, pending state, server errors and field arrays.

## The slice

`state.form` holds:

| Field | |
|---|---|
| `values`, `initial` | The current values, and the ones the form started with (or was last saved or reset with) |
| `errors` | Every current schema error by field name, shown or not |
| `touched`, `server`, `remote`, `pending` | Blurred fields; [server errors](/guide/forms/#server-errors-and-failed-submits); [check](#async-checks) results; checks running |
| `submitting`, `submitted`, `submitCount`, `queued`, `validating`, `validated` | Submit state: the request sent and not answered yet; `form.DONE` arrived (or a submit without a request was dispatched); attempts; a submit waits for a check or an async schema; an async schema runs; the schema has answered since the start or the last reset |
| `fields`, `valid`, `dirty`, `error` | Calculated: per-field view data; no errors as of the schema's last answer (`false` before the first); values differ from `initial`; the form-level message |

The options are on [Forms](/guide/forms/#options).

## The actions

Named after the `uses` key (`form.CHANGE` for `uses = { form: … }`):

| Action | Data |
|---|---|
| `form.CHANGE` | `{ name, value }`: from the form element's `input` events ([field types](/guide/forms/#field-types); a checkbox gives `checked`, and its `value` as `item`) |
| `form.BLUR` | The field name, from `focusout` |
| `form.SUBMIT` | From the form element's `submit` (default prevented) |
| `form.ADD` / `form.REMOVE` | `{ field, value }` / `{ field, id }`: [field array](/guide/forms/#field-arrays) rows |
| `form.ERRORS` | Server errors: an error reply, a map or a list of issues |
| `form.DONE` | The submit's request was saved: `initial` becomes `values`, `submitted` turns on ([a submit without a request](/guide/forms/#submit-without-a-request) needs none) |
| `form.RESET` | Back to `initial`, or to the values given |
| `form.VALIDATE` | Internal: the first validation when the host starts; with `resetOnShow`, the start over (also each time the form element appears again) |

As for any behavior, a host model entry with the same name runs after the form's: `'form.DONE': (state) => ({ ...state, done: true })` shows a confirmation. Trigger an action from elsewhere with an intent action of that name, or `t.simulateAction('form.RESET')` in a test.

## Any Standard Schema

`form()` takes any object with `~standard.validate`: zod (3.24 and later), valibot (1.0 and later), arktype, or one you write. A schema's issue paths become field names, and an issue without a path is a form-level message (`state.form.error`, shown after a submit):

```js
const EMAIL = /^\S+@\S+\.\S+$/

export const signupSchema = {
  '~standard': {
    version: 1,
    vendor: 'my-app',
    validate(values) {
      const issues = []
      if (!values.name.trim()) issues.push({ message: 'Enter your name', path: ['name'] })
      if (!EMAIL.test(values.email)) issues.push({ message: 'Enter a valid email address', path: ['email'] })
      return issues.length ? { issues } : { value: { ...values, email: values.email.trim().toLowerCase() } }
    },
  },
}
```

An async schema (valibot's `pipeAsync`, zod's async refinements) works too: `state.form.validating` is `true` while it runs (also at the start, until its first answer) and a submit waits for it. `state.form.valid` is `false` until the first answer; after that it keeps the last answer's validity while the schema re-validates, so `<button disabled={!state.form.valid}>` doesn't flicker on every keystroke (show progress with `validating`). The schema first runs when the component starts, not when `form()` is called. Something that isn't a Standard Schema is [SYG231](/reference/errors/#syg231).

## Async checks

Some checks need the server: is this email address taken? `check` names a field and the request that checks it. The request goes to the `HTTP` driver ([`makeFetchDriver`](/guide/http/)) with a reply action the form handles, and `latest: true`, so a check for a newer value replaces the older one:

```jsx
import { form } from 'sygnal'
import { signupSchema } from './schema.js'

function Signup({ state, uid }) {
  const f = state.form.fields
  return (
    <form className="signup" noValidate>
      <label for={uid('email')}>Email</label>
      <input id={uid('email')} name="email" type="email" value={f.email.value} aria-invalid={f.email.invalid} aria-describedby={uid('email-error')} />
      <p id={uid('email-error')}>{f.email.pending ? 'Checking…' : f.email.error}</p>
      <button type="submit" disabled={state.form.submitting}>Sign up</button>
    </form>
  )
}

Signup.uses = {
  form: form(signupSchema, {
    values: { email: '' },
    submit: 'SIGN_UP',
    check: {
      email: {
        request: (email) => ({ url: '/api/email-available', query: { email } }),
        error: (body) => !body.available && 'This email is already registered',
      },
    },
  }),
}

Signup.model = {
  SIGN_UP: { HTTP: (state, values) => ({ url: '/api/signup', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
}
```

- A field is checked when it loses focus, once per value, and only when its schema error is clear and it isn't empty. `error(body)` turns the reply into a message, or a falsy value when the value is fine.
- A submit while a check runs (or before a field was ever checked) waits for it: `state.form.queued` is `true`, and the submit goes on once every check passed, or stops and focuses the field whose check failed. Checks for several fields run one after the other.
- Editing the field drops its check: a late reply for the old value is ignored. Editing any field cancels a queued submit.
- A check that fails (network error, 500) doesn't block the form: the server validates again on submit.

A test answers the check like any request:

```jsx
import { renderComponent } from 'sygnal'
import { it, expect } from 'vitest'
import Signup from './Signup.jsx'

it('validates, checks the email, and posts the cleaned values', async () => {
  const t = renderComponent(Signup, { strict: true })
  await t.ready()
  t.simulateEvent('[name="email"]', 'input', { value: 'nope' })
  t.simulateEvent('[name="email"]', 'focusout')
  await t.settle()
  expect(t.state.form.fields.email.error).toBe('Enter a valid email address')

  t.simulateEvent('[name="email"]', 'input', { value: 'Ada@Example.com' })
  t.simulateEvent('[name="email"]', 'focusout')
  await t.settle()
  expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/email-available' })
  await t.respond('HTTP', { available: true })

  t.simulateEvent('.signup', 'submit')
  await t.settle()
  expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/signup', json: { email: 'ada@example.com' } })
  await t.fail('HTTP', { status: 422, body: { errors: { email: 'Already registered' } } })
  expect(t.state.form.fields.email.error).toBe('Already registered')
  t.expectNoDiagnostics()
})
```

## Two forms in one component

Each `form` use listens on its `form` selector inside the component, so two uses left at the default `'form'` would both hear every form element: typing in one changes the other, and each submit is handled twice. Give each form element a class and pass it ([SYG237](/reference/errors/#syg237) warns otherwise); the first invalid field focused on submit is then also searched in that form only:

```jsx
import { form } from 'sygnal'
import { loginSchema, newsSchema } from './schemas.js'

function Account({ state }) {
  const login = state.login.fields, news = state.news.fields
  return (
    <div>
      <form className="login" noValidate>
        <input name="email" aria-label="Email" value={login.email.value} />
        <button type="submit">Sign in</button>
      </form>
      <form className="news" noValidate>
        <input name="email" aria-label="Newsletter email" value={news.email.value} />
        <button type="submit">Subscribe</button>
      </form>
    </div>
  )
}

Account.uses = {
  login: form(loginSchema, { values: { email: '' }, submit: 'SIGN_IN', form: '.login' }),
  news: form(newsSchema, { values: { email: '' }, submit: 'SUBSCRIBE', form: '.news' }),
}

Account.model = {
  SIGN_IN: { HTTP: (state, values) => ({ url: '/api/sign-in', method: 'POST', json: values, ok: 'login.DONE', error: 'login.ERRORS' }) },
  SUBSCRIBE: { HTTP: (state, values) => ({ url: '/api/newsletter', method: 'POST', json: values, ok: 'news.DONE', error: 'news.ERRORS' }) },
}
```

## Rows as components

The [recipe](/guide/forms/#the-recipe) renders [field array](/guide/forms/#field-arrays) rows inline, which needs no child component. When a row is big enough to be a component of its own, render the rows with a [Collection](/guide/collections/), pass `fields` down, and send the remove up with `PARENT`:

```jsx
import { Collection, form } from 'sygnal'
import { signupSchema } from './schema.js'

function Address({ state, fields, uid }) {
  const city = fields[`addresses.${state.id}.city`]
  return (
    <div className="address">
      <label for={uid('city')}>City</label>
      <input id={uid('city')} name={city.name} value={city.value} aria-invalid={city.invalid} aria-describedby={uid('city-error')} />
      <p id={uid('city-error')}>{city.error}</p>
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
      <p id={uid('email-error')}>{f.email.error}</p>
      <fieldset aria-describedby={uid('addresses-error')}>
        <legend>Addresses</legend>
        <Collection of={Address} from={{ get: (s) => s.form.values.addresses }} fields={f} />
        <p id={uid('addresses-error')}>{f.addresses.error}</p>
        <button type="button" className="add-address">Add address</button>
      </fieldset>
      <button type="submit" disabled={state.form.submitting}>Sign up</button>
    </form>
  )
}

Signup.uses = {
  form: form(signupSchema, { values: { email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP' }),
}

Signup.intent = ({ DOM, CHILD }) => ({
  'form.ADD': DOM.click('.add-address').mapTo({ field: 'addresses', value: { city: '' } }),
  'form.REMOVE': CHILD.select(Address),
})

Signup.model = {
  SIGN_UP: { HTTP: (state, values) => ({ url: '/api/signup', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
}
```

- The Collection reads the rows through a read-only lens (`from={{ get }}`): rows don't write their own state, the form does, because the row's inputs are inside the form element.
- Fields of child components and Collection items inside the form element count as the form's fields.
- A failed submit focuses the first invalid field even inside a row.

## Saving and resetting

`form.DONE` marks the submit saved: `submitting` turns off, `submitted` on, and the saved values become `initial` (so `dirty` is `false` again).

Whether a valid submit waits for `form.DONE` depends on the host's entry for the `submit` action, checked when the host starts:

- **With the `http` sink** (`SIGN_UP: { HTTP: … }`, or the sink the `http` option names, such as `http: 'API'`): `submitting` is `true` until `form.DONE` or `form.ERRORS`, and a submit meanwhile is dropped ([SYG232](/reference/errors/#syg232)). Even when the entry returns `ABORT` this time, the form waits.
- **Anything else** (`STATE`, `PARENT`, `EVENTS`, `EFFECT`, `ROUTER`, a reducer function): no request, so the submit is done at once, as if `form.DONE` had arrived (no host `form.DONE` entry runs). An `EFFECT` that calls `next('form.DONE')` itself still works; the second `DONE` changes nothing. Work that answers later without the `http` sink (a promise in an `EFFECT`) gets no pending state: send it through a driver as a request instead.
- **A host that unmounts** keeps its slice in the parent's state when it has a `state` prop. When it mounts again, the form clears `submitting`, `queued` and running checks (their replies went to the old host); the values, errors and `submitted` stay. `form.RESET` goes back to `initial`, or to the values it is given (`t.simulateAction('form.RESET', values)`, or an intent action `'form.RESET': DOM.click('.reset')`); it clears errors, touched fields and the submit count.
- **Starting over when shown** (`resetOnShow: true`): the form goes back to its start values, as a new form (`initial` too; touched fields, errors, server errors, checks and the submit state cleared), when its host starts (mounted again, a Switchable page made again for another `instance`) and each time its form element appears in the host's DOM after being absent (a Switchable page shown again: hidden pages stay alive and keep their state; a form rendered conditionally). Re-renders while the form is shown keep what the user typed. With the mock DOM (and in SSR) only the host's start counts. A `values` function gets the host's whole state and is called at each start over; without `resetOnShow`, once, when the host starts and the slice is still untouched. Before its first call (the first render of a page that reads its parent's state) the fields come from calling it with a blank state, every value read from it `''`.

## Without the behavior: the helpers

The behavior covers the common form. When a form needs its own state layout or flow, write the actions yourself and use the functions the behavior is built on; each is a pure function for a reducer:

| Helper | |
|---|---|
| `checkForm(schema, values)` | `{ errors, value }`: errors by field name and the schema's output; a Promise for an async schema |
| `formErrors(schema, values)` | Only the errors (`{}` when valid) |
| `setField(values, name, value)`, `getField(values, name)`, `hasField(values, name)` | Immutable set and get by field name (rows by id); whether the field exists (also with an `undefined` value) |
| `fieldName(values, path)`, `fieldNames(values)` | An issue path as a field name; every field name of `values` |
| `replyErrors(reply, values?)` | Server errors (a reply, a map or a list of issues) as field errors |
| `focusInvalid(errors, within?)` | An `ELEMENT` command that focuses the first field with an error, children included; with `within` (the form element's selector), only a field inside that element; `ABORT` when there is none |

```jsx
import { formErrors, setField, focusInvalid, ABORT } from 'sygnal'
import { profileSchema } from './schema.js'

function Profile({ state }) {
  return (
    <form className="profile" noValidate>
      <label>Display name <input name="name" value={state.values.name} /></label>
      <p>{state.submitted ? state.errors.name : ''}</p>
      <button type="submit">Save</button>
    </form>
  )
}

Profile.initialState = { values: { name: '' }, errors: formErrors(profileSchema, { name: '' }), submitted: false }

Profile.intent = ({ DOM }) => ({
  CHANGE: DOM.select('.profile').events('input').map((e) => ({ name: e.target.name, value: e.target.value })),
  SUBMIT: DOM.select('.profile').events('submit', { preventDefault: true }),
})

Profile.model = {
  CHANGE: (state, { name, value }) => {
    const values = setField(state.values, name, value)
    return { ...state, values, errors: formErrors(profileSchema, values) }
  },
  SUBMIT: {
    STATE: (state) => ({ ...state, submitted: true }),
    ELEMENT: (state) => focusInvalid(state.errors, '.profile'),
    HTTP: (state) => (Object.keys(state.errors).length ? ABORT : { url: '/api/profile', method: 'PUT', json: state.values }),
  },
}
```

## Diagnostics

With the dev checks on (the Vite plugin in dev, `renderComponent` in tests): [SYG230](/reference/errors/#syg230) a field inside the form whose name isn't in `values`, [SYG231](/reference/errors/#syg231) a schema that isn't a Standard Schema, [SYG232](/reference/errors/#syg232) a submit dropped while one is in progress (info), [SYG233](/reference/errors/#syg233) a value the schema strips from its output, [SYG234](/reference/errors/#syg234) a `submit` action the model doesn't have, [SYG235](/reference/errors/#syg235) a `check` for an unknown field, or a check request that sets `ok`/`error`/`latest`, [SYG236](/reference/errors/#syg236) array rows without an `id`, and [SYG237](/reference/errors/#syg237) two forms in one component on the same selector. `sygnal-check` knows `form`: an option typo is [SYG127](/reference/errors/#syg127), and fields inside the form element are not reported as uncontrolled ([SYG111](/reference/errors/#syg111)).

## processForm()

For a form without validation, `processForm()` reads every named field of a form element on its events:

```jsx
import { processForm } from 'sygnal'

function ContactForm({ state }) {
  return (
    <form className="contact-form">
      <input name="name" aria-label="Name" value={state.name} />
      <input name="email" aria-label="Email" value={state.email} />
      <textarea name="message" aria-label="Message">{state.message}</textarea>
      <button type="submit">Send</button>
    </form>
  )
}

ContactForm.initialState = { name: '', email: '', message: '' }

ContactForm.intent = ({ DOM }) => ({
  // Listen only to submit events
  SUBMIT: processForm(DOM.select('.contact-form'), { events: 'submit' }),

  // Listen to all input changes (default: both 'input' and 'submit')
  FIELD_CHANGE: processForm(DOM.select('.contact-form'))
})

ContactForm.model = {
  FIELD_CHANGE: (state, data) => ({
    ...state,
    name: data.name,
    email: data.email,
    message: data.message
  }),
  SUBMIT: {
    STATE: (state) => ({ ...state, submitted: true }),
    LOG:   (state, data) => data   // { name: '...', email: '...', message: '...', eventType: 'submit', event }
  }
}
```

### processForm() Options

```javascript
processForm(DOM.select('.my-form'), { events: 'submit', preventDefault: true })
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `events` | String or Array | `['input', 'submit']` | Which form events to listen for |
| `preventDefault` | Boolean | `true` | Whether to call `preventDefault()` on events |

### Return Value

The stream emits an object with:
- All form field values keyed by their `name` attribute
- `event` — The raw DOM event
- `eventType` — The event type string (e.g., `'submit'`, `'input'`)
