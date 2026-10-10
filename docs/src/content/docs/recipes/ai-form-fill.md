---
title: Structured Output into a Form
description: Paste free text, let a chat model extract the fields with a schema, and fill a form behavior's fields with the validated value — the user reviews and submits
---

A contact form with a shortcut: paste an email signature, and a [chat model](/guide/ai-chat/) fills in the fields. The model answers with [structured output](/guide/ai-chat/#structured-output), validated against a schema, and each field it found goes into the [`form` behavior](/guide/forms/) as if the user had typed it. Nothing is saved until the user checks the fields and submits, with the form's own validation.

The pieces:

- **Two schemas.** The extraction schema says what the model may answer: every field can be `null` (not in the text). The form's schema says what the user may submit.
- **The `ok` action fills the form** with one `form.SET` holding the fields the model found, so those fields are validated and marked as changed like typed ones.
- **The model never submits.** The user does.

## The form

In this demo, the signature is read as soon as the demo shows. Paste another one and fill again; or edit a field and submit.

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

let nextId = 1

export default {
  // the chat model: reads a signature (a real model reads anything)
  'POST /v1/responses': ({ json }) => {
    const text = String(json.input.at(-1).content)
    const contact = {
      name: text.split('\n')[0].trim() || null,
      email: text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null,
      company: text.split('\n')[1]?.split('|')[1]?.trim() || null,
      phone: text.match(/\+?[\d ()-]{7,}\d/)?.[0].trim() ?? null,
    }
    return { sse: encodeOpenResponses(JSON.stringify(contact).match(/.{1,20}/g)), delayMs: 300, chunkMs: 40 }
  },
  'POST /api/contacts': ({ json }) => ({ status: 201, json: { id: nextId++, ...json } }),
}
```

```jsx live live-height=420
import { z } from 'zod'
import { ABORT, form } from 'sygnal'

// what the model may answer: null for "not in the text"
const Extracted = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  company: z.string().nullable(),
  phone: z.string().nullable(),
})

// what the user may submit
const contactSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name'),
  email: z.string().trim().email('Enter a valid email address'),
  company: z.string().trim(),
  phone: z.string().trim(),
})

const SIGNATURE = 'Dana Whitfield\nHead of Operations | Northwind Traders\ndana.whitfield@northwind.example\n+1 (555) 014-2290'

const read = (text) => ({
  instructions: 'Extract the contact details from the text. Use null for anything that is not there.',
  messages: [{ role: 'user', content: text }],
  output: Extracted,
  ok: 'EXTRACTED',
  error: 'NOT_EXTRACTED',
})

function Field({ field, label, id }) {
  return (
    <p>
      <label for={id}>{label}</label>{' '}
      <input id={id} name={field.name} value={field.value} aria-invalid={field.invalid} aria-describedby={`${id}-error`} />
      <span id={`${id}-error`}> {field.error}</span>
    </p>
  )
}

function NewContact({ state, uid }) {
  const f = state.form.fields
  return (
    <section className="new-contact">
      <form className="paste">
        <label for={uid('paste')}>Paste a signature</label>
        <textarea id={uid('paste')} className="pasted" rows="4" value={state.pasted} />
        <button type="submit" disabled={state.reading}>{state.reading ? 'Reading…' : 'Fill in the form'}</button>
        <span role="status"> {state.note}</span>
      </form>
      <form className="contact" noValidate>
        <Field field={f.name} label="Name" id={uid('name')} />
        <Field field={f.email} label="Email" id={uid('email')} />
        <Field field={f.company} label="Company" id={uid('company')} />
        <Field field={f.phone} label="Phone" id={uid('phone')} />
        <button type="submit" disabled={state.form.submitting}>Save contact</button>
        <span className="saved"> {state.savedId ? `Saved as contact ${state.savedId}.` : ''}</span>
      </form>
    </section>
  )
}

NewContact.initialState = { pasted: SIGNATURE, reading: false, note: '', savedId: null }

NewContact.uses = {
  form: form(contactSchema, { form: '.contact', values: { name: '', email: '', company: '', phone: '' }, submit: 'SAVE' }),
}

NewContact.intent = ({ DOM }) => ({
  PASTE: DOM.input('.pasted').value(),
  FILL: DOM.select('.paste').events('submit', { preventDefault: true }),
})

NewContact.model = {
  BOOTSTRAP: {
    STATE: (state) => ({ ...state, reading: true }),
    LLM: (state) => read(state.pasted),
  },
  PASTE: (state, pasted) => ({ ...state, pasted }),
  FILL: {
    STATE: (state) => (state.pasted.trim() ? { ...state, reading: true, note: '' } : ABORT),
    LLM: (state) => (state.pasted.trim() ? read(state.pasted) : ABORT),
  },
  EXTRACTED: {
    STATE: (state, { value }) => ({ ...state, reading: false, note: value.name === null ? 'No name found: add it, then save.' : 'Check the fields, then save.' }),
    // the fields the model found, as if the user had typed them
    EFFECT: (state, { value }, next) => {
      next('form.SET', { values: Object.fromEntries(Object.entries(value).filter(([, text]) => text !== null)) })
    },
  },
  NOT_EXTRACTED: (state) => ({ ...state, reading: false, note: 'Could not read that. Fill in the form by hand.' }),
  SAVE: { HTTP: (state, values) => ({ url: '/api/contacts', method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) },
  'form.DONE': (state, contact) => ({ ...state, savedId: contact.id }),
}
```

```css live
.new-contact textarea { width: 100%; }
.new-contact form { margin-bottom: 1rem; }
```

- **The extraction schema is loose, the form's is strict.** The model may find no email; the form still requires one. A wrong value from the model (an email without `@`) shows the form's error once the user leaves the field or submits, as for anything typed.
- **`form.SET`, not `form.RESET`**: a reset makes the values the form's starting point, so they would count as unchanged, and it would clear what the user had already typed in the fields the model didn't find. `form.SET` changes only the fields it names, in one validation.
- **`null`, not optional.** Providers' strict modes require every key, so "not found" is a `null` value. `.nullable()` also tells the model plainly that it may say so.
- **Keep the user in the loop.** The model's answer is a suggestion: the form shows it, the user saves it.

## Testing

`t.respond('LLM', object)` sends the object as the reply's JSON, so `EXTRACTED` gets it as `value`:

```js
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import NewContact from './NewContact.jsx'

it('fills the fields the model found, and saves only on submit', async () => {
  const t = renderComponent(NewContact)
  await t.respond('LLM', { name: 'Dana Whitfield', email: 'dana@northwind.example', company: null, phone: null })
  expect(t.state.form.values).toEqual({ name: 'Dana Whitfield', email: 'dana@northwind.example', company: '', phone: '' })
  expect(t.requests('HTTP')).toEqual([])

  t.simulateEvent('.contact', 'submit')
  await t.respond('HTTP', { id: 7 })
  expect(t.state.savedId).toBe(7)
  t.dispose()
})
```
