---
title: Forms
description: The form behavior — validation, submit to the server, pending state, server (422) errors and field arrays in one recipe, then field types, options and testing
---

A form with validation is one [behavior](/guide/behaviors/): `form(schema, options)` in the component's `uses`. It keeps the values, errors and touched fields in `state.form`, validates with any [Standard Schema](https://standardschema.dev) validator (zod, valibot, arktype, or your own object), and handles the submit. Sygnal has no validator dependency.

This page is the recipe and what you need around it. The [Forms reference](/guide/forms-reference/) has the full slice and action tables, async checks (is this email taken?), two forms in one component, rows as components, resetting, the helpers for a form without the behavior, and `processForm()`. Controlled inputs, `uid()` and `autoFocus` are on [Inputs, Labels and Focus](/guide/inputs/).

## The recipe

In this demo, a stand-in server answers the request: `taken@example.com` is already registered, any other address gets an account.

```js live-server
let nextId = 1

export default {
  'POST /api/signup': ({ json }) => json.email === 'taken@example.com'
    ? { status: 422, json: { errors: { email: 'Already registered' } } }
    : { status: 201, json: { id: nextId++ } },
}
```

Validation, a list of rows the user adds and removes, the submit to the server, the pending button, and the server's errors:

```jsx live
import { form } from 'sygnal'
import { z } from 'zod'

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  addresses: z.array(z.object({ city: z.string().trim().min(1, 'Enter a city') })).min(1, 'Add at least one address'),
})

function Signup({ state, uid }) {
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
        const city = f[`addresses.${row.id}.city`]
        return (
          <fieldset className="address">
            <legend>Address {i + 1}</legend>
            <label for={uid(`city-${row.id}`)}>City</label>
            <input id={uid(`city-${row.id}`)} name={city.name} value={city.value} aria-invalid={city.invalid} aria-describedby={uid(`city-${row.id}-error`)} />
            <p id={uid(`city-${row.id}-error`)}>{city.error}</p>
            <button type="button" className="remove" data-id={row.id} disabled={rows.length === 1}>Remove</button>
          </fieldset>
        )
      })}
      <p>{f.addresses.error}</p>
      <button type="button" className="add">Add address</button>

      <p role="alert">{state.form.error}</p>
      <button type="submit" disabled={state.form.submitting}>{state.form.submitting ? 'Signing up…' : 'Sign up'}</button>
      <p className="done">{state.accountId ? `Account ${state.accountId} created.` : ''}</p>
    </form>
  )
}

Signup.initialState = { accountId: null }

Signup.uses = {
  form: form(signupSchema, { values: { name: '', email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP' }),
}

Signup.intent = ({ DOM }) => ({
  'form.ADD': DOM.click('.add').mapTo({ field: 'addresses', value: { city: '' } }),
  'form.REMOVE': DOM.click('.remove').map((e) => ({ field: 'addresses', id: e.target.dataset.id })),
})

Signup.model = {
  SIGN_UP: { HTTP: (state, values) => ({ url: '/api/signup', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
  'form.DONE': (state, account) => ({ ...state, accountId: account.id }),
}
```

`main.js` runs it with `run(Signup, { HTTP: makeFetchDriver() })`. There is no intent per field: the two intent entries are the row buttons.

## What the form does

