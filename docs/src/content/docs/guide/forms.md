---
title: Forms
description: Forms with validation (the form behavior), field arrays, async checks, server errors, testing, labels, controlled inputs and focus
---

A form with validation is one [behavior](/guide/behaviors/): `form(schema, options)` in the component's `uses`. It keeps the values, errors and touched fields in `state.form`, validates with any [Standard Schema](https://standardschema.dev) validator (zod, valibot, arktype, or your own object), and handles the submit: on an invalid submit it shows every error and focuses the first invalid field; on a valid one it dispatches your action with the validated values. Field arrays, async checks (is this email taken?) and server errors are covered too. Sygnal has no validator dependency.

## A form with validation

```jsx
import { form } from 'sygnal'
import { z } from 'zod'

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
})

function Signup({ state, uid }) {
  const f = state.form.fields
  return (
    <form className="signup" noValidate>
      <label for={uid('name')}>Name</label>
      <input id={uid('name')} name="name" value={f.name.value} aria-invalid={f.name.invalid} aria-describedby={uid('name-error')} />
      <p id={uid('name-error')}>{f.name.error}</p>

      <label for={uid('email')}>Email</label>
      <input id={uid('email')} name="email" type="email" value={f.email.value} aria-invalid={f.email.invalid} aria-describedby={uid('email-error')} />
      <p id={uid('email-error')}>{f.email.error}</p>

      <label for={uid('password')}>Password</label>
      <input id={uid('password')} name="password" type="password" value={f.password.value} aria-invalid={f.password.invalid} aria-describedby={uid('password-error')} />
      <p id={uid('password-error')}>{f.password.error}</p>

      <p role="alert">{state.form.error}</p>
      <button type="submit" disabled={state.form.submitting}>{state.form.submitting ? 'Signing up…' : 'Sign up'}</button>
    </form>
  )
}

Signup.uses = {
  form: form(signupSchema, { values: { name: '', email: '', password: '' }, submit: 'SIGN_UP' }),
}

Signup.model = {
  SIGN_UP: { HTTP: (state, values) => ({ url: '/api/signup', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
}
```

That is the whole wiring: there is no intent for the fields.

