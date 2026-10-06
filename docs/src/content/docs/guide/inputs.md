---
title: Inputs, Labels and Focus
description: Controlled and uncontrolled inputs, stable ids for labels and ARIA references with uid(), and autoFocus / autoSelect
---

How Sygnal treats the value of a field, how to give labels and descriptions ids that stay unique, and how to focus a field when it appears. For forms with validation, see [Forms](/guide/forms/).

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

**Uncontrolled**: leave out `value`, and read the element's value from the event when you need it (on blur, Enter or submit), or with [`processForm()`](/guide/forms-reference/#processform):

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
