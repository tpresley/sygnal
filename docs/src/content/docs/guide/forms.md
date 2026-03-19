---
title: Forms & Focus
description: Form handling and focus management
---

## Form Handling

Sygnal provides `processForm()` to simplify working with HTML forms:

```jsx
import { processForm } from 'sygnal'

function ContactForm({ state }) {
  return (
    <form className="contact-form">
      <input name="name" value={state.name} />
      <input name="email" value={state.email} />
      <textarea name="message">{state.message}</textarea>
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
    STATE: (state, data) => ({ ...state, submitted: true }),
    LOG: (state, data) => data  // { name: '...', email: '...', message: '...', eventType: 'submit' }
  }
}
```

### processForm() Options

```javascript
processForm(domSource, options?)
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
        ? <input autoFocus={true} autoSelect={true} value={state.title} className="title-input" />
        : <h2 className="title">{state.title}</h2>
      }
    </div>
  )
}
```

When the user double-clicks to edit, the input appears focused with all text selected — ready to type a replacement.

### How It Works

These props are intercepted by the JSX pragma before they reach the DOM. Under the hood, a snabbdom `insert` hook calls `.focus()` (and optionally `.select()`) when the element is first inserted. The props are never passed to the actual DOM element.

If you also set a manual `hook={{ insert: fn }}` on the same element, both hooks run — yours first, then the focus behavior.