- **Fields are matched by `name`.** The behavior listens for `input`, `focusout` and `submit` on the form element (`form` option, default `'form'`), so every field inside it with a `name` that is a path in `values` is controlled: `value={f.email.value}` stays in sync as the user types. Fields of child components and Collection items inside the form element count too ([field arrays](#field-arrays)).
- **`state.form.fields[name]`** is what the view needs for each field: `value`, `error` (the message to show, `''` for none), `invalid` (`!!error`, for `aria-invalid`), `touched`, `dirty` and `pending` (an [async check](#async-checks) is running), plus `name`.
- **When errors show**: every change is validated, but a field's schema error shows once the field has lost focus (`show: 'blur'`, the default), or while typing (`show: 'input'`), or only after a submit (`show: 'submit'`). After the first submit every error shows. Server and check errors show at once.
- **An invalid submit** shows every error, focuses the first invalid field in page order and sends nothing.
- **A valid submit** dispatches the `submit` action (`SIGN_UP`) with the schema's output: the trimmed, transformed values (`email` lower-cased here), not the raw ones. `state.form.submitting` is `true` until the host answers with `form.DONE` (saved) or `form.ERRORS` ([server errors](#server-errors)); a second submit meanwhile is dropped, so a double click sends once.
- **Labels and errors**: each field has a label and its error text is linked with `aria-describedby`, with ids from [`uid()`](#labels-and-ids-uid), so the form passes the [accessibility checks](/guide/accessibility/). `aria-invalid={f.email.invalid}` renders `"true"` or `"false"`.

Reserve the height of the error lines in your CSS (`min-height`). A field's error appears when it loses focus, which happens on the mouse*down* of a click elsewhere: if the new line pushes the button down before the mouse*up*, the click is lost.

### Any Standard Schema

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

An async schema (valibot's `pipeAsync`, zod's async refinements) works too: `state.form.validating` is `true` while it runs (also at the start, until its first answer), `state.form.valid` is `false` meanwhile, and a submit waits for it. The schema first runs when the component starts, not when `form()` is called. Something that isn't a Standard Schema is [SYG231](/reference/errors/#syg231).

### The slice, the options and the actions

`state.form` holds:

| Field | |
|---|---|
| `values`, `initial` | The current values, and the ones the form started with (or was last saved or reset with) |
| `errors` | Every current schema error by field name, shown or not |
| `touched`, `server`, `remote`, `pending` | Blurred fields; [server errors](#server-errors); [check](#async-checks) results; checks running |
| `submitting`, `submitted`, `submitCount`, `queued`, `validating` | Submit state: sent and not answered yet; `form.DONE` arrived; attempts; a submit waits for a check or an async schema; an async schema runs |
| `fields`, `valid`, `dirty`, `error` | Calculated: per-field view data; no errors (and not `validating`); values differ from `initial`; the form-level message |

The options:

| Option | |
|---|---|
| `values` | The start values. Field names are paths in it: `email`, `address.city`, and `addresses.7.city` for the row with `id` 7 |
| `submit` | The host action a valid submit dispatches with the schema's output ([SYG234](/reference/errors/#syg234) when the model has no such entry) |
| `check` | [Async checks](#async-checks) by field name |
| `show` | `'blur'` (default), `'input'` or `'submit'`: when a schema error shows |
| `form` | The form element's selector, default `'form'`. Give each form its own when a component has two ([below](#two-forms-in-one-component)) |
| `http` | The driver sink the checks' requests go to, default `'HTTP'` |

The actions, named after the `uses` key (`form.CHANGE` for `uses = { form: … }`):

| Action | Data |
|---|---|
| `form.CHANGE` | `{ name, value }`: from the form element's `input` events (a checkbox gives `checked`) |
| `form.BLUR` | The field name, from `focusout` |
| `form.SUBMIT` | From the form element's `submit` (default prevented) |
| `form.ADD` / `form.REMOVE` | `{ field, value }` / `{ field, id }`: [field array](#field-arrays) rows |
| `form.ERRORS` | Server errors: an error reply or a map |
| `form.DONE` | The submit was saved: `initial` becomes `values`, `submitted` turns on |
| `form.RESET` | Back to `initial`, or to the values given |

As for any behavior, a host model entry with the same name runs after the form's: `'form.DONE': (state) => ({ ...state, done: true })` shows a confirmation. Trigger an action from elsewhere with an intent action of that name, or `t.simulateAction('form.RESET')` in a test.

### Two forms in one component

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

## Field arrays

Rows of an array of objects are named by their `id`, not their position: `addresses.7.city` (`addresses.0.city` names nothing when the rows have ids, also in a server error map, where it becomes the form-level message). So a row's errors, touched state and focus stay with it when another row is removed. Render the rows with a [Collection](/guide/collections/), pass `fields` down, and add and remove rows with `form.ADD` and `form.REMOVE`:

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
- `form.ADD` appends `{ id, ...value }` with the next free id. Start values need ids too ([SYG236](/reference/errors/#syg236)).
- The array itself is a field (`f.addresses`), for an array-level error such as "Add at least one address" (`z.array(…).min(1, …)`).
- A failed submit focuses the first invalid field even inside a row.

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

## Server errors

The server has the last word. Answer the submit with `error: 'form.ERRORS'` and the form puts the reply's errors on the fields, shows them at once and focuses the first one:

```json
{ "errors": { "password": "Too common", "addresses.1.city": "Unknown city" } }
```

`form.ERRORS` accepts an error reply whose body is `{ errors: { name: message } }` (a message or a list of messages per field), the map itself, or a list of `{ path, message }` issues (index paths become row ids). A message for a name that isn't a field (`{ "message": "Down for maintenance" }`) becomes the form-level `state.form.error`, and a reply with no message at all (a network error, an empty body) shows "Request failed (500)". Editing a field clears its server error, and the form-level one.

## Saving and resetting

`form.DONE` marks the submit saved: `submitting` turns off, `submitted` on, and the saved values become `initial` (so `dirty` is `false` again). `form.RESET` goes back to `initial`, or to the values it is given (`t.simulateAction('form.RESET', values)`, or an intent action `'form.RESET': DOM.click('.reset')`); it clears errors, touched fields and the submit count.

## Testing

Simulate events on the fields by name; the form's actions show in `t.actions`:

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

- `t.state.form.fields[name]` is what the view shows; `t.query('[name="email"]').getAttribute('aria-invalid')` checks the markup.
- The focus on a failed submit is an [element command](/guide/element-commands/): `t.commands('ELEMENT').at(-1).focus.within` is the selector of the invalid fields on the default mock DOM; with `renderComponent(Signup, { dom: 'real' })` the field is focused (`document.activeElement`).
- Answer checks and the submit with `t.respond('HTTP', body)` and `t.fail('HTTP', { status, body })`.

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

## Controlled Inputs

An `<input>`, `<textarea>` or `<select>` with a `value` prop (or a checkbox/radio with `checked`) is **controlled**: on every render, Sygnal writes the value from your view into the element, like React does. That keeps the field in sync with state (clearing a field after "Add" works even when both happen in the same tick), but it means the field must update state as the user types. Otherwise any re-render resets what they typed.

A form-associated custom element (one whose class has `static formAssociated = true`, such as Web Awesome's `<wa-input>` or `<wa-rating>`) with a `value` or `checked` prop is controlled the same way.

To refuse what the user entered, return `ABORT` (or the state unchanged): the state stays as it was, and because the action came from an `input` or `change` event, the component still renders, so the field shows the state's value again. A digits-only field:

```jsx
import { ABORT } from 'sygnal'

function Pin({ state }) {
  return <input className="pin" aria-label="PIN" inputMode="numeric" value={state.pin} />
}

Pin.initialState = { pin: '' }
Pin.intent = ({ DOM }) => ({ PIN: DOM.input('.pin').value() })
Pin.model = {
  PIN: (state, pin) => /^\d{0,6}$/.test(pin) ? { ...state, pin } : ABORT,
}
```

This applies only while the `input` or `change` event is being handled (an intent that delays the action, with `debounce` for example, gets no extra render). `ABORT` from any other action (a click, a timer, a reply) still renders nothing.

Pick one of two patterns:

**Controlled**: bind `value` to state and update state on `input`:

```jsx
import { ABORT } from 'sygnal'

function NewTodo({ state }) {
  return (
    <div>
      <input className="new-todo" aria-label="New todo" value={state.draft} />
      <button className="add">Add</button>
    </div>
  )
}

NewTodo.initialState = { draft: '', items: [] }

NewTodo.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.new-todo').value(),
  ADD:   DOM.click('.add'),
})

NewTodo.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD:   (state) => state.draft.trim()
    ? { ...state, items: [...state.items, state.draft.trim()], draft: '' }
    : ABORT,
}
```

**Uncontrolled**: leave out `value`, and read the element's value from the event when you need it (on blur, Enter or submit), or with [`processForm()`](#processform):

```jsx
import { ABORT } from 'sygnal'

function Rename({ state }) {
  return <input className="rename" placeholder={state.title} />
}

Rename.intent = ({ DOM }) => ({
  RENAME: DOM.keydown('.rename').filter(e => e.key === 'Enter').map(e => e.target.value),
})

Rename.model = {
  RENAME: (state, title) => title ? { ...state, title } : ABORT,
}
```

What doesn't work is a bound `value` with no `input`/`change` listener, for example a "save on blur" field that only listens to `blur`: the first re-render while the user types puts the old value back. `sygnal-check` reports that as [SYG111](/reference/errors/#syg111). Literal values (`value=""`) are controlled too, so they reset the field on every render as well.

`value={null}` (or `checked={null}`) clears the field and keeps it controlled; leaving the prop out makes the field uncontrolled, so whatever the user typed stays.

## Labels and ids: uid()

Every field needs a label ([SYG702](/guide/accessibility/#syg702-form-field-without-a-label)). Wrapping the field in a `<label>` needs no id. When the label sits elsewhere, or a hint is attached with `aria-describedby`, the elements need ids, and a literal `id="email"` is repeated as soon as the component renders twice. Use the `uid` view prop instead:

```jsx
function Signup({ state, uid }) {
  return (
    <form className="signup">
      <label for={uid('email')}>Email</label>
      <input id={uid('email')} type="email" className="email" value={state.email} aria-describedby={uid('email-help')} />
      <p id={uid('email-help')}>We only use it to sign you in.</p>
    </form>
  )
}

Signup.initialState = { email: '' }
Signup.intent = ({ DOM }) => ({ EMAIL: DOM.input('.email').value() })
Signup.model = { EMAIL: (state, email) => ({ ...state, email }) }
```

`uid()` returns an id for this component instance, and `uid('email')` one derived from it (for example `u-email` at the root, longer further down the tree). Ids come from the instance's position in the tree and its Collection item key, never from a counter, so they:

- differ between two instances of the component, and between Collection items;
- stay the same across renders, and move with their item when a Collection is reordered;
- are the same on the server and after hydration ([SSR](/integration/ssr/#stable-ids-uid)).

`uid` is also on the reducers' `props` argument. It is a reserved prop: a parent can't pass its own `uid` to a child ([SYG106](/reference/errors/#syg106)). `sygnal-check` matches `for={uid('email')}` with `id={uid('email')}` ([SYG708](/guide/accessibility/#syg708-label-or-aria-reference-to-an-id-that-isnt-rendered)).

## Focus Management

Sygnal components are pure functions — they never touch real DOM elements. But web apps frequently need to focus an element programmatically, for example when an input appears for inline editing.

The `autoFocus` and `autoSelect` JSX props handle this declaratively. No imperative code in your view, no drivers, no hooks.

### autoFocus

Add `autoFocus={true}` to any element. When that element enters the DOM, it receives focus automatically:

```jsx
function SearchBar({ state }) {
  return (
    <div>
      {state.isOpen &&
        <input autoFocus={true} className="search-input" placeholder="Search..." />
      }
    </div>
  )
}
```

### autoSelect

Add `autoSelect={true}` alongside `autoFocus` to select all text in the element after focusing. This is ideal for edit-in-place patterns where the user typically wants to replace the existing value:

```jsx
function EditableTitle({ state }) {
  return (
    <div>
      {state.isEditing
        ? <input autoFocus={true} autoSelect={true} value={state.draft} className="title-input" aria-label="Title" />
        : <h2 className="title">{state.title}</h2>
      }
    </div>
  )
}

EditableTitle.intent = ({ DOM }) => ({
  EDIT:  DOM.dblclick('.title'),
  DRAFT: DOM.input('.title-input').value(),
  SAVE:  DOM.blur('.title-input'),
})

EditableTitle.model = {
  EDIT:  (state) => ({ ...state, isEditing: true, draft: state.title }),
  DRAFT: (state, draft) => ({ ...state, draft }),
  SAVE:  (state) => ({ ...state, isEditing: false, title: state.draft }),
}
```

When the user double-clicks to edit, the input appears focused with all text selected — ready to type a replacement.

### How It Works

These props are intercepted by the JSX pragma before they reach the DOM. Under the hood, a snabbdom `insert` hook calls `.focus()` (and optionally `.select()`) when the element is first inserted. The props are never passed to the actual DOM element.

If you also set a manual `hook={{ insert: fn }}` on the same element, both hooks run — yours first, then the focus behavior.