- **Fields are matched by `name`.** The behavior listens for `input`, `focusout` and `submit` on the form element (option `form`, default `'form'`), so every field inside it whose `name` is a path in `values` is controlled: `value={f.email.value}` stays in sync as the user types. Array rows are named by their `id`: `addresses.7.city`.
- **`state.form.fields[name]`** is what the view needs for each field: `value`, `error` (the message to show, `''` for none), `invalid` (`!!error`, for `aria-invalid`), `touched`, `dirty` and `pending` (an [async check](/guide/forms-reference/#async-checks) is running), plus `name`.
- **When errors show**: every change is validated, but a field's schema error shows once the field has lost focus (`show: 'blur'`, the default), or while typing (`show: 'input'`), or only after a submit (`show: 'submit'`). After the first submit every error shows, and each follows the typing. Server errors show at once.
- **An invalid submit** shows every error, focuses the first invalid field in page order (rows included) and sends nothing.
- **A valid submit** dispatches the `submit` action (`SIGN_UP`) with the schema's output: the trimmed, transformed values (`email` lower-cased here; the rows without their `id`, because `z.object` strips keys it doesn't declare), not the raw ones. Your model entry for it sends the request, with `ok: 'form.DONE'` and `error: 'form.ERRORS'` as its reply actions.
- **Pending**: when the submit entry sends a request (an `HTTP` sink), `state.form.submitting` is `true` from the valid submit until `form.DONE` or `form.ERRORS` arrives. Use it for the button's text and `disabled`. A second submit meanwhile is dropped, so a double click sends once.
- **`form.DONE`** marks the submit saved: `submitting` turns off, `submitted` on, and the saved values become the new start values (`dirty` is `false` again). A host model entry with the same name runs after the form's and gets the reply body: `'form.DONE': (state, account) => …` above shows the new account's id.
- **Labels and errors**: each field has a label and its error text is linked with `aria-describedby`, with ids from [`uid()`](/guide/inputs/#labels-and-ids-uid) (a row's ids include its `id`, so they stay unique), so the form passes the [accessibility checks](/guide/accessibility/). `aria-invalid={f.email.invalid}` renders `"true"` or `"false"`.

Reserve the height of the error lines in your CSS (`min-height`). A field's error appears when it loses focus, which happens on the mouse*down* of a click elsewhere: if the new line pushes the button down before the mouse*up*, the click is lost.

```css live
.signup p { min-height: 1.5em; }
```

## Submit without a request

A submit that sends nothing (a wizard step's "Next", a dialog's "OK") is an entry with `STATE`, `PARENT` or `EVENTS` and no `HTTP`. It is done at once: `submitting` stays `false`, `submitted` turns on, and you send no `form.DONE`.

```jsx
AccountStep.uses = { form: form(accountSchema, { values: { email: '', password: '' }, submit: 'NEXT' }) }
AccountStep.model = {
  NEXT: { PARENT: (state, values) => ({ type: 'NEXT', email: values.email }) },
}
```

**Wizards**: each step is a child with a `state` prop (`<AccountStep state="account" />`); the parent switches steps on its `PARENT` message. The step's `form` slice lives in the parent's state, so after "Back" the step mounts with its values kept (and `submitting` off, even if it unmounted mid-request). Make "Next" a `type="submit"` button inside the `<form>`; in a test, simulate `'submit'` on the form (the mock DOM doesn't turn a click into a submit).

## Start empty on each visit

The values live in state, so they survive a visit (a [Switchable](/guide/switchable/) page shares its parent's state and stays alive while hidden). For a form that starts empty each time it is shown, set `resetOnShow: true`; a start value from state goes in a `values` function:

```jsx
NewExpensePage.uses = {
  form: form(expenseSchema, {
    values: (state) => ({ ...EMPTY, category: state.settings.defaultCategory }),
    submit: 'SAVE',
    resetOnShow: true,
  }),
}
```

Typing while it is shown is kept; a wizard step leaves it off. [The rule](/guide/forms-reference/#saving-and-resetting).

## Server errors and failed submits

The server has the last word. With `error: 'form.ERRORS'` on the request, a failed reply goes to the form, which turns `submitting` off, puts the reply's errors on their fields, shows them at once and focuses the first one in page order. A `422` reply's body can be either shape:

```json
{ "errors": { "password": "Too common", "addresses.1.city": "Unknown city" } }
```

```json
{ "errors": [{ "path": ["addresses", 0, "city"], "message": "Unknown city" }, { "path": ["email"], "message": "Already registered" }] }
```

- A map from field name to a message (or a list of messages: the first shows), or a list of `{ path, message }` issues. In an issue path, a number is the row's position in the array the server got, and it becomes that row's `id` (`addresses.0.city` names the first row's city, whatever its `id`). In a map, a name is a field name, so rows go by `id`.
- `form.ERRORS` also accepts the map or the list itself (`t.simulateAction('form.ERRORS', { email: 'Taken' })`).
- A message for a name that isn't a field (`{ "message": "Down for maintenance" }`) becomes the form-level `state.form.error`. A reply with no message at all (a `500` with an empty body, a network error) shows `"Request failed (500)"` there, or `"Request failed"` without a status. The recipe renders it in `<p role="alert">`.
- Editing a field clears its server error, and the form-level one.

For your own text on failures other than a `422`, add a host entry: it runs after the form's and gets the [error reply](/guide/http/) `{ error, status, body, request }` (`status` is `undefined` for a network error):

```js
Checkout.model = {
  'form.SUBMIT': (state) => ({ ...state, failed: false }),
  'form.ERRORS': (state, reply) => ({ ...state, failed: reply.status !== 422 }),
}
// view: <p role="alert">{state.failed ? 'Could not place the order. Try again.' : ''}</p>
```

## Field arrays

Rows of an array of objects are named by their `id`, not their position, so a row's errors, touched state and focus stay with it when another row is removed. Render the rows inline with `.map()`, as in the recipe:

- **Names**: `name={f[`addresses.${row.id}.city`].name}`. Each row needs an `id` in the start values ([SYG236](/reference/errors/#syg236)).
- **Add**: `form.ADD` with `{ field, value }` appends `{ id, ...value }` with the next free id: `'form.ADD': DOM.click('.add').mapTo({ field: 'addresses', value: { city: '' } })`.
- **Remove**: `form.REMOVE` with `{ field, id }` removes that row (the id can be the string from `data-id`): `'form.REMOVE': DOM.click('.remove').map((e) => ({ field: 'addresses', id: e.target.dataset.id }))`.
- **Numbering**: the row's position is the map's index (`Address {i + 1}`); it renumbers after a remove, while the row's `id`, name and ids stay.
- **The array itself is a field** (`f.addresses`), for an array-level error such as "Add at least one address" (`z.array(…).min(1, …)`).

No child component is needed for a row. When a row is big enough to be a component of its own, see [rows as components](/guide/forms-reference/#rows-as-components).

## Field types

What `state.form.values[name]` gets from each kind of field, and how to bind it:

| Field | Value | Bind |
|---|---|---|
| `<input>` (text, email, password, search, tel, url), `<textarea>` | The text | `value={f.email.value}` |
| `<input type="number">`, `range`, `date`, `time` | The text as the browser gives it (`'42'`, `'2026-10-05'`; `''` when empty) | `value={f.age.value}`; convert in the schema: `z.coerce.number()`, `v.pipe(v.string(), v.transform(Number), v.number())` |
| `<input type="radio">` (same `name`) | The checked radio's `value` | `checked={f.size.value === 'm'}` |
| `<input type="checkbox">` on a boolean | `checked` | `checked={f.agree.value}` |
| Checkboxes sharing a `name` on an array | The array of the checked boxes' `value`s (checking adds it, unchecking removes it) | `values: { tags: [] }`, `<input type="checkbox" name="tags" value="news" checked={f.tags.value.includes('news')} />` |
| `<select>` | The selected option's `value` | `value={f.country.value}` |
| `<select multiple>` | The array of selected `value`s | `selected={f.colors.value.includes('red')}` on each `<option>` |
| A form-associated custom element (`<wa-input>`, `<wa-select>`) | Its `value` | `value={f.nick.value}` |
| A form-associated custom checkbox or switch (`<wa-checkbox>`, `<wa-switch>`: a hyphenated tag with a boolean `checked`) | `checked` (as a group on an array, like checkboxes) | `checked={f.news.value}` |
| `<input type="file">` | Not handled: the form ignores it | Leave `value` unbound; read `e.target.files` in your own intent and keep the files out of `values` |

## Options

| Option | |
|---|---|
| `values` | The start values (or a function of the host's state). Field names are paths in it: `email`, `address.city`, and `addresses.7.city` for the row with `id` 7 |
| `submit` | The host action a valid submit dispatches with the schema's output ([SYG234](/reference/errors/#syg234) when the model has no such entry). An entry with an `HTTP` sink keeps the submit pending until its reply; any other is done at once ([submit without a request](#submit-without-a-request)) |
| `show` | `'blur'` (default), `'input'` or `'submit'`: when a schema error shows |
| `form` | The form element's selector, default `'form'`. Give each form its own when a component has two: `form: '.login'` and `form: '.news'` ([two forms](/guide/forms-reference/#two-forms-in-one-component), [SYG237](/reference/errors/#syg237)) |
| `check` | [Async checks](/guide/forms-reference/#async-checks) by field name |
| `http` | The driver sink of the requests, default `'HTTP'`: the checks' requests go to it, and a submit entry with this sink waits for its reply |
| `resetOnShow` | `true`: start over each time the form is shown ([start empty on each visit](#start-empty-on-each-visit)) |
| `tool` | Experimental: `{ name, description, autosubmit? }` offers the form to the browser's agent ([WebMCP](/guide/forms-reference/#offer-the-form-to-the-browsers-agent)) |

The form's actions are named after the `uses` key (`form.ADD` for `uses = { form: … }`): `form.CHANGE`, `form.BLUR`, `form.SUBMIT`, `form.ADD`, `form.REMOVE`, `form.ERRORS`, `form.DONE` and `form.RESET` ([the actions](/guide/forms-reference/#the-actions)). A host model entry with one of those names runs after the form's, on the full state; trigger one from elsewhere with an intent action of that name, or `t.simulateAction('form.RESET')` in a test. Don't name `submit` after one ([SYG234](/reference/errors/#syg234)).

## Testing

Simulate events on the fields by `name`, answer the requests, and read `t.state.form`:

```jsx
import { renderComponent } from 'sygnal'
import { it, expect } from 'vitest'
import Signup from './Signup.jsx'

it('validates, adds a row, posts the cleaned values and shows the server errors', async () => {
  const t = renderComponent(Signup, { strict: true })
  await t.ready()
  t.simulateEvent('[name="email"]', 'input', { value: 'nope' })
  t.simulateEvent('[name="email"]', 'focusout')
  await t.settle()
  expect(t.state.form.fields.email.error).toBe('Enter a valid email address')

  t.simulateEvent('[name="name"]', 'input', { value: ' Ada ' })
  t.simulateEvent('[name="email"]', 'input', { value: 'Ada@Example.com' })
  t.simulateEvent('[name="addresses.1.city"]', 'input', { value: 'London' })
  t.simulateEvent('.add', 'click')
  t.simulateEvent('[name="addresses.2.city"]', 'input', { value: 'Paris' })
  t.simulateEvent('.signup', 'submit')
  await t.settle()
  expect(t.state.form.submitting).toBe(true)
  expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/signup', json: { name: 'Ada', email: 'ada@example.com', addresses: [{ city: 'London' }, { city: 'Paris' }] } })

  await t.fail('HTTP', { status: 422, body: { errors: [{ path: ['addresses', 1, 'city'], message: 'Unknown city' }] } })
  expect(t.state.form.fields['addresses.2.city'].error).toBe('Unknown city')
  expect(t.state.form.submitting).toBe(false)
  t.expectNoDiagnostics()
})
```

- `simulateEvent` takes a CSS selector (`'[name="email"]'`, `'.remove[data-id="2"]'`), never an element from `t.query()`.
- `await t.respond('HTTP', body)` and `await t.fail('HTTP', { status, body })` answer the newest request the component has sent (check `t.requests('HTTP')` first) and resolve once the reply is reduced and rendered: read `t.state` right after them. `t.next(pred)` would wait for a further state and time out.
- `t.state.form.fields[name]` is what the view shows; `t.query('[name="email"]').getAttribute('aria-invalid')` checks the markup.
- The focus on a failed submit is an [element command](/guide/element-commands/): `t.commands('ELEMENT').at(-1).focus.within` is the selector of the invalid fields on the default mock DOM; with `renderComponent(Signup, { dom: 'real' })` the field is focused (`document.activeElement`).

## More

On the [Forms reference](/guide/forms-reference/):

- [the slice](/guide/forms-reference/#the-slice) (`values`, `initial`, `errors`, `touched`, `server`, `submitCount`, `queued`, `validating`, `valid`, `dirty`…) and [the actions](/guide/forms-reference/#the-actions) with their data;
- [any Standard Schema](/guide/forms-reference/#any-standard-schema): a hand-written schema, async schemas;
- [async checks](/guide/forms-reference/#async-checks) on blur, [two forms in one component](/guide/forms-reference/#two-forms-in-one-component), [rows as components](/guide/forms-reference/#rows-as-components), [saving and resetting](/guide/forms-reference/#saving-and-resetting);
- [the helpers](/guide/forms-reference/#without-the-behavior-the-helpers) for a form without the behavior, the [diagnostics](/guide/forms-reference/#diagnostics), and [`processForm()`](/guide/forms-reference/#processform) for a form without validation.
